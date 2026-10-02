# Codex adapter

Install `adapters/common` and this folder under `~/.zeus/adapters/`, then merge `hooks.example.json` into a trusted Codex hooks configuration.

Environment:

- `ZEUS_GATEWAY_URL` - gateway base URL.
- `ZEUS_GATEWAY_TOKEN` - paired device/service token (or `ZEUS_ADMIN_TOKEN` locally).
- `ZEUS_APPROVAL_TIMEOUT` - seconds Zeus waits for mobile/desktop approval; default 25.
- `ZEUS_CODEX_PROVIDER` - model provider label; default `openai` (can be `deepseek`, `openrouter`, etc. when Codex is routed elsewhere).

A permission timeout emits no decision, preserving Codex's normal native approval prompt.
