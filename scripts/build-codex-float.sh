#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/macos/CodexFloat"
BUILD="$PROJECT/.build/release"
X86_BUILD="$PROJECT/.build-x86/x86_64-apple-macosx/release"
APP="$ROOT/dist/Codex Float.app"
UNIVERSAL="$PROJECT/.build/CodexFloat-universal"

cd "$PROJECT"
swift build -c release
swift build -c release --arch x86_64 --scratch-path .build-x86
xcrun lipo -create "$BUILD/CodexFloat" "$X86_BUILD/CodexFloat" -output "$UNIVERSAL"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$UNIVERSAL" "$APP/Contents/MacOS/CodexFloat"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>CodexFloat</string>
  <key>CFBundleIdentifier</key><string>com.tlm.codex-float</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Codex Float</string>
  <key>CFBundleDisplayName</key><string>Codex Float</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2.1</string>
  <key>CFBundleVersion</key><string>5</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/Codex-Float-macOS.zip"

DMG_STAGE="$(mktemp -d)"
trap 'rm -rf "$DMG_STAGE"' EXIT
ditto "$APP" "$DMG_STAGE/Codex Float.app"
ln -s /Applications "$DMG_STAGE/Applications"
rm -f "$ROOT/dist/Codex-Float-macOS.dmg"
hdiutil create -quiet -volname "Codex Float" -srcfolder "$DMG_STAGE" -ov -format UDZO "$ROOT/dist/Codex-Float-macOS.dmg"

echo "$APP"
echo "$ROOT/dist/Codex-Float-macOS.zip"
echo "$ROOT/dist/Codex-Float-macOS.dmg"
