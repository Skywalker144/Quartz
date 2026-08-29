"use strict";
/* Quick-ask bar (Option+Space). A standalone overlay renderer that shares the main app's
 * stored config — it reads the same IndexedDB record the app writes (chatbox / kv / "state"),
 * so your API key, default model, system prompt and theme all come along automatically.
 * The streaming below mirrors app.js's streamChat for the default provider (text-only). */

const api = window.chatbox || {};
const MARKDOWN = QuartzMarkdown.createMarkdown({ root: window, core: QuartzCore });
const renderMd = MARKDOWN.render;
MARKDOWN.setup();

/* ---------- DOM ---------- */
const wrap = document.getElementById("wrap");
const inputEl = document.getElementById("q");
const ansEl = document.getElementById("qans");
const ansScroll = document.getElementById("qans-scroll");
const ansContent = document.getElementById("qans-content");
const hintEl = document.getElementById("qhint");
const copyBtn = document.getElementById("qcopy");
const contBtn = document.getElementById("qcont");
const COPYKBD = (api.platform === "darwin") ? "⌘C" : "Ctrl+C";   // platform-correct copy hint (no Mac glyph on Windows)
copyBtn.innerHTML = '复制 <kbd>' + COPYKBD + '</kbd>';

/* ---------- shared config (pushed up from the main app via IPC) ----------
 * file:// pages don't share IndexedDB, so we can't read the app's store here.
 * The main app publishes its config to the main process, which hands it to us
 * on demand (getQuickConfig) and on every summon (onQuickFocus). */
let cfg = null;            // { providers, chat:{provider,model}, theme, system, temp }
let mode = "idle";         // idle | asking | answered
let controller = null;     // AbortController for the in-flight request
let lastQuestion = "";
let lastAnswer = "";
let lastUsage = null;
let histQuestion = "";     // 本会话最近一次提过的问题（resetAll 也不清；空输入框按 ↑ 唤回）

function applyConfig(c) {
  if (c && typeof c === "object") cfg = c;
  if (!cfg) cfg = { providers: {}, chat: { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" }, theme: "auto", system: "", temp: undefined };
  if (!cfg.chat) cfg.chat = { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" };
  applyTheme(cfg.theme || "auto");
}

function keyFor(provider) { const p = cfg && cfg.providers && cfg.providers[provider]; return (p && p.key) ? p.key.trim() : ""; }

function applyTheme(theme) {
  const dark = theme === "auto" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  const ac = cfg && cfg.accent;   // crystal colour follows the app's 强调色 (resolved for this theme)
  if (ac) document.documentElement.style.setProperty("--crystal", dark ? (ac.dark || ac.light) : (ac.light || ac.dark));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (cfg && cfg.theme === "auto") applyTheme("auto"); });

async function streamAsk(userText, signal, onDelta) {
  const ref = cfg.chat;
  const key = keyFor(ref.provider);
  if (!key) { const e = new Error("NO_KEY"); e.code = "NO_KEY"; throw e; }
  const providerConfig = cfg.providers && cfg.providers[ref.provider];
  return QuartzCore.streamCompletion({
    ref,
    key,
    baseUrl: providerConfig && providerConfig.baseUrl,
    system: cfg.system || "",
    messages: [{ role: "user", content: userText, attachments: [] }],
    temperature: cfg.temp != null && cfg.temp !== "" ? Number(cfg.temp) : undefined,
    topP: cfg.topP != null && cfg.topP !== "" ? Number(cfg.topP) : undefined,
    topK: cfg.topK != null && cfg.topK !== "" ? Number(cfg.topK) : undefined,
    reasoning: ref.provider === "deepseek" ? false : undefined,
    signal,
    onDelta,
  });
}

/* ---------- window height: grow/shrink the panel to fit content ---------- */
function reportHeight() {
  requestAnimationFrame(() => {
    const h = Math.ceil(wrap.getBoundingClientRect().height);
    api.quickResize && api.quickResize(h);
  });
}

/* ---------- UI helpers ---------- */
// Loading indicator: the Quartz crystal with a highlight rotating around its nine facets.
const QZ_CRYSTAL = '<svg class="qz-crystal" viewBox="0 0 24 24" aria-hidden="true">'
  + '<polygon class="qc-center" points="10.2,8.5 13.8,8.5 13.8,15.5 10.2,15.5"/>'
  + '<polygon class="qc p1" points="12,3 10.2,8.5 13.8,8.5"/>'
  + '<polygon class="qc p2" points="12,3 13.8,8.5 17,8.5"/>'
  + '<polygon class="qc p3" points="13.8,8.5 17,8.5 17,15.5 13.8,15.5"/>'
  + '<polygon class="qc p4" points="12,21 13.8,15.5 17,15.5"/>'
  + '<polygon class="qc p5" points="12,21 10.2,15.5 13.8,15.5"/>'
  + '<polygon class="qc p6" points="12,21 7,15.5 10.2,15.5"/>'
  + '<polygon class="qc p7" points="7,8.5 10.2,8.5 10.2,15.5 7,15.5"/>'
  + '<polygon class="qc p8" points="12,3 7,8.5 10.2,8.5"/></svg>';
const LOADER_HTML = '<span class="qz-load">' + QZ_CRYSTAL + '</span>';
let _loading = false;
function appendLoader() {
  if (!_loading) return;
  const last = ansContent.lastElementChild;
  const t = (last && /^(P|LI|H[1-6])$/.test(last.tagName)) ? last : ansContent;   // trail the last line inline
  t.insertAdjacentHTML("beforeend", LOADER_HTML);
}
function setLoading(on) {
  _loading = on;
  const ex = ansContent.querySelector(".qz-load"); if (ex) ex.remove();
  if (on) appendLoader();
}
// Show top/bottom edge fades only when the answer is actually scrolled out of view.
function updateFades() {
  const el = ansContent;
  const atTop = el.scrollTop <= 1;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  ansScroll.classList.toggle("fade-top", !atTop);
  ansScroll.classList.toggle("fade-bottom", !atBottom);
}
function showAnswer(show) {
  ansEl.hidden = !show;
  if (!show) {
    ansContent.innerHTML = ""; setLoading(false);
    ansScroll.classList.remove("fade-top", "fade-bottom");
    hintEl.textContent = ""; hintEl.classList.remove("error"); copyBtn.hidden = true; contBtn.hidden = true;
  }
  reportHeight();
}
function setHint(text, isError) {
  hintEl.classList.toggle("error", !!isError);
  hintEl.innerHTML = "";
  hintEl.appendChild(document.createTextNode(text || ""));
}
function autoGrow() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(96, inputEl.scrollHeight) + "px";
}

function resetAll() {
  if (controller) { try { controller.abort(); } catch (e) {} controller = null; }
  mode = "idle"; lastQuestion = ""; lastAnswer = ""; lastUsage = null;
  inputEl.value = ""; autoGrow();
  setLoading(false); showAnswer(false);
}

/* ---------- actions ---------- */
async function ask() {
  const text = inputEl.value.trim();
  if (!text || mode === "asking") return;
  if (controller) { try { controller.abort(); } catch (e) {} }
  controller = new AbortController();
  mode = "asking"; lastQuestion = text; histQuestion = text; lastAnswer = ""; lastUsage = null;
  showAnswer(true);
  ansContent.innerHTML = "";
  setLoading(true);            // blinking caret shows immediately, before the first token
  setHint("", false);
  copyBtn.hidden = true; contBtn.hidden = true;
  reportHeight();

  try {
    const r = await streamAsk(text, controller.signal, (acc) => {
      lastAnswer = acc;
      ansContent.innerHTML = renderMd(acc);
      appendLoader();                // keep the rotating crystal trailing the streamed text
      updateFades();                 // no auto-scroll — the answer stays put, user scrolls if they want
      reportHeight();
    });
    lastAnswer = r.text || lastAnswer || "（没有返回内容）";
    lastUsage = r.usage || null;
    ansContent.innerHTML = renderMd(lastAnswer);
    mode = "answered";
    copyBtn.hidden = false; contBtn.hidden = false;
    setHint("Enter 进入 Quartz · " + COPYKBD + " 复制 · Esc 关闭", false);
  } catch (err) {
    if (err && err.name === "AbortError") {
      // user dismissed mid-stream — leave whatever we have
      mode = lastAnswer ? "answered" : "idle";
      if (lastAnswer) { copyBtn.hidden = false; contBtn.hidden = false; }
    } else if (err && err.code === "NO_KEY") {
      mode = "idle";
      setHint("未配置 API Key，请在 Quartz 设置中添加", true);
      const a = document.createElement("a"); a.textContent = "打开 Quartz"; a.onclick = () => openMain();
      hintEl.appendChild(document.createTextNode("  "));
      hintEl.appendChild(a);
      contBtn.hidden = false; contBtn.textContent = "打开 Quartz";
    } else {
      mode = "answered";
      ansContent.innerHTML = renderMd("⚠️ **出错了：** " + (err && err.message ? err.message : String(err)));
    }
  } finally {
    setLoading(false);
    updateFades();
    reportHeight();
  }
}

function openMain() {
  api.quickHandoff && api.quickHandoff({
    question: lastQuestion || inputEl.value.trim(),
    answer: lastAnswer || null,
    usage: lastUsage || null,
    model: cfg ? cfg.chat : null,
  });
  // the window hides via main; reset for next time
  setTimeout(resetAll, 150);
}

/* ---------- copy helpers ---------- */
let _copyLabel = copyBtn.innerHTML;
function flashCopied() {
  if (!lastAnswer) return;
  navigator.clipboard.writeText(lastAnswer).then(() => {
    copyBtn.textContent = "已复制";
    clearTimeout(copyBtn._t);
    copyBtn._t = setTimeout(() => { copyBtn.innerHTML = _copyLabel; }, 1200);
  }).catch(() => {});
}

/* ---------- events ---------- */
inputEl.addEventListener("input", () => { autoGrow(); reportHeight(); });

inputEl.addEventListener("keydown", (e) => {
  // An IME (e.g. Chinese input method, even when typing English) uses Enter to COMMIT the
  // composition — that Enter must be left to the IME, not fire an answer. isComposing is the
  // standard signal; keyCode 229 is the legacy fallback some IMEs still send.
  if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) return;
  // 空输入框按 ↑ → 唤回本次会话最近一次提的问题（改一改再问）
  if (e.key === "ArrowUp" && !e.isComposing && !inputEl.value.trim() && histQuestion) {
    e.preventDefault();
    inputEl.value = histQuestion; autoGrow(); reportHeight();
    requestAnimationFrame(() => inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length));
    return;
  }
  // ⌘/Ctrl + Enter → 直接进入 Quartz（带上当前问题/答案）
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); openMain(); return; }
  // 输入框聚焦时回车 → 回答（可能已修改过的）新问题，然后让输入框失焦。
  // 失焦后再按回车不会进到这里，改由下方 document 级处理 → 进入 Quartz（stopPropagation 避免本次回车被两处同时接住）。
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); e.stopPropagation();
    if (mode !== "asking" && inputEl.value.trim()) { ask(); inputEl.blur(); }
    return;
  }
});

// These work no matter what's focused inside the bar (input, answer text, or body) — the bug
// was Esc only firing while the textarea had focus.
document.addEventListener("keydown", (e) => {
  // 输入框已失焦时按回车（且已有答案）→ 进入 Quartz，呼应提示「Enter 进入 Quartz」。
  // 聚焦输入框时的回车由 inputEl 处理并 stopPropagation，不会走到这里（那是「回答新问题」）。
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    if (document.activeElement !== inputEl && mode === "answered") { e.preventDefault(); openMain(); }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (mode === "asking") { if (controller) { try { controller.abort(); } catch (err) {} } setLoading(false); }
    else api.quickHide && api.quickHide();
    return;
  }
  // ⌘C / Ctrl+C after an answer copies the whole answer — unless the user has a selection of
  // their own (then let the native copy take that).
  if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C")) {
    if (mode !== "answered" || !lastAnswer) return;
    const sel = (window.getSelection && window.getSelection().toString()) || "";
    const inputSel = inputEl.selectionStart !== inputEl.selectionEnd;
    if (sel.trim() || inputSel) return;
    e.preventDefault();
    flashCopied();
  }
});

ansContent.addEventListener("scroll", updateFades);
copyBtn.addEventListener("click", () => flashCopied());
contBtn.addEventListener("click", () => openMain());

// Each time the bar is summoned: refresh config (key/model/theme may have changed),
// start clean, focus and select any leftover text.
api.onQuickFocus && api.onQuickFocus((c) => {
  applyConfig(c);
  showAnswer(false);
  mode = "idle"; lastAnswer = ""; lastUsage = null;
  setLoading(false);
  inputEl.focus();
  inputEl.select();
  reportHeight();
});

/* ---------- init ---------- */
(async () => {
  let c = null;
  try { c = api.getQuickConfig ? await api.getQuickConfig() : null; } catch (e) {}
  applyConfig(c);
})();
autoGrow();
reportHeight();
