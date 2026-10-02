# OpenCode adapter

`zeus_opencode_hook.py` integrates the OpenCode agent runtime with the Zeus gateway, relaying prompt lifecycle, tool execution, and remote approvals directly to your Zeus desktop island and mobile companion.

## Setup

Place `adapters/common` and `adapters/opencode` under a shared path (e.g. `~/.zeus/adapters/` or directly inside the repository workspace).

### Configuration

Add `zeus_opencode_hook.py` to your OpenCode hooks or plugin configuration:

```json
{
  "hooks": {
    "tool_before_call": "python3 /path/to/zeus_opencode_hook.py",
    "tool_after_call": "python3 /path/to/zeus_opencode_hook.py",
    "prompt_completed": "python3 /path/to/zeus_opencode_hook.py",
    "session_end": "python3 /path/to/zeus_opencode_hook.py"
  }
}
```

### Environment variables

- `ZEUS_GATEWAY_URL` - gateway base URL (default: `http://127.0.0.1:8080`).
- `ZEUS_GATEWAY_TOKEN` - paired agent token (`ZEUS_AGENT_TOKEN` or `ZEUS_ADMIN_TOKEN` for local development).
- `ZEUS_APPROVAL_TIMEOUT` - seconds Zeus waits for desktop/mobile approval (default: `25`).
- `ZEUS_OPENCODE_PROVIDER` - model provider label (default: `anthropic`, `openai`, `deepseek`, etc.).

### Fail-Open Principle

In accordance with Zeus design rules, this adapter is **strictly fail-open**: if the Zeus gateway is unreachable or offline, the tool execution proceeds directly to OpenCode's native confirmation dialog without blocking the agent.
