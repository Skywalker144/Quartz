const { app, BrowserWindow, Menu, shell, globalShortcut, ipcMain, screen, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { /* dep missing in some dev setups */ }

// Keep the storage folder stable across the ChatBox→Quartz rename so existing conversations
// survive (userData defaults to productName, which changed). Must run before app is ready.
try { app.setPath("userData", path.join(app.getPath("appData"), "ChatBox")); } catch (e) {}

let mainWindow = null;
let quickWindow = null;
// Config (provider keys, default model, theme, system prompt, shortcut, …) pushed up from
// the main app renderer. file:// pages don't share IndexedDB, so the quick bar can't read
// the store directly — the main process caches the config here and hands it to the bar.
let quickConfig = null;
let currentShortcut = null;   // quick-bar accelerator currently registered with the OS
let quickEnabled = null;      // whether the quick-bar global shortcut is active
let currentOpenShortcut = null;  // "open & focus Quartz" accelerator currently registered
let openEnabled = null;          // whether that global shortcut is active

const QUICK_W = 720;        // fixed width of the Spotlight-style bar
const QUICK_MIN_H = 150;    // compact height: input row + shadow padding (28/60)
const QUICK_MAX_H = 660;    // cap; the answer area scrolls internally beyond this

function sendMenu(action) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("menu", action);
}

// Remember the main window's size/position across launches.
function winStateFile() { return path.join(app.getPath("userData"), "window-state.json"); }
function loadWinState() {
  try { const s = JSON.parse(fs.readFileSync(winStateFile(), "utf8"));
    if (s && Number.isFinite(s.width) && Number.isFinite(s.height)) return s; } catch (e) {}
  return null;
}
function boundsVisible(b) {   // is the window's title bar on some currently-connected display?
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return false;
  return screen.getAllDisplays().some(d => {
    const w = d.workArea;
    return b.x + b.width > w.x + 80 && b.x < w.x + w.width - 80 && b.y >= w.y - 4 && b.y < w.y + w.height - 40;
  });
}
let _winSaveT = null;
function saveWinState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const max = mainWindow.isMaximized();
    const b = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    fs.writeFileSync(winStateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: max }));
  } catch (e) {}
}

function createWindow() {
  const isMac = process.platform === "darwin";
  const saved = loadWinState();
  const opts = {
    width: (saved && saved.width) || 1100,
    height: (saved && saved.height) || 760,
    minWidth: 720,
    minHeight: 480,
    title: "Quartz",
    backgroundColor: "#1c1c1c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  };
  if (isMac) {
    opts.titleBarStyle = "hiddenInset";              // hide bar, keep inset traffic lights
    opts.trafficLightPosition = { x: 18, y: 18 };
  } else {
    // Windows/Linux: no OS title bar; draw native min/max/close as an overlay over our header
    opts.titleBarStyle = "hidden";
    opts.titleBarOverlay = { color: "#1c1c1c", symbolColor: "#d3d3d3", height: 60 };
  }
  if (saved && boundsVisible(saved)) { opts.x = saved.x; opts.y = saved.y; }
  mainWindow = new BrowserWindow(opts);
  if (saved && saved.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // Persist size/position (debounced) so the window reopens where you left it.
  const scheduleWinSave = () => { clearTimeout(_winSaveT); _winSaveT = setTimeout(saveWinState, 400); };
  mainWindow.on("resize", scheduleWinSave);
  mainWindow.on("move", scheduleWinSave);
  mainWindow.on("close", saveWinState);

  // Open external (http/https) links in the user's default browser,
  // not inside the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      e.preventDefault();
      if (url.startsWith("http")) shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// Bring the main Quartz window to the front (recreating it if it was closed).
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") { try { app.focus({ steal: true }); } catch (e) {} }
}

// Global "open & focus" — bring up Quartz and put the cursor in the composer.
function showMainFocus() {
  const fresh = !mainWindow || mainWindow.isDestroyed();
  showMain();
  const wc = mainWindow.webContents;
  const focus = () => wc.send("menu", "focus-input");
  if (fresh || wc.isLoading()) wc.once("did-finish-load", () => setTimeout(focus, 80));
  else focus();
}

/* ===================== Quick-ask bar (Option+Space) ===================== */
function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: QUICK_W,
    height: QUICK_MIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,        // the rounded card draws its own shadow in CSS
    roundedCorners: false,   // we round (squircle) in CSS
    alwaysOnTop: true,
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  quickWindow.loadFile(path.join(__dirname, "quickbar.html"));
  quickWindow.setAlwaysOnTop(true, "screen-saver");
  if (process.platform === "darwin") {
    quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  // Click outside / focus elsewhere dismisses the bar (Spotlight behaviour), unless the
  // user turned that off in settings.
  quickWindow.on("blur", () => {
    if (quickWindow && quickWindow.isVisible() && (!quickConfig || quickConfig.closeOnBlur !== false)) hideQuick();
  });

  quickWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });
  quickWindow.on("closed", () => { quickWindow = null; });
}

function showQuick() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  // Width + vertical position come from settings; centred horizontally on the display
  // that holds the cursor.
  const pt = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(pt).workArea;
  const w = Math.round((quickConfig && quickConfig.width) || QUICK_W);
  const topPct = (quickConfig && typeof quickConfig.topPct === "number") ? quickConfig.topPct : 18;
  const x = Math.round(wa.x + (wa.width - w) / 2);
  const y = Math.round(wa.y + wa.height * (topPct / 100));
  const h = Math.max(QUICK_MIN_H, Math.min(QUICK_MAX_H, quickWindow.getBounds().height || QUICK_MIN_H));
  quickWindow.setBounds({ x, y, width: w, height: h });
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send("quick-focus", quickConfig);
}

function hideQuick() {
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
}

function toggleQuick() {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) hideQuick();
  else showQuick();
}

// (Re)register the global shortcut to match settings. Reports success/failure back to the
// app renderer so the settings panel can flag a conflict.
function applyQuickShortcut(shortcut, enabled) {
  const sc = shortcut || "Alt+Space";
  const en = enabled !== false;
  if (sc === currentShortcut && en === quickEnabled) return;   // nothing changed
  if (currentShortcut) { try { globalShortcut.unregister(currentShortcut); } catch (e) {} }
  currentShortcut = sc; quickEnabled = en;
  let ok = true;
  if (en) {
    try { ok = globalShortcut.register(sc, toggleQuick); } catch (e) { ok = false; }
    if (!ok) console.warn("Failed to register quick shortcut: " + sc);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("quick-shortcut-result", { which: "quickBar", shortcut: sc, ok: en ? ok : true });
  buildMenu();   // refresh the (display-only) accelerator shown in the menu
}

// Same, for the "open & focus Quartz" global shortcut.
function applyOpenShortcut(shortcut, enabled) {
  const sc = shortcut || "Alt+Cmd+Space";
  const en = enabled !== false;
  if (sc === currentOpenShortcut && en === openEnabled) return;
  if (currentOpenShortcut) { try { globalShortcut.unregister(currentOpenShortcut); } catch (e) {} }
  currentOpenShortcut = sc; openEnabled = en;
  let ok = true;
  if (en) {
    try { ok = globalShortcut.register(sc, showMainFocus); } catch (e) { ok = false; }
    if (!ok) console.warn("Failed to register open-main shortcut: " + sc);
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("quick-shortcut-result", { which: "openMain", shortcut: sc, ok: en ? ok : true });
  buildMenu();
}

// Renderer asks to grow/shrink the bar to fit its content; keep x/y/width fixed.
ipcMain.on("quick-resize", (_e, height) => {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const h = Math.max(QUICK_MIN_H, Math.min(QUICK_MAX_H, Math.round(height || 0)));
  const b = quickWindow.getBounds();
  if (b.height !== h) quickWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: h });
});

ipcMain.on("quick-hide", () => hideQuick());

// Optional bundled .env (for distribution builds): provider keys + default model the renderer
// seeds into a fresh install. Parsed once; safe if the file is absent.
function readBundledEnv() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    const env = {};
    txt.split(/\r?\n/).forEach(line => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return;
      const i = t.indexOf("="); if (i < 0) return;
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
    return env;
  } catch (e) { return {}; }
}
function parseModelRef(s) {
  if (!s) return null;
  const i = s.indexOf("::");
  return i < 0 ? { provider: "openrouter", model: s.trim() } : { provider: s.slice(0, i).trim(), model: s.slice(i + 2).trim() };
}
function seedConfig() {
  const e = readBundledEnv();
  const map = { OPENROUTER_API_KEY: "openrouter", OPENAI_API_KEY: "openai", ANTHROPIC_API_KEY: "anthropic", DEEPSEEK_API_KEY: "deepseek", GOOGLE_API_KEY: "google" };
  const keys = {};
  for (const k in map) if (e[k]) keys[map[k]] = e[k];
  return { keys, chat: parseModelRef(e.DEFAULT_MODEL), title: parseModelRef(e.DEFAULT_TITLE_MODEL) };
}
ipcMain.handle("seed-config", () => seedConfig());
ipcMain.handle("app-info", () => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }));

// One-time: decrypt API keys that a brief earlier build stored via the OS keychain, so the renderer
// can convert them back to plaintext. (Key encryption was removed — it popped a keychain prompt on
// every ad-hoc update, which other desktop chat apps don't do.)
ipcMain.handle("decrypt-secret", (_e, b64) => {
  try { return b64 ? safeStorage.decryptString(Buffer.from(String(b64), "base64")) : null; }
  catch (e) { return null; }
});

// Full data backup: write the whole app-state blob (conversations + settings + keys) to a file the user picks.
ipcMain.handle("data-export", async (_e, json) => {
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await dialog.showSaveDialog(mainWindow, {
      title: "导出 Quartz 数据",
      defaultPath: `Quartz-备份-${stamp}.json`,
      filters: [{ name: "Quartz 备份", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, json, "utf8");
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Restore from a backup file: read it and hand the raw JSON text back to the renderer to validate + apply.
ipcMain.handle("data-import", async () => {
  try {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: "导入 Quartz 数据",
      properties: ["openFile"],
      filters: [{ name: "Quartz 备份", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { ok: true, json: fs.readFileSync(r.filePaths[0], "utf8") };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Silent rotating auto-backups for data safety (the renderer strips API keys before sending).
function backupsDir() { return path.join(app.getPath("userData"), "backups"); }
ipcMain.handle("backup-write", (_e, json) => {
  try {
    const dir = backupsDir(); fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `quartz-auto-${stamp}.json`), json, "utf8");
    const files = fs.readdirSync(dir).filter(f => /^quartz-auto-.*\.json$/.test(f)).sort();
    while (files.length > 8) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) {} }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle("open-backups", () => {
  try { const d = backupsDir(); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Keep the Windows/Linux window-controls overlay colours in sync with the app theme.
ipcMain.on("set-titlebar-overlay", (_e, o) => {
  if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed() || !mainWindow.setTitleBarOverlay) return;
  try { mainWindow.setTitleBarOverlay(o); } catch (e) {}
});

/* ===================== Auto-update (GitHub releases) ===================== */
// Windows (NSIS): electron-updater downloads + self-installs via quitAndInstall.
// macOS is ad-hoc signed, so Squirrel.Mac can't self-install. Instead we run our OWN
// updater: electron-updater only CHECKS; on mac we download the zip ourselves (Chromium
// net, proxy-aware), verify its sha512, then swap the .app bundle in place and relaunch.
const GH_OWNER = "Skywalker144", GH_REPO = "Quartz";
let lastUpdate = null;          // cached so the renderer can query on boot
let pendingUpdate = null;       // { version, zipPath } once a mac update is downloaded & verified
function uSend(payload) {
  lastUpdate = payload;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-status", payload);
}
function releasesUrl() { return `https://github.com/${GH_OWNER}/${GH_REPO}/releases/latest`; }
function ignoredPath() { return path.join(app.getPath("userData"), "ignored-update"); }
function getIgnored() { try { return fs.readFileSync(ignoredPath(), "utf8").trim(); } catch (e) { return ""; } }
function setIgnored(v) { try { fs.writeFileSync(ignoredPath(), v || "", "utf8"); } catch (e) {} }
function appBundlePath() { return path.resolve(path.dirname(process.execPath), "..", ".."); } // …/Quartz.app

// Stream a URL to disk via Chromium's net stack (follows redirects, honours system proxy).
function downloadTo(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const { net } = require("electron");
    const req = net.request(url);
    req.on("response", (res) => {
      if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
      const lh = res.headers["content-length"];
      const total = parseInt(Array.isArray(lh) ? lh[0] : (lh || 0), 10) || 0;
      const file = fs.createWriteStream(dest);
      let got = 0;
      res.on("data", (c) => { got += c.length; file.write(c); if (total) onProgress(Math.min(99, Math.round(got / total * 100))); });
      res.on("end", () => file.end(resolve));
      res.on("error", reject);
      file.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

async function downloadMacUpdate(info) {
  const ver = info && info.version;
  const entry = ((info && info.files) || []).find(f => /-mac\.zip$/.test(f.url)) || {};
  const name = entry.url || `Quartz-${ver}-arm64-mac.zip`;
  const url = `https://github.com/${GH_OWNER}/${GH_REPO}/releases/download/v${ver}/${name}`;
  const dir = path.join(app.getPath("userData"), "updates");
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const dest = path.join(dir, name);
  uSend({ state: "downloading", version: ver, percent: 0 });
  try {
    await downloadTo(url, dest, (pct) => uSend({ state: "downloading", version: ver, percent: pct }));
    if (entry.sha512) {
      const got = require("crypto").createHash("sha512").update(fs.readFileSync(dest)).digest("base64");
      if (got !== entry.sha512) throw new Error("下载校验失败");
    }
    pendingUpdate = { version: ver, zipPath: dest };
    uSend({ state: "ready", version: ver });
  } catch (e) {
    uSend({ state: "error", version: ver, message: e.message });
  }
}

// Detached shell helper: wait for us to quit, unzip the new build, swap it in (keeping a
// rollback copy), strip quarantine so Gatekeeper won't block the ad-hoc app, relaunch.
const MAC_SWAP_SCRIPT = `#!/bin/sh
ZIP="$1"; APP="$2"; DIR="$(dirname "$ZIP")/_x"
i=0; while /usr/bin/pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1 && [ $i -lt 80 ]; do sleep 0.25; i=$((i+1)); done
rm -rf "$DIR"; mkdir -p "$DIR"
/usr/bin/ditto -x -k "$ZIP" "$DIR" || { open "$APP"; exit 1; }
NEW="$DIR/$(basename "$APP")"
[ -d "$NEW" ] || NEW="$(/usr/bin/find "$DIR" -maxdepth 1 -name '*.app' | head -1)"
[ -d "$NEW" ] || { open "$APP"; exit 1; }
/usr/bin/xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
rm -rf "$APP.bak"
mv "$APP" "$APP.bak" || { open "$APP"; exit 1; }
if mv "$NEW" "$APP"; then rm -rf "$APP.bak"; else mv "$APP.bak" "$APP"; open "$APP"; exit 1; fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
rm -rf "$DIR"
open "$APP"
`;
function installMacUpdate() {
  if (!pendingUpdate || !pendingUpdate.zipPath) { shell.openExternal(releasesUrl()); return; }
  try {
    const script = path.join(os.tmpdir(), "quartz-self-update.sh");
    fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
    require("child_process").spawn("/bin/sh", [script, pendingUpdate.zipPath, appBundlePath()], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 250);
  } catch (e) { uSend({ state: "error", message: e.message }); }
}

function setupAutoUpdate() {
  if (!autoUpdater || !app.isPackaged) return;   // no updates in dev
  const isMac = process.platform === "darwin";
  autoUpdater.autoDownload = !isMac;             // win: updater downloads NSIS; mac: we download ourselves
  autoUpdater.autoInstallOnAppQuit = !isMac;
  autoUpdater.on("update-available", (info) => {
    const ver = info && info.version;
    if (ver && ver === getIgnored()) { uSend({ state: "none", version: ver, ignored: true }); return; }
    if (isMac) downloadMacUpdate(info);
    else uSend({ state: "downloading", version: ver });
  });
  autoUpdater.on("update-not-available", (info) => uSend({ state: "none", version: info && info.version }));
  autoUpdater.on("download-progress", (p) => { if (process.platform !== "darwin") uSend({ state: "downloading", percent: Math.round((p && p.percent) || 0) }); });
  autoUpdater.on("update-downloaded", (info) => { pendingUpdate = { version: info && info.version }; uSend({ state: "ready", version: info && info.version }); });
  autoUpdater.on("error", (e) => uSend({ state: "error", message: e && e.message }));
  autoUpdater.checkForUpdates().catch(() => {});                                   // on launch
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 24 * 60 * 60 * 1000);   // + once a day while running
}
ipcMain.handle("update-status-get", () => lastUpdate);
ipcMain.handle("update-check", async () => {
  if (!autoUpdater || !app.isPackaged) return { state: "dev" };
  uSend({ state: "checking" });
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { uSend({ state: "error", message: e && e.message }); return { ok: false, error: e && e.message }; }
});
ipcMain.on("update-action", (_e, action) => {
  if (action === "ignore") { const v = lastUpdate && lastUpdate.version; if (v) setIgnored(v); uSend({ state: "none", version: v, ignored: true }); return; }
  if (action === "page") { shell.openExternal(releasesUrl()); return; }
  if (process.platform === "darwin") installMacUpdate();
  else if (autoUpdater) { try { autoUpdater.quitAndInstall(); } catch (e) {} }
});

// The main app renderer pushes its current config up; the quick bar pulls it on demand.
ipcMain.on("quick-config", (_e, cfg) => {
  quickConfig = cfg;
  if (cfg) {
    applyQuickShortcut(cfg.shortcut, cfg.enabled);
    applyOpenShortcut(cfg.openMainShortcut, cfg.openMainEnabled);
  }
});
ipcMain.handle("quick-config-get", () => quickConfig);

// Hand the quick Q&A (or a draft question) off to the main Quartz window.
ipcMain.on("quick-handoff", (_e, payload) => {
  hideQuick();
  showMain();
  const wc = mainWindow.webContents;
  if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("quick-open", payload));
  else wc.send("quick-open", payload);
});

/* ===================== Export current conversation (PDF / PNG / Markdown) ===================== */
const EXPORT_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.66; }
/* fixed text column so PDF (A4) and PNG render an identical line length (~42 CJK chars @15px) */
.ex-root { max-width: 700px; margin: 0 auto; padding: 40px 30px 48px; }
.ex-title { font-size: 22px; font-weight: 700; margin: 0 0 26px; }
.ex-turn { margin: 0 0 22px; }
.ex-who { font-size: 11px; font-weight: 700; color: #999; margin-bottom: 6px; letter-spacing: .06em; }
.ex-user .ex-bubble { background: #f1f1f3; border-radius: 12px; padding: 12px 16px; }
.ex-assistant .ex-bubble { padding: 0 2px; }
.ex-bubble > :first-child { margin-top: 0; } .ex-bubble > :last-child { margin-bottom: 0; }
.ex-bubble p { margin: 0 0 .7em; }
.ex-bubble ul, .ex-bubble ol { margin: .4em 0 .8em; padding-left: 1.5em; }
.ex-bubble li { margin: .15em 0; }
.ex-bubble h1, .ex-bubble h2, .ex-bubble h3, .ex-bubble h4 { margin: .9em 0 .4em; line-height: 1.3; }
.ex-bubble pre { background: #f6f6f7; border: 1px solid #e6e6e6; border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: .6em 0; }
.ex-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; }
.ex-bubble :not(pre) > code { background: #efefef; padding: .1em .35em; border-radius: 4px; }
.ex-bubble blockquote { margin: .6em 0; padding-left: .9em; border-left: 3px solid #ddd; color: #666; }
.ex-bubble table { border-collapse: collapse; margin: .5em 0; } .ex-bubble th, .ex-bubble td { border: 1px solid #ddd; padding: 5px 10px; }
.ex-bubble a { color: #0a58ca; }
.ex-img { max-width: 100%; border-radius: 8px; margin: 6px 0; display: block; }
.ex-file { font-size: 13px; color: #666; margin: 4px 0; }
`;
function buildExportDoc(title, bodyHTML) {
  const katexHref = "file://" + path.join(__dirname, "vendor", "katex", "katex.min.css");
  const safeTitle = String(title || "对话").replace(/[<>&]/g, "");
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + safeTitle +
    '</title><link rel="stylesheet" href="' + katexHref + '"><style>' + EXPORT_CSS +
    '</style></head><body><main class="ex-root">' + bodyHTML + '</main></body></html>';
}

ipcMain.handle("export-conversation", async (_e, payload) => {
  const p = payload || {};
  const base = (p.name || "对话");
  try {
    if (p.format === "md") {
      const r = await dialog.showSaveDialog(mainWindow, { defaultPath: base + ".md", filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (r.canceled || !r.filePath) return { canceled: true };
      fs.writeFileSync(r.filePath, p.markdown || "", "utf8");
      return { ok: true, path: r.filePath };
    }
    // PDF / PNG: render the conversation in a hidden window
    const html = buildExportDoc(p.title, p.bodyHTML || "");
    const tmpFile = path.join(os.tmpdir(), "quartz-export-" + process.pid + "-" + Math.round(process.hrtime()[1]) + ".html");
    fs.writeFileSync(tmpFile, html, "utf8");
    // window width = column (700) + ~30px margin each side, so the PNG is a tight, centred document
    const win = new BrowserWindow({ show: false, width: 760, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false } });
    try {
      await win.loadFile(tmpFile);
      await new Promise(r => setTimeout(r, 300));   // let KaTeX fonts / images settle
      if (p.format === "pdf") {
        const r = await dialog.showSaveDialog(mainWindow, { defaultPath: base + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
        if (r.canceled || !r.filePath) return { canceled: true };
        const data = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { marginType: "custom", top: 0.5, bottom: 0.5, left: 0.4, right: 0.4 } });
        fs.writeFileSync(r.filePath, data);
        return { ok: true, path: r.filePath };
      } else {
        // PNG — size the page to its full content, then capture
        const dims = await win.webContents.executeJavaScript("({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})");
        const W = Math.max(360, Math.min(2000, dims.w || 860));
        const H = Math.max(200, Math.min(8000, dims.h || 1000));   // capped (×DPR must stay under GPU texture limit); PDF has no limit
        win.setContentSize(W, H);
        await new Promise(r => setTimeout(r, 250));
        const r = await dialog.showSaveDialog(mainWindow, { defaultPath: base + ".png", filters: [{ name: "PNG 图片", extensions: ["png"] }] });
        if (r.canceled || !r.filePath) return { canceled: true };
        const img = await win.webContents.capturePage();
        fs.writeFileSync(r.filePath, img.toPNG());
        return { ok: true, path: r.filePath };
      }
    } finally {
      win.destroy();
      fs.unlink(tmpFile, () => {});
    }
  } catch (err) {
    return { error: String((err && err.message) || err) };
  }
});

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "对话",
      submenu: [
        { label: "新对话", accelerator: "CmdOrCtrl+N", click: () => sendMenu("new-conversation") },
        { label: "聚焦输入框", accelerator: "CmdOrCtrl+L", click: () => sendMenu("focus-input") },
        { label: "搜索对话", accelerator: "CmdOrCtrl+F", click: () => sendMenu("focus-search") },
        // accelerators below are display-only (registerAccelerator:false) — the real bindings are
        // the global shortcuts, so we don't double-register and double-trigger when focused.
        { label: "快速提问", accelerator: (quickEnabled !== false && currentShortcut) ? currentShortcut : "Alt+Space", registerAccelerator: false, click: () => toggleQuick() },
        { label: "打开并聚焦 Quartz", accelerator: (openEnabled !== false && currentOpenShortcut) ? currentOpenShortcut : "Alt+Cmd+Space", registerAccelerator: false, click: () => showMainFocus() },
        { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => sendMenu("open-settings") },
        { type: "separator" },
        isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
      ],
    },
    { role: "editMenu" },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  createQuickWindow();   // created hidden; first Option+Space is then instant
  // Creating the 'panel'-type quick bar demotes the app to an accessory (UIElement) on macOS —
  // which strips the Dock running-dot and the menu bar. Force a normal foreground app back.
  if (process.platform === "darwin") { try { app.setActivationPolicy("regular"); } catch (e) {} }

  // Register the default shortcuts now; the app reconciles them with the persisted settings
  // as soon as it boots and pushes its config up.
  applyQuickShortcut("Alt+Space", true);
  applyOpenShortcut("Alt+Cmd+Space", true);

  setupAutoUpdate();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().filter(w => w !== quickWindow).length === 0) createWindow();
  });
});

app.on("will-quit", () => { globalShortcut.unregisterAll(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
