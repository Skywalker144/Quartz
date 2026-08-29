"use strict";

const crypto = require("node:crypto");
const childProcess = require("node:child_process");

const MAC_SWAP_SCRIPT = `#!/bin/sh
ZIP="$1"; APP="$2"; DIR="$(dirname "$ZIP")/_x"
i=0; while /usr/bin/pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1 && [ $i -lt 80 ]; do sleep 0.25; i=$((i+1)); done
rm -rf "$DIR"; mkdir -p "$DIR"
/usr/bin/ditto -x -k "$ZIP" "$DIR" || { open "$APP"; exit 1; }
NEW="$DIR/$(basename "$APP")"
[ -d "$NEW" ] || NEW="$(/usr/bin/find "$DIR" -maxdepth 1 -name '*.app' | head -1)"
[ -d "$NEW" ] || { open "$APP"; exit 1; }
/usr/bin/xattr -dr com.apple.quarantine "$NEW" 2>/dev/null
OLD="$APP/Contents.quartz-bak"
rm -rf "$OLD"
mv "$APP/Contents" "$OLD" || { open "$APP"; exit 1; }
if mv "$NEW/Contents" "$APP/Contents"; then
  rm -rf "$OLD" "$NEW"
else
  rm -rf "$APP/Contents"
  mv "$OLD" "$APP/Contents"
  open "$APP"
  exit 1
fi
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null
rm -rf "$DIR"
open "$APP"
`;

function selectMacUpdateFile(files, arch) {
  const values = files || [];
  return values.find(file => /-universal-mac\.zip$/.test(file.url || ""))
    || values.find(file => new RegExp("-" + arch + "-mac\\.zip$").test(file.url || ""))
    || values.find(file => /-mac\.zip$/.test(file.url || ""))
    || {};
}

function createAutoUpdate(options) {
  const { app, ipcMain, fs, path, os, shell, net, autoUpdater, getMainWindow } = options;
  const owner = options.owner || "Skywalker144";
  const repository = options.repository || "Quartz";
  let lastUpdate = null;
  let pendingUpdate = null;
  let macDownload = null;
  let autoUpdateOn = true;
  const autoUpdatePath = () => path.join(app.getPath("userData"), "auto-update");
  const loadAutoUpdate = () => {
    try {
      autoUpdateOn = fs.readFileSync(autoUpdatePath(), "utf8").trim() !== "0";
    } catch (error) {
      autoUpdateOn = true;
    }
    return autoUpdateOn;
  };
  const saveAutoUpdate = on => {
    autoUpdateOn = !!on;
    try {
      fs.writeFileSync(autoUpdatePath(), on ? "1" : "0");
    } catch (error) {}
  };
  const send = payload => {
    lastUpdate = payload;
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("update-status", payload);
  };
  const releasesUrl = () => `https://github.com/${owner}/${repository}/releases/latest`;
  const appBundlePath = () => path.resolve(path.dirname(process.execPath), "..", "..");

  const downloadTo = (url, destination, onProgress) => new Promise((resolve, reject) => {
    const request = net.request(url);
    request.on("response", response => {
      if (response.statusCode !== 200) {
        reject(new Error("HTTP " + response.statusCode));
        return;
      }
      const header = response.headers["content-length"];
      const total = parseInt(Array.isArray(header) ? header[0] : (header || 0), 10) || 0;
      const file = fs.createWriteStream(destination);
      let received = 0;
      response.on("data", chunk => {
        received += chunk.length;
        file.write(chunk);
        if (total) onProgress(Math.min(99, Math.round(received / total * 100)));
      });
      response.on("end", () => file.end(resolve));
      response.on("error", reject);
      file.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });

  const downloadMacUpdate = async info => {
    const version = info && info.version;
    if (pendingUpdate && pendingUpdate.zipPath && pendingUpdate.version === version) {
      send({ state: "ready", version });
      return;
    }
    if (macDownload) {
      send({ state: "downloading", version: macDownload.version, percent: macDownload.percent });
      return;
    }
    macDownload = { version, percent: 0 };
    const entry = selectMacUpdateFile(info && info.files, process.arch);
    const name = entry.url || `Quartz-${version}-${process.arch}-mac.zip`;
    const url = `https://github.com/${owner}/${repository}/releases/download/v${version}/${name}`;
    const dir = path.join(app.getPath("userData"), "updates");
    const destination = path.join(dir, name);
    send({ state: "downloading", version, percent: 0 });
    try {
      fs.mkdirSync(dir, { recursive: true });
      await downloadTo(url, destination, percent => {
        if (macDownload) macDownload.percent = percent;
        send({ state: "downloading", version, percent });
      });
      if (!entry.sha512) throw new Error("更新缺少校验信息（sha512），为安全起见已中止");
      const digest = crypto.createHash("sha512").update(fs.readFileSync(destination)).digest("base64");
      if (digest !== entry.sha512) throw new Error("下载校验失败");
      pendingUpdate = { version, zipPath: destination };
      send({ state: "ready", version });
    } catch (error) {
      send({ state: "error", version, message: error.message });
    } finally {
      macDownload = null;
    }
  };

  const installMacUpdate = () => {
    if (!pendingUpdate || !pendingUpdate.zipPath) {
      shell.openExternal(releasesUrl());
      return;
    }
    try {
      const script = path.join(os.tmpdir(), "quartz-self-update.sh");
      fs.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o755 });
      childProcess.spawn("/bin/sh", [script, pendingUpdate.zipPath, appBundlePath()], { detached: true, stdio: "ignore" }).unref();
      setTimeout(() => app.quit(), 250);
    } catch (error) {
      send({ state: "error", message: error.message });
    }
  };

  ipcMain.handle("update-status-get", () => lastUpdate);
  ipcMain.handle("get-auto-update", () => loadAutoUpdate());
  ipcMain.on("set-auto-update", (_event, on) => saveAutoUpdate(on));
  ipcMain.handle("update-check", async () => {
    if (!autoUpdater || !app.isPackaged) return { state: "dev" };
    send({ state: "checking" });
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      send({ state: "error", message: error && error.message });
      return { ok: false, error: error && error.message };
    }
  });
  ipcMain.on("update-action", (_event, action) => {
    if (action === "page") {
      shell.openExternal(releasesUrl());
    } else if (process.platform === "darwin") {
      installMacUpdate();
    } else if (autoUpdater) {
      try {
        autoUpdater.quitAndInstall();
      } catch (error) {}
    }
  });

  const setup = () => {
    if (!autoUpdater || !app.isPackaged) return;
    const isMac = process.platform === "darwin";
    autoUpdater.autoDownload = !isMac;
    autoUpdater.autoInstallOnAppQuit = !isMac;
    autoUpdater.on("update-available", info => {
      const version = info && info.version;
      if (isMac) downloadMacUpdate(info);
      else send({ state: "downloading", version });
    });
    autoUpdater.on("update-not-available", info => send({ state: "none", version: info && info.version }));
    autoUpdater.on("download-progress", progress => {
      if (!isMac) send({ state: "downloading", percent: Math.round((progress && progress.percent) || 0) });
    });
    autoUpdater.on("update-downloaded", info => {
      pendingUpdate = { version: info && info.version };
      send({ state: "ready", version: info && info.version });
    });
    autoUpdater.on("error", error => send({ state: "error", message: error && error.message }));
    loadAutoUpdate();
    if (autoUpdateOn) autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => {
      if (autoUpdateOn) autoUpdater.checkForUpdates().catch(() => {});
    }, 24 * 60 * 60 * 1000);
  };

  return { setup };
}

module.exports = { createAutoUpdate, selectMacUpdateFile };
