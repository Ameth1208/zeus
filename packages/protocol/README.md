# Zeus Agent Protocol (ZAP) v0.1

ZAP is the stable boundary between agent runtimes and Zeus clients. An adapter translates native runtime hooks into normalized events. Desktop/mobile clients never need to understand Codex, Claude Code or Antigravity hook payloads directly.

## Event transport

Adapters `POST /v1/events` using the server-only `ZEUS_AGENT_TOKEN`. Every session identifier is namespaced by machine + runtime so two computers can report the same native session id safely.

Important event kinds: `session.started`, `thinking`, `tool.started`, `file.changed`, `command.started`, `permission.requested`, `permission.resolved`, `session.completed`, `session.failed`.

A `permission.requested` event should include `metadata.request_id`. The Gateway records this id and rejects stale approvals.

## Action transport

Adapters keep an SSE connection to `/v1/actions/stream?agent_id=...`. Paired controllers publish `approve`, `deny`, `message`, `pause`, `resume`, or `stop`. An action is accepted only when the session advertises the capability. `approve`/`deny` are accepted only while that session is waiting for the current request.

## Authentication boundaries

- `ZEUS_ADMIN_TOKEN`: pairing and device administration only.
- `ZEUS_AGENT_TOKEN`: runtime adapters only.
- paired device token: mobile/desktop controller only; stored hashed by Gateway.

The admin token must never be embedded in a mobile or desktop build.
