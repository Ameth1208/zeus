# Validation snapshot — Zeus v0.1

Validated in the Linux build environment used to assemble this package:

- `./scripts/test.sh` — Go tests and Python adapter syntax pass.
- `./scripts/build-gateway.sh` — Gateway + zeusctl cross-build for Linux amd64/arm64, Windows amd64, macOS amd64/arm64.
- `./scripts/smoke-gateway.sh` — pairing, device auth, agent event ingestion, waiting permission session, approval, stale-request rejection and queued action delivery pass end-to-end.
- `swiftc -frontend -parse` — all macOS Swift source parses with Swift 6.2.
- `tsc --noEmit --strict` — Tauri UI TypeScript passes static type checking with a minimal ambient Tauri declaration.
- release SHA-256 checksums are regenerated after every Gateway build.
- no Coucou/Mochi audio/video/demo media is packaged; references to those names only remain in licensing/upstream documentation.
- no obvious private keys/API secrets are committed.

Not locally build-validated because this container does not contain the required platform toolchains:

- Flutter / Android SDK.
- Xcode / iOS SDK / macOS AppKit linker.
- Rust / Tauri native bundler.
- Rive CLI. Network DNS in this container cannot resolve `releases.rive.app`, so a fake `zeus.riv` is deliberately not shipped.

GitHub Actions workflows are included for Android, iOS simulator, macOS, Windows and Linux desktop builds. Signed App Store/TestFlight IPA, notarized macOS app and signed Windows installer require the maintainer's signing identities/secrets and therefore are intentionally not embedded in the repository.
