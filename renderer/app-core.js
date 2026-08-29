"use strict";

function isMacPlatform() {
  const dp = document.documentElement.dataset.platform;
  if (dp) return dp === "mac";
  if (window.chatbox && window.chatbox.platform) return window.chatbox.platform === "darwin";
  return /Mac/i.test(navigator.platform || navigator.userAgent || "");
}
function defaultQuick() { return "Alt+Space"; }
function defaultOpenMain() { return isMacPlatform() ? "Cmd+Shift+L" : "Alt+Shift+L"; }

/* ===================== Config ===================== */
const PROVIDERS = QuartzCore.providers;
const PROVIDER_ORDER = QuartzCore.providerOrder;
const STATE_MODEL = QuartzState.createStateModel({
  providerOrder: PROVIDER_ORDER,
  defaultQuick,
  defaultOpenMain,
  visionSupport,
  uid,
});
const QUICK_PROMPT = STATE_MODEL.quickPrompt;
const freshState = STATE_MODEL.freshState;
const ensureShape = STATE_MODEL.normalizeState;
const migrate = STATE_MODEL.migrateLegacyState;
const STATE_STORE = QuartzStorage.createStateStore({
  indexedDB,
  localStorage,
  normalizeState: ensureShape,
  migrateLegacyState: migrate,
  freshState,
  decryptSecret: value => window.chatbox && window.chatbox.decryptSecret ? window.chatbox.decryptSecret(value) : null,
  onWarning: (message, error) => console.warn(message, error),
});
const SUGGESTED = {
  openrouter: ["google/gemini-3-flash-preview", "google/gemini-3.1-pro-preview", "openai/gpt-5.5", "anthropic/claude-opus-4.8", "anthropic/claude-sonnet-4.6", "qwen/qwen3.7-plus", "qwen/qwen3.7-max"],
  openai:     ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  anthropic:  ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],   // native ids use dashes
  deepseek:   ["deepseek-v4-pro", "deepseek-v4-flash"],
  google:     ["gemini-3-flash-preview", "gemini-3.1-pro-preview"],
};

const FONT_STACKS = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "PingFang SC", "Hiragino Sans GB", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
  mono: '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

const TEXT_EXT = ["txt","md","markdown","csv","tsv","json","xml","yaml","yml","html","htm","css","js","mjs","ts","jsx","tsx","py","java","c","cc","cpp","h","hpp","cs","go","rs","rb","php","swift","kt","kts","sh","bash","zsh","sql","log","ini","toml","conf","cfg","env","vue","svelte","r","scala","pl","lua","dart","gradle","properties","gitignore","dockerfile","makefile"];

/* ===================== State ===================== */
let state = null;   // assigned by boot() after the async load below
let nextModel = null;     // model for the next new conversation (empty state); set in boot()
let nextPromptId = null;  // system prompt for the next new conversation; set in boot()
let nextWeb = false;        // web search toggle for the next new conversation
let nextReasoning = false;  // reasoning/thinking toggle for the next new conversation
let nextReasoningEffort = "medium"; // low | medium | high, for the next new conversation
// 多对话并发生成：每个对话一条独立的流（内存态，不持久化）。键=对话 id，值={controller, targetIndex, reason?}。
// 发送/停止键、流式视觉态只跟「当前对话」走（syncStreamingUI）；后台对话的流照常写回各自消息对象（onDelta/onReasoning 里按 currentId 守卫）。
const streams = new Map();
function isStreaming(convId) { return streams.has(convId); }
function currentStream() { return streams.get(state.currentId) || null; }
function currentStreaming() { return streams.has(state.currentId); }
function syncStreamingUI() {
  const s = currentStream();
  const box = document.getElementById("messages");
  if (box) box.classList.toggle("streaming", !!s);
  if (s) setSending(true, s.reason); else setSending(false);
  // 滚动锚（pinTop）不在这里动——它需要重建后的 DOM 才能算，统一在 renderMessages 末尾按当前流恢复（见那里的注释）。
}
let undoSend = null;         // armed after Esc-stops a fresh send: a SECOND Esc undoes the whole turn (prompt → input box)
let pending = [];        // composer attachments awaiting send
const _drafts = new Map();    // conv id -> { text, pending } unsent composer draft, kept in memory only (never persisted)
let composerConvId = null;    // which conversation's draft currently sits in the composer (for stash/restore on switch)
let inputUserH = null;        // user-dragged input-box height (px floor); null = auto-grow to 5 lines then scroll
let editingIndex = null; // index of message being edited inline
let autoScroll = true;   // follow streaming output only while the user is at the bottom
let pinTop = null;       // while answering: target scrollTop that keeps the user's message at the top
let lastSetTop = -1;     // the scrollTop WE last set programmatically — used to tell our scrolls from the user's
let nodePinned = null;   // while a node-click jump animates, keep that target lit; then resume viewport highlights
let selPointerDown = false; // mouse held down in the transcript (selecting): pause streaming re-renders so the drag's anchor node isn't replaced
const mql = window.matchMedia("(prefers-color-scheme: dark)");
// Smoothly glide scrollTop toward a moving target with a rAF easing loop (buttery during streaming,
// no per-line jumps). The goal is updated continuously; the loop keeps chasing it.
let scrollAnim = null, scrollGoal = null, jumpAnim = null;
function smoothFollow(box, goal) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { box.scrollTop = goal; lastSetTop = box.scrollTop; return; }
  scrollGoal = goal;
  if (scrollAnim) return;
  const tick = () => {
    if (scrollGoal == null) { scrollAnim = null; return; }
    const cur = box.scrollTop, d = scrollGoal - cur;
    if (Math.abs(d) < 0.5) { box.scrollTop = scrollGoal; lastSetTop = box.scrollTop; scrollAnim = null; scrollGoal = null; return; }
    box.scrollTop = cur + d * 0.08;        // easing factor — lower = gentler / slower glide
    lastSetTop = box.scrollTop;
    scrollAnim = requestAnimationFrame(tick);
  };
  scrollAnim = requestAnimationFrame(tick);
}
function cancelSmooth() {
  scrollGoal = null;
  if (scrollAnim) { cancelAnimationFrame(scrollAnim); scrollAnim = null; }
  if (jumpAnim) { cancelAnimationFrame(jumpAnim); jumpAnim = null; }
}
// Jump to a target scrollTop in a FIXED duration regardless of distance (used for node-map jumps).
function animateScrollTo(box, target, duration) {
  if (jumpAnim) { cancelAnimationFrame(jumpAnim); jumpAnim = null; }
  const max = box.scrollHeight - box.clientHeight;
  const start = box.scrollTop;
  const end = Math.max(0, Math.min(target, max));
  const dist = end - start;
  if (Math.abs(dist) < 1 || duration <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { box.scrollTop = end; lastSetTop = box.scrollTop; return; }
  const t0 = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);   // ease-out cubic
  const step = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    box.scrollTop = start + dist * ease(p); lastSetTop = box.scrollTop;
    if (p < 1) jumpAnim = requestAnimationFrame(step); else { box.scrollTop = end; lastSetTop = box.scrollTop; jumpAnim = null; }
  };
  jumpAnim = requestAnimationFrame(step);
}
// during streaming: keep the user's question pinned near the top; otherwise follow the bottom if at bottom
function applyAutoScroll(box) {
  if (pinTop != null) smoothFollow(box, Math.min(pinTop, box.scrollHeight - box.clientHeight));
  else if (autoScroll) smoothFollow(box, box.scrollHeight - box.clientHeight);
  else cancelSmooth();
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// 美元→人民币汇率（固定值，费用换算的单一来源）。货币单位与汇率的设置项已移除：费用一律按人民币显示。
// ⚠️ 调汇率只改这一处——usdToCny() 与 DeepSeek 参考汇率 DEEPSEEK_CNY_PER_USD 都引用它。
const DEFAULT_USD_CNY = 6.78;

async function loadState() { return STATE_STORE.load(); }
async function persist(value) {
  const saved = await STATE_STORE.persist(value);
  if (!saved) toast("⚠️ 保存失败：存储空间不足或不可用。可删除部分旧对话/附件后重试。");
  return saved;
}

// save() stays synchronous-looking (callers don't await): it schedules a debounced async
// write to IndexedDB. Discrete user actions trigger it, so a short debounce just coalesces bursts.
let _saveTimer = null, _saveInFlight = false, _saveDirty = false;
function save() {
  _saveDirty = true;
  if (_saveTimer || _saveInFlight) return;
  _saveTimer = setTimeout(flushSave, 150);
}
async function flushSave() {
  _saveTimer = null;
  if (!_saveDirty || !state) return;
  _saveDirty = false; _saveInFlight = true;
  try { await persist(state); }
  finally {
    _saveInFlight = false;
    if (_saveDirty && !_saveTimer) _saveTimer = setTimeout(flushSave, 150); // coalesce writes that arrived mid-flight
  }
  pushQuickConfig();   // keep the Option+Space quick bar's config (keys/model/theme) in sync
}

// Publish the small config subset the Option+Space quick bar needs up to the main process.
// (file:// pages don't share IndexedDB, so the bar can't read our store directly.)
function quickConfigPayload() {
  if (!state) return null;
  const set = state.settings;
  const q = set.quick || {};
  const providers = {};
  for (const pk of PROVIDER_ORDER) providers[pk] = {
    key: (set.providers[pk] && set.providers[pk].key) || "",
    baseUrl: (set.providers[pk] && set.providers[pk].baseUrl) || "",
  };
  // model: quick override, else the default chat model — carry the auto-generated display name
  const chat = (q.model && q.model.provider && q.model.model) ? clone(q.model) : clone(set.defaults.chat);
  if (chat && chat.model) chat.name = prettyModel(chat.model, chat.provider);
  // system prompt: dedicated concise prompt (default), the app's default prompt, or none
  let system = "";
  if (q.promptMode === "default") { const pid = set.defaults.promptId; if (pid) { const p = promptById(pid); if (p) system = p.text || ""; } }
  else if (q.promptMode !== "none") system = (q.concisePrompt != null ? q.concisePrompt : QUICK_PROMPT);   // "concise" — user-editable
  return {
    providers, chat, theme: set.appearance.theme, accent: accentPair(), system, temp: set.defaults.temp,
    topP: set.defaults.topP, topK: set.defaults.topK,
    enabled: q.enabled !== false,
    shortcut: q.shortcut || defaultQuick(),
    closeOnBlur: q.closeOnBlur !== false,
    width: q.width || 720,
    topPct: (q.topPct != null ? q.topPct : 18),
    openMainEnabled: q.openMainEnabled !== false,
    openMainShortcut: q.openMainShortcut || defaultOpenMain(),
  };
}
function pushQuickConfig() {
  try {
    if (window.chatbox && window.chatbox.pushQuickConfig) { const c = quickConfigPayload(); if (c) window.chatbox.pushQuickConfig(c); }
  } catch (e) {}
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function currentConv() { return state.conversations.find(c => c.id === state.currentId) || null; }
function keyOf(ref) { if (!ref || !ref.provider) return ""; const p = state.settings.providers[ref.provider]; return (p && p.key ? p.key.trim() : ""); }
function customBaseOf(provider) {
  const p = state.settings.providers[provider];
  return (p && p.baseUrl ? String(p.baseUrl).trim().replace(/\/+$/, "") : "");
}
function apiUrl(provider, path) { return QuartzCore.apiUrl(provider, path, customBaseOf(provider)); }
function activeRef() { const c = currentConv(); return (c && c.model) || nextModel; }
function anyKey() { return PROVIDER_ORDER.some(pk => keyOf({ provider: pk })); }

/* enabled-model list helpers */
function refKey(r) { return r.provider + "::" + r.model; }
function parseRefKey(s) { const i = s.indexOf("::"); return { provider: s.slice(0, i), model: s.slice(i + 2) }; }
function modelsEqual(a, b) { return !!a && !!b && a.provider === b.provider && a.model === b.model; }
function hasModel(r) { return state.settings.models.some(m => modelsEqual(m, r)); }
function addModel(r) {
  if (hasModel(r)) return;
  state.settings.models.push({ provider: r.provider, model: r.model });
  // First model on an empty install becomes the default chat + naming model (so the app works right away).
  const d = state.settings.defaults;
  if (!d.chat) { d.chat = { provider: r.provider, model: r.model }; nextModel = clone(d.chat); }
  if (!d.title) d.title = { provider: r.provider, model: r.model };
  if (!d.vision && visionSupport(r) === "yes") d.vision = { provider: r.provider, model: r.model };   // 首个能读图的模型顺带设为读图回退
  save();
}
function removeModel(r) { state.settings.models = state.settings.models.filter(m => !modelsEqual(m, r)); save(); }
const MODEL_BRANDS = { gpt: "GPT", claude: "Claude", gemini: "Gemini", deepseek: "DeepSeek", llama: "Llama", mistral: "Mistral", mixtral: "Mixtral", qwen: "Qwen", grok: "Grok", phi: "Phi", gemma: "Gemma", command: "Command", sonar: "Sonar", kimi: "Kimi", glm: "GLM", nova: "Nova", yi: "Yi" };
function prettyToken(t) {
  if (!t) return "";
  const low = t.toLowerCase();
  if (MODEL_BRANDS[low]) return MODEL_BRANDS[low];     // brand acronyms: GPT / Claude / DeepSeek / Qwen / GLM …
  if (/^\d/.test(t)) return t;                          // version starting with a digit, kept verbatim: 4.6, 4o, 3.5
  return t.charAt(0).toUpperCase() + t.slice(1);        // capitalize the leading letter: v4→V4, flash→Flash, qwen3.7→Qwen3.7
}
// Auto display name from a model id, tuned per provider:
//  · OpenRouter / OpenAI / DeepSeek / Google: drop the "org/" prefix and any ":tag", split on "-"/"_",
//    then brand-case or capitalize each word (deepseek-v4-flash → DeepSeek V4 Flash, gpt-5.5 → GPT 5.5).
//  · Anthropic native ids encode the version with dashes (claude-opus-4-8) — fold "<digit>-<digit>" into "4.8" first.
//  · Google models (OpenRouter org "google/" or the native Google provider) often carry a trailing "-preview"
//    (sometimes plus a date) — drop it so gemini-3-flash-preview reads as "Gemini 3 Flash".
function prettyModel(id, provider) {
  let s = String(id || "");
  const slash = s.lastIndexOf("/");
  const vendor = slash >= 0 ? s.slice(0, slash).toLowerCase() : "";              // OpenRouter org, e.g. "google"
  if (slash >= 0) s = s.slice(slash + 1);                                        // strip "anthropic/" etc.
  s = s.replace(/:.*$/, "");                                                     // strip ":free" / ":beta"
  if (!s) return String(id || "");
  if (vendor === "google" || provider === "google") s = s.replace(/-preview\b.*$/i, "");  // gemini-3-flash-preview → Gemini 3 Flash
  if (provider === "anthropic") s = s.replace(/(\d)-(\d)/g, "$1.$2");            // claude-opus-4-8 → claude-opus-4.8
  return s.split(/[-_]/).map(prettyToken).filter(Boolean).join(" ");
}
function modelLabel(ref) { return ref ? prettyModel(ref.model, ref.provider) : ""; }   // names are auto-generated; no manual override
// First time a provider gets an API key: wire up sensible models/defaults so it works out of the box.
function onProviderConnected(pk) {
  if (pk === "deepseek") {
    addModel({ provider: "deepseek", model: "deepseek-v4-pro" });
    addModel({ provider: "deepseek", model: "deepseek-v4-flash" });
    state.settings.defaults.chat = { provider: "deepseek", model: "deepseek-v4-pro" };   // 对话 = Pro
    state.settings.defaults.title = { provider: "deepseek", model: "deepseek-v4-flash" }; // 命名 = Flash
    nextModel = clone(state.settings.defaults.chat);
    const c = currentConv(); if (c && (!c.messages || !c.messages.length)) c.model = clone(nextModel);
    updateModelPill();
    toast("已接入 DeepSeek：默认对话用 v4-pro，自动命名用 v4-flash");
  } else {
    // other providers: make their suggested models one-click available (added below in the chips UI)
  }
  // 轻量刷新：只更新「服务商圆点 / 已启用模型 / 模型列表」，不重建 #ms-key 输入框——
  // 否则会在用户刚输入完 key、焦点还在框里时把输入框换掉（丢焦点），或吞掉随后点「检测」的点击。
  const sec = document.querySelector('#modal-sections section[data-sec="services"]');
  if (sec && !sec.classList.contains("hidden")) { renderMsProviders(); renderMsEnabled(pk); renderMsList(pk, ""); }
  populateQuickModelSelect();
}

/* per-conversation web search + reasoning toggles */
const EFFORT_LABELS = { low: "低", medium: "中", high: "高" };
function activeWeb() { const c = currentConv(); return c ? !!c.webSearch : nextWeb; }
function activeReasoning() { const c = currentConv(); return c ? !!c.reasoning : nextReasoning; }
function activeEffort() { const c = currentConv(); return (c ? c.reasoningEffort : nextReasoningEffort) || "medium"; }
function toggleWeb() { const c = currentConv(); if (c) c.webSearch = !c.webSearch; else nextWeb = !nextWeb; save(); updateComposerToggles(); }
function setEffort(level) { const c = currentConv(); if (c) { c.reasoningEffort = level; c.reasoning = true; } else { nextReasoningEffort = level; nextReasoning = true; } save(); updateComposerToggles(); warnIfNoReasoning(); }
function warnIfNoReasoning() { const r = activeRef(); if (r && reasoningSupport(r) === "no") toast("ℹ️ 该模型不支持推理，思考开关对它无效（请求中会被忽略）"); }
// 粗估当前对话将随下一条请求发出的上下文 token 数（中文≈0.7/字、其他≈3.6字符/token、图片≈800/张），
// 只用于压缩按钮的提示，给「该不该压缩」一个直观参照。
function estContextTokens(conv) {
  if (!conv || !conv.messages.length) return 0;
  let txt = activePromptText(conv) || "";
  let imgs = 0;
  let msgs = conv.messages;
  if (conv.compaction) {
    const cut = Math.min(conv.compaction.count, msgs.length);
    if (msgs.length > cut) { if (conv.compaction.summary) txt += conv.compaction.summary; msgs = msgs.slice(cut); }
  }
  for (const m of msgs) {
    txt += m.content || "";
    for (const a of (m.attachments || [])) { if (a.kind === "image") imgs++; else if (a.kind === "textfile") txt += a.text || ""; }
  }
  const cjk = (txt.match(/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
  return Math.round(cjk * 0.7 + (txt.length - cjk) / 3.6 + imgs * 800);
}
function updateComposerToggles() {
  const ref = activeRef();
  const w = document.getElementById("web-btn");
  if (w) {
    const webOk = !!ref && ref.provider === "openrouter";   // 联网仅 OpenRouter 模型支持
    const on = activeWeb() && webOk;
    w.classList.toggle("active", on);
    w.classList.toggle("unsupported", !webOk);
    w.dataset.tip = webOk ? "联网搜索（仅 OpenRouter）" : "当前模型不支持联网（仅 OpenRouter 模型可用）";
    w.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const t = document.getElementById("think-btn");
  if (t) {
    const noReason = reasoningSupport(ref) === "no";       // 仅 OpenRouter 目录明确标注「不支持」时才灰显
    const on = activeReasoning() && !noReason;
    t.classList.toggle("active", on);
    t.classList.toggle("unsupported", noReason);
    t.dataset.tip = noReason ? "当前模型不支持思考" : "思考强度（点击调节）";
    t.setAttribute("aria-pressed", on ? "true" : "false");
    const lvl = t.querySelector(".cb-think-lvl");
    if (lvl) lvl.textContent = on ? (EFFORT_LABELS[activeEffort()] || "中") : "";
  }
  const cb = document.getElementById("compact-btn");
  if (cb) {
    const n = estContextTokens(currentConv());
    cb.dataset.tip = "压缩前文（AI 总结较早对话，省上下文）" + (n ? " · 当前上下文约 " + QuartzCore.formatCompactTokens(n) + " tokens" : "");
  }
}
// "yes" | "no" | "unknown" — only "no" comes from hard OpenRouter catalog data, so warnings never false-positive
function reasoningSupport(ref) {
  if (!ref) return "unknown";
  const prov = PROVIDERS[ref.provider];
  if (prov && prov.kind === "anthropic") return "yes";
  if (ref.provider === "openrouter" && orCatalog && orCatalog.length) {
    const e = orCatalog.find(m => m.id === ref.model);
    if (e) return e.reasoningOk ? "yes" : "no";
  }
  const id = (ref.model || "").toLowerCase();
  if (/(^|\/)o[1-4](-|$)|o[1-4]-(mini|preview)|gpt-5|deepseek-r|deepseek-v[4-9]|[-/]r1\b|reason|think|gemini-(2\.5|3)|qwen3|magistral|grok-(3|4)/.test(id)) return "yes";
  return "unknown";
}
// "yes" | "no" | "unknown" — 能否读图。只有 "no" 来自可靠数据（DeepSeek 接口直接拒图；
// OpenRouter 目录标注了输入模态），所以「读图回退 / 拦截」不会对能读图的模型误判。
function visionSupport(ref) {
  if (!ref) return "unknown";
  if (ref.provider === "deepseek") return "no";                       // image_url → 400
  if (ref.provider === "openrouter" && orCatalog && orCatalog.length) {
    const e = orCatalog.find(m => m.id === ref.model);
    if (e && typeof e.visionOk === "boolean") return e.visionOk ? "yes" : "no";
  }
  const prov = PROVIDERS[ref.provider];
  if (prov && prov.kind === "anthropic") return "yes";                // Claude 3+ 均可读图
  const id = (ref.model || "").toLowerCase();
  if (/gemini|gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o|claude|-vl\b|vision|pixtral|llava|llama-3\.2/.test(id)) return "yes";
  return "unknown";
}

/* system-prompt library helpers */
function promptById(id) { return state.settings.prompts.find(p => p.id === id) || null; }
function activePromptId() { const c = currentConv(); return c ? (c.promptId || null) : nextPromptId; }
function activePromptText(conv) { const id = conv ? (conv.promptId || null) : nextPromptId; const p = promptById(id); return p ? (p.text || "") : ""; }

// The faceted quartz gem (nine facets: qc-center + qc p1..p8), shared by the answer crest and the settings
// preview via the .qz-gem class. Coloured by --crystal; a graded gem at rest, facet highlight travels when .live.
const CRYSTAL_FACETS = '<svg viewBox="0 0 24 24">'
  + '<polygon class="qc-center" points="10.2,8.5 13.8,8.5 13.8,15.5 10.2,15.5"/>'
  + '<polygon class="qc p1" points="12,3 10.2,8.5 13.8,8.5"/>'
  + '<polygon class="qc p2" points="12,3 13.8,8.5 17,8.5"/>'
  + '<polygon class="qc p3" points="13.8,8.5 17,8.5 17,15.5 13.8,15.5"/>'
  + '<polygon class="qc p4" points="12,21 13.8,15.5 17,15.5"/>'
  + '<polygon class="qc p5" points="12,21 10.2,15.5 13.8,15.5"/>'
  + '<polygon class="qc p6" points="12,21 7,15.5 10.2,15.5"/>'
  + '<polygon class="qc p7" points="7,8.5 10.2,8.5 10.2,15.5 7,15.5"/>'
  + '<polygon class="qc p8" points="12,3 7,8.5 10.2,8.5"/></svg>';
// Crystal that leads each AI answer — sits in the left gutter, centred on the first line; the text keeps its
// normal full-width position. While the answer streams (.live) the highlight travels around the facets.
const ANS_CREST = '<span class="ans-crest qz-gem" aria-hidden="true">' + CRYSTAL_FACETS + '</span>';
// Render an assistant answer's markdown while PRESERVING the leading crystal node across re-renders.
// Recreating the crystal on every streamed token would restart its CSS animation, so the facet highlight
// would never travel — it'd freeze on whichever facets are lit in the animation's first frame. Instead we
// keep the same .ans-crest element and only swap the markdown that follows it.
function renderAnswer(contentEl, html, live) {
  if (!contentEl) return;
  let crest = contentEl.querySelector(":scope > .ans-crest");
  if (crest) {
    while (crest.previousSibling) crest.previousSibling.remove();   // keep crest first
    while (crest.nextSibling) crest.nextSibling.remove();           // drop the old markdown, keep crest
    if (html) crest.insertAdjacentHTML("afterend", html);
  } else {
    contentEl.innerHTML = html || "";
    contentEl.insertAdjacentHTML("afterbegin", ANS_CREST);
    crest = contentEl.querySelector(":scope > .ans-crest");
  }
  if (crest) crest.classList.toggle("live", !!live);               // facet highlight travels while generating
}
function stopCrest(contentEl) { const c = contentEl && contentEl.querySelector(":scope > .ans-crest"); if (c) c.classList.remove("live"); }

/* ---- 思考窗口（reasoning）：折叠 / 半展开(110px) / 完全展开；顶栏切折叠⇄展开，底部按钮切半⇄全。 ---- */
function reasonMore(rEl) { const m = rEl.querySelector(".reasoning-more"); if (m) m.textContent = rEl.dataset.exp === "full" ? "收起 ▴" : "展开全部 ▾"; }
function setReasonExp(rEl, exp) {
  rEl.dataset.exp = exp; if (exp !== "collapsed") rEl.dataset.lastExp = exp; reasonMore(rEl);
  // 完成态：把 max-height 设成真实内容高度（半展开封顶 110），收起时从真高度平滑收起、无死区。
  // 思考态/折叠态清掉内联，交给 CSS（思考态 min=max 固定取景窗；折叠 max-height:0）。
  const rb = rEl.querySelector(".reasoning-body"); if (!rb) return;
  if (rEl.classList.contains("thinking") || exp === "collapsed") rb.style.maxHeight = "";
  else rb.style.maxHeight = (exp === "full" ? rb.scrollHeight : Math.min(rb.scrollHeight, 110)) + "px";
}
function setReasonTitle(rEl, txt) { const t = rEl.querySelector(".reasoning-title"); if (t) t.textContent = txt; rEl.classList.toggle("thinking", txt === "思考中"); }
function bindReason(rEl, row) {
  const head = rEl.querySelector(".reasoning-head");
  if (head) head.onclick = () => { setReasonExp(rEl, rEl.dataset.exp === "collapsed" ? (rEl.dataset.lastExp || "half") : "collapsed"); trackCrest(row); };
  const more = rEl.querySelector(".reasoning-more");
  if (more) more.onclick = (e) => { e.stopPropagation(); setReasonExp(rEl, rEl.dataset.exp === "full" ? "half" : "full"); trackCrest(row); };
  // 思考流式时正文默认贴底跟随；用户在思考窗内上滑（离底 >24px）即暂停跟随、停在原处看，滑回底部再自动恢复。
  const rb = rEl.querySelector(".reasoning-body");
  if (rb) {
    rb._follow = true;                                  // 每次（重新）绑定/开播都默认贴底跟随
    if (!rb._followBound) {
      rb._followBound = true;
      rb.addEventListener("scroll", () => { rb._follow = rb.scrollHeight - rb.scrollTop - rb.clientHeight < 24; }, { passive: true });
    }
  }
}
// 水晶定位：思考时骑在思考窗口的垂直中线上；否则落在回答首行（CSS 默认 top:0.85em）。top 的 CSS 过渡产生移动动画。
function placeCrest(row) {
  if (!row) return;
  const cEl = row.querySelector(".msg-body > .msg-content");
  const crest = cEl && cEl.querySelector(":scope > .ans-crest");
  if (!crest) return;
  const r = row.querySelector(".reasoning");
  if (row.classList.contains("thinking") && r && r.style.display !== "none") {
    const rRect = r.getBoundingClientRect(), cRect = cEl.getBoundingClientRect();   // 相对偏移与滚动无关
    crest.style.top = Math.round(rRect.top + rRect.height / 2 - cRect.top) + "px";
  } else {
    crest.style.top = "";   // 回到 CSS 默认：回答首行
  }
}
// 思考窗口尺寸变化的动画期间（出现 / 收起 / 切换大小），逐帧把水晶贴着布局放（关掉水晶自身过渡，避免追赶滞后）：
// 布局平滑动 → 水晶平滑动，不再瞬移。约 360ms 覆盖一次过渡，结束后恢复过渡。目标类型不变时用它（思考中始终对准窗口中线）。
let crestRAF = 0;
function trackCrest(row, ms) {
  if (!row) return;
  const cEl = row.querySelector(".msg-body > .msg-content");
  const crest = cEl && cEl.querySelector(":scope > .ans-crest");
  if (!crest) return;
  if (crestRAF) cancelAnimationFrame(crestRAF);
  crest.style.transition = "none";
  placeCrest(row);   // 立即放一次，避免首帧停在跳变位置
  const start = performance.now(), dur = ms || 360;
  const step = (now) => { placeCrest(row); if (now - start < dur) crestRAF = requestAnimationFrame(step); else { crest.style.transition = ""; crestRAF = 0; } };
  crestRAF = requestAnimationFrame(step);
}
// 思考结束（回答开始 / 整体完成）：标题改「思考过程」、窗口收起；水晶恢复过渡，随收起动画一起滑回回答首行。
function finishThinking(row) {
  if (!row) return;
  if (crestRAF) { cancelAnimationFrame(crestRAF); crestRAF = 0; }
  const cEl = row.querySelector(".msg-body > .msg-content");
  const crest = cEl && cEl.querySelector(":scope > .ans-crest");
  if (crest) crest.style.transition = "";   // 恢复过渡 → top 改变会平滑滑动
  const r = row.querySelector(".reasoning");
  if (r) { setReasonTitle(r, "思考过程"); setReasonExp(r, "collapsed"); }
  row.classList.remove("thinking");
  placeCrest(row);   // top → ""（回答首行）；与收起动画一起平滑收束
}

// Cost is charged in USD; the user can display it in USD or CNY (fixed, editable rate — see 设置 → 常规).
function curUnit() { return "cny"; }            // 费用固定按人民币显示（货币单位/汇率的设置项已移除）
function curSym() { return curUnit() === "cny" ? "¥" : "$"; }
function usdToCny() { return DEFAULT_USD_CNY; }  // 固定汇率（汇率设置项已移除）
function convAmt(usd) { return curUnit() === "cny" ? usd * usdToCny() : usd; }
function trimNum(s) { return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s; }
// Clean, friendly inline cost: 2 decimals, or "<¥0.01" when under one cent (hover the element for the exact value).
function fmtCost(c) {
  if (c == null) return "";
  const sym = curSym(), v = convAmt(c);
  if (v === 0) return sym + "0";
  if (v < 0.01) return "<" + sym + "0.01";
  return sym + v.toFixed(2);
}
// Exact cost for tooltips — full precision in RMB, plus the USD source × rate (cost is stored in USD).
function fmtCostExact(c) {
  if (c == null) return "";
  const sym = curSym(), v = convAmt(c);
  if (v === 0) return sym + "0";
  const body = sym + trimNum(v < 0.01 ? v.toFixed(6) : v.toFixed(4));
  if (curUnit() === "cny") return body + "（$" + trimNum(c < 0.01 ? c.toFixed(6) : c.toFixed(4)) + " × " + usdToCny() + "）";
  return body;
}
const fmtTok = QuartzCore.formatTokens;
function convTotals(conv) {
  let pt = 0, ct = 0, cost = 0, has = false;
  for (const m of conv.messages) if (m.usage) { has = true; pt += m.usage.prompt_tokens || 0; ct += m.usage.completion_tokens || 0; cost += m.usage.cost || 0; }
  return { pt, ct, cost, has };
}
// ---- daily token stats (powers the contribution heatmap in 设置 → 统计) ----
function dayKey(d) { const p = (x) => String(x).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
function recordDailyUsage(usage) {
  if (!usage || !state) return;
  const t = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
  if (t <= 0) return;
  state.stats = state.stats || {}; state.stats.daily = state.stats.daily || {}; state.stats.dailyCost = state.stats.dailyCost || {};
  const k = dayKey(new Date());
  state.stats.daily[k] = (state.stats.daily[k] || 0) + t;                          // 往后精确累计（save 紧随其后）
  if (usage.cost > 0) state.stats.dailyCost[k] = (state.stats.dailyCost[k] || 0) + usage.cost;
}
// One-time rough backfill: attribute each conversation's total tokens + cost to its last-active day.
// Approximate (a multi-day chat lands on one day) — a heatmap "vibe" for history; precise going forward.
// Tokens and cost are seeded independently so an install that already seeded tokens still gets cost on upgrade.
function backfillDailyStats() {
  state.stats = state.stats || {}; state.stats.daily = state.stats.daily || {}; state.stats.dailyCost = state.stats.dailyCost || {};
  if (state.stats.seeded && state.stats.seededCost) return;
  (state.conversations || []).concat(state.archived || []).forEach(c => {
    const tot = convTotals(c); const ts = convTime(c); if (!ts) return;
    const k = dayKey(new Date(ts)); const t = (tot.pt || 0) + (tot.ct || 0);
    if (!state.stats.seeded && t > 0) state.stats.daily[k] = (state.stats.daily[k] || 0) + t;
    if (!state.stats.seededCost && tot.cost > 0) state.stats.dailyCost[k] = (state.stats.dailyCost[k] || 0) + tot.cost;
  });
  state.stats.seeded = true; state.stats.seededCost = true;
}
// DeepSeek 不像 OpenRouter 那样在 usage 里回传 cost，只给 token 数 + 缓存命中/未命中拆分，所以本地按官方单价估算。
// 官方按人民币计价（¥ / 每百万 token），命中缓存(cacheHit)的输入比未命中(cacheMiss)便宜很多——这里存人民币原价，便于核对/调价。
// 算出人民币成本后，按内置参考汇率换成美元存进 usage.cost：与 OpenRouter 等同口径（usage.cost 一律美元），
// 最终人民币展示由 convAmt 按固定汇率 DEFAULT_USD_CNY 换算，故人民币显示就是官方原价。
// ⚠️ 官方调价时改下面的数字即可；想改汇率改 DEFAULT_USD_CNY。
const DEEPSEEK_CNY_PER_USD = DEFAULT_USD_CNY;
const DEEPSEEK_PRICES = {
  "deepseek-v4-pro":   { cacheHit: 0.025, cacheMiss: 3, output: 6 },
  "deepseek-v4-flash": { cacheHit: 0.02,  cacheMiss: 1, output: 2 },
};
// 入参是 DeepSeek 原始 usage（含 prompt_cache_hit_tokens / prompt_cache_miss_tokens）；表里没有的模型返回 undefined（退回只显示 token）。
function deepseekCost(model, u) {
  const p = DEEPSEEK_PRICES[model];
  if (!p || !u) return undefined;
  const hit = u.prompt_cache_hit_tokens || 0;
  const miss = (u.prompt_cache_miss_tokens != null) ? u.prompt_cache_miss_tokens : Math.max(0, (u.prompt_tokens || 0) - hit);
  const out = u.completion_tokens || 0;
  const cny = (hit * p.cacheHit + miss * p.cacheMiss + out * p.output) / 1e6;   // 人民币成本
  return cny / DEEPSEEK_CNY_PER_USD;   // usage.cost 统一存美元
}
function toast(msg, action) {
  let t = document.getElementById("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
  t.innerHTML = "";
  const span = document.createElement("span"); span.textContent = msg; t.appendChild(span);
  if (action && action.label && typeof action.fn === "function") {
    const btn = document.createElement("button"); btn.className = "toast-action"; btn.textContent = action.label;
    btn.onclick = () => { clearTimeout(t._t); t.classList.remove("show"); action.fn(); };
    t.appendChild(btn);
  }
  // Center over the chat area (matching #status-banner) instead of the whole window — stays put even with the
  // sidebar/modal open (kept on <body> so it still layers above modals; only the horizontal centre is retargeted).
  const main = document.getElementById("main");
  if (main) { const r = main.getBoundingClientRect(); t.style.left = Math.round(r.left + r.width / 2) + "px"; }
  t.classList.add("show");
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), action ? 6000 : 2800);
}
function showStatus(text) { document.getElementById("status-text").textContent = text; document.getElementById("status-banner").classList.add("show"); }
function hideStatus() { document.getElementById("status-banner").classList.remove("show"); }
function plainText(m) {
  let t = m.content || "";
  (m.attachments || []).forEach(a => { t += " [" + (a.kind === "image" ? "图片" : a.name) + "]"; });
  return t.trim() || "（空）";
}
// 用户这一轮只发了附件（图片/文件）、没有任何文字 —— 此时这条没有可命名的提问文本，标题改用本轮回答来起。
function isAttachmentOnly(m) { return !!(m && !((m.content || "").trim()) && (m.attachments || []).length); }
// 紧跟某条用户消息之后、且已有实际内容的助手回答（回答还在生成 / 占位为空时返回 null）。
function answerAfter(conv, userIndex) { const a = conv.messages[userIndex + 1]; return (a && a.role === "assistant" && (a.content || "").trim()) ? a : null; }

/* ===================== Appearance / layout ===================== */
function applyTheme() {
  const t = state.settings.appearance.theme;
  const resolved = t === "auto" ? (mql.matches ? "dark" : "light") : t;
  document.documentElement.setAttribute("data-theme", resolved);
  applyAccent();              // crystal colour is per-theme — refresh it for the resolved light/dark
  syncTitleBarOverlay();
}
// Accent colour — a single restrained hue the user picks. For now it drives the brand crystal (--crystal);
// other focal points can opt in later. Each option is a real quartz variety; lighter on dark backgrounds,
// deeper on light, so the faceted gem reads well either way.
const ACCENT_COLORS = {
  amethyst: { name: "紫水晶", light: "#7a4fd6", dark: "#bd9cff" },
  sapphire: { name: "蓝晶",   light: "#2f73d4", dark: "#74b6ff" },
  rose:     { name: "粉晶",   light: "#db4f80", dark: "#ff9fc2" },
  citrine:  { name: "黄水晶", light: "#cf911a", dark: "#f6cb45" },
  smoky:    { name: "茶晶",   light: "#b3743e", dark: "#e3a86f" },
  emerald:  { name: "绿晶",   light: "#1ba36a", dark: "#56d79b" },
  clear:    { name: "白水晶", light: "#9a9a9a", dark: "#d6d6d6" },
};
function accentHex() {
  const a = state.settings.appearance;
  if (a.accent === "custom") return a.accentCustom || "#a99cd6";   // user-picked, same hue in both themes
  const c = ACCENT_COLORS[a.accent] || ACCENT_COLORS.clear;
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  return theme === "light" ? c.light : c.dark;
}
// Both light & dark hexes for the current accent, so the quick-bar (a separate window that resolves its
// own light/dark) can colour its crystal to match the app instead of staying monochrome.
function accentPair() {
  const a = state.settings.appearance;
  if (a.accent === "custom") { const h = a.accentCustom || "#d6d6d6"; return { light: h, dark: h }; }
  const c = ACCENT_COLORS[a.accent] || ACCENT_COLORS.clear;
  return { light: c.light, dark: c.dark };
}
function applyAccent() {
  if (!state) return;
  document.documentElement.style.setProperty("--crystal", accentHex());
  const sw = document.getElementById("set-accent-sw");
  if (sw) renderAccentSwatches();   // keep the settings swatches in sync when the theme flips
}
// Render the colour swatches in Settings → 外观 → 强调色. Each shows the hue as it'll look in the current theme.
function renderAccentSwatches() {
  const wrap = document.getElementById("set-accent-sw");
  if (!wrap || !state) return;
  const preview = document.getElementById("accent-preview");
  if (preview && !preview.firstChild) preview.innerHTML = CRYSTAL_FACETS;   // the showcase gem (coloured by --crystal)
  const cur = state.settings.appearance.accent || "clear";
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  wrap.innerHTML = "";
  Object.keys(ACCENT_COLORS).forEach(key => {
    const c = ACCENT_COLORS[key];
    const hex = theme === "light" ? c.light : c.dark;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch" + (key === cur ? " on" : "");
    b.title = c.name;
    b.style.background = hex;
    b.onmouseenter = () => { if (preview) preview.style.setProperty("--crystal", hex); };   // hover to preview
    b.onclick = () => { if (preview) preview.style.removeProperty("--crystal"); state.settings.appearance.accent = key; applyAccent(); save(); };
    wrap.appendChild(b);
  });
  // custom colour — a rainbow swatch wrapping a hidden native colour picker
  const a = state.settings.appearance;
  const custom = a.accentCustom || "#a99cd6";
  const cl = document.createElement("label");
  cl.className = "swatch custom" + (cur === "custom" ? " on" : "");
  cl.title = "自定义颜色";
  const ci = document.createElement("input");
  ci.type = "color"; ci.value = custom;
  ci.oninput = () => {   // live preview everywhere while dragging in the picker (saved on change)
    if (preview) preview.style.removeProperty("--crystal");
    a.accent = "custom"; a.accentCustom = ci.value;
    document.documentElement.style.setProperty("--crystal", ci.value);
  };
  ci.onchange = () => { a.accent = "custom"; a.accentCustom = ci.value; applyAccent(); save(); };
  cl.appendChild(ci);
  cl.onmouseenter = () => { if (preview) preview.style.setProperty("--crystal", a.accentCustom || "#a99cd6"); };
  wrap.appendChild(cl);
  if (preview) wrap.onmouseleave = () => preview.style.removeProperty("--crystal");   // revert to the selected colour
}
// multiply a #rrggbb colour toward black by factor f (0..1) — used to dim the native controls under a modal scrim
function dimHex(hex, f) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim()); if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function anyModalOpen() { return ["modal-bg", "confirm-bg", "guide-bg"].some(id => { const e = document.getElementById(id); return e && e.classList.contains("show"); }); }
// Keep the Windows/Linux native window-controls overlay matching the current theme colours. While a modal is open
// the page sits under a 50% black scrim, but Windows draws the controls ABOVE the web layer so they stay bright and
// "pop" — dim them to match so the whole window greys out together.
function syncTitleBarOverlay() {
  if (!window.chatbox || !window.chatbox.setTitleBarOverlay || window.chatbox.platform === "darwin") return;
  const cs = getComputedStyle(document.documentElement);
  let color = (cs.getPropertyValue("--bg") || "#1c1c1c").trim();
  let symbolColor = (cs.getPropertyValue("--text") || "#d3d3d3").trim();
  if (anyModalOpen()) { color = dimHex(color, 0.5); symbolColor = dimHex(symbolColor, 0.5); }   // match the rgba(0,0,0,.5) scrim
  window.chatbox.setTitleBarOverlay({ color, symbolColor, height: 60 });
}
function applyFont() {
  const a = state.settings.appearance;
  document.documentElement.style.setProperty("--font-family", FONT_STACKS[a.fontFamily] || FONT_STACKS.system);
  document.documentElement.style.setProperty("--font-size", (a.fontSize || 15) + "px");
}
// Reading width is a percentage of the available area (responsive, follows window/sidebar).
function setContentPct(pct, persist) {
  const p = Math.min(100, Math.max(50, Math.round((pct || 90) / 5) * 5));
  state.settings.appearance.contentPct = p;
  document.documentElement.style.setProperty("--content-width", p + "%");
  if (persist) save();
}
function applyContentWidth() {
  const p = Math.min(100, Math.max(50, state.settings.appearance.contentPct || 90));
  document.documentElement.style.setProperty("--content-width", p + "%");
}
// Route all model API requests through the configured local proxy (Clash/V2Ray), or direct when disabled.
function applyProxy() {
  if (window.chatbox && window.chatbox.setProxy) {
    try { return window.chatbox.setProxy(state.settings.proxy || { enabled: false }); } catch (e) {}
  }
}
function applyDensity() {
  const box = document.getElementById("messages");
  if (box) box.classList.toggle("dense", (state.settings.appearance.density || "comfortable") === "compact");
}
function applyCodeTheme() {
  const ct = state.settings.appearance.codeTheme || "vivid";
  if (ct === "contrast" || ct === "vivid") document.documentElement.setAttribute("data-hl", ct);
  else document.documentElement.removeAttribute("data-hl");
}
function applySidebar() {
  const sb = document.getElementById("sidebar");
  const rz = document.getElementById("sidebar-resizer");
  const s = state.settings.sidebar;
  if (s.collapsed) { sb.style.width = "0px"; sb.classList.add("collapsed"); rz.style.display = "none"; }
  else { sb.style.width = Math.max(210, Math.min(480, s.width || 264)) + "px"; sb.classList.remove("collapsed"); rz.style.display = "block"; }
}
function toggleSidebar() { state.settings.sidebar.collapsed = !state.settings.sidebar.collapsed; save(); applySidebar(); }
function isNearBottom(box) { return box.scrollHeight - box.scrollTop - box.clientHeight < 80; }
function updateScrollBtn() {
  const btn = document.getElementById("scroll-btn");
  const box = document.getElementById("messages");
  if (!btn || !box) return;
  const conv = currentConv();
  const has = !!(conv && conv.messages && conv.messages.length);
  // Show only when auto-follow is released (no streaming pin) and the latest content sits below the fold.
  btn.classList.toggle("show", has && pinTop == null && !isNearBottom(box));
}

/* ===================== File handling ===================== */
function readAs(file, how) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result); fr.onerror = reject;
    if (how === "text") fr.readAsText(file); else fr.readAsDataURL(file);
  });
}
function downscaleImage(file, max = 1456, q = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (Math.max(width, height) > max) { const r = max / Math.max(width, height); width = Math.round(width * r); height = Math.round(height * r); }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      try { resolve(canvas.toDataURL("image/jpeg", q)); } catch (e) { reject(e); }
    };
    img.onerror = reject;
    readAs(file, "dataurl").then(d => img.src = d).catch(reject);
  });
}
function isTextLike(file) {
  if (file.type.startsWith("text/")) return true;
  if (["application/json", "application/xml", "application/javascript", "application/x-yaml", "application/x-sh"].includes(file.type)) return true;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return TEXT_EXT.includes(ext) || TEXT_EXT.includes(file.name.toLowerCase());
}
async function handleFiles(files) {
  let addedImage = false;
  for (const file of files) {
    try {
      if (file.type.startsWith("image/")) { pending.push({ kind: "image", name: file.name, dataUrl: await downscaleImage(file) }); addedImage = true; }
      else if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        if (file.size > 20 * 1024 * 1024) { toast("「" + file.name + "」超过 20MB，PDF 太大，未添加"); continue; }   // 图片有降采样、文本会截断，唯独 PDF 整份转 base64，过大撑爆存储
        pending.push({ kind: "pdf", name: file.name, dataUrl: await readAs(file, "dataurl") });
      }
      else if (isTextLike(file)) {
        let text = await readAs(file, "text");
        if (text.length > 200000) text = text.slice(0, 200000) + "\n…（文件过长，已截断）";
        pending.push({ kind: "textfile", name: file.name, text });
      } else { pending.push({ kind: "note", name: file.name }); toast("「" + file.name + "」是不支持解析的类型，仅附带文件名。"); }
    } catch (e) { console.error(e); toast("读取「" + file.name + "」失败"); }
  }
  renderPending();
  // 提前提示（不必等到发送才被拦）：当前是 DeepSeek 又贴了图——它不支持图片。
  const ref = activeRef();
  if (addedImage && ref && ref.provider === "deepseek") toast("当前 DeepSeek 模型不支持图片，发送前请切换模型或移除图片");
}
function renderPending() {
  const row = document.getElementById("attach-row");
  if (!pending.length) { row.style.display = "none"; row.innerHTML = ""; return; }
  row.style.display = "flex"; row.innerHTML = "";
  pending.forEach((a, i) => {
    const el = document.createElement("div");
    if (a.kind === "image") { el.className = "pending-thumb"; const im = document.createElement("img"); im.src = a.dataUrl; im.onclick = () => openLightbox(a.dataUrl); el.appendChild(im); }
    else {
      el.className = "pending-chip";
      const nm = document.createElement("span"); nm.className = "nm";
      nm.innerHTML = ic("file", 13); nm.append(document.createTextNode(" " + a.name)); el.appendChild(nm);
    }
    const rm = document.createElement("button"); rm.className = "rm"; rm.innerHTML = ic("x", 13);
    rm.onclick = () => { pending.splice(i, 1); renderPending(); };
    el.appendChild(rm); row.appendChild(el);
  });
  updateSendButton();   // attachments count toward "has something to send"
}
