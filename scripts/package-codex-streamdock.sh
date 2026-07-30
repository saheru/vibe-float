#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN="$ROOT/com.tlm.codex-control.sdPlugin"
DIST="$ROOT/dist"
OUTPUT="$DIST/com.tlm.codex-control.sdPlugin.zip"

mkdir -p "$DIST"
rm -f "$OUTPUT"
npm --prefix "$PLUGIN/plugin" ci --omit=dev --ignore-scripts
(
  cd "$ROOT"
  /usr/bin/zip -qr "$OUTPUT" "com.tlm.codex-control.sdPlugin" \
    -x '*/log/*' '*/.DS_Store'
)
echo "$OUTPUT"
