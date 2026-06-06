#!/usr/bin/env bash
# One-click packager for ChatBox.
#
#   ./build.sh                 → macOS dmg + zip (arm64)
#   ./build.sh mac             → same
#   ./build.sh win             → Windows portable zip (x64) — no Wine needed
#   ./build.sh all             → both of the above
#   ./build.sh mac --publish   → build AND upload to a GitHub release draft (needs GH_TOKEN)
#
# Notes:
#   • No Apple cert here → the app is ad-hoc signed. macOS auto-UPDATE can't self-install
#     without a Developer ID cert (it falls back to a "前往下载" notice). Manual install works.
#   • The Windows .exe INSTALLER (NSIS, required for Windows auto-update) must be built on a
#     Windows PC — see BUILD-WINDOWS.md. The zip here is a portable build for quick trials.
#   • For a build pre-loaded with your API key, fill in .env first (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

export CSC_IDENTITY_AUTO_DISCOVERY=false                                  # ad-hoc sign (no cert)
export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/" # fast/proxy-friendly mirror

TARGET="mac"; PUBLISH=""
for a in "$@"; do
  case "$a" in
    mac|win|all) TARGET="$a" ;;
    --publish)   PUBLISH="--publish always" ;;
    *) echo "usage: ./build.sh [mac|win|all] [--publish]"; exit 1 ;;
  esac
done
VERSION=$(node -p "require('./package.json').version")

# Windows zip on Apple Silicon: electron-builder runs rcedit through a bundled (x86) wine to
# stamp exe metadata. Without Rosetta 2 that step fails, but the app is still fully packaged —
# so we fall back to zipping win-unpacked ourselves (exe runs; just lacks icon/version strings).
# To get clean Windows builds, run:  softwareupdate --install-rosetta --agree-to-license
build_win() {
  npx electron-builder --win zip --x64 $PUBLISH || echo "⚠ electron-builder win step failed (rcedit/wine) — falling back to manual zip"
  if [ -f dist/win-unpacked/ChatBox.exe ] && ! ls dist/ChatBox-*-win*.zip >/dev/null 2>&1; then
    ( cd dist && rm -rf ChatBox && cp -R win-unpacked ChatBox && zip -rqy "ChatBox-${VERSION}-win-x64.zip" ChatBox && rm -rf ChatBox )
    echo "✅ portable Windows zip created (manual fallback)"
  fi
}

echo "▶ building target=$TARGET ${PUBLISH:+(publishing)}"
case "$TARGET" in
  mac) npx electron-builder --mac --arm64 $PUBLISH ;;
  win) build_win ;;
  all) npx electron-builder --mac --arm64 $PUBLISH && build_win ;;
esac

echo ""
echo "✅ Done — artifacts in ./dist:"
ls -1 dist/*.dmg dist/*.zip dist/*.exe 2>/dev/null || true
