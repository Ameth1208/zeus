#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/gateway"
mkdir -p "$OUT"
cd "$ROOT/gateway"
for spec in linux/amd64 linux/arm64 windows/amd64 darwin/amd64 darwin/arm64; do
  GOOS="${spec%/*}"; GOARCH="${spec#*/}"
  ext=""; [ "$GOOS" = windows ] && ext=".exe"
  echo "building $GOOS/$GOARCH"
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" -o "$OUT/zeus-gateway-$GOOS-$GOARCH$ext" ./cmd/zeus-gateway
  CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" -o "$OUT/zeusctl-$GOOS-$GOARCH$ext" ./cmd/zeusctl
done
(
  cd "$OUT"
  rm -f SHA256SUMS
  sha256sum zeus-gateway-* zeusctl-* > SHA256SUMS
)
