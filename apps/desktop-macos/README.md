# Zeus Desktop — macOS

Native Swift 6 / SwiftUI + AppKit controller. The floating panel follows the same *category of interaction* as the original project (compact island -> expanded control surface), but all Zeus UI, mascot and animation code in this directory is original.

Build on macOS:

```bash
brew install xcodegen
xcodegen generate
open ZeusDesktop.xcodeproj
```

Requires macOS 15+. Pair it to a Zeus Gateway with a six-digit code. The device token is stored in Keychain.
