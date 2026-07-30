#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$ROOT/macos/CodexFloat"
BUILD="$PROJECT/.build/release"
X86_BUILD="$PROJECT/.build-x86/x86_64-apple-macosx/release"
APP="$ROOT/dist/Vibe Float.app"
UNIVERSAL="$PROJECT/.build/CodexFloat-universal"
HELPER_UNIVERSAL="$PROJECT/.build/VibeFloatStatus-universal"

"$ROOT/scripts/build-icons.sh"

cd "$PROJECT"
swift build -c release
swift build -c release --arch x86_64 --scratch-path .build-x86
xcrun lipo -create "$BUILD/CodexFloat" "$X86_BUILD/CodexFloat" -output "$UNIVERSAL"
xcrun lipo -create "$BUILD/VibeFloatStatus" "$X86_BUILD/VibeFloatStatus" -output "$HELPER_UNIVERSAL"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Helpers"
cp "$UNIVERSAL" "$APP/Contents/MacOS/VibeFloat"
cp "$HELPER_UNIVERSAL" "$APP/Contents/Helpers/VibeFloatStatus"
cp "$PROJECT/Resources/CodexFloat.icns" "$APP/Contents/Resources/CodexFloat.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>VibeFloat</string>
  <key>CFBundleIdentifier</key><string>com.tlm.vibe-float</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Vibe Float</string>
  <key>CFBundleDisplayName</key><string>Vibe Float</string>
  <key>CFBundleIconFile</key><string>CodexFloat</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.5.0</string>
  <key>CFBundleVersion</key><string>14</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/dist/Vibe-Float-macOS.zip"

DMG_STAGE="$(mktemp -d)"
trap 'rm -rf "$DMG_STAGE"' EXIT
ditto "$APP" "$DMG_STAGE/Vibe Float.app"
ln -s /Applications "$DMG_STAGE/Applications"
rm -f "$ROOT/dist/Vibe-Float-macOS.dmg"
hdiutil create -quiet -volname "Vibe Float" -srcfolder "$DMG_STAGE" -ov -format UDZO "$ROOT/dist/Vibe-Float-macOS.dmg"

echo "$APP"
echo "$ROOT/dist/Vibe-Float-macOS.zip"
echo "$ROOT/dist/Vibe-Float-macOS.dmg"
