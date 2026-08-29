"use strict";

const BACKUP_FILE = /^quartz-auto-[\w.-]+\.json$/;

function isBackupFileName(name) {
  return BACKUP_FILE.test(name || "");
}

function registerDataTransfer(options) {
  const { ipcMain, app, dialog, shell, fs, path, getMainWindow } = options;
  const now = options.now || (() => new Date());
  const backupsDir = () => path.join(app.getPath("userData"), "backups");

  ipcMain.handle("data-export", async (_event, json) => {
    try {
      const stamp = now().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(getMainWindow(), {
        title: "导出 Quartz 数据",
        defaultPath: `Quartz-备份-${stamp}.json`,
        filters: [{ name: "Quartz 备份", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, json, "utf8");
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("data-import", async () => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: "导入 Quartz 数据",
        properties: ["openFile"],
        filters: [{ name: "Quartz 备份", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { canceled: true };
      return { ok: true, json: fs.readFileSync(result.filePaths[0], "utf8") };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("backup-write", (_event, json) => {
    try {
      const dir = backupsDir();
      fs.mkdirSync(dir, { recursive: true });
      const stamp = now().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(dir, `quartz-auto-${stamp}.json`), json, "utf8");
      const files = fs.readdirSync(dir).filter(isBackupFileName).sort();
      while (files.length > 8) fs.unlinkSync(path.join(dir, files.shift()));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("open-backups", () => {
    try {
      const dir = backupsDir();
      fs.mkdirSync(dir, { recursive: true });
      shell.openPath(dir);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("backup-list", () => {
    try {
      const dir = backupsDir();
      fs.mkdirSync(dir, { recursive: true });
      return fs.readdirSync(dir).filter(isBackupFileName).map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, mtime: stat.mtimeMs, size: stat.size };
      }).sort((a, b) => b.mtime - a.mtime);
    } catch (error) {
      return [];
    }
  });

  ipcMain.handle("backup-read", (_event, name) => {
    try {
      if (!isBackupFileName(name)) return { ok: false, error: "无效的备份文件名" };
      return { ok: true, json: fs.readFileSync(path.join(backupsDir(), name), "utf8") };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = { isBackupFileName, registerDataTransfer };
