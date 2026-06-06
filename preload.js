const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge between the main process and the renderers.
contextBridge.exposeInMainWorld("chatbox", {
  platform: process.platform,
  setTitleBarOverlay: (opts) => ipcRenderer.send("set-titlebar-overlay", opts),
  // --- main app window ---
  onMenu: (cb) => ipcRenderer.on("menu", (_e, action) => cb(action)),
  onQuickOpen: (cb) => ipcRenderer.on("quick-open", (_e, payload) => cb(payload)),
  onQuickShortcutResult: (cb) => ipcRenderer.on("quick-shortcut-result", (_e, r) => cb(r)),
  pushQuickConfig: (cfg) => ipcRenderer.send("quick-config", cfg),
  exportConversation: (payload) => ipcRenderer.invoke("export-conversation", payload),
  exportData: (json) => ipcRenderer.invoke("data-export", json),
  importData: () => ipcRenderer.invoke("data-import"),
  getSeedConfig: () => ipcRenderer.invoke("seed-config"),
  getAppInfo: () => ipcRenderer.invoke("app-info"),
  onUpdateStatus: (cb) => ipcRenderer.on("update-status", (_e, s) => cb(s)),
  getUpdateStatus: () => ipcRenderer.invoke("update-status-get"),
  updateAction: (action) => ipcRenderer.send("update-action", action),
  updateCheck: () => ipcRenderer.invoke("update-check"),

  // --- quick-ask bar window ---
  onQuickFocus: (cb) => ipcRenderer.on("quick-focus", (_e, cfg) => cb(cfg)),
  getQuickConfig: () => ipcRenderer.invoke("quick-config-get"),
  quickResize: (height) => ipcRenderer.send("quick-resize", height),
  quickHide: () => ipcRenderer.send("quick-hide"),
  quickHandoff: (payload) => ipcRenderer.send("quick-handoff", payload),
});
