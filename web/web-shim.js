/* Quartz web shim — provides a window.chatbox fallback when Quartz runs as a
 * plain web page (e.g. on Cloudflare Pages) instead of inside Electron.
 *
 * Self-guarding: if the real Electron preload bridge is already present, this
 * does nothing, so the SAME index.html / app.js serve both desktop and web.
 *
 * Model A (BYOK): there is deliberately NO seeded API key here. Each device
 * stores its own key in this browser's IndexedDB and calls the providers
 * directly (the CSP in index.html already whitelists them).
 *
 * "__QUARTZ_VERSION__" is replaced with the package.json version by build-web.sh.
 */
(function () {
  if (window.chatbox) return;            // Electron: the real preload bridge wins
  window.__WEB__ = true;

  var ua = navigator.userAgent || "";
  var noop = function () {};
  var resolved = function (v) { return Promise.resolve(v); };

  // --- download a generated file via a transient <a download> ---
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // --- read a user-picked text file; resolves null if cancelled ---
  function pickTextFile(accept) {
    return new Promise(function (resolve) {
      var inp = document.createElement("input");
      inp.type = "file"; if (accept) inp.accept = accept;
      inp.style.display = "none";
      document.body.appendChild(inp);
      var settled = false;
      function finish(v) { if (settled) return; settled = true; inp.remove(); resolve(v); }
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        if (!f) { finish(null); return; }
        var r = new FileReader();
        r.onload = function () { finish(String(r.result || "")); };
        r.onerror = function () { finish(null); };
        r.readAsText(f);
      });
      // No reliable "cancel" event: if focus returns and change never fired, treat as cancelled.
      window.addEventListener("focus", function onF() {
        window.removeEventListener("focus", onF);
        setTimeout(function () { if (!settled) finish(null); }, 600);
      }, { once: true });
      inp.click();
    });
  }

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); };
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }
  function safeName(s) { return String(s || "conversation").replace(/[\/\\:*?"<>|]+/g, "_").slice(0, 80) || "conversation"; }

  function printStyles() {
    return "<style>body{font-family:-apple-system,system-ui,'PingFang SC',sans-serif;line-height:1.65;" +
      "max-width:780px;margin:24px auto;padding:0 16px;color:#111}" +
      "pre{white-space:pre-wrap;background:#f5f5f5;padding:10px 12px;border-radius:8px;overflow:auto}" +
      "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
      "img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}</style>";
  }

  window.chatbox = {
    // Force the neutral, no-native-chrome layout (no traffic-light / overlay spacing).
    platform: "web",

    // ---- native window / OS integration: not available on the web ----
    setTitleBarOverlay: noop,
    setProxy: function () { return resolved({ ok: false, error: "web" }); },
    testProxy: function () { return resolved({ ok: false, error: "web" }); },
    onMenu: noop, onQuickOpen: noop, onQuickShortcutResult: noop, pushQuickConfig: noop,
    onQuickFocus: noop, getQuickConfig: function () { return resolved(null); },
    quickResize: noop, quickHide: noop, quickHandoff: noop,
    getLoginItem: function () { return resolved(false); },
    setLoginItem: function () { return resolved(false); },

    // ---- updates: handled by the browser / service worker; report "none" ----
    onUpdateStatus: noop,
    getUpdateStatus: function () { return resolved({ state: "none" }); },
    updateAction: noop,
    updateCheck: function () { return resolved({ state: "none" }); },
    getAutoUpdate: function () { return resolved(false); },
    setAutoUpdate: noop,

    // ---- secrets: no OS keychain; keys live as plaintext in this browser's IndexedDB.
    // Exported Electron backups already store keys as plaintext, so imports work too. ----
    decryptSecret: function () { return resolved(null); },

    // ---- seed config: intentionally none (Model A = bring-your-own-key) ----
    getSeedConfig: function () { return resolved(null); },

    // ---- app info / changelog ----
    getAppInfo: function () {
      return resolved({
        name: "Quartz",
        version: "__QUARTZ_VERSION__",
        electron: "web",
        chrome: (ua.match(/Chrome\/([\d.]+)/) || [])[1] || ""
      });
    },
    getChangelog: function () {
      return fetch("CHANGELOG.md").then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; });
    },

    // ---- whole-app data export / import → browser download / file picker ----
    exportData: function (json) {
      download("quartz-backup-" + stamp() + ".json", json, "application/json");
      return resolved({ ok: true, path: "浏览器下载" });
    },
    importData: function () {
      return pickTextFile("application/json,.json").then(function (json) {
        return json == null ? { canceled: true } : { ok: true, json: json };
      });
    },

    // ---- single-conversation export ----
    exportConversation: function (payload) {
      payload = payload || {};
      var base = safeName(payload.name || payload.title);
      if (payload.format === "md") {
        download(base + ".md", payload.markdown || "", "text/markdown");
        return resolved({ ok: true, path: "浏览器下载" });
      }
      if (payload.format === "pdf") {
        var w = window.open("", "_blank");
        if (!w) return resolved({ ok: false, error: "弹窗被拦截，请允许后重试" });
        w.document.write("<!doctype html><meta charset=utf-8><title>" + (payload.title || base) + "</title>" +
          printStyles() + "<body>" + (payload.bodyHTML || "") + "</body>");
        w.document.close(); w.focus();
        setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
        return resolved({ ok: true, path: "打印 / 存为 PDF" });
      }
      // Image export needs a canvas rasteriser we don't bundle yet (see plan P3).
      return resolved({ ok: false, error: "网页版暂不支持图片导出，请用 Markdown 或 PDF" });
    },

    // ---- local-folder backups: not available on the web; use manual export ----
    writeBackup: function () { return resolved({ ok: false }); },
    openBackups: noop,
    listBackups: function () { return resolved([]); },
    readBackup: function () { return resolved(null); }
  };
})();
