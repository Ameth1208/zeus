#!/usr/bin/env python3
"""OpenCode runtime adapter for Zeus.

Observes OpenCode tool executions and permission requests, mapping them to
normalized Zeus events. Always fails open.
"""
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
    command = tool_input.get("command") or tool_input.get("cmd") or ""
    path = ""
    for key in ("path", "file_path", "target_file", "filename"):
        if isinstance(tool_input.get(key), str):
            path = str(tool_input[key])
            break
    return str(command), path


def tool_event(hook: str, tool: str, command: str, path: str) -> str:
    if hook in ("PermissionRequest", "AskApproval", "permission_request"):
        return "permission.requested"
    before = hook in ("PreToolUse", "pre_tool", "before_tool")
    lower = tool.lower()
    if command or lower in ("bash", "sh", "terminal", "command"):
        return "command.started" if before else "command.completed"
    if path and any(word in lower for word in ("read", "view", "glob", "grep", "search")):
        return "file.read"
    if path or lower in ("write", "edit", "replace", "patch"):
        return "tool.started" if before else "file.changed"
    return "tool.started" if before else "tool.completed"


def main() -> int:
    data = read_stdin_json()
    hook = str(data.get("hook_event_name") or data.get("event") or "Unknown")
    native_session = str(data.get("session_id") or data.get("sessionId") or "unknown")
    native_agent = str(data.get("agent_id") or native_session)
    session = global_session_id("opencode", native_session)
    agent = global_agent_id("opencode", native_agent)
    cwd = str(data.get("cwd") or os.getcwd())
    model = str(data.get("model") or env("ZEUS_OPENCODE_MODEL", "DeepSeek R1"))
    provider = env("ZEUS_OPENCODE_PROVIDER", "opencode")
    tool = str(data.get("tool_name") or data.get("tool") or "")
    tool_input = data.get("tool_input") or data.get("parameters") or {}
    command, path = tool_details(tool, tool_input)

    if hook in ("SessionStart", "session_start"):
        emit(event(
            session_id=session,
            agent_id=agent,
            runtime="opencode",
            event_type="session.started",
            provider=provider,
            model=model,
            project=project_name(cwd),
            message="OpenCode session started",
        ))
        return 0

    if hook in ("SessionStop", "session_stop"):
        emit(event(
            session_id=session,
            agent_id=agent,
            runtime="opencode",
            event_type="session.stopped",
            provider=provider,
            model=model,
            project=project_name(cwd),
            message="OpenCode session stopped",
        ))
        return 0

    if hook in ("SessionComplete", "session_complete"):
        emit(event(
            session_id=session,
            agent_id=agent,
            runtime="opencode",
            event_type="session.completed",
            provider=provider,
            model=model,
            project=project_name(cwd),
            message="Task completed",
        ))
        return 0

    if hook in ("Thinking", "thinking"):
        emit(event(
            session_id=session,
            agent_id=agent,
            runtime="opencode",
            event_type="thinking",
            provider=provider,
            model=model,
            project=project_name(cwd),
            message=str(data.get("message") or "Thinking…"),
        ))
        return 0

    if hook in ("PermissionRequest", "AskApproval", "permission_request"):
        req = request_id("opencode")
        emit(event(
            session_id=session,
            agent_id=agent,
            runtime="opencode",
            event_type="permission.requested",
            provider=provider,
            model=model,
            project=project_name(cwd),
            tool=tool,
            command=command,
            path=path,
            message=str(data.get("message") or f"Allow {tool or 'action'}?"),
            metadata={"request_id": req},
        ))
        if env("ZEUS_REMOTE_APPROVALS") in ("1", "true"):
            timeout = int(env("ZEUS_APPROVAL_TIMEOUT", "20"))
            decision = wait_for_permission(req, timeout_seconds=timeout)
            if decision == "approve":
                print_json({"decision": "allow", "approved": True})
                return 0
            if decision == "deny":
                print_json({"decision": "deny", "approved": False})
                return 0
        return 0

    # General tool execution
    ev = tool_event(hook, tool, command, path)
    emit(event(
        session_id=session,
        agent_id=agent,
        runtime="opencode",
        event_type=ev,
        provider=provider,
        model=model,
        project=project_name(cwd),
        tool=tool,
        command=command,
        path=path,
        message=str(data.get("message") or f"{tool} in progress"),
    ))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        # Runtime hooks must be fail-open
        sys.exit(0)
