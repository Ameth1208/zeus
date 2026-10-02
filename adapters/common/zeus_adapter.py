#!/usr/bin/env python3
"""Dependency-free helpers shared by Zeus runtime adapters.

Runtime hooks must be fail-open: if Zeus Gateway is unreachable, the AI runtime's
native permission flow continues instead of being blocked by Zeus.
"""
from __future__ import annotations

import hashlib
import json
import os
import pathlib
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, Iterator, Optional


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def gateway_url() -> str:
    return env("ZEUS_GATEWAY_URL", "http://127.0.0.1:8080").rstrip("/")


def gateway_token() -> str:
    # Runtime adapters should never carry the VPS admin credential.
    return env("ZEUS_AGENT_TOKEN", env("ZEUS_GATEWAY_TOKEN"))


def machine_name() -> str:
    return env("ZEUS_MACHINE_NAME", socket.gethostname() or "Computer")


def machine_id() -> str:
    configured = env("ZEUS_MACHINE_ID").strip()
    if configured:
        return configured
    # Stable enough for a machine until its hostname changes, without collecting
    # hardware identifiers. Users can pin ZEUS_MACHINE_ID for long-lived setups.
    digest = hashlib.sha256(machine_name().encode("utf-8", "replace")).hexdigest()[:12]
    return f"host-{digest}"


def global_session_id(runtime: str, native_session_id: str) -> str:
    native = native_session_id or "unknown"
    return f"{machine_id()}:{runtime}:{native}"


def global_agent_id(runtime: str, native_agent_id: str) -> str:
    native = native_agent_id or "unknown"
    return f"{machine_id()}:{runtime}:{native}"


def project_name(cwd: Optional[str]) -> str:
    if not cwd:
        return "unknown"
    try:
        return pathlib.Path(cwd).resolve().name or "unknown"
    except Exception:
        return pathlib.Path(cwd).name or "unknown"


def request_id(prefix: str = "req") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def event(*, session_id: str, agent_id: str, runtime: str, event_type: str,
          provider: str = "", model: str = "", project: str = "",
          message: str = "", tool: str = "", path: str = "", command: str = "",
          metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "session_id": session_id,
        "agent_id": agent_id,
        "runtime": runtime,
        "type": event_type,
        "machine_id": machine_id(),
        "machine_name": machine_name(),
    }
    optional = {
        "provider": provider,
        "model": model,
        "project": project,
        "message": message,
        "tool": tool,
        "path": path,
        "command": command,
    }
    for key, value in optional.items():
        if value not in (None, ""):
            body[key] = value
    if metadata:
        body["metadata"] = metadata
    return body


def post_json(path: str, body: Dict[str, Any], timeout: float = 2.5) -> Optional[Dict[str, Any]]:
    token = gateway_token()
    if not token:
        return None
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        gateway_url() + path,
        data=data,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, socket.timeout):
        return None


def emit(body: Dict[str, Any]) -> None:
    # Hooks must never fail the agent just because Zeus Gateway is unavailable.
    post_json("/v1/events", body)


def action_stream(agent_id: str, timeout: float) -> Iterator[Dict[str, Any]]:
    token = gateway_token()
    if not token:
        return
    params = urllib.parse.urlencode({"agent_id": agent_id})
    req = urllib.request.Request(
        gateway_url() + "/v1/actions/stream?" + params,
        method="GET",
        headers={"Authorization": f"Bearer {token}", "Accept": "text/event-stream"},
    )
    deadline = time.monotonic() + timeout
    try:
        with urllib.request.urlopen(req, timeout=max(timeout, 1.0)) as response:
            data_lines = []
            while time.monotonic() < deadline:
                line = response.readline().decode("utf-8", "replace")
                if not line:
                    return
                line = line.rstrip("\r\n")
                if not line:
                    if data_lines:
                        try:
                            yield json.loads("\n".join(data_lines))
                        except json.JSONDecodeError:
                            pass
                        data_lines = []
                    continue
                if line.startswith("data:"):
                    data_lines.append(line[5:].lstrip())
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, socket.timeout):
        return


def wait_for_permission(agent_id: str, session_id: str, request: str, timeout: float) -> Optional[str]:
    for action in action_stream(agent_id, timeout):
        if action.get("session_id") != session_id:
            continue
        if action.get("kind") not in ("approve", "deny"):
            continue
        payload = action.get("payload") or {}
        action_request = payload.get("request_id")
        if action_request and action_request != request:
            continue
        return action["kind"]
    return None


def read_stdin_json() -> Dict[str, Any]:
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def print_json(obj: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, separators=(",", ":")))
    sys.stdout.write("\n")
