#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/apps/mobile/assets/rive/zeus-rive"
OUT="$ROOT/apps/mobile/assets/rive/zeus.riv"
if ! command -v rive >/dev/null 2>&1; then
  echo "Rive CLI is required. Install it from https://rive.app/docs/cli/getting-started" >&2
  exit 127
fi
if [ ! -d "$PROJECT" ]; then
  echo "Missing Rive source project: $PROJECT" >&2
  exit 2
fi
rive "$PROJECT" --verify
rive "$PROJECT" --once
BUILT="$PROJECT/build/zeus.riv"
if [ ! -f "$BUILT" ]; then
  echo "Rive CLI did not produce $BUILT" >&2
  exit 3
fi
cp "$BUILT" "$OUT"
echo "built $OUT"
