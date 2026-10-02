# Building Zeus

## Gateway

```bash
./scripts/test.sh
./scripts/build-gateway.sh
./scripts/smoke-gateway.sh
```

Cross-built Gateway and `zeusctl` binaries are written to `dist/gateway/` with `SHA256SUMS`.

## Flutter mobile

```bash
cd apps/mobile
./scripts_bootstrap_platforms.sh
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter test
flutter build apk --release
flutter build appbundle --release
```

For iOS simulator validation:

```bash
flutter build ios --simulator --no-codesign
```

A distributable iOS IPA requires an Apple Developer signing identity/profile. The iOS 26 Liquid Glass bridge is installed by the bootstrap script.

## Rive mascot

If the official Rive CLI is installed:

```bash
./scripts/build-rive.sh
```

The final production layered mascot must satisfy the state-machine contract in `docs/RIVE.md`.

## macOS desktop

Requires macOS 15+, Xcode 16+ and XcodeGen:

```bash
cd apps/desktop-macos
xcodegen generate
xcodebuild -project ZeusDesktop.xcodeproj -scheme ZeusDesktop -configuration Release CODE_SIGNING_ALLOWED=NO build
```

Production distribution requires your own signing/notarization credentials.

## Windows / Linux desktop

Requires Rust stable, Node 22+ and Tauri platform prerequisites:

```bash
cd apps/desktop-windows
npm install
npm run tauri build
```

## CI

- `core.yml`: Gateway tests/releases + Android APK/AAB.
- `apple.yml`: unsigned macOS build + iOS simulator app.
- `desktop.yml`: Windows and Linux Tauri bundles.
