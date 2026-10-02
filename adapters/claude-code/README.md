# Claude Code adapter

Zeus observes Claude Code through its documented lifecycle hooks. The adapter emits normalized Zeus events without replacing Claude Code's own permission system.

## Environment

```bash
export ZEUS_GATEWAY_URL=https://zeus.example.com
export ZEUS_GATEWAY_TOKEN=...
export ZEUS_CLAUDE_PROVIDER=anthropic
```

Copy the hooks from `settings.example.json` into either `~/.claude/settings.json` or a project's `.claude/settings.json`, changing the absolute path first.

Remote approval is opt-in:

```bash
export ZEUS_REMOTE_APPROVALS=1
export ZEUS_APPROVAL_TIMEOUT=25
```

If Zeus does not answer before the timeout, the adapter prints no permission decision and Claude Code continues with its native permission flow. A remote allow also does not override Claude Code deny rules.
