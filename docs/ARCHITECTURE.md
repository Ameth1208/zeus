# Zeus architecture

Zeus is a **local-first desktop host**. The machine running your agent CLIs owns
the sessions; a VPS gateway mirrors state so a phone can watch and approve.

```text
                    ┌──────────────────────── Zeus desktop process ───────────────────────┐
                    │                                                                      │
  codex / claude / │  RuntimeDrivers          ZeusEngine                                 │
  agy  ───────────▶│  (managed)  ──────────▶  EventBus ──▶ LocalStore (source of truth)  │
                    │  (observed)                          │      │                       │
  hooks ──────────▶│  observed.rs ────────────────────────┘      │                       │
                    │  ▲                                           ▼                       │
                    │  │  Capability gates        PermissionManager (approval authority)  │
                    │  └───────────────────────    GatewayClient    (outbound WSS, queued) │
                    └──────────────┬───────────────────────────────────────┬───────────────┘
                                   │ invoke / events                      │ outbound
                              ┌────▼─────┐                         ┌───────▼────────┐
                              │  Island  │                         Zeus Gateway VPS │
                              │ + full UI│                         auth · pairing   │
                              └──────────┘                         presence · sync  │
                                                                    remote commands │
                                                                           ▲         │
                                                        WSS (ids only)   │         │
                                                                      ┌──┴─────────▼┐
                                                                      │ Flutter app │
                                                                      └──────────────┘
```

## The one rule everything else follows

**The UI never owns an agent process.**

The webview holds no process handle, no socket and no store. It calls a Tauri
command; `ZeusEngine` decides; data comes back. So:

- hiding the island (`hide_island`) does not stop anything,
- reloading the webview does not stop anything,
- quitting the app does stop everything, because that is the only thing that
  should.

That is why the engine lives in Rust (`src-tauri/crates/zeus-engine`) and not in
TypeScript. It is also why the crate has no Tauri dependency: the host must be
testable without a windowing toolchain, and the boundary should be enforced by
the build rather than by convention.

## Local-first

The desktop works fully offline. The local store is the source of truth and the
gateway is a mirror:

```text
<app data>/sessions.json          snapshot: sessions, seq counters, pending requests
<app data>/events.log             append-only NDJSON, one event per line
<app data>/digests/<session>.json the SessionDigest, rewritten in place
```

Append-then-snapshot means a crash loses at most the tail of the log, which is
replayed on boot. Outbound events queue (bounded, oldest dropped) and drain on
reconnect. A gateway that is down changes nothing about the agents.

Observed sessions reach the desktop through a loopback HTTP endpoint
(`crates/zeus-engine/src/ingest.rs`, port 8787). Point the adapters' 
`ZEUS_GATEWAY_URL` at it and hook events land locally with no network at all.

## Normalized events

Every runtime is reduced to one shape before anything downstream sees it:

```text
ZeusEvent{event_id, session_id, runtime, external_session_id?, seq, time, kind, payload}

kind = session.started | session.completed | session.failed
     | agent.thinking | agent.message
     | tool.started | tool.completed | tool.failed
     | permission.requested | permission.resolved | input.requested
```

`seq` is monotonic per session. The gateway drops an event whose `seq` is not
greater than the last one it saw, which is what makes a reconnecting hook's
replayed buffer harmless. `crates/zeus-engine/tests/parity.rs` feeds equivalent
moments from Codex, Claude and agy through their real fixtures and asserts they
normalize identically.

**The status table is written in three places and must change together:**
`status_for` in the engine's `store.rs`, `statusForEvent` in
`gateway/internal/store.go`, and `uiStateForSession` in
`apps/desktop-windows/src/zeus/frames.ts`.

## Capabilities, and never faking a control

Each driver declares what it can actually do. Managed `CodexDriver` can
interrupt; managed `ClaudeDriver` and `AntigravityDriver` cannot, because their
documented interfaces have no per-turn interrupt — so they do not advertise one
and the island renders no button for it. Observed sessions advertise `observe`
and nothing else: Zeus does not own the process, so `stop` would be a lie.

The UI asks `can(session, "stop")` before rendering. It never renders a control
and then reports "unsupported" when pressed.

## Approval is the desktop's to give

A request carries `request_id` + `session_id` + `workstation_id` + `created_at` +
`expires_at` + `status`. `PermissionManager` refuses:

- an unknown request,
- a reply for a different session,
- a reply from a different workstation,
- a reply after `expires_at`,
- **any second reply** — a replay is a replay.

**Timeout and offline never mean allow.** Expiry denies rather than stalling the
agent, because an unanswered request must not leave a CLI blocked forever and
must certainly not be read as consent.

## Runtimes

| Runtime | Managed transport | Approvals | Interrupt | Notes |
|---|---|---|---|---|
| `codex` | `codex app-server` (stdio JSON-RPC) | yes | yes | thread/turn model; approvals arrive as server→client requests needing a reply on the same id |
| `claude` | `claude -p --input-format stream-json` | no | no | print mode owns permissions; observed hooks do carry approvals |
| `antigravity` | `agy --input-format stream-json` | no | no | persistent process, `--conversation` to resume |
| `opencode` | none | — | — | observed only, via `adapters/opencode` |

## Token and context cost

`ContextManager` retrieves in a fixed order, because the order is the single
biggest lever on cost:

1. `git diff` / recent changes — already diff-sized
2. Serena symbol lookup (the one MCP server enabled by default, and only where
   the runtime speaks MCP)
3. `ast-grep` structural search
4. `rg` text search
5. a bounded chunk of one file (200 lines)
6. the whole file, only on explicit request

Caps are enforced, not suggested: ≤20 search hits, ≤200 lines per read, ≤32 KB of
log with the tail kept. Over-budget results carry `truncated: true` so the agent
asks for the next chunk instead of assuming it saw everything. A file whose
content hash is unchanged is never sent twice. `repomix --compress` with
`--token-count-tree` runs only when a repository map is asked for by name.

`SessionDigest` replaces history replay on resume: goal, constraints, decisions,
changed files, tests, pending, last seq — a few hundred characters, never file
contents. Raw source and terminal logs never cross the network; the gateway and
the phone see normalized events and summaries only.

Per-session input/output/cached tokens come from the runtime when it reports them.
The local estimator only fills gaps and is always labelled `estimated`. Usage
belongs in session details, not on the island.

## Icons

`src/zeus/visuals.ts` is the `AgentVisualRegistry`. Marks are local paths only.
Yesicon is the approved source for new marks; the current set is Zeus-drawn
placeholders because yesicon.io was unreachable when this was written. See
`THIRD_PARTY_ICONS.md` for the provenance table and what still has to be done.

## Trust boundaries

1. **Runtime drivers** can run processes and answer approvals Zeus itself raised.
   They cannot create pairing codes or enumerate devices.
2. **Observed hooks** can publish events to the loopback endpoint. They cannot
   answer anything: the desktop holds approval authority.
3. **Paired clients** can read session state and send only advertised
   capabilities. A remote approval still needs the desktop to accept it.
4. **Admin** issues pairing codes and revokes devices. Never embedded in an app.
5. **Provider credentials** never leave the machine that runs the agent.