#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/dist/Codex Float.app"
TARGET="/Applications/Codex Float.app"

if [[ ! -d "$SOURCE" ]]; then
  "$ROOT/scripts/build-codex-float.sh"
fi

pkill -x CodexFloat 2>/dev/null || true
sleep 1
if [[ -d "$TARGET" ]]; then
  BACKUP="$HOME/.Trash/Codex Float.old.$(date +%s).app"
  mv "$TARGET" "$BACKUP"
  echo "旧版本已移到：$BACKUP"
fi
ditto "$SOURCE" "$TARGET"
open "$TARGET"
echo "已安装并启动：$TARGET"
