const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const updateSource = fs.readFileSync(path.join(__dirname, "..", "main", "auto-update.js"), "utf8");

test("QuickBar never transforms the macOS application process type", () => {
  assert.doesNotMatch(mainSource, /^\s*quickWindow\.setVisibleOnAllWorkspaces\s*\(/m);
  assert.doesNotMatch(mainSource, /^\s*app\.setActivationPolicy\s*\(/m);
});

test("the non-activating panel is constructed before the visible main window", () => {
  const startup = mainSource.slice(mainSource.indexOf("app.whenReady().then"));
  const quickIndex = startup.indexOf("createQuickWindow();");
  const mainIndex = startup.indexOf("createWindow(startHidden);");
  const activateIndex = startup.indexOf("if (!startHidden || pendingMainShow) showMain();");

  assert.ok(quickIndex >= 0, "startup must create the QuickBar");
  assert.ok(mainIndex > quickIndex, "the main window must be created after the panel");
  assert.ok(activateIndex > mainIndex, "foreground launches must finish by activating the main window");
});

test("the macOS updater preserves the outer app bundle for Dock bookmarks", () => {
  const match = updateSource.match(/const MAC_SWAP_SCRIPT = `([\s\S]*?)`;/);
  assert.ok(match, "MAC_SWAP_SCRIPT must exist");
  const script = match[1];

  assert.match(script, /OLD="\$APP\/Contents\.quartz-bak"/);
  assert.match(script, /mv "\$NEW\/Contents" "\$APP\/Contents"/);
  assert.doesNotMatch(script, /mv "\$APP" "\$APP\.bak"/);
});
