#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/com.tlm.codex-control.sdPlugin"
TARGET_ROOT="$HOME/Library/Application Support/HotSpot/StreamDock/plugins"
TARGET="$TARGET_ROOT/com.tlm.codex-control.sdPlugin"

mkdir -p "$TARGET_ROOT"
if [[ -d "$TARGET" ]]; then
  BACKUP="$TARGET.backup.$(date +%Y%m%d-%H%M%S)"
  mv "$TARGET" "$BACKUP"
  echo "旧版本已备份：$BACKUP"
fi
cp -R "$SOURCE" "$TARGET"
echo "已安装：$TARGET"
echo "请重启 StreamDock 以加载插件。"
