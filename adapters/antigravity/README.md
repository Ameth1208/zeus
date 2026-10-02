# Antigravity adapter

`hooks.example.json` is monitoring-only: it observes completed tools and model invocation lifecycle without inserting a new `PreToolUse` gate.

`hooks.remote-approvals.example.json` is optional. When enabled, selected mutating/execution tools are gated through Zeus. The hook can return `allow`, `deny`, `ask`, `force_ask`, or `deny_unless_prior_grant`. Zeus uses `allow`/`deny` only after an explicit mobile/desktop action; a timeout returns `force_ask`, so a dead gateway never becomes an approval bypass.

Install either definition into `.agents/hooks.json` or `~/.gemini/config/hooks.json` using Antigravity's named-hook schema. Set `ZEUS_ANTIGRAVITY_PROVIDER` if the runtime is routed to a non-Google model provider.
