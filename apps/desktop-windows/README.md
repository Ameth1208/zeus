# Zeus Desktop — Windows / Linux

Tauri 2 + TypeScript control island. It pairs to Zeus Gateway, stores the paired device token in the operating-system credential store through the Rust `keyring` crate, streams agent events and exposes safe approval controls.

```bash
npm install
npm run tauri dev
# release
npm run tauri build
```

The same Tauri source can target Windows and Linux. The visual surface is an original Zeus implementation; no Coucou/Mochi art, sounds or media are included.
