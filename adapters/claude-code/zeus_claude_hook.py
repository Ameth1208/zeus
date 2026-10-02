#!/usr/bin/env python3
from __future__ import annotations

import os
import pathlib
import sys

COMMON = pathlib.Path(__file__).resolve().parents[1] / "common"
sys.path.insert(0, str(COMMON))
from zeus_adapter import (  # noqa:E402
    emit,
    env,
    event,
    global_agent_id,
    global_session_id,
    print_json,
    project_name,
    read_stdin_json,
    request_id,
    wait_for_permission,
)


def details(tool: str, args):
    if not isinstance(args, dict):
        return "", ""
    command = next((str(args[k]) for k in ("command", "cmd", "script") if isinstance(args.get(k), str)), "")
    path = next((str(args[k]) for k in ("file_path", "path", "target_file", "notebook_path") if isinstance(args.get(k), str)), "")
    return command, path


def tool_event(hook: str, tool: str, path: str, command: str) -> str:
    if hook == "PermissionRequest":
        return "permission.requested"
    if hook == "PostToolUseFailure":
        return "tool.failed"
    before = hook == "PreToolUse"
    lower = tool.lower()
    if command or lower in ("bash", "powershell"):
        return "command.started" if before else "command.completed"
    if path and any(word in lower for word in ("read", "glob", "grep")):
        return "file.read"
    if path and any(word in lower for word in ("write", "edit", "notebook")):
        return "tool.started" if before else "file.changed"
    return "tool.started" if before else "tool.completed"


def main() -> int:
    data = read_stdin_json()
    hook = str(data.get("hook_event_name") or "Unknown")
    native_session = str(data.get("session_id") or "unknown")
    native_subagent = str(data.get("agent_id") or native_session)
    session = global_session_id("claude-code", native_session)
    agent = global_agent_id("claude-code", native_subagent)
    cwd = str(data.get("cwd") or os.getcwd())
    tool = str(data.get("tool_name") or "")
    tool_input = data.get("tool_input") or {}
    command, path = details(tool, tool_input)
    provider = env("ZEUS_CLAUDE_PROVIDER", "anthropic")
    model = str(data.get("model") or env("ZEUS_CLAUDE_MODEL", ""))
    project = project_name(cwd)

    event_type = {
        "SessionStart": "session.started",
        "UserPromptSubmit": "message",
        "PermissionRequest": "permission.requested",
        "Stop": "session.completed",
        "StopFailure": "session.failed",
        "SubagentStart": "session.started",
        "SubagentStop": "session.completed",
        "SessionEnd": "session.stopped",
        "PreToolUse": tool_event(hook, tool, path, command),
        "PostToolUse": tool_event(hook, tool, path, command),
        "PostToolUseFailure": "tool.failed",
    }.get(hook, "thinking")

    metadata = {"native_hook": hook, "native_session_id": native_session}
    for key in ("permission_mode", "tool_use_id", "agent_id", "agent_type", "source"):
        if key in data:
            metadata[key] = data[key]

    req_id = ""
    if hook == "PermissionRequest":
        req_id = request_id("claude")
        metadata["request_id"] = req_id
        metadata["tool_input"] = tool_input
        metadata["permission_suggestions"] = data.get("permission_suggestions") or []

    message = ""
    if hook == "UserPromptSubmit":
        message = str(data.get("prompt") or "")
    elif hook == "StopFailure":
        message = str(data.get("error") or data.get("error_message") or "Claude Code turn failed")

    emit(event(
        session_id=session,
        agent_id=agent,
        runtime="claude-code",
        provider=provider,
        model=model,
        project=project,
        event_type=event_type,
        message=message,
        tool=tool,
        path=path,
        command=command,
        metadata=metadata,
    ))

    if hook != "PermissionRequest" or env("ZEUS_REMOTE_APPROVALS", "0") != "1":
        print_json({})
        return 0

    timeout = float(env("ZEUS_APPROVAL_TIMEOUT", "25"))
    choice = wait_for_permission(agent, session, req_id, timeout)
    if choice == "approve":
        emit(event(session_id=session, agent_id=agent, runtime="claude-code", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "allow"}))
        print_json({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}})
    elif choice == "deny":
        emit(event(session_id=session, agent_id=agent, runtime="claude-code", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "deny"}))
        print_json({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": "Denied from Zeus."}}})
    else:
        # No decision preserves Claude Code's native permission flow.
        print_json({})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
