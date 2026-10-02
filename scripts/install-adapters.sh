#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ZEUS_HOME:-$HOME/.zeus}/adapters"
mkdir -p "$DEST"
cp -R "$ROOT/adapters/common" "$ROOT/adapters/codex" "$ROOT/adapters/claude-code" "$ROOT/adapters/antigravity" "$ROOT/adapters/generic" "$DEST/"
find "$DEST" -name '*.py' -exec chmod 700 {} +
echo "Zeus adapters installed in $DEST"
echo "Configure ZEUS_GATEWAY_URL, ZEUS_AGENT_TOKEN and the hook JSON for your runtime."
