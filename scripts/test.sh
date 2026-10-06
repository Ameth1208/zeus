#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The engine carries the runtimes and the approval rules, so its tests are part
# of the core gate, not a separate optional step.
(cd "$ROOT/gateway" && gofmt -w ./cmd ./internal && go test ./...)
(cd "$ROOT/apps/desktop-windows/src-tauri" && cargo test -p zeus-engine)

# Run from the repo root: Git Bash paths are not valid arguments to the native
# Windows Python executable.
(cd "$ROOT" && python3 -m py_compile \
  adapters/common/zeus_adapter.py \
  adapters/codex/zeus_codex_hook.py \
  adapters/claude-code/zeus_claude_hook.py \
  adapters/antigravity/zeus_antigravity_hook.py \
  adapters/opencode/zeus_opencode_hook.py \
  adapters/generic/zeus_emit.py)

# Validated from inside the directory: a Git-Bash ROOT is a POSIX path that
# Windows python3 cannot open.
(cd "$ROOT/packages/protocol" && python3 -c "
import json
for name in ('zeus-event.schema.json', 'zeus-action.schema.json'):
    json.load(open(name))
")

echo "Zeus core checks passed."
