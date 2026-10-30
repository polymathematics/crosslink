#!/bin/bash
# Builds "Crosslink Composer.app" into build/. Pass --install to also copy it to /Applications.
# Needs only the Xcode command line tools (swiftc, iconutil, codesign).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APP="build/Crosslink Composer.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "Compiling…"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos12.0" \
  -framework AppKit -framework WebKit \
  composer/mac/main.swift -o "$APP/Contents/MacOS/Crosslink Composer"

# the composer UI plus a copy of the site (core.js, styles, solver) for Test Solve
rsync -aL --delete --exclude '.DS_Store' --exclude 'puzzles/' composer/web/ "$APP/Contents/Resources/web/"

if [[ ! -f build/AppIcon.icns || composer/mac/make_icon.swift -nt build/AppIcon.icns ]]; then
  echo "Drawing the icon…"
  rm -rf build/AppIcon.iconset
  swift composer/mac/make_icon.swift build/AppIcon.iconset >/dev/null
  iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
fi
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

sed -e "s|__REPO__|${ROOT//&/\\&}|" -e "s|__BUILD__|$(date +%Y%m%d%H%M)|" composer/mac/Info.plist > "$APP/Contents/Info.plist"
codesign --force --deep --sign - "$APP" >/dev/null
echo "Built $APP"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf "/Applications/Crosslink Composer.app"
  cp -R "$APP" /Applications/
  echo "Installed /Applications/Crosslink Composer.app"
fi
