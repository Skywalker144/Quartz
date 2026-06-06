# Building & releasing Quartz

Maintainer notes. Day-to-day usage lives in [README.md](README.md).

## Prerequisites

- **Node.js 18+**
- macOS on Apple Silicon for the mac build (`arm64`).
- The repo ships with vendored web libs (`vendor/`), so the app has no runtime web dependencies; `electron-updater` is the only bundled npm dependency.

## One-click build

```bash
./build.sh mac     # macOS arm64: dmg + zip + latest-mac.yml
./build.sh win     # Windows x64: portable zip
./build.sh all
./build.sh mac --publish   # build AND upload to a GitHub release (needs GH_TOKEN)
```

`build.sh` sets two env vars for you:

- `CSC_IDENTITY_AUTO_DISCOVERY=false` — ad-hoc sign (there is no Apple Developer cert).
- `ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/` — fast, proxy-friendly Electron download.

## Platform caveats

### Windows from a Mac
electron-builder runs `rcedit` through a **bundled x86 Wine** to stamp the exe's icon/version. On
Apple Silicon **without Rosetta 2** this step fails (`bad CPU type`), but the app is still fully
packaged — `build.sh` then zips `win-unpacked/` itself, giving a runnable portable build (default
icon, no version strings).

- For clean Windows builds (icon + version), install Rosetta once: `softwareupdate --install-rosetta --agree-to-license`.
- For a native **`.exe` installer (NSIS) with working auto-update**, build on a real Windows PC — see [BUILD-WINDOWS.md](BUILD-WINDOWS.md). The portable zip does **not** auto-update.

### Code signing & auto-update
Builds are **ad-hoc signed** (no cert), so:

- **macOS** can't *self-install* updates (Squirrel.Mac requires a Developer ID signature). Quartz
  still checks the feed and shows a "新版本 · 前往下载" notice that opens the Releases page. A
  $99/yr Apple Developer cert would enable true one-click updates.
- **Windows** auto-update works **only** with the NSIS installer (built on a PC), not the portable zip.

## Cutting a release

1. Bump `version` in `package.json` (e.g. `0.2.0`). electron-updater compares versions, so this must increase.
2. Build the artifacts: `./build.sh all`.
3. Create a GitHub Release tagged `v<version>` and attach **all** of:
   `Quartz-<ver>-arm64.dmg`, `Quartz-<ver>-arm64-mac.zip`, `latest-mac.yml`, `Quartz-<ver>-win-x64.zip`
   (the `.yml` is what powers the update check — don't forget it).

Easiest with the GitHub CLI:

```bash
gh release create v0.2.0 --title "Quartz 0.2.0" --notes "..." \
  dist/Quartz-0.2.0-arm64.dmg dist/Quartz-0.2.0-arm64-mac.zip \
  dist/Quartz-0.2.0-win-x64.zip dist/latest-mac.yml
```

Or let electron-builder publish directly: `GH_TOKEN=<token> ./build.sh mac --publish`
(uses the `build.publish` config in `package.json`; `releaseType: "release"` publishes immediately
rather than as a draft), then attach the Windows zip to that release.

> The public release must contain **no** API key — build releases with an empty `.env`. Keyed
> builds for friends are private, never published here.
