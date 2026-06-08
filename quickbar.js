"use strict";
/* Quick-ask bar (Option+Space). A standalone overlay renderer that shares the main app's
 * stored config — it reads the same IndexedDB record the app writes (chatbox / kv / "state"),
 * so your API key, default model, system prompt and theme all come along automatically.
 * The streaming below mirrors app.js's streamChat for the default provider (text-only). */

const api = window.chatbox || {};

const PROVIDERS = {
  openrouter: { kind: "openai", base: "https://openrouter.ai/api/v1" },
  openai:     { kind: "openai", base: "https://api.openai.com/v1" },
  anthropic:  { kind: "anthropic", base: "https://api.anthropic.com/v1" },
  deepseek:   { kind: "openai", base: "https://api.deepseek.com/v1" },
  google:     { kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
};

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

/* ---------- markdown + math (KaTeX), mirroring the main app ---------- */
(function setupMd() {
  if (!window.marked) return;
  const renderMath = (tex, display) => {
    if (!window.katex) return (display ? "$$" + tex + "$$" : "$" + tex + "$");
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
    catch (e) { return (display ? "$$" + tex + "$$" : "$" + tex + "$"); }
  };
  const blockMath = {
    name: "blockMath", level: "block",
    start(src) { const a = [src.indexOf("$$"), src.indexOf("\\[")].filter(x => x >= 0); return a.length ? Math.min.apply(null, a) : undefined; },
    tokenizer(src) {
      let m = /^\$\$([\s\S]+?)\$\$/.exec(src); if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
      m = /^\\\[([\s\S]+?)\\\]/.exec(src); if (m) return { type: "blockMath", raw: m[0], text: m[1].trim() };
    },
    renderer(t) { return '<div class="math-block">' + renderMath(t.text, true) + "</div>"; },
  };
  const inlineMath = {
    name: "inlineMath", level: "inline",
    start(src) { const a = [src.indexOf("$"), src.indexOf("\\(")].filter(x => x >= 0); return a.length ? Math.min.apply(null, a) : undefined; },
    tokenizer(src) {
      let m = /^\$\$([^\n]+?)\$\$/.exec(src); if (m) return { type: "inlineMath", raw: m[0], text: m[1].trim(), display: true };
      m = /^\\\(([\s\S]+?)\\\)/.exec(src); if (m) return { type: "inlineMath", raw: m[0], text: m[1], display: false };
      m = /^\$([^\n$]+?)\$/.exec(src);
      if (m) {
        const b = m[1];
        if (/^\s|\s$/.test(b)) return;
        if (/^\d+(\.\d+)?$/.test(b)) return;
        if (/\d/.test(src.charAt(m[0].length))) return;
        return { type: "inlineMath", raw: m[0], text: b, display: false };
      }
    },
    renderer(t) { return renderMath(t.text, !!t.display); },
  };
  try { marked.use({ extensions: [blockMath, inlineMath] }); } catch (e) {}
})();
// CommonMark emphasis won't fire when a ** / * delimiter sits flush against CJK punctuation with a CJK
// letter on the other side (Chinese uses no spaces), so "**加粗（注）**的" renders literally. Slip a
// zero-width space between the delimiter and the punctuation to restore "flanking"; it is stripped back
// out of the final HTML so copied text stays clean. Code spans/blocks are left untouched.
const CJK_LETTER = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\u3005\\u3007";
const CJK_PUNCT = "()\\[\\]{}<>\"'`!?.,:;~|@#%^&=+/\\\\\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2026\\u3000-\\u303F\\uFF00-\\uFFEF";
const EM_OPEN_RE = new RegExp("([" + CJK_LETTER + "])([*_]+)([" + CJK_PUNCT + "])", "g");
const EM_CLOSE_RE = new RegExp("([" + CJK_PUNCT + "])([*_]+)([" + CJK_LETTER + "])", "g");
// LLMs sometimes emit "** 文字**" — a space hugging the inside of the ** stops CommonMark from forming
// strong emphasis. Trim those inner spaces for a PAIRED ** run on one line (leaves "2 ** 3" / code alone).
const LOOSE_STRONG_LEAD = /\*\*[ \t]+([^\s*](?:[^\n*]*?[^\s*])?)[ \t]*\*\*/g;
const LOOSE_STRONG_TRAIL = /\*\*([^\s*](?:[^\n*]*?[^\s*])?)[ \t]+\*\*/g;
function fixCjkEmphasis(src) {
  if (!src || (src.indexOf("*") < 0 && src.indexOf("_") < 0)) return src;
  return src.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
    .map((seg, i) => {
      if (i % 2) return seg;                       // inside a code span/block — leave verbatim
      seg = seg.replace(LOOSE_STRONG_LEAD, "**$1**").replace(LOOSE_STRONG_TRAIL, "**$1**");
      return seg.replace(EM_OPEN_RE, "$1$2​$3").replace(EM_CLOSE_RE, "$1​$2$3");
    })
    .join("");
}
function renderMd(t) {
  let html;
  if (window.marked) { try { html = marked.parse(fixCjkEmphasis(t), { breaks: true, gfm: true }); } catch (e) {} }
  if (html == null) { const d = document.createElement("div"); d.textContent = t; html = "<p>" + d.innerHTML.replace(/\n/g, "<br>") + "</p>"; }
  html = html.replace(/​/g, "");   // drop the helper zero-width spaces
  if (window.DOMPurify) return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form"] });
  return html;
}

/* ---------- streaming (mirrors app.js streamChat, text-only) ---------- */
async function errText(resp) {
  let em = "请求失败：HTTP " + resp.status;
  try { const j = await resp.json(); em = (j.error && j.error.message) || j.message || em; } catch (e) {}
  return em;
}
async function pumpSSE(resp, onData) {
  const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      let json; try { json = JSON.parse(data); } catch (e) { continue; }
      onData(json);
    }
  }
}
async function streamAsk(userText, signal, onDelta) {
  const ref = cfg.chat;
  const prov = PROVIDERS[ref.provider];
  const key = keyFor(ref.provider);
  if (!prov) throw new Error("未知的提供方：" + ref.provider);
  if (!key) { const e = new Error("NO_KEY"); e.code = "NO_KEY"; throw e; }
  const sys = cfg.system || "";
  const temp = (cfg.temp != null && cfg.temp !== "") ? Number(cfg.temp) : undefined;
  const topP = (cfg.topP != null && cfg.topP !== "") ? Number(cfg.topP) : undefined;
  const topK = (cfg.topK != null && cfg.topK !== "") ? Number(cfg.topK) : undefined;
  let acc = "", usage = null;

  if (prov.kind === "openai") {
    const msgs = [];
    if (sys) msgs.push({ role: "system", content: sys });
    msgs.push({ role: "user", content: userText });
    const body = { model: ref.model, messages: msgs, stream: true };
    if (temp != null) body.temperature = temp;
    if (topP != null) body.top_p = topP;
    if (topK != null && ref.provider === "openrouter") body.top_k = topK;
    const headers = { "Authorization": "Bearer " + key, "Content-Type": "application/json" };
    if (ref.provider === "openrouter") { headers["HTTP-Referer"] = "https://quartz.local"; headers["X-Title"] = "Quartz"; body.usage = { include: true }; }
    else if (ref.provider === "openai" || ref.provider === "deepseek") body.stream_options = { include_usage: true };
    const resp = await fetch(prov.base + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!resp.ok) throw new Error(await errText(resp));
    await pumpSSE(resp, (j) => {
      const d = j.choices && j.choices[0] && j.choices[0].delta;
      if (d && d.content) { acc += d.content; onDelta(acc); }
      if (j.usage) usage = { prompt_tokens: j.usage.prompt_tokens, completion_tokens: j.usage.completion_tokens, cost: j.usage.cost };
    });
  } else if (prov.kind === "anthropic") {
    const body = { model: ref.model, max_tokens: 4096, stream: true, messages: [{ role: "user", content: userText }] };
    if (sys) body.system = sys;
    if (temp != null) body.temperature = temp;
    if (topP != null) body.top_p = topP;
    if (topK != null) body.top_k = topK;
    const headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    const resp = await fetch(prov.base + "/messages", { method: "POST", headers, body: JSON.stringify(body), signal });
    if (!resp.ok) throw new Error(await errText(resp));
    let inTok = 0, outTok = 0;
    await pumpSSE(resp, (j) => {
      if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") { acc += j.delta.text; onDelta(acc); }
      else if (j.type === "message_start" && j.message && j.message.usage) inTok = j.message.usage.input_tokens || 0;
      else if (j.type === "message_delta" && j.usage && j.usage.output_tokens != null) outTok = j.usage.output_tokens;
    });
    usage = { prompt_tokens: inTok, completion_tokens: outTok };
  } else throw new Error("不支持的提供方类型");

  return { text: acc, usage };
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
  mode = "asking"; lastQuestion = text; lastAnswer = ""; lastUsage = null;
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
  // ⌘/Ctrl + Enter, or plain Enter once answered → continue in Quartz
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openMain(); return; }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (mode === "answered") openMain();
    else if (mode !== "asking") ask();
    return;
  }
});

// These work no matter what's focused inside the bar (input, answer text, or body) — the bug
// was Esc only firing while the textarea had focus.
document.addEventListener("keydown", (e) => {
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
