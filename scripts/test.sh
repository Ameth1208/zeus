#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT/gateway" && gofmt -w ./cmd ./internal && go test ./...)
python3 -m py_compile \
  "$ROOT/adapters/common/zeus_adapter.py" \
  "$ROOT/adapters/codex/zeus_codex_hook.py" \
  "$ROOT/adapters/claude-code/zeus_claude_hook.py" \
  "$ROOT/adapters/antigravity/zeus_antigravity_hook.py" \
  "$ROOT/adapters/generic/zeus_emit.py"
echo "Zeus core checks passed."
