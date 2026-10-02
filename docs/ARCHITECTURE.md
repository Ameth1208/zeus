# Zeus architecture

```text
Codex / Claude Code / Antigravity / Generic
                  |
               adapters
                  |
          HTTPS + Agent token
                  v
            Zeus Gateway (VPS)
        + sessions + persistence
        + device pairing
        + event/action SSE
        + provider registry
          /       |        \
   macOS island  Flutter   Tauri
                  iOS/
                Android
```

## Trust boundaries

1. **Runtime adapters** can publish events and subscribe to actions, but cannot create pairing codes or enumerate devices.
2. **Paired clients** can read session state and send only capabilities advertised by a session.
3. **Admin** can issue pairing codes and revoke clients. Never embed the admin token in an app.
4. **Provider API keys** stay on Gateway. Clients see only provider metadata, never secrets.

## IDs

A native runtime session is expanded to `machine-id:runtime:native-session-id`. This prevents collisions across several computers.

## Approval safety

A permission request gets a unique `request_id`. The current request is persisted with the session. Zeus rejects an approval carrying another request id. If a remote adapter times out, it falls back to that runtime's native approval behavior instead of silently allowing a command.

## Provider abstraction

The Gateway implements `openai-compatible` and `anthropic-compatible` chat transports. DeepSeek, Gemini, OpenRouter and Ollama can use the OpenAI-compatible transport when configured accordingly. This layer is deliberately independent from runtime adapters.
