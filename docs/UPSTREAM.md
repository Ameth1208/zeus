# Upstream Coucou relationship

Zeus follows Coucou's proven desktop architecture category: native SwiftUI/AppKit on macOS and Tauri/Rust/TypeScript on Windows, but replaces the Claude-only boundary with Zeus Agent Protocol and uses a completely separate visual identity.

The build environment used to assemble this package could read the public repository documentation but could not establish a raw `git clone` network connection. Therefore this package does **not** pretend to be a byte-for-byte snapshot of the current Coucou tree. Instead, it contains the Zeus implementation plus `scripts/fetch-upstream-coucou.sh` for a maintainer to pull the current upstream source on a normal network and audit/port MIT-licensed changes.

When porting upstream code:

1. Keep the upstream MIT copyright/permission notice.
2. Do not ship the Coucou/Mochi names, character, expressions/animations as a character, icons, sounds, or media.
3. Prefer behavior-level parity with original Zeus visual implementation rather than copying protected character choreography or art.
4. Keep runtime-specific code behind the Zeus adapter/protocol boundary rather than reintroducing Claude-only assumptions.
