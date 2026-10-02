#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
flutter create --platforms=ios,android --org ai.zeus.agent --project-name zeus_mobile .

# Install the native iOS Liquid Glass platform view automatically.
cp platform-patches/ios/ZeusGlassView.swift ios/Runner/ZeusGlassView.swift
python3 - <<'PY'
from pathlib import Path
p = Path('ios/Runner/AppDelegate.swift')
s = p.read_text()
needle = 'GeneratedPluginRegistrant.register(with: self)'
insert = '''GeneratedPluginRegistrant.register(with: self)\n    if let registrar = self.registrar(forPlugin: "ZeusLiquidGlass") {\n      registrar.register(ZeusGlassViewFactory(), withId: "zeus/liquid-glass")\n    }'''
if 'ZeusLiquidGlass' not in s:
    if needle not in s:
        raise SystemExit('Could not find Flutter plugin registration in AppDelegate.swift')
    s = s.replace(needle, insert, 1)
p.write_text(s)
PY

echo "Flutter iOS/Android platform folders and Zeus Liquid Glass bridge are ready."
echo "Next: flutter pub get && dart run build_runner build --delete-conflicting-outputs"
