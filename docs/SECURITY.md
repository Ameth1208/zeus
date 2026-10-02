# Security model

- Always put Zeus Gateway behind HTTPS.
- Keep its raw `:8080` port on localhost/private network.
- Generate different high-entropy `ZEUS_ADMIN_TOKEN` and `ZEUS_AGENT_TOKEN` values.
- Store paired-device tokens only in Keychain / secure storage on clients. Gateway persists only SHA-256 hashes of paired tokens.
- Provider secrets live only in Gateway environment variables.
- Remote approval is **opt-in** (`ZEUS_REMOTE_APPROVALS=1`).
- Adapters are fail-open to the runtime's native approval UI on network timeout; they do not auto-approve.
- Approval actions are bound to a current `request_id`, reducing stale/replay mistakes.
- Revoke a lost phone/desktop immediately with `zeusctl devices` then `zeusctl revoke <id>`.
- Configure `ZEUS_ALLOWED_ORIGINS` for Tauri/browser origins. Native mobile clients do not require CORS.
- Add reverse-proxy rate limits to `/v1/pair/complete` and protect the admin environment file with OS permissions.

For an Internet-facing production deployment, use firewall rules, automatic TLS, OS patching, backups of `/data`, and monitoring. Do not expose provider keys or admin tokens in logs/screenshots.
