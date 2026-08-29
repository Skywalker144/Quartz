const { app, BrowserWindow, Menu, Tray, nativeImage, shell, globalShortcut, ipcMain, screen, dialog, safeStorage, session, net } = require("electron");
const path = require("path");
const fs = require("fs");
let autoUpdater = null;
try { autoUpdater = require("electron-updater").autoUpdater; } catch (e) { /* dep missing in some dev setups */ }
const { registerDataTransfer } = require("./main/data-transfer");
const { registerConversationExport } = require("./main/conversation-export");
const { createAutoUpdate } = require("./main/auto-update");

// Storage folder = "Quartz". Early builds used "ChatBox" (the old product name); migrate that folder over once
// via an atomic same-volume rename. On any failure, fall back to the legacy folder so data is never lost.
// Must run before app is ready.
try {
  const _ad = app.getPath("appData");
  const _target = path.join(_ad, "Quartz");
  const _legacy = path.join(_ad, "ChatBox");
  try { if (!fs.existsSync(_target) && fs.existsSync(_legacy)) fs.renameSync(_legacy, _target); } catch (e) {}
  // Use Quartz, unless the rename couldn't happen and only the legacy folder exists (then keep using it).
  app.setPath("userData", (fs.existsSync(_legacy) && !fs.existsSync(_target)) ? _legacy : _target);
} catch (e) {}

// Chromium encrypts its own cookie/session storage with an OS-keychain key ("Quartz Safe Storage").
// On an ad-hoc-signed app whose code signature changes every update, that pops a keychain prompt on
// each launch-after-update. Keep Chromium entirely out of the keychain. On macOS the right switch is
// --use-mock-keychain (--password-store is a Linux-only no-op on mac); --password-store=basic covers
// Linux. Our API keys live as plaintext in IndexedDB, not the keychain, so nothing is lost.
if (process.platform === "darwin") app.commandLine.appendSwitch("use-mock-keychain");
else app.commandLine.appendSwitch("password-store", "basic");

let mainWindow = null;
let quickWindow = null;
let tray = null;
let isQuitting = false;       // set on a real quit so close-to-tray doesn't swallow it
let pendingMainShow = false;  // a second launch can arrive before app.whenReady() has created the window
let loginEnabled = false;     // cached "open at login" state; drives background (close-to-tray) mode
let trayHintShown = false;    // show the "still running in the tray" balloon only once per session
// Config (provider keys, default model, theme, system prompt, shortcut, …) pushed up from
// the main app renderer. file:// pages don't share IndexedDB, so the quick bar can't read
// the store directly — the main process caches the config here and hands it to the bar.
let quickConfig = null;
let currentShortcut = null;   // quick-bar accelerator currently registered with the OS
let quickEnabled = null;      // whether the quick-bar global shortcut is active
let currentOpenShortcut = null;  // "open & focus Quartz" accelerator currently registered
let openEnabled = null;          // whether that global shortcut is active
// Platform-appropriate default global shortcuts. Windows avoids Alt+Space (system window menu) and the Cmd key.
const DEF_QUICK = "Alt+Space";
const DEF_OPENMAIN = process.platform === "darwin" ? "Cmd+Shift+L" : "Alt+Shift+L";

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
    // zoom：视图菜单 ⌘+/- 改的是 zoomLevel，这里一并记住，重启后恢复
    fs.writeFileSync(winStateFile(), JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: max, zoom: mainWindow.webContents.getZoomLevel() }));
  } catch (e) {}
}

function createWindow(startHidden = false) {
  const isMac = process.platform === "darwin";
  const saved = loadWinState();
  const opts = {
    width: (saved && saved.width) || 1100,
    height: (saved && saved.height) || 760,
    minWidth: 720,
    minHeight: 480,
    title: "Quartz",
    show: !startHidden,                              // launched at login → load hidden (QuickBar works, no window pops up)
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
    // A 14px traffic light at (14, 14) has its centre at (21, 21), matching the
    // sidebar's 6px inset + 15px corner radius.
    opts.trafficLightPosition = { x: 14, y: 14 };
  } else {
    // Windows/Linux: no OS title bar; draw native min/max/close as an overlay over our header
    opts.titleBarStyle = "hidden";
    opts.titleBarOverlay = { color: "#1c1c1c", symbolColor: "#d3d3d3", height: 60 };
  }
  if (saved && boundsVisible(saved)) { opts.x = saved.x; opts.y = saved.y; }
  mainWindow = new BrowserWindow(opts);
  if (saved && saved.maximized) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  // 恢复上次的界面缩放（视图菜单 ⌘+/- 设置的 zoomLevel）
  if (saved && Number.isFinite(saved.zoom) && saved.zoom !== 0) {
    mainWindow.webContents.once("did-finish-load", () => { try { mainWindow.webContents.setZoomLevel(saved.zoom); } catch (e) {} });
  }

  // Persist size/position (debounced) so the window reopens where you left it.
  const scheduleWinSave = () => { clearTimeout(_winSaveT); _winSaveT = setTimeout(saveWinState, 400); };
  mainWindow.on("resize", scheduleWinSave);
  mainWindow.on("move", scheduleWinSave);
  mainWindow.on("close", saveWinState);
  // Background mode (Windows/Linux, "开机自启" on): closing the window hides it to the tray instead
  // of quitting, so the global QuickBar + tray stay alive. A real quit (tray 退出 / Ctrl+Q / updater)
  // sets isQuitting first and falls through. macOS keeps its native "close window, app stays" behaviour.
  mainWindow.on("close", (e) => {
    if (isQuitting || process.platform === "darwin") return;
    if (tray && loginEnabled) { e.preventDefault(); mainWindow.hide(); hintTrayOnce(); }
  });

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
  // A second-instance event can race app.whenReady() during a cold launch. Defer the
  // request instead of trying to construct a BrowserWindow before Electron is ready.
  if (!app.isReady()) { pendingMainShow = true; return; }
  pendingMainShow = false;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow(true);
  if (mainWindow.isMinimized()) mainWindow.restore();
  // Activate the application before ordering the window front. Doing this in the
  // opposite order can leave a visible, non-key window (grey traffic lights) on macOS.
  if (process.platform === "darwin") { try { app.focus({ steal: true }); } catch (e) {} }
  mainWindow.show();
  mainWindow.focus();
  try { mainWindow.webContents.focus(); } catch (e) {}
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

/* ===================== Tray icon (Windows/Linux) ===================== */
// macOS already has the Dock + menu bar, so we only add a tray on Windows/Linux. It's the
// discoverable way to reopen the window (especially after a hidden login-launch) and to quit
// the app when it's running in the background with no window open.
function trayIconPath() {
  const file = process.platform === "win32" ? "icon.ico" : "icon.png";
  // packaged: copied next to the app via build.extraResources; dev: read straight from build/.
  return app.isPackaged ? path.join(process.resourcesPath, file) : path.join(__dirname, "build", file);
}
function createTray() {
  if (tray || process.platform === "darwin") return;
  try {
    let img = nativeImage.createFromPath(trayIconPath());
    if (img.isEmpty()) return;                 // no icon on disk — skip rather than show a blank slot
    img = img.resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip("Quartz");
    const menu = Menu.buildFromTemplate([
      { label: "打开 Quartz", click: () => showMain() },
      { label: "快速提问", click: () => showQuick() },
      { type: "separator" },
      { label: "退出 Quartz", click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => showMain());        // Windows: left-click reopens the window
    tray.on("double-click", () => showMain());
  } catch (e) { tray = null; }
}
// One-time balloon so closing the window into the tray doesn't feel like the app vanished.
function hintTrayOnce() {
  if (trayHintShown || !tray) return;
  trayHintShown = true;
  if (process.platform === "win32" && tray.displayBalloon) {
    try { tray.displayBalloon({ title: "Quartz 仍在后台运行", content: "已收进托盘，速答随时可用。点托盘图标可重新打开，右键可退出。" }); } catch (e) {}
  }
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
  // Do not call setVisibleOnAllWorkspaces({ visibleOnFullScreen: true }) here.
  // Electron's macOS `panel` already adds CanJoinAllSpaces + FullScreenAuxiliary;
  // that extra API call temporarily hides the Dock and transforms the whole process
  // into a UIElement, which detached the running app from its pinned Dock tile and
  // left the already-visible main window inactive.

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
  const sc = shortcut || DEF_QUICK;
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
  const sc = shortcut || DEF_OPENMAIN;
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
  const baseUrls = {};
  if (e.OPENAI_BASE_URL) baseUrls.openai = e.OPENAI_BASE_URL;
  if (e.ANTHROPIC_BASE_URL) baseUrls.anthropic = e.ANTHROPIC_BASE_URL;
  return { keys, baseUrls, chat: parseModelRef(e.DEFAULT_MODEL), title: parseModelRef(e.DEFAULT_TITLE_MODEL) };
}
ipcMain.handle("seed-config", () => seedConfig());
ipcMain.handle("app-info", () => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome }));
// Read the bundled CHANGELOG.md (works inside the asar) so 设置→关于 can show the release history.
ipcMain.handle("get-changelog", () => { try { return fs.readFileSync(path.join(__dirname, "CHANGELOG.md"), "utf8"); } catch (e) { return ""; } });
// Launch at login — start hidden so 速答 is available in the background without the window popping up.
// `args` is Windows-only. macOS 13+ ignores openAsHidden, so startup uses wasOpenedAtLogin below.
const LOGIN_ARGS = ["--hidden"];
function getLoginSettings() {
  return process.platform === "win32" ? app.getLoginItemSettings({ args: LOGIN_ARGS }) : app.getLoginItemSettings();
}
ipcMain.handle("get-login-item", () => { try { loginEnabled = !!getLoginSettings().openAtLogin; return loginEnabled; } catch (e) { return false; } });
ipcMain.handle("set-login-item", (_e, enabled) => {
  try {
    const settings = process.platform === "win32"
      ? { openAtLogin: !!enabled, args: LOGIN_ARGS }
      : { openAtLogin: !!enabled, openAsHidden: !!enabled };
    app.setLoginItemSettings(settings);
    loginEnabled = !!enabled;
    return true;
  } catch (e) { return false; }
});

// One-time: decrypt API keys that a brief earlier build stored via the OS keychain, so the renderer
// can convert them back to plaintext. (Key encryption was removed — it popped a keychain prompt on
// every ad-hoc update, which other desktop chat apps don't do.)
ipcMain.handle("decrypt-secret", (_e, b64) => {
  try { return b64 ? safeStorage.decryptString(Buffer.from(String(b64), "base64")) : null; }
  catch (e) { return null; }
});

registerDataTransfer({
  ipcMain,
  app,
  dialog,
  shell,
  fs,
  path,
  getMainWindow: () => mainWindow,
});

// Keep the Windows/Linux window-controls overlay colours in sync with the app theme.
ipcMain.on("set-titlebar-overlay", (_e, o) => {
  if (process.platform === "darwin" || !mainWindow || mainWindow.isDestroyed() || !mainWindow.setTitleBarOverlay) return;
  try { mainWindow.setTitleBarOverlay(o); } catch (e) {}
});
// Route all app network (model APIs, updater) through a local proxy (e.g. Clash), or go direct.
// defaultSession is shared by both the main window and the quick-ask bar, so one call covers everything.
ipcMain.handle("set-proxy", async (_e, cfg) => {
  try {
    const ses = session.defaultSession;
    if (cfg && cfg.enabled && cfg.host && cfg.port) {
      const rules = (cfg.scheme === "socks5")
        ? ("socks5://" + cfg.host + ":" + cfg.port)   // SOCKS5 for all schemes
        : (cfg.host + ":" + cfg.port);                // bare host:port = HTTP proxy for all schemes (incl. https)
      await ses.setProxy({ proxyRules: rules, proxyBypassRules: "<local>" });
      return { ok: true, rules };
    }
    await ses.setProxy({ mode: "direct" });
    return { ok: true, rules: null };
  } catch (e) { return { ok: false, error: e.message }; }
});
// Probe connectivity through the proxied defaultSession (main-process net.request → no CORS, honours the proxy).
// A Google 204 endpoint: only resolves if traffic really reaches the outside, exactly what a Clash user verifies.
ipcMain.handle("test-proxy", () => new Promise((resolve) => {
  const started = Date.now(); let done = false;
  const finish = (r) => { if (!done) { done = true; resolve(r); } };
  try {
    const req = net.request({ method: "GET", url: "https://www.gstatic.com/generate_204" });
    const timer = setTimeout(() => { try { req.abort(); } catch (e) {} finish({ ok: false, error: "超时（8 秒）" }); }, 8000);
    req.on("response", (res) => { clearTimeout(timer); res.on("data", () => {}); res.on("end", () => {}); finish({ ok: true, status: res.statusCode, ms: Date.now() - started }); });
    req.on("error", (e) => { clearTimeout(timer); finish({ ok: false, error: (e && e.message) || "无法连接" }); });
    req.end();
  } catch (e) { finish({ ok: false, error: e.message }); }
}));

const autoUpdate = createAutoUpdate({
  app,
  ipcMain,
  fs,
  path,
  os: require("os"),
  shell,
  net,
  autoUpdater,
  getMainWindow: () => mainWindow,
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

registerConversationExport({
  ipcMain,
  dialog,
  fs,
  path,
  os: require("os"),
  BrowserWindow,
  getMainWindow: () => mainWindow,
  appRoot: __dirname,
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
        { label: "快速提问", accelerator: (quickEnabled !== false && currentShortcut) ? currentShortcut : DEF_QUICK, registerAccelerator: false, click: () => toggleQuick() },
        { label: "打开并聚焦 Quartz", accelerator: (openEnabled !== false && currentOpenShortcut) ? currentOpenShortcut : DEF_OPENMAIN, registerAccelerator: false, click: () => showMainFocus() },
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

// Single instance: if Quartz is already running, don't open a duplicate. After an update the build is
// ad-hoc signed (a fresh signature), so macOS may treat the old Dock-pinned app as a different app and
// launch a second copy — this catches that launch, quits it, and focuses the running window instead.
// (It also stops two processes from writing the same data dir.)
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (app.isReady()) showMain();
  else pendingMainShow = true;
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;   // a duplicate launch — we're already quitting
  buildMenu();
  // Launched at login? Start with the main window hidden — the renderer still loads and the global
  // QuickBar shortcut registers (below), so 速答 works in the background before the window is opened.
  const li = getLoginSettings();
  loginEnabled = !!li.openAtLogin;
  const startHidden = process.argv.includes("--hidden") || li.wasOpenedAsHidden || li.wasOpenedAtLogin;
  // Construct the non-activating panel first and the normal app window last. This
  // guarantees that a user-initiated launch ends with the main window as the key window.
  createQuickWindow();   // created hidden; first Option+Space is then instant
  createWindow(startHidden);
  createTray();          // Windows/Linux tray; the way back to the window after a hidden launch

  // BrowserWindow(show:true) normally activates itself, but explicitly complete the
  // activation after all startup windows exist. Never steal focus for a login launch.
  if (!startHidden || pendingMainShow) showMain();

  // Register the default shortcuts now; the app reconciles them with the persisted settings
  // as soon as it boots and pushes its config up.
  applyQuickShortcut(DEF_QUICK, true);
  applyOpenShortcut(DEF_OPENMAIN, true);

  autoUpdate.setup();

  app.on("activate", () => { showMain(); });   // dock/taskbar click surfaces the window (incl. when it started hidden)
});

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });

app.on("window-all-closed", () => {
  // In background mode (tray + 开机自启) keep running with no window — the tray and QuickBar live on.
  if (process.platform !== "darwin" && !(tray && loginEnabled)) app.quit();
});
