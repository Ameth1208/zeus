# Zeus Mobile

Flutter client for iOS and Android using **Riverpod**, **FlutterGen**, **Rive** and secure storage.

## Bootstrap

```bash
./scripts_bootstrap_platforms.sh
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter run
```

The bootstrap script creates the native iOS/Android folders and installs the native iOS glass bridge automatically.

### iOS design

When compiled with the iOS 26 SDK and running on iOS 26+, Zeus uses UIKit `UIGlassEffect` behind interactive Flutter controls. On earlier toolchains/OS versions it falls back to `systemUltraThinMaterialDark`. The mascot/island interaction itself remains Flutter/Rive so behavior is consistent on iPhone and Android.

## Rive

The source includes an original, layer-named `assets/rive/zeus-base.svg` and the runtime contract in `assets/rive/README.md`. Export the completed editor animation as `assets/rive/zeus.riv`. Until that binary exists, Zeus uses a built-in animated mascot fallback (breathing, pointer/touch gaze, tap bounce and status reactions), so the application is not visually static.

## Gateway

Pairing tokens are stored with `flutter_secure_storage`. Provider API keys never enter the phone; they remain on Zeus Gateway. The phone reads sessions/providers over HTTPS and receives live events through SSE.
