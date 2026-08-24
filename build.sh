#!/usr/bin/env bash
# One-click local packager for Quartz.
#
#   ./build.sh                 → macOS dmg + zip (universal: Intel + Apple Silicon)
#   ./build.sh mac             → same
#   ./build.sh win             → Windows portable zip (x64) — no Wine needed
#   ./build.sh all             → both of the above
#   ./build.sh mac --publish   → build AND upload to the configured GitHub release (needs GH_TOKEN)
#
# Notes:
#   • No Apple cert here → the app is ad-hoc signed. macOS auto-UPDATE can't self-install
#     without a Developer ID cert (it falls back to a "前往下载" notice). Manual install works.
#   • The Windows .exe INSTALLER (NSIS, required for Windows auto-update) must be built on a
#     Windows PC — see BUILD-WINDOWS.md. The zip here is a portable build for quick trials.
#   • For a build pre-loaded with your API key, fill in .env first (see .env.example).
set -euo pipefail
cd "$(dirname "$0")"

# Default to the existing ad-hoc build, but allow a release machine to opt into its
# installed Developer ID identity with CSC_IDENTITY_AUTO_DISCOVERY=true.
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
# Do not force ELECTRON_MIRROR here. Current @electron/get also applies it to
# electron-builder helper artifacts (such as dmg-builder), which makes DMG builds
# request invalid mirror URLs. Callers may still provide their own download/cache setup.

TARGET="mac"; PUBLISH=""
for a in "$@"; do
  case "$a" in
    mac|win|all) TARGET="$a" ;;
    --publish)   PUBLISH="--publish always" ;;
    *) echo "usage: ./build.sh [mac|win|all] [--publish]"; exit 1 ;;
  esac
done
VERSION=$(node -p "require('./package.json').version")
PRODUCT=$(node -p "(require('./package.json').build && require('./package.json').build.productName) || require('./package.json').productName || require('./package.json').name")

# Windows zip on Apple Silicon: electron-builder runs rcedit through a bundled (x86) wine to
# stamp exe metadata. Without Rosetta 2 that step fails, but the app is still fully packaged —
# so we fall back to zipping win-unpacked ourselves (exe runs; just lacks icon/version strings).
# To get clean Windows builds, run:  softwareupdate --install-rosetta --agree-to-license
build_win() {
  npx electron-builder --win zip --x64 $PUBLISH || echo "⚠ electron-builder win step failed (rcedit/wine) — falling back to manual zip"
  if [ -f "dist/win-unpacked/${PRODUCT}.exe" ] && ! ls dist/${PRODUCT}-*-win*.zip >/dev/null 2>&1; then
    ( cd dist && rm -rf "${PRODUCT}" && cp -R win-unpacked "${PRODUCT}" && zip -rqy "${PRODUCT}-${VERSION}-win-x64.zip" "${PRODUCT}" && rm -rf "${PRODUCT}" )
    echo "✅ portable Windows zip created (manual fallback)"
  fi
}

echo "▶ building target=$TARGET ${PUBLISH:+(publishing)}"
case "$TARGET" in
  mac) npx electron-builder --mac --universal $PUBLISH ;;
  win) build_win ;;
  all) npx electron-builder --mac --universal $PUBLISH && build_win ;;
esac

echo ""
echo "✅ Done — artifacts in ./dist:"
ls -1 dist/*.dmg dist/*.zip dist/*.exe 2>/dev/null || true
