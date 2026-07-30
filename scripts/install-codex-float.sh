#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/dist/Vibe Float.app"
TARGET="/Applications/Vibe Float.app"

if [[ ! -d "$SOURCE" ]]; then
  "$ROOT/scripts/build-codex-float.sh"
fi

pkill -x VibeFloat 2>/dev/null || true
pkill -x CodexFloat 2>/dev/null || true
sleep 1
if [[ -d "/Applications/Codex Float.app" ]]; then
  mv "/Applications/Codex Float.app" "$HOME/.Trash/Codex Float.renamed.$(date +%s).app"
fi
if [[ -d "$TARGET" ]]; then
  BACKUP="$HOME/.Trash/Vibe Float.old.$(date +%s).app"
  mv "$TARGET" "$BACKUP"
  echo "旧版本已移到：$BACKUP"
fi
ditto "$SOURCE" "$TARGET"
open "$TARGET"
echo "已安装并启动：$TARGET"
