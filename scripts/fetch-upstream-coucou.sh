#!/usr/bin/env bash
set -euo pipefail
# Optional audit helper. It downloads upstream source code into an isolated
# directory so maintainers can diff/port MIT-licensed implementation changes.
# It intentionally removes upstream protected brand/art/media directories from
# the working copy; do not ship those files in Zeus.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/upstream/coucou"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
git clone --depth 1 https://github.com/Louis-CFM/coucou.git "$DEST"
rm -rf "$DEST/design" "$DEST/docs/media"
find "$DEST/NotchBuddy/Resources/sounds" -type f -delete 2>/dev/null || true
# Asset catalogs can mix code metadata and protected icons. Leave the upstream
# tree for audit only; never copy its asset catalogs into a Zeus release.
cat <<MSG
Upstream source is available at: $DEST
Use it for code diff/audit under its MIT license. Do not package Coucou/Mochi
name, character, icons, sounds or media. See THIRD_PARTY_NOTICES.md.
MSG
