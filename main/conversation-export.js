"use strict";

const EXPORT_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.66; }
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

function buildExportDocument({ title, bodyHTML, katexHref }) {
  const safeTitle = String(title || "对话").replace(/[<>&]/g, "");
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline' file:; font-src file: data:; base-uri 'none'";
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><title>' + safeTitle +
    '</title><link rel="stylesheet" href="' + katexHref + '"><style>' + EXPORT_CSS +
    '</style></head><body><main class="ex-root">' + bodyHTML + '</main></body></html>';
}

function registerConversationExport(options) {
  const { ipcMain, dialog, fs, path, os, BrowserWindow, getMainWindow, appRoot } = options;
  ipcMain.handle("export-conversation", async (_event, payload) => {
    const value = payload || {};
    const base = value.name || "对话";
    try {
      if (value.format === "md") {
        const result = await dialog.showSaveDialog(getMainWindow(), { defaultPath: base + ".md", filters: [{ name: "Markdown", extensions: ["md"] }] });
        if (result.canceled || !result.filePath) return { canceled: true };
        fs.writeFileSync(result.filePath, value.markdown || "", "utf8");
        return { ok: true, path: result.filePath };
      }
      const html = buildExportDocument({
        title: value.title,
        bodyHTML: value.bodyHTML || "",
        katexHref: "file://" + path.join(appRoot, "vendor", "katex", "katex.min.css"),
      });
      const tempFile = path.join(os.tmpdir(), "quartz-export-" + process.pid + "-" + Math.round(process.hrtime()[1]) + ".html");
      fs.writeFileSync(tempFile, html, "utf8");
      const win = new BrowserWindow({ show: false, width: 760, height: 1000, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false } });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", event => event.preventDefault());
      try {
        await win.loadFile(tempFile);
        await new Promise(resolve => setTimeout(resolve, 300));
        if (value.format === "pdf") {
          const result = await dialog.showSaveDialog(getMainWindow(), { defaultPath: base + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
          if (result.canceled || !result.filePath) return { canceled: true };
          const data = await win.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { marginType: "custom", top: 0.5, bottom: 0.5, left: 0.4, right: 0.4 } });
          fs.writeFileSync(result.filePath, data);
          return { ok: true, path: result.filePath };
        }
        const dimensions = await win.webContents.executeJavaScript("({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})");
        const width = Math.max(360, Math.min(2000, dimensions.w || 860));
        const height = Math.max(200, Math.min(8000, dimensions.h || 1000));
        win.setContentSize(width, height);
        await new Promise(resolve => setTimeout(resolve, 250));
        const result = await dialog.showSaveDialog(getMainWindow(), { defaultPath: base + ".png", filters: [{ name: "PNG 图片", extensions: ["png"] }] });
        if (result.canceled || !result.filePath) return { canceled: true };
        const image = await win.webContents.capturePage();
        fs.writeFileSync(result.filePath, image.toPNG());
        return { ok: true, path: result.filePath };
      } finally {
        win.destroy();
        fs.unlink(tempFile, () => {});
      }
    } catch (error) {
      return { error: String((error && error.message) || error) };
    }
  });
}

module.exports = { buildExportDocument, registerConversationExport };
