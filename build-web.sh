#!/usr/bin/env bash
#
# Build the static web version of Quartz into dist-web/ for Cloudflare Pages.
#
# Pure file assembly — no node/npm required, runs on macOS or Linux CI.
# The source files (index.html, app.js, styles.css) are NOT modified: the web
# shim + PWA tags are injected only into the COPY under dist-web/.
#
#   Cloudflare Pages:  Build command = bash build-web.sh   Output dir = dist-web
#   Local quick test:  bash build-web.sh && open dist-web/index.html
#
set -euo pipefail
cd "$(dirname "$0")"

OUT="dist-web"
VER="$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"

rm -rf "$OUT"
mkdir -p "$OUT"

# --- shared core: the very same files the Electron renderer uses ---
cp app.js styles.css CHANGELOG.md "$OUT"/
cp -R shared "$OUT"/shared
cp -R renderer "$OUT"/renderer
cp -R vendor "$OUT"/vendor
cp -R assets "$OUT"/assets

# --- web-only assets ---
cp web/manifest.json "$OUT"/manifest.json
cp -R web/icons "$OUT"/icons

# web-shim.js: stamp the version in (avoids a CSP-blocked inline <script>)
sed "s/__QUARTZ_VERSION__/$VER/g" web/web-shim.js > "$OUT"/web-shim.js

# --- index.html: inject PWA tags + the shim, single-line so sed is portable ---
PWA='<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#1c1c1c"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black"><meta name="apple-mobile-web-app-title" content="Quartz"><link rel="manifest" href="manifest.json"><link rel="apple-touch-icon" href="icons/icon-192.png">'
sed \
  -e "s|<meta name=\"viewport\"[^>]*>|$PWA|" \
  -e "s|<script src=\"app.js\"></script>|<script src=\"web-shim.js\"></script><script src=\"app.js\"></script>|" \
  index.html > "$OUT"/index.html

# --- tidy: drop macOS junk that cp -R drags along ---
find "$OUT" -name '.DS_Store' -delete

# --- safety: dist-web must never contain a key or the Electron main process ---
for bad in .env main.js preload.js quickbar.js quickbar.html quickbar.css; do
  if [ -e "$OUT/$bad" ]; then echo "ERROR: $bad leaked into $OUT/" >&2; exit 1; fi
done

echo "Built $OUT/  (Quartz v$VER)"
