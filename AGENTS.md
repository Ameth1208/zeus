# AGENTS.md

Zeus — a local-first agent control plane. A desktop host orchestrates AI coding
CLIs (Codex, Claude Code, Antigravity) and mirrors state through a Go gateway to
a Flutter mobile app. Derived from `Louis-CFM/coucou` (MIT).

There are **no agent rule files** in this repo (`.cursorrules`, `.cursor/rules/`,
`.github/copilot-instructions.md` are all absent). This file is the single source.

## Layout

```
gateway/           Go 1.23 · VPS gateway: auth, pairing, sync, remote commands
apps/desktop-windows/  Tauri 2 host + island UI (the primary app)
  src-tauri/crates/zeus-engine/   ZeusEngine: runtimes, events, store, approvals
  src/                            webview: island, views, engine client
apps/mobile/       Flutter + Riverpod · Android/iOS
apps/desktop-macos/    SwiftUI · macOS island (build needs xcodegen)
adapters/          Python runtime hooks for observed sessions
shared/ packages/  Cross-cutting assets and contracts
scripts/           Canonical build/test entry points
tools/             Asset pipelines (e.g. normalize_zeus_frames.py)
```

## Architecture — read this first

Zeus is local-first. The machine running the CLIs owns the sessions; the VPS
gateway mirrors state so a phone can watch and approve.

**The UI never owns an agent process.** The webview holds no process handle, no
socket and no store. It calls a Tauri command, `ZeusEngine` decides, data comes
back. Hiding the island or reloading the page therefore cannot stop anything.

That is why the engine lives in Rust and **not** in `src/`:

```
src/engine/client.ts        typed invoke/event bridge — the only UI↔host seam
src-tauri/src/lib.rs        window control, hotkey, bus bridge, commands
src-tauri/crates/zeus-engine/
  lib.rs                    ZeusEngine: the single object everything goes through
  event.rs                  ZeusEvent + the closed EventKind set
  bus.rs                    one broadcast channel, many readers
  store.rs                  LocalStore: append NDJSON, then snapshot
  digest.rs                 SessionDigest (replaces history replay)
  permission.rs             PermissionManager — the approval authority
  context.rs                ContextManager: git diff → Serena → ast-grep → rg
  tokens.rs                 token/cost accounting, estimate always labelled
  session.rs                SessionManager + RuntimeSupervisor
  gateway.rs                outbound WSS client, bounded queue
  ingest.rs                 loopback HTTP for observed hooks (port 8787)
  registry.rs               RuntimeRegistry
  runtime/                  mod.rs (trait) · codex · claude · antigravity
                            observed · stdio
  tests/parity.rs           Codex/Claude/agy fixtures must normalize alike
```

The engine crate has **no Tauri dependency**. That is deliberate: the host must be
testable without a windowing toolchain, and the UI/engine boundary should be
enforced by the build rather than by convention.

See `docs/ARCHITECTURE.md` for the full picture, including why each runtime
advertises exactly the capabilities it has.

## Commands

Run from the repo root unless noted. `./scripts/test.sh` is the gate CI uses.

**Everything (gateway gofmt + go test + python syntax check):**
```bash
./scripts/test.sh
```

**Engine — the runtimes and the approval rules** (run these; they are part of the core gate):
```bash
cd apps/desktop-windows/src-tauri
cargo test -p zeus-engine          # every test here; add `-- --nocapture` to debug
cargo test -p zeus-engine --lib    # unit tests only, skips the parity fixtures
cargo test -p zeus-engine --test parity
cargo check                         # both crates
```

**Gateway — single test:**
```bash
cd gateway
go test ./internal -run TestSessionPersistenceAndPermissionLifecycle -v
go test ./internal -run 'TestAuth' -v      # regex works
go test ./internal -run 'TestX' -count=1    # bypass cache
```

**Gateway — format / vet / build all platforms:**
```bash
cd gateway && gofmt -w ./cmd ./internal && go vet ./...
./scripts/build-gateway.sh     # cross-compiles 5 targets into dist/gateway + SHA256SUMS
./scripts/smoke-gateway.sh     # boots a real binary on a random port, curls it
```

**Mobile:**
```bash
cd apps/mobile
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # regenerates lib/gen/assets.gen.dart
flutter analyze                 # linter + type errors
flutter test                    # all tests
flutter test test/zeus_session_test.dart                      # single file
flutter test --plain-name 'parses pending permission metadata' # single test
flutter run -d <device-id>
```

**Desktop:**
```bash
cd apps/desktop-windows
npx tsc --noEmit      # typecheck only, fastest gate
npm run build         # tsc && vite build
npm run tauri build   # release exe + msi + nsis
```

### Windows caveats — read before building the desktop app

- `npm run tauri dev` **does not compile** on this machine: `ld.exe: error: export
  ordinal too large` from mingw-w64 building a `cdylib` in debug. Use
  `npm run tauri build`. Do not "fix" this by changing `crate-type`.
- A `target/` directory created under the old repo path `Personal Lib/...` will
  make `tauri-build` fail with `failed to read plugin permissions`, because every
  cached artifact bakes in that old path. Fix: `rm -rf src-tauri/target/release`.
- Kill `zeus-desktop.exe` before rebuilding, or the linker gets `Acceso denegado`.
- `tauri icon <png> -o src-tauri/icons` regenerates the icon set. If a bundle step
  reports `Couldn't find a .ico icon`, the ICO is single-size or `bundle.icon` is
  missing from `tauri.conf.json` — both must be fixed, not worked around.

## Go style (`gateway/`)

- `gofmt` is authoritative; `test.sh` rewrites files in place, so run it before committing.
- Errors are values, never panics. `errors.New` for static cases, `fmt.Errorf` with
  `%w` when wrapping. Messages are lowercase, no trailing punctuation.
- Exported types carry doc comments; JSON tags are `snake_case` (`json:"agent_id"`).
- Every type with mutable state guards it with a `sync.RWMutex` and takes the lock
  in every method. `SessionStore` is the reference implementation.
- Unexported helpers when they are package-internal (`hasCapability`, `truncate`).
- Tests are `TestXxx` in `package internal` (internal tests, not `_test` package),
  use `t.TempDir()`, and assert with `t.Fatalf` and `%#v` for struct dumps.
  One test covers a lifecycle end-to-end rather than many narrow ones.

## Dart style (`apps/mobile/`)

- Lints come from `package:flutter_lints` plus two local rules in
  `analysis_options.yaml`: **`prefer_single_quotes`** and **`use_super_parameters`**.
  Both are errors — match them rather than reformatting after the fact.
- Relative imports within `lib/`, package imports for dependencies
  (`package:flutter_riverpod/flutter_riverpod.dart`).
- `const` constructors everywhere a widget or model allows it.
- Models are immutable with a `factory X.fromJson`. Expose derived state as getters
  (`bool get needsAttention => status == 'waiting';`) instead of duplicating fields.
- Riverpod: `final xProvider = Provider((ref) => ...)` for sync, `AsyncNotifier` for
  async. Mutate via `AsyncValue.guard()` so errors land in `state` rather than throwing.
- UI lives in `lib/ui/`, widgets in `lib/ui/widgets/`. Prefer `CupertinoButton`
  over `TextButton` for consistency with the Apple-flavoured design.
- **Never hand-edit `lib/gen/assets.gen.dart`** — it is generated by build_runner.
- Toasts/dialogs follow the `XSheet.show(context, ...)` static convention.

## TypeScript style (`apps/desktop-windows/src/`)

- `strict: true` is on. No `any`, no non-null `!` unless genuinely proven.
- `tsc` is the only linter; there is no ESLint config. `npx tsc --noEmit` must be clean.
- Modules are grouped `core/` (pure logic), `island/` (geometry, FSM, shape),
  `zeus/` (mascot + state table), `views.ts`, `main.ts` (wiring only).
- Pure logic modules must not touch the DOM. `IslandFsm` and `island/layout.ts`
  are testable because of this — keep it that way.
- Naming: `camelCase` values/functions, `PascalCase` classes, `SCREAMING_SNAKE`
  constants. Module-private members use a leading underscore.
- Errors: prefer `Result`-shaped early returns over exceptions in render paths.
  Anything async gets a `.catch()` — an unhandled rejection in the webview is
  invisible because release builds do not forward console output.
- Animation constants are named and commented with *why*, not *what*.

## Context and token cost

`ContextManager` retrieval order is fixed and is the biggest cost lever:
`git diff` → Serena → `ast-grep` → `rg` → bounded chunk → whole file.

- Caps are enforced, not suggested: ≤20 search hits, ≤200 lines per read, ≤32 KB
  of log with the tail kept. Over-budget results carry `truncated: true`.
- A file whose content hash is unchanged is never sent twice.
- `repomix` runs only when a repository map is asked for by name.
- Serena is the **only** MCP server enabled by default, and only for runtimes
  that speak MCP. Fewer tools beats many tools.
- Token counts come from the runtime when reported. The estimator only fills gaps
  and always sets `estimated: true`.

## Python style (`adapters/`)

- **Runtime hooks must be fail-open.** If the gateway is unreachable, the AI
  runtime's native permission flow continues. Never block the agent on Zeus.
- `from __future__ import annotations`; `pathlib`, not `os.path`. Stdlib only — no deps.
- Each hook is a standalone executable script (`#!/usr/bin/env python3`) that
  `test.sh` compiles with `py_compile`.
- Adapters use `ZEUS_AGENT_TOKEN`, never the admin credential.

## Design system

Non-negotiable, because the desktop island is a transparent always-on-top panel
and the design only works as a set:

- The island body is **liquid glass**, not flat black: fill `--glass-fill`
  (`rgba(16,18,23,0.58)`) over `backdrop-filter: blur(30px) saturate(170%)`,
  a 1 px `--glass-edge` hairline, an inset top highlight and the specular
  `#island::before` sheen. The window stays transparent; the material is what
  sells the depth. Cards are white at 5.5%, flat cards at 3.5%, hairlines at
  8% — all translucent, so the blur reads through every layer.
- The aesthetic reference is Apple's materials (macOS `NSVisualEffectView`,
  Grokbot-style frosted panels). On macOS use `.ultraThinMaterial`; on mobile
  `BackdropFilter`. Never paint an opaque surface where a material belongs.
- Geometry is mode + view → `(w, h, radius)` via `island/layout.ts`. The
  silhouette is plain `border-radius` (`0 0 r r`, flush against the top edge);
  `island/shape.ts` and its `topRadius` ear cutouts are retired legacy — do
  not resurrect them without redesigning hit-testing too.
- **Growth springs, shrink curves.** Growth overshoots, shrink does not. Asymmetric
  animation is what makes the island read as a physical object.
- Content cross-fade: exit 160 ms, enter 300 ms delayed 160 ms.
- The rAF loop must shut down when nothing animates. State-driven loops that never
  stop are the classic regression here.
- Mascot frames live in `assets/zeus/` and are **generated**, not hand-edited.
  Run `python3 tools/normalize_zeus_frames.py` after changing them; raw frames are
  1122×1402 and illegible at island scale.
- Event → state mapping is duplicated deliberately in **three** places. When
  changing it, change all three together:
  `status_for` in `crates/zeus-engine/src/store.rs`,
  `statusForEvent` in `gateway/internal/store.go`, and
  `uiStateForSession` in `apps/desktop-windows/src/zeus/frames.ts`.
- The mascot exposes exactly nine UI states: `idle, thinking, working,
  waitingApproval, waitingInput, success, error, sleeping, disconnected`. There is
  no runtime-specific state, because every runtime is normalized to events before
  the UI sees it. `BOT_STATES` in `frames.ts` is the drawable table behind those
  nine, not a wider API.
- **Never render a control the runtime has not advertised.** `can(session, "stop")`
  in `views.ts` is the single gate. A runtime without `interrupt` gets no button,
  rather than a button that reports "unsupported" when pressed.
- **MODEL != RUNTIME.** `runtime` is the CLI, `provider` is the model vendor.
  They are separate fields everywhere and must never be merged.

## Rust style (`src-tauri/`)

- `gofmt` has no Rust equivalent here: `cargo fmt` if the toolchain has it, else
  keep lines under 100 and match the surrounding file.
- Errors are values. `DriverError::Unsupported("interrupt")` means "this runtime
  genuinely cannot do this" and the UI renders no control; `DriverError::Failed`
  means it tried and did not work. **Never return `Unsupported` for something a
  user could reasonably expect to work.**
- Types with mutable state guard it with `Mutex`/`RwMutex` and take the lock in
  every method. `LocalStore` and `PermissionManager` are the reference.
- Driver reader threads publish through `Arc<dyn EventSink>`; the `BusSink` in
  `lib.rs` persists to the store *before* fanning out, so a crash between the two
  loses nothing.
- Tests are unit tests next to the code (`#[cfg(test)] mod tests`) plus
  `tests/parity.rs` for the cross-runtime fixtures. Fixtures under
  `tests/fixtures/` record their provenance in a `_provenance` field: verbatim
  captures are kept separate from schema-derived shapes.
- Every function that touches a process, socket or filesystem needs a test that
  proves its *failure* mode, not just its success. Several bugs found while
  building this only showed up there: a `..` in a path defeating a `starts_with`
  guard, a store that silently dropped its first events because the directory did
  not exist yet.

## Before you commit

1. `./scripts/test.sh`  (gateway go test + engine cargo test + py_compile + schema)
2. `cd apps/mobile && flutter analyze && flutter test`
3. `cd apps/desktop-windows && npx tsc --noEmit`
4. `cd apps/desktop-windows/src-tauri && cargo check`
4. Never commit `.env`, `providers.json`, `target/`, `dist/` (except `dist/gateway/`), or `node_modules/` — all gitignored.
5. Credentials belong in the OS keyring, never in source or logs.
