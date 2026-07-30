#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/assets/codex-float-icon.svg"
TMP="$(mktemp -d)"
ICONSET="$TMP/CodexFloat.iconset"
MASTER="$TMP/CodexFloat-1024.png"

trap 'rm -rf "$TMP"' EXIT
mkdir -p "$ICONSET" "$ROOT/macos/CodexFloat/Resources" "$ROOT/windows/CodexFloat/Assets" "$ROOT/docs/images"

sips -s format png "$SOURCE" --out "$MASTER" >/dev/null 2>&1

make_png() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$MASTER" --out "$ICONSET/$name" >/dev/null
}

make_png 16 icon_16x16.png
make_png 32 icon_16x16@2x.png
make_png 32 icon_32x32.png
make_png 64 icon_32x32@2x.png
make_png 128 icon_128x128.png
make_png 256 icon_128x128@2x.png
make_png 256 icon_256x256.png
make_png 512 icon_256x256@2x.png
make_png 512 icon_512x512.png
make_png 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET" -o "$ROOT/macos/CodexFloat/Resources/CodexFloat.icns"
cp "$MASTER" "$ROOT/docs/images/app-icon.png"

python3 - "$MASTER" "$ROOT/windows/CodexFloat/Assets/CodexFloat.ico" <<'PY'
import sys
from PIL import Image

source, output = sys.argv[1:3]
image = Image.open(source).convert("RGBA")
image.save(
    output,
    format="ICO",
    sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
           (48, 48), (64, 64), (128, 128), (256, 256)],
)
PY

echo "$ROOT/macos/CodexFloat/Resources/CodexFloat.icns"
echo "$ROOT/windows/CodexFloat/Assets/CodexFloat.ico"
echo "$ROOT/docs/images/app-icon.png"
