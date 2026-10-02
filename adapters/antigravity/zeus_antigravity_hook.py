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


def tool_details(tool: str, args):
    if not isinstance(args, dict):
        return "", ""
    command = next((str(args[k]) for k in ("CommandLine", "command", "cmd", "script") if isinstance(args.get(k), str)), "")
    path = next((str(args[k]) for k in ("TargetFile", "target_file", "file_path", "path", "AbsolutePath") if isinstance(args.get(k), str)), "")
    return command, path


def mapped_tool_event(hook: str, tool: str, command: str, path: str, failed: bool) -> str:
    if failed:
        return "tool.failed"
    before = hook == "PreToolUse"
    lower = tool.lower()
    if command or "command" in lower or "shell" in lower:
        return "command.started" if before else "command.completed"
    if path and any(x in lower for x in ("read", "view", "search", "grep")):
        return "file.read"
    if path and any(x in lower for x in ("write", "replace", "edit")):
        return "tool.started" if before else "file.changed"
    return "tool.started" if before else "tool.completed"


def main() -> int:
    data = read_stdin_json()
    hook = str(data.get("hookEventName") or data.get("hook_event_name") or env("ZEUS_ANTIGRAVITY_HOOK", "PreToolUse"))
    native_session = str(data.get("conversationId") or "unknown")
    session = global_session_id("antigravity", native_session)
    agent = global_agent_id("antigravity", native_session)
    workspaces = data.get("workspacePaths") or []
    cwd = str(workspaces[0]) if workspaces else os.getcwd()
    model = str(data.get("modelName") or "")
    call = data.get("toolCall") or {}
    tool = str(call.get("name") or "") if isinstance(call, dict) else ""
    args = (call.get("args") or {}) if isinstance(call, dict) else {}
    command, path = tool_details(tool, args)
    provider = env("ZEUS_ANTIGRAVITY_PROVIDER", "google")
    project = project_name(cwd)
    remote = hook == "PreToolUse" and env("ZEUS_REMOTE_APPROVALS", "0") == "1"
    failed = bool(data.get("error"))

    if hook in ("PreToolUse", "PostToolUse"):
        event_type = "permission.requested" if remote else mapped_tool_event(hook, tool, command, path, failed)
    else:
        event_type = {
            "PreInvocation": "thinking",
            "PostInvocation": "message",
            "Stop": "session.completed",
        }.get(hook, "thinking")

    metadata = {"native_hook": hook, "native_session_id": native_session}
    if "stepIdx" in data:
        metadata["step_idx"] = data["stepIdx"]
    if args:
        metadata["tool_args"] = args
    if data.get("error"):
        metadata["error"] = data["error"]

    req_id = ""
    if remote:
        req_id = request_id("ag")
        metadata["request_id"] = req_id

    emit(event(
        session_id=session,
        agent_id=agent,
        runtime="antigravity",
        provider=provider,
        model=model,
        project=project,
        event_type=event_type,
        tool=tool,
        path=path,
        command=command,
        metadata=metadata,
    ))

    if hook != "PreToolUse":
        print_json({})
        return 0

    if not remote:
        # PreToolUse requires a decision. If this adapter is installed manually
        # without remote approvals, defer to Antigravity's normal ask flow.
        print_json({"decision": "ask", "reason": "Zeus remote approvals are disabled."})
        return 0

    timeout = float(env("ZEUS_APPROVAL_TIMEOUT", "25"))
    choice = wait_for_permission(agent, session, req_id, timeout)
    if choice == "approve":
        emit(event(session_id=session, agent_id=agent, runtime="antigravity", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "allow"}))
        print_json({"decision": "allow"})
    elif choice == "deny":
        emit(event(session_id=session, agent_id=agent, runtime="antigravity", provider=provider,
                   model=model, project=project, event_type="permission.resolved",
                   metadata={"request_id": req_id, "decision": "deny"}))
        print_json({"decision": "deny", "reason": "Denied from Zeus."})
    else:
        # Antigravity falls back to its own interactive approval UI.
        print_json({"decision": "force_ask", "reason": "Zeus did not answer in time."})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
