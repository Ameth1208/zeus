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


def tool_details(tool: str, tool_input):
    if not isinstance(tool_input, dict):
        return "", ""
    command = tool_input.get("command") if isinstance(tool_input.get("command"), str) else ""
    path = ""
    for key in ("path", "file_path", "target_file"):
        if isinstance(tool_input.get(key), str):
            path = str(tool_input[key])
            break
    return command, path


def tool_event(hook: str, tool: str, command: str, path: str) -> str:
    if hook == "PermissionRequest":
        return "permission.requested"
    before = hook == "PreToolUse"
    lower = tool.lower()
    if command or lower == "bash":
        return "command.started" if before else "command.completed"
    if path and any(word in lower for word in ("read", "glob", "grep", "search")):
        return "file.read"
    if path or lower in ("apply_patch", "edit", "write"):
        return "tool.started" if before else "file.changed"
    return "tool.started" if before else "tool.completed"


def main() -> int:
    data = read_stdin_json()
    hook = str(data.get("hook_event_name") or data.get("hookEventName") or "Unknown")
    native_session = str(data.get("session_id") or data.get("sessionId") or "unknown")
    native_agent = str(data.get("agent_id") or native_session)
    session = global_session_id("codex", native_session)
    agent = global_agent_id("codex", native_agent)
    cwd = str(data.get("cwd") or os.getcwd())
    model = str(data.get("model") or "")
    tool = str(data.get("tool_name") or "")
    tool_input = data.get("tool_input") or {}
    command, path = tool_details(tool, tool_input)
    provider = env("ZEUS_CODEX_PROVIDER", "openai")
    project = project_name(cwd)

    event_type = {
        "SessionStart": "session.started",
        "PreToolUse": tool_event(hook, tool, command, path),
        "PostToolUse": tool_event(hook, tool, command, path),
        "PermissionRequest": "permission.requested",
        "Stop": "session.completed",
        "Interrupt": "agent.interrupted",
        "SessionEnd": "session.stopped",
        "UserPromptSubmit": "message",
        "SubagentStart": "session.started",
        "SubagentStop": "session.completed",
    }.get(hook, "thinking")

    metadata = {"native_hook": hook, "native_session_id": native_session}
    for key in ("turn_id", "tool_use_id", "agent_id", "agent_type", "trigger", "permission_mode"):
        if key in data:
            metadata[key] = data[key]

    req_id = ""
    if hook == "PermissionRequest":
        req_id = request_id("codex")
        metadata["request_id"] = req_id
        metadata["tool_input"] = tool_input
        description = tool_input.get("description") if isinstance(tool_input, dict) else None
        if description:
            metadata["description"] = description

    message = ""
    if hook == "Stop":
        message = str(data.get("last_assistant_message") or "")
    elif hook == "UserPromptSubmit":
        message = str(data.get("prompt") or data.get("user_prompt") or "")

    emit(event(
        session_id=session,
        agent_id=agent,
        runtime="codex",
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

    # JSON with no decision means Codex keeps its native behavior.
    if hook != "PermissionRequest":
        print_json({})
        return 0

    if env("ZEUS_REMOTE_APPROVALS", "0") != "1":
        print_json({})
        return 0

    timeout = float(env("ZEUS_APPROVAL_TIMEOUT", "25"))
    choice = wait_for_permission(agent, session, req_id, timeout)
    if choice == "approve":
        emit(event(session_id=session, agent_id=agent, runtime="codex", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "allow"}))
        print_json({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}})
    elif choice == "deny":
        emit(event(session_id=session, agent_id=agent, runtime="codex", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "deny"}))
        print_json({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": "Denied from Zeus."}}})
    else:
        # Fail open to Codex's own approval UI when Zeus cannot decide in time.
        print_json({})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
