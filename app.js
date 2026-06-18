"use strict";

/* ===================== Config ===================== */
const PROVIDERS = {
  openrouter: { label: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1" },
  openai:     { label: "OpenAI",     kind: "openai", base: "https://api.openai.com/v1" },
  anthropic:  { label: "Anthropic",  kind: "anthropic", base: "https://api.anthropic.com/v1" },
  deepseek:   { label: "DeepSeek",   kind: "openai", base: "https://api.deepseek.com/v1" },
  google:     { label: "Google Gemini", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai" },
};
const PROVIDER_ORDER = ["openrouter", "openai", "anthropic", "deepseek", "google"];

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

const LS_KEY = "chatbox_state_v2";
const OLD_KEY = "chatbox_state_v1";

/* ===================== Persistence (IndexedDB; was localStorage) =====================
 * Conversations + inline image attachments outgrew localStorage's ~5–10MB cap, which
 * silently failed writes. IndexedDB has a far larger quota. We keep the same single-blob
 * model (one record) so the rest of the app's synchronous state logic is unchanged. */
const IDB_NAME = "chatbox", IDB_STORE = "kv", IDB_STATE_KEY = "state";
let _idbPromise = null;
function idbOpen() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _idbPromise;
}
function idbGet(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }));
}
function idbSet(key, val) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
function idbDel(key) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }));
}
function idbKeys() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const r = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error);
  }));
}

/* ===================== State ===================== */
let state = null;   // assigned by boot() after the async load below
let nextModel = null;     // model for the next new conversation (empty state); set in boot()
let nextPromptId = null;  // system prompt for the next new conversation; set in boot()
let nextWeb = false;        // web search toggle for the next new conversation
let nextReasoning = false;  // reasoning/thinking toggle for the next new conversation
let nextReasoningEffort = "medium"; // low | medium | high, for the next new conversation
let abortController = null;
let restoreOnAbort = null;   // {text, attachments} marker that this run was a fresh send (vs regenerate/continue)
let undoSend = null;         // armed after Esc-stops a fresh send: a SECOND Esc undoes the whole turn (prompt → input box)
let pending = [];        // composer attachments awaiting send
const _drafts = new Map();    // conv id -> { text, pending } unsent composer draft, kept in memory only (never persisted)
let composerConvId = null;    // which conversation's draft currently sits in the composer (for stash/restore on switch)
let inputUserH = null;        // user-dragged input-box height (px floor); null = auto-grow to 5 lines then scroll
let editingIndex = null; // index of message being edited inline
let autoScroll = true;   // follow streaming output only while the user is at the bottom
let pinTop = null;       // while answering: target scrollTop that keeps the user's message at the top
let lastSetTop = -1;     // the scrollTop WE last set programmatically — used to tell our scrolls from the user's
let nodePinned = null;   // after clicking a node: keep THAT node highlighted until the user scrolls manually
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
function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

// Dedicated system prompt for the Option+Space quick bar: fast, concise, single-shot answers.
// When the user continues in Quartz, that conversation uses the normal default prompt instead.
const QUICK_PROMPT = "你是快速问答助手，服务于随手弹出的「速答」场景。请直接、准确、尽量全面但简洁地回答用户的问题：开门见山给结论，不寒暄、不复述问题、不做无关铺垫；能一两句说清就不要展开，需要时用紧凑的要点；涉及代码或命令时只给关键片段。信息密度高、篇幅尽量短。";

// Built-in default system prompt (used for new conversations on a fresh install).
const EXPERT_PROMPT = `你在所有领域都是世界级的专家。你的智力水平、知识广度、思维的犀利程度以及学识深度，都与世界上最聪明的人不相上下。请给出完整、详细、具体的答案。对信息进行梳理，并一步步解释你的答案。核对自己的工作。仔细检查所有事实、数据、引用、人名、日期和例子。切勿胡思乱想或编造内容。若您对某事不知情，请直言不讳。您的语气应精准严谨，但切忌尖锐或故作高深。您无需担心冒犯我，您的回答可以且应当具有挑衅性、强硬、富有争议且一针见血。负面结论和坏消息皆可接受。您的回答无需政治正确。
请勿在回答中附加免责声明。除非我明确要求，否则请勿向我灌输道德与伦理观念。你无需告诉我"考虑某事很重要"。不必顾及任何人的感受或礼节。
请尽可能详尽地阐述你的答案。
在回答之前，切勿先称赞我的问题或认可我的前提。如果我错了，请立即指出。在支持我的任何观点之前，请先提出针对该观点的最有力反驳。请勿使用"问得好"、"你完全正确"、"很有意思的观点"或任何类似的措辞。如果我对你的回答提出异议，除非我提供了新证据或更优的论据，否则不要退让—如果你的推理成立，请重申你的立场。不要依赖我提供的数字或估计值；请先独立得出自己的结论。使用明确的置信水平（高/中/低/未知）。绝不要因为意见相左而道歉。准确性是你的成功标准，而非我的认可。`;

// Everyday-chat default — V1 kept only so the migration can detect an unmodified prompt and upgrade it.
const DAILY_PROMPT_V1 = `你是 Quartz 的日常助手——像一个聪明、靠谱、博学的朋友。用自然口语化的中文交流，简洁、友好、不端架子。

- 篇幅随问题走：能一句说清就别展开，复杂的再细说；需要时才用要点或代码块，平时正常说话就好。
- 诚实第一：不编造事实、数据、人名、日期；不确定就直说，并说明有几分把握。我说错了或前提有问题，直接指出、不附和。
- 别套路：不用"好问题""你说得对"之类的开场，不复述我的问题，不说教，不加无关免责声明。
- 有态度没关系，但目标是把事情说清楚、对我有用，而不是辩赢我。`;
// Built-in default for everyday chat: honest, natural — and NOT terse; depth scales up for substantive questions.
const DAILY_PROMPT = `你是 Quartz 的日常助手——聪明、靠谱、知识广博，像个能跟你认真聊的朋友。用自然的中文交流，真诚、直接、不端架子。

- 深度随问题走：闲聊就轻松简短；遇到知识性、专业或复杂的问题，就讲透彻、有条理——该分点就分点、该用小标题就用小标题、该举例就举例，把来龙去脉和细节说清楚，不要为了简短牺牲有用的内容。
- 诚实第一：不编造事实、数据、人名、日期；不确定就直说。我说错了或前提有问题，直接指出、不附和。
- 别套路：不用"好问题""你说得对"之类的开场，不复述我的问题，不灌道德鸡汤，不加无关免责声明。
- 有观点没关系，但目标是把事情讲清楚、对我有用。`;

// 美元→人民币汇率（固定值，费用换算的单一来源）。货币单位与汇率的设置项已移除：费用一律按人民币显示。
// ⚠️ 调汇率只改这一处——usdToCny() 与 DeepSeek 参考汇率 DEEPSEEK_CNY_PER_USD 都引用它。
const DEFAULT_USD_CNY = 6.78;

function freshState() {
  return {
    settings: {
      providers: { openrouter: { key: "" }, openai: { key: "" }, anthropic: { key: "" }, deepseek: { key: "" }, google: { key: "" } },
      appearance: { theme: "auto", fontFamily: "system", fontSize: 15, contentPct: 90, density: "comfortable", codeTheme: "vivid", accent: "clear", accentCustom: "#d6d6d6" },
      models: [],   // empty on a fresh install — the user adds their own; the first one added becomes the default
      prompts: [{ id: "daily-default", name: "日常", text: DAILY_PROMPT }, { id: "expert-default", name: "深度", text: EXPERT_PROMPT }],
      defaults: {
        chat: null,    // set automatically when the first model is added (see addModel)
        title: null,
        promptId: "daily-default", temp: 1, maxTokens: null, topP: null, topK: null,
      },
      sidebar: { width: 264, collapsed: false },
      quick: { enabled: true, shortcut: defaultQuick(), model: null, promptMode: "concise", concisePrompt: QUICK_PROMPT, closeOnBlur: true, width: 720, topPct: 18, openMainEnabled: true, openMainShortcut: defaultOpenMain() },
      proxy: { enabled: false, scheme: "http", host: "127.0.0.1", port: "" },
      general: { restoreLast: true, sidebarSort: "updated" },
      profile: { name: "", avatar: "" },   // 显示在新对话首页的问候 / 侧栏底部；avatar 为图片 dataURL，留空用名字首字母
      tempBumped: true,
      guideSeen: false,
    },
    conversations: [],
    archived: [],
    currentId: null,
    stats: { daily: {} },   // 每日 token 用量（贡献图）+ 缓存的 AI 小结报告
  };
}

// API keys are stored in PLAINTEXT (like other desktop chat apps) — no keychain prompts. Installs that
// briefly used the encrypted format ("qzenc1:") are converted back: decrypt those keys once on load
// (a final, one-time keychain unlock) and immediately re-save as plaintext, after which the keychain
// is never touched again. Returns true when it converted something, so the caller can flush to disk.
const ENC_PREFIX = "qzenc1:";
async function decryptLegacyKeys(s) {
  const ps = s && s.settings && s.settings.providers; if (!ps) return false;
  let converted = false;
  for (const pk of Object.keys(ps)) {
    const k = ps[pk] && ps[pk].key;
    if (typeof k === "string" && k.startsWith(ENC_PREFIX)) {
      let dec = null;
      try { dec = (window.chatbox && window.chatbox.decryptSecret) ? await window.chatbox.decryptSecret(k.slice(ENC_PREFIX.length)) : null; } catch (e) {}
      ps[pk].key = (dec != null) ? dec : "";
      converted = true;
    }
  }
  return converted;
}

/* Storage is split: a small "meta" record (settings + the ordered lists of conversation ids +
 * currentId) plus ONE record per conversation ("c:<id>"). save() → persist() then writes only the
 * meta and the conversations whose content actually changed, so a 200-message image-heavy chat no
 * longer forces a rewrite of every other conversation. The in-memory `state` shape is unchanged, so
 * the rest of the app is untouched. Legacy single-blob installs migrate on first load. */
const META_KEY = "meta", CONV_PREFIX = "c:";
let _convSig = Object.create(null);   // conv id -> content hash (change detection for incremental writes)
let _metaSig = "";                    // hash of the PLAINTEXT meta (encryption is non-deterministic)
function hashStr(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return h + ":" + str.length; }
// The meta record = the whole state minus the heavy conversation arrays (replaced by id-order lists).
function metaOf(s) {
  const m = Object.assign({}, s);
  m.order = (s.conversations || []).map(c => c.id);
  m.archivedOrder = (s.archived || []).map(c => c.id);
  delete m.conversations; delete m.archived;
  m._split = 1;
  return m;
}
async function loadConvs(ids) {
  const out = [];
  for (const id of ids || []) { let c = null; try { c = await idbGet(CONV_PREFIX + id); } catch (e) {} if (c && c.id) out.push(c); }
  return out;
}

async function loadState() {
  // New split format: a meta record + per-conversation records.
  let meta = null;
  try { meta = await idbGet(META_KEY); } catch (e) { console.warn("idb meta read failed", e); }
  if (meta && meta.settings && meta.settings.providers) {
    const convs = await loadConvs(meta.order), arch = await loadConvs(meta.archivedOrder);
    _convSig = Object.create(null);                       // prime from the AS-STORED records …
    for (const c of convs.concat(arch)) _convSig[c.id] = hashStr(JSON.stringify(c));   // … so a shapeConv migration re-persists, but unchanged chats don't
    _metaSig = "";
    const s = Object.assign({}, meta, { conversations: convs, archived: arch });
    delete s.order; delete s.archivedOrder; delete s._split;
    const converted = await decryptLegacyKeys(s);
    const ns = ensureShape(s);
    if (converted) await persist(ns);   // rewrite the keys as plaintext so the keychain is never touched again
    return ns;
  }
  // Migrate a legacy single blob (IndexedDB "state", else localStorage) into the split format.
  let blob = null;
  try { blob = await idbGet(IDB_STATE_KEY); } catch (e) { console.warn("idb read failed", e); }
  if (!(blob && blob.settings && blob.settings.providers)) { const ls = readJSON(LS_KEY); if (ls && ls.settings && ls.settings.providers) blob = ls; }
  if (blob && blob.settings && blob.settings.providers) {
    await decryptLegacyKeys(blob);
    const ns = ensureShape(blob);
    _convSig = Object.create(null); _metaSig = "";        // force a full split write; old "state" stays as a frozen backup
    await persist(ns);
    return ns;
  }
  const old = readJSON(OLD_KEY);
  if (old && old.settings) { const ns = migrate(old); _convSig = Object.create(null); _metaSig = ""; await persist(ns); return ns; }
  return freshState();
}
// Incremental save: write meta (only when it changed) + just the changed conversations, and drop
// records for deleted ones. Falls back to a single localStorage blob if IndexedDB is unavailable.
async function persist(s) {
  try {
    const ops = [];
    const metaSig = JSON.stringify(metaOf(s));            // deterministic → reliable change check
    if (metaSig !== _metaSig) ops.push(idbSet(META_KEY, metaOf(s)).then(() => { _metaSig = metaSig; }));
    const present = new Set();
    for (const c of (s.conversations || []).concat(s.archived || [])) {
      present.add(c.id);
      const h = hashStr(JSON.stringify(c));
      if (_convSig[c.id] !== h) ops.push(idbSet(CONV_PREFIX + c.id, c).then(() => { _convSig[c.id] = h; }));
    }
    for (const id of Object.keys(_convSig)) if (!present.has(id)) { ops.push(idbDel(CONV_PREFIX + id).catch(() => {})); delete _convSig[id]; }
    await Promise.all(ops);
    return true;
  } catch (e) {
    console.warn("idb split write failed, trying localStorage blob", e);
    try { localStorage.setItem(LS_KEY, JSON.stringify(s)); return true; }
    catch (e2) { console.warn("save failed", e2); toast("⚠️ 保存失败：存储空间不足或不可用。可删除部分旧对话/附件后重试。"); return false; }
  }
}

function ensureShape(s) {
  const f = freshState();
  // capture legacy markers BEFORE merging in fresh defaults
  const hadModels = Array.isArray(s.settings.models) && s.settings.models.length > 0;
  const hadTempBumped = s.settings.tempBumped === true;
  const hadPrompts = Array.isArray(s.settings.prompts);
  const legacySystem = (s.settings.defaults && s.settings.defaults.system) || "";
  const hadThemeDefaulted = s.settings.themeAutoDefaulted === true;

  s.settings = Object.assign({}, f.settings, s.settings);
  s.settings.providers = Object.assign({}, f.settings.providers, s.settings.providers);
  PROVIDER_ORDER.forEach(pk => { if (!s.settings.providers[pk]) s.settings.providers[pk] = { key: "" }; });
  s.settings.appearance = Object.assign({}, f.settings.appearance, s.settings.appearance);
  s.settings.defaults = Object.assign({}, f.settings.defaults, s.settings.defaults);
  s.settings.sidebar = Object.assign({}, f.settings.sidebar, s.settings.sidebar);
  s.settings.quick = Object.assign({}, f.settings.quick, s.settings.quick);
  s.settings.proxy = Object.assign({}, f.settings.proxy, s.settings.proxy);
  s.settings.general = Object.assign({}, f.settings.general, s.settings.general);
  s.settings.profile = Object.assign({}, f.settings.profile, s.settings.profile);
  // One-time: move the quick bar onto its dedicated concise prompt (was "default").
  if (!s.settings.quick.promptModeMigrated) {
    if (!s.settings.quick.promptMode || s.settings.quick.promptMode === "default") s.settings.quick.promptMode = "concise";
    s.settings.quick.promptModeMigrated = true;
  }

  // One-time: flip the old amethyst default crystal to the neutral 白水晶 (matches the monochrome UI).
  // Guarded so a later deliberate amethyst pick still sticks.
  if (!s.settings.accentDefaultedClear) {
    if (s.settings.appearance.accent === "amethyst") s.settings.appearance.accent = "clear";
    if (s.settings.appearance.accentCustom === "#bd9cff") s.settings.appearance.accentCustom = "#d6d6d6";
    s.settings.accentDefaultedClear = true;
  }

  if (!hadModels) s.settings.models = [];
  [s.settings.defaults.chat, s.settings.defaults.title].forEach(r => {
    if (r && r.provider && r.model && !s.settings.models.some(m => m.provider === r.provider && m.model === r.model))
      s.settings.models.push({ provider: r.provider, model: r.model });
  });

  // One-time: bump the legacy 0.7 default temperature up to 1
  if (!hadTempBumped && s.settings.defaults.temp === 0.7) s.settings.defaults.temp = 1;
  s.settings.tempBumped = true;

  // One-time: re-point existing installs onto the new global-shortcut defaults (quick = Alt+Space,
  // open-main = ⌘⇧L / Alt+Shift+L) — but only when still on a prior default, never overriding a custom binding.
  if (!s.settings.shortcutsBumpedV2) {
    const q = s.settings.quick;
    const OLD_QUICK = ["Alt+Space", "Ctrl+Shift+Space"];      // prior mac / win quick-ask defaults
    const OLD_OPEN = ["Alt+Cmd+Space", "Ctrl+Alt+Space"];     // prior mac / win open-main defaults
    if (!q.shortcut || OLD_QUICK.includes(q.shortcut)) q.shortcut = defaultQuick();
    if (!q.openMainShortcut || OLD_OPEN.includes(q.openMainShortcut)) q.openMainShortcut = defaultOpenMain();
    s.settings.shortcutsBumpedV2 = true;
  }

  // One-time: switch existing installs to follow the system appearance (default 跟随系统).
  // Guarded so any later manual 浅色/深色 choice still sticks.
  if (!hadThemeDefaulted) s.settings.appearance.theme = "auto";
  s.settings.themeAutoDefaulted = true;

  // Migrate the legacy single system prompt into the prompt library
  if (!hadPrompts) {
    s.settings.prompts = [];
    if (legacySystem.trim()) {
      const id = uid();
      s.settings.prompts.push({ id: id, name: "默认", text: legacySystem });
      if (s.settings.defaults.promptId == null) s.settings.defaults.promptId = id;
    }
  }
  if (s.settings.defaults.promptId === undefined) s.settings.defaults.promptId = null;

  // One-time: make the built-in expert prompt available (and the default if the user had none).
  if (!s.settings.expertPromptSeeded) {
    if (!s.settings.prompts.some(p => p.id === "expert-default")) s.settings.prompts.unshift({ id: "expert-default", name: "默认", text: EXPERT_PROMPT });
    if (!s.settings.defaults.promptId) s.settings.defaults.promptId = "expert-default";
    s.settings.expertPromptSeeded = true;
  }

  // One-time: introduce the friendlier "日常" prompt as the new default; demote the old expert prompt to "深度".
  if (!s.settings.dailyPromptSeeded) {
    if (!s.settings.prompts.some(p => p.id === "daily-default"))
      s.settings.prompts.unshift({ id: "daily-default", name: "日常", text: DAILY_PROMPT });
    // rename the built-in expert prompt to 深度 (only if the user kept its original 默认 name)
    const ex = s.settings.prompts.find(p => p.id === "expert-default");
    if (ex && ex.name === "默认") ex.name = "深度";
    // switch the default to 日常 — only if the user is still on the built-in expert prompt (respect any custom choice)
    if (s.settings.defaults.promptId === "expert-default") s.settings.defaults.promptId = "daily-default";
    s.settings.dailyPromptSeeded = true;
  }

  // One-time: upgrade the 日常 prompt to the depth-aware V2 (only if the user hasn't edited it).
  if (!s.settings.dailyPromptV2) {
    const dp = s.settings.prompts.find(p => p.id === "daily-default");
    if (dp && dp.text === DAILY_PROMPT_V1) dp.text = DAILY_PROMPT;
    s.settings.dailyPromptV2 = true;
  }

  // One-time: move the default code palette to the new 多彩 (vivid) theme unless the user picked one.
  if (!s.settings.codeThemeVivid) {
    if (!s.settings.appearance.codeTheme || s.settings.appearance.codeTheme === "muted") s.settings.appearance.codeTheme = "vivid";
    s.settings.codeThemeVivid = true;
  }

  s.stats = s.stats || {};
  if (!s.stats.daily || typeof s.stats.daily !== "object") s.stats.daily = {};
  if (!s.stats.dailyCost || typeof s.stats.dailyCost !== "object") s.stats.dailyCost = {};
  s.conversations = (s.conversations || []).map(c => shapeConv(c, s));
  s.archived = (s.archived || []).map(c => shapeConv(c, s));
  return s;
}

// Normalize a stored conversation to the current shape (fill defaults, flatten any legacy branch tree).
function shapeConv(c, s) {
  return flattenConv({
    id: c.id, title: c.title || "新对话", titled: c.titled !== false,
    model: c.model || clone(s.settings.defaults.chat),
    promptId: c.promptId !== undefined ? c.promptId : (s.settings.defaults.promptId || null),
    compaction: c.compaction || null,
    webSearch: !!c.webSearch,
    reasoning: !!c.reasoning,
    reasoningEffort: c.reasoningEffort || "medium",
    pinned: !!c.pinned,
    createdAt: c.createdAt, updatedAt: c.updatedAt,
    messages: c.messages || [],
    turns: c.turns, roots: c.roots, current: c.current,
    archivedAt: c.archivedAt,
  });
}

// One-time un-migration from the short-lived branching build: flatten the active branch
// (root→current) back into a linear messages[], preserving per-turn names, then drop tree fields.
function flattenConv(conv) {
  if (conv.turns && typeof conv.turns === "object" && !Array.isArray(conv.turns) && Array.isArray(conv.roots)) {
    const path = []; const seen = new Set(); let id = conv.current;
    while (id != null && conv.turns[id] && !seen.has(id)) { seen.add(id); path.unshift(conv.turns[id]); id = conv.turns[id].parent; }
    if (!path.length && conv.roots.length) { // current invalid → follow the last root down
      let t = conv.turns[conv.roots[conv.roots.length - 1]]; const s2 = new Set();
      while (t && !s2.has(t.id)) { s2.add(t.id); path.push(t); t = (t.children && t.children.length) ? conv.turns[t.children[t.children.length - 1]] : null; }
    }
    if (path.length || !Array.isArray(conv.messages)) {
      const msgs = [];
      path.forEach(t => {
        const um = { role: "user", content: (t.user && t.user.content) || "", attachments: (t.user && t.user.attachments) || [] };
        if (t.nodeTitle) um.nodeTitle = t.nodeTitle;
        msgs.push(um);
        if (t.assistant && (t.assistant.content || t.assistant.reasoning)) {
          const am = { role: "assistant", content: t.assistant.content || "" };
          if (t.assistant.reasoning) am.reasoning = t.assistant.reasoning;
          if (t.assistant.usage) am.usage = t.assistant.usage;
          msgs.push(am);
        }
      });
      conv.messages = msgs;
    }
  }
  delete conv.turns; delete conv.roots; delete conv.current;
  if (!Array.isArray(conv.messages)) conv.messages = [];
  return conv;
}

function migrate(old) {
  const ns = freshState();
  const m = old.settings.model || "anthropic/claude-sonnet-4.6";
  ns.settings.providers.openrouter.key = old.settings.apiKey || "";
  ns.settings.defaults.chat = { provider: "openrouter", model: m };
  ns.settings.defaults.title = { provider: "openrouter", model: m };
  const sys = old.settings.system || "";
  if (sys.trim()) { const pid = uid(); ns.settings.prompts.push({ id: pid, name: "默认", text: sys }); ns.settings.defaults.promptId = pid; }
  const ot = old.settings.temp;
  ns.settings.defaults.temp = (ot == null || ot === 0.7) ? 1 : ot;
  ns.settings.defaults.maxTokens = old.settings.maxTokens != null ? old.settings.maxTokens : null;
  ns.settings.appearance.theme = old.settings.theme || "auto";
  ns.settings.models = [{ provider: "openrouter", model: m }];
  ns.conversations = (old.conversations || []).map(c => ({
    id: c.id, title: c.title || "新对话", titled: true,
    model: { provider: "openrouter", model: m }, promptId: ns.settings.defaults.promptId || null, messages: c.messages || [],
  }));
  ns.currentId = old.currentId || (ns.conversations[0] && ns.conversations[0].id) || null;
  return ns;
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
  for (const pk of PROVIDER_ORDER) providers[pk] = { key: (set.providers[pk] && set.providers[pk].key) || "" };
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
function fmtTok(n) { return n >= 1000 ? ((n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k") : String(n); }
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
    cb.dataset.tip = "压缩前文（AI 总结较早对话，省上下文）" + (n ? " · 当前上下文约 " + fmtTok(n) + " tokens" : "");
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

/* system-prompt library helpers */
function promptById(id) { return state.settings.prompts.find(p => p.id === id) || null; }
function activePromptId() { const c = currentConv(); return c ? (c.promptId || null) : nextPromptId; }
function activePromptText(conv) { const id = conv ? (conv.promptId || null) : nextPromptId; const p = promptById(id); return p ? (p.text || "") : ""; }

/* ===================== Helpers ===================== */
function setupMarked() {
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
        if (/^\s|\s$/.test(b)) return;            // no leading/trailing space (avoids "$ x $" and multi-word currency like "$4 and $")
        if (/\d/.test(src.charAt(m[0].length))) return; // next char is a digit → "$5...$10" currency (but "$4$" / "$1$" closed pairs DO render as math)
        return { type: "inlineMath", raw: m[0], text: b, display: false };
      }
    },
    renderer(t) { return renderMath(t.text, !!t.display); },
  };
  marked.use({ extensions: [blockMath, inlineMath] });
}

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

// CommonMark emphasis won't fire when a ** / * delimiter sits flush against CJK punctuation with a CJK
// letter on the other side (Chinese uses no spaces), so "**加粗（注）**的" renders literally. Slip a
// zero-width space between the delimiter and the punctuation to restore "flanking"; it is stripped back
// out of the final HTML so copied text stays clean. Code spans/blocks are left untouched.
const CJK_LETTER = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\u3005\\u3007";
const CJK_PUNCT = "()\\[\\]{}<>\"'`!?.,:;~|@#%^&=+/\\\\\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2026\\u3000-\\u303F\\uFF00-\\uFFEF";
const EM_OPEN_RE = new RegExp("([" + CJK_LETTER + "])([*_]+)([" + CJK_PUNCT + "])", "g");
const EM_CLOSE_RE = new RegExp("([" + CJK_PUNCT + "])([*_]+)([" + CJK_LETTER + "])", "g");
// LLMs sometimes emit "** 文字**" / "** 文字 **" — a space hugging the inside of the ** stops CommonMark
// from forming strong emphasis, so it renders literally. Trim those inner spaces, but only for a PAIRED
// ** run on one line (so "2 ** 3" with no closer, or a code span, is left alone). Lenient like ChatGPT.
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

function renderMarkdown(text) {
  let html;
  if (window.marked) { try { html = marked.parse(fixCjkEmphasis(text), { breaks: true, gfm: true }); } catch (e) {} }
  if (html == null) {
    const div = document.createElement("div"); div.textContent = text;
    html = "<p>" + div.innerHTML.replace(/\n/g, "<br>") + "</p>";
  }
  return sanitizeHtml(html.replace(/​/g, ""));   // drop the helper zero-width spaces
}
// Strip any executable/exfiltration vectors from rendered HTML (defence-in-depth with the CSP).
// Keeps KaTeX (HTML + MathML + SVG), code, tables, links, images.
function sanitizeHtml(html) {
  if (!window.DOMPurify) return html;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style", "form"],
    ALLOW_DATA_ATTR: false,
  });
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
function fmtTok(n) { return (n || 0).toLocaleString("en-US"); }
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

/* ===================== Rendering ===================== */
let searchQuery = "";
let searchHits = [];        // <mark> elements for the current search, in document order
let searchHitIndex = -1;    // which hit is the active (focused) one
let lastConvSeen = null;   // for the fade-in-on-conversation-switch animation
// One consistent monochrome SVG icon set (stroke = currentColor). ic(name,size) -> svg string.
const ICON_PATHS = {
  pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.7 10.2 18 9 18 8a6 6 0 0 0-12 0c0 1 .3 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  compress: '<polyline points="8 7 12 11 16 7"/><polyline points="8 17 12 13 16 17"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  send: '<path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.7 9.7 0 0 0-6.7 2.7L3 8"/><path d="M3 3v5h5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.06 6.06C3.5 7.66 2 11 2 11s3.5 7 10 7a9.7 9.7 0 0 0 5.94-1.94"/><path d="m2 2 20 20"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  cube: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  sliders: '<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  command: '<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
  fork: '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/>',
};
function ic(name, size) { size = size || 16; return '<svg class="ic" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATHS[name] || "") + '</svg>'; }
const PIN_SVG = ic("pin", 13);
// match a conversation against the search query (title, message text, per-turn node names)
function convMatches(c, q) {
  if (!q) return true;
  if ((c.title || "").toLowerCase().includes(q)) return true;
  return (c.messages || []).some(m =>
    (typeof m.content === "string" && m.content.toLowerCase().includes(q)) ||
    (m.nodeTitle && m.nodeTitle.toLowerCase().includes(q)));
}
function togglePin(c) { c.pinned = !c.pinned; save(); renderSidebar(); }
function clearConvSearch() { searchQuery = ""; const s = document.getElementById("conv-search"); if (s) s.value = ""; }
// ⌘F / Ctrl+F → jump to the conversation search box (expand the sidebar if collapsed), select its text
function focusSearch() {
  if (state.settings.sidebar.collapsed) { state.settings.sidebar.collapsed = false; applySidebar(); save(); }
  const s = document.getElementById("conv-search");
  if (s) { s.focus(); s.select(); }
}
// ---- conversation timestamps + relative-time grouping ----
// best-effort time for a conversation: explicit updatedAt/createdAt, else decode from the id
// (uid() = Date.now().toString(36) + 5 random chars), else 0 (→ "更早").
function convTime(c) {
  if (c.updatedAt) return c.updatedAt;
  if (c.createdAt) return c.createdAt;
  if (typeof c.id === "string" && c.id.length > 5) {
    const t = parseInt(c.id.slice(0, c.id.length - 5), 36);
    if (t > 1262304000000 && t < Date.now() + 86400000) return t;   // 2010-01-01 .. now+1d
  }
  return 0;
}
// 创建时间（不看 updatedAt）：createdAt，否则从 id 解码，否则 0。
function convCreatedTime(c) {
  if (c.createdAt) return c.createdAt;
  if (typeof c.id === "string" && c.id.length > 5) {
    const t = parseInt(c.id.slice(0, c.id.length - 5), 36);
    if (t > 1262304000000 && t < Date.now() + 86400000) return t;
  }
  return 0;
}
// 列表排序 / 分组所用的时间：默认按修改时间（含 updatedAt），设置为「添加时间」时按创建时间。
function convSortTime(c) {
  return (state.settings.general && state.settings.general.sidebarSort === "created") ? convCreatedTime(c) : convTime(c);
}
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function bucketOf(ts) {
  if (!ts) return "更早";
  const today = startOfDay(Date.now()), day = 86400000;
  if (ts >= today) return "今天";
  if (ts >= today - day) return "昨天";
  if (ts >= today - 7 * day) return "近7天";
  if (ts >= today - 30 * day) return "近30天";
  return "更早";
}
function relTime(ts) {
  if (!ts) return "";
  const today = startOfDay(Date.now()), day = 86400000, diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return min + "分钟前";
  if (startOfDay(ts) === today) return Math.floor(min / 60) + "小时前";
  if (ts >= today - day) return "昨天";
  const d = new Date(ts);
  if (ts >= today - 6 * day) return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  if (d.getFullYear() === new Date().getFullYear()) return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
}
function buildConvEl(c) {
  const el = document.createElement("div");
  el.className = "conv" + (c.id === state.currentId ? " active" : "") + (c.pinned ? " pinned" : "");
  el.tabIndex = 0; el.setAttribute("role", "option"); el.setAttribute("aria-selected", c.id === state.currentId ? "true" : "false");
  el.innerHTML =
    '<div class="conv-row"><span class="title"></span>' +
    '<span class="conv-actions">' +
    '<button class="pin" title="' + (c.pinned ? "取消置顶" : "置顶") + '" aria-label="' + (c.pinned ? "取消置顶" : "置顶") + '">' + PIN_SVG + '</button>' +
    '<button class="del" title="删除（移入已归档）" aria-label="删除（移入已归档）">' + ic("x", 15) + '</button>' +
    '</span></div>';
  const titleEl = el.querySelector(".title");
  titleEl.textContent = c.title || "新对话";
  titleEl.title = c.title || "新对话";   // AI 标题常超宽被截断——悬停看全名（与归档项一致）
  el.onclick = () => { state.currentId = c.id; editingIndex = null; autoScroll = true; nodePinned = null; save(); renderAll(); };
  // keyboard: Enter/Space opens, ↑/↓ move focus to the prev/next conversation row (skipping group headers)
  el.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.onclick(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      let sib = el;
      do { sib = (e.key === "ArrowDown") ? sib.nextElementSibling : sib.previousElementSibling; } while (sib && !sib.classList.contains("conv"));
      if (sib) sib.focus();
    }
  };
  el.querySelector(".pin").onclick = (e) => { e.stopPropagation(); togglePin(c); };
  el.querySelector(".del").onclick = (e) => {
    e.stopPropagation();
    const nm = c.title || "新对话";
    archiveConversation(c);
    toast("已删除「" + nm + "」", { label: "撤销", fn: () => restoreConversation(c.id) });
  };
  el.oncontextmenu = (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, convMenuItems(c)); };
  return el;
}
// Soft opacity fade at the bottom of the conversation list (replaces the hard divider above
// the archive/footer). Only shown when the list actually has more content scrolled below.
let _convFadeBound = false;
function updateConvListFade() {
  const el = document.getElementById("conv-list");
  if (!el) return;
  if (!_convFadeBound) { el.addEventListener("scroll", updateConvListFade); _convFadeBound = true; }
  const more = el.scrollHeight - el.clientHeight - el.scrollTop > 1;
  el.classList.toggle("fade-bottom", more);
}
function renderSidebar() {
  const list = document.getElementById("conv-list");
  list.innerHTML = "";
  const q = searchQuery.toLowerCase();
  const matched = state.conversations.filter(c => convMatches(c, q));
  const addHeader = (txt) => { const h = document.createElement("div"); h.className = "conv-group"; h.textContent = txt; list.appendChild(h); };
  // when searching, show a flat list (grouping headers would be noise) in the conversations'
  // natural (stable) order — clicking a result must NOT reorder the list. The open conversation
  // always stays in the list (even with no match) so search covers BOTH "find in this chat"
  // (highlighted on the right) and "find across chats" (the other results).
  if (q) {
    const cid = state.currentId;
    const ordered = state.conversations.filter(c => convMatches(c, q) || c.id === cid);
    if (!ordered.length) {
      const e = document.createElement("div"); e.className = "conv-empty";
      e.append(document.createTextNode("没有匹配的对话"), document.createElement("br"));
      const btn = document.createElement("button"); btn.className = "conv-empty-clear"; btn.textContent = "清除搜索";
      btn.onclick = () => { clearConvSearch(); renderSidebar(); clearSearchHighlight(); applySearchHighlight(); const si = document.getElementById("conv-search"); if (si) si.focus(); };
      e.appendChild(btn); list.appendChild(e);
    } else ordered.forEach(c => list.appendChild(buildConvEl(c)));
    requestAnimationFrame(updateConvListFade); return;
  }
  if (!matched.length) {
    const e = document.createElement("div"); e.className = "conv-empty";
    e.textContent = "还没有对话";
    list.appendChild(e); requestAnimationFrame(updateConvListFade); return;
  }
  // the blank "新对话" always stays pinned to the very top (above pinned + recency groups),
  // so continuing an old chat or a QuickBar hand-off never bumps above it
  const blank = matched.find(c => !c.messages || c.messages.length === 0);
  if (blank) list.appendChild(buildConvEl(blank));
  const pool = blank ? matched.filter(c => c !== blank) : matched;
  // pinned next (own group), then the rest grouped by recency
  const pinned = pool.filter(c => c.pinned);
  const rest = pool.filter(c => !c.pinned).sort((a, b) => convSortTime(b) - convSortTime(a));
  if (pinned.length) { addHeader("置顶"); pinned.forEach(c => list.appendChild(buildConvEl(c))); }
  const groups = {};
  rest.forEach(c => { const b = bucketOf(convSortTime(c)); (groups[b] = groups[b] || []).push(c); });
  ["今天", "昨天", "近7天", "近30天", "更早"].forEach(b => {
    if (groups[b] && groups[b].length) { addHeader(b); groups[b].forEach(c => list.appendChild(buildConvEl(c))); }
  });
  requestAnimationFrame(updateConvListFade);
}
// On launch, bring the open conversation ~20% down from the top of the sidebar list — prominent, with a
// little context above it — instead of leaving it wherever the freshly-rendered list happened to sit.
function scrollActiveConvIntoView() {
  const list = document.getElementById("conv-list");
  if (!list) return;
  const active = list.querySelector(".conv.active");
  if (!active) return;
  const offsetWithinContent = (active.getBoundingClientRect().top - list.getBoundingClientRect().top) + list.scrollTop;
  list.scrollTop = Math.max(0, offsetWithinContent - list.clientHeight * 0.2);
}
// 一段短缓动滚动（平滑且快），可被下一次滚动/即时设置打断。
let convScrollRAF = 0;
function animateScrollTop(el, to, dur) {
  if (convScrollRAF) { cancelAnimationFrame(convScrollRAF); convScrollRAF = 0; }
  const from = el.scrollTop, delta = to - from;
  if (Math.abs(delta) < 1) { el.scrollTop = to; return; }
  const start = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - start) / (dur || 340));
    el.scrollTop = from + delta * ease(t);
    convScrollRAF = t < 1 ? requestAnimationFrame(step) : 0;
  };
  convScrollRAF = requestAnimationFrame(step);
}
// 把当前对话滚到列表「距顶 ~20%」处。默认仅当它不在可视区时才滚；force 则总是定位（如启动）；smooth 用缓动。
function revealActiveConv(opts) {
  opts = opts || {};
  const list = document.getElementById("conv-list");
  if (!list) return;
  const active = list.querySelector(".conv.active");
  if (!active) return;
  const lr = list.getBoundingClientRect(), ar = active.getBoundingClientRect();
  const visible = ar.top >= lr.top - 1 && ar.bottom <= lr.bottom + 1;
  if (visible && !opts.force) return;
  const target = Math.max(0, (ar.top - lr.top) + list.scrollTop - list.clientHeight * 0.2);
  if (opts.smooth) animateScrollTop(list, target, 340);
  else { if (convScrollRAF) { cancelAnimationFrame(convScrollRAF); convScrollRAF = 0; } list.scrollTop = target; }
}

/* ===================== Archive (recycle bin for deleted conversations) — managed in 设置 → 数据 ===================== */
function archiveConversation(c) {
  state.conversations = state.conversations.filter(x => x.id !== c.id);
  state.archived = state.archived || [];
  c.archivedAt = Date.now();
  state.archived.unshift(c);
  if (state.currentId === c.id) state.currentId = (state.conversations[0] && state.conversations[0].id) || null;
  save(); renderAll();
}
function restoreConversation(id) {
  const i = (state.archived || []).findIndex(x => x.id === id);
  if (i < 0) return;
  const c = state.archived.splice(i, 1)[0];
  delete c.archivedAt;
  state.conversations.unshift(c);
  state.currentId = c.id; editingIndex = null; autoScroll = true;
  save(); renderAll();
}
async function deleteArchived(id) {
  const c = (state.archived || []).find(x => x.id === id);
  if (!c) return;
  const ok = await confirmDialog({
    title: "彻底删除对话",
    body: "「" + (c.title || "新对话") + "」将被永久删除，无法恢复。",
    okText: "彻底删除", danger: true,
  });
  if (!ok) return;
  state.archived = state.archived.filter(x => x.id !== id);
  save(); renderArchiveSettings();
}
async function clearAllArchived() {
  const arr = state.archived || [];
  if (!arr.length) return;
  const ok = await confirmDialog({
    title: "清空已归档",
    body: "将永久删除全部 " + arr.length + " 个已归档对话，无法恢复。",
    okText: "全部删除", danger: true,
  });
  if (!ok) return;
  const backup = state.archived.slice();   // 即便确认了，也留个短时撤销缓冲（这是最危险的批量清空）
  state.archived = [];
  save(); renderArchiveSettings();
  toast("已清空 " + backup.length + " 个已归档对话", { label: "撤销", fn: () => { state.archived = backup.concat(state.archived || []); save(); renderArchiveSettings(); } });
}
// The archived list now lives in 设置 → 数据 (always-expanded). The sidebar no longer hosts it.
function renderArchiveSettings() {
  const box = document.getElementById("data-archive");
  if (!box) return;
  box.innerHTML = "";
  const arr = state.archived || [];
  if (!arr.length) { box.innerHTML = '<div class="arch-empty">没有已归档的对话。删除对话时会先移到这里（软删除），可随时恢复。</div>'; return; }
  const head = document.createElement("div"); head.className = "arch-head";
  head.innerHTML = '<span class="arch-head-label"></span>' +
    '<button class="arch-clear" title="清空全部已归档">' + ic("trash", 13) + '<span>全部删除</span></button>';
  head.querySelector(".arch-head-label").textContent = "共 " + arr.length + " 项";
  head.querySelector(".arch-clear").onclick = (e) => { e.stopPropagation(); clearAllArchived(); };
  box.appendChild(head);
  arr.forEach(c => {
    const el = document.createElement("div"); el.className = "arch-item";
    el.innerHTML = '<span class="title"></span>' +
      '<span class="arch-actions"><button class="rest" title="恢复到对话列表">' + ic("undo", 14) + '</button>' +
      '<button class="purge" title="彻底删除">' + ic("x", 14) + '</button></span>';
    el.querySelector(".title").textContent = c.title || "新对话";
    el.title = "点击恢复：" + (c.title || "新对话");
    el.onclick = () => restoreConversation(c.id);
    el.querySelector(".rest").onclick = (e) => { e.stopPropagation(); restoreConversation(c.id); };
    el.querySelector(".purge").onclick = (e) => { e.stopPropagation(); deleteArchived(c.id); };
    box.appendChild(el);
  });
}

/* ===================== Profile (name + avatar) & home greeting ===================== */
// The faceted brand crystal as standalone markup (graded opacities, currentColor) — used as the home logo
// when no profile is set, and as a small badge on the avatar when one is.
const EMPTY_CRYSTAL_POLYS =
    '<polygon points="7,8.5 10.2,8.5 10.2,15.5 7,15.5" fill="currentColor" opacity=".72"/>'
  + '<polygon points="10.2,8.5 13.8,8.5 13.8,15.5 10.2,15.5" fill="currentColor" opacity=".82"/>'
  + '<polygon points="13.8,8.5 17,8.5 17,15.5 13.8,15.5" fill="currentColor" opacity=".46"/>'
  + '<polygon points="12,3 7,8.5 10.2,8.5" fill="currentColor" opacity=".86"/>'
  + '<polygon points="12,3 10.2,8.5 13.8,8.5" fill="currentColor" opacity=".96"/>'
  + '<polygon points="12,3 13.8,8.5 17,8.5" fill="currentColor" opacity=".56"/>'
  + '<polygon points="12,21 7,15.5 10.2,15.5" fill="currentColor" opacity=".62"/>'
  + '<polygon points="12,21 10.2,15.5 13.8,15.5" fill="currentColor" opacity=".5"/>'
  + '<polygon points="12,21 13.8,15.5 17,15.5" fill="currentColor" opacity=".36"/>';
function crystalSvg(size) { return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" class="empty-crystal" aria-hidden="true">' + EMPTY_CRYSTAL_POLYS + '</svg>'; }
function greetingFor(d) {
  const h = d.getHours();
  if (h >= 5 && h < 11) return "早上好";
  if (h >= 11 && h < 13) return "中午好";
  if (h >= 13 && h < 18) return "下午好";
  if (h >= 18 && h < 23) return "晚上好";
  return "夜深了";
}
// Initials for the no-photo avatar: two latin words → their initials; a single token → its first char (CJK) or letter.
function profileInitials() {
  const n = ((state.settings.profile && state.settings.profile.name) || "").trim();
  if (!n) return "";
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const t = parts[0];
  return /[㐀-鿿぀-ヿ가-힯]/.test(t) ? t.slice(0, 1) : t.slice(0, 1).toUpperCase();   // CJK/kana/hangul → first char; latin → first letter
}
// Home greeting + avatar: photo > initials (both carry a small crystal badge) > the plain crystal logo.
function renderEmptyGreeting() {
  const g = document.getElementById("empty-greeting");
  const av = document.getElementById("empty-avatar");
  const cta = document.getElementById("empty-name-cta");
  if (!g || !av) return;
  const name = ((state.settings.profile && state.settings.profile.name) || "").trim();
  const greet = greetingFor(new Date());
  g.textContent = name ? (greet + "，" + name) : greet;
  av.className = "logo-only"; av.innerHTML = crystalSvg(70);   // 主页只展示 Quartz 水晶 + 问候行（头像放在侧栏/设置）
  if (cta) cta.hidden = !!name;   // 没设名字 → 提示「给自己起个名字」
}
// Sidebar footer profile: avatar + name (left), opens settings. Shows even with nothing set (a "设置名字" prompt).
function renderSidebarProfile() {
  const btn = document.getElementById("sidebar-profile");
  if (!btn) return;
  const av = btn.querySelector(".sp-avatar"), nm = btn.querySelector(".sp-name");
  if (!av || !nm) return;
  const p = state.settings.profile || {};
  const name = (p.name || "").trim();
  av.innerHTML = ""; av.classList.remove("is-empty");
  if (p.avatar) { const img = document.createElement("img"); img.src = p.avatar; img.alt = ""; av.appendChild(img); }
  else if (name) { const s = document.createElement("span"); s.className = "av-ini"; s.textContent = profileInitials(); av.appendChild(s); }
  else { av.classList.add("is-empty"); av.innerHTML = ic("user", 15); }
  nm.textContent = name || "设置名字";
  nm.classList.toggle("muted", !name);
  btn.title = name ? ("个人资料：" + name) : "设置名字和头像";
}
// Settings avatar editor preview: photo > initials > an "upload" affordance.
function renderProfileSettings() {
  const btn = document.getElementById("set-avatar-btn");
  const rm = document.getElementById("set-avatar-remove");
  if (!btn) return;
  const p = state.settings.profile || {};
  btn.innerHTML = "";
  if (p.avatar) { const img = document.createElement("img"); img.src = p.avatar; img.alt = ""; btn.appendChild(img); }
  else { const ini = profileInitials(); if (ini) { const s = document.createElement("span"); s.className = "av-ini"; s.textContent = ini; btn.appendChild(s); } else btn.innerHTML = ic("edit", 16); }
  if (rm) rm.hidden = !p.avatar;
}
async function setAvatarFromFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("请选择图片文件"); return; }
  try {
    state.settings.profile.avatar = await downscaleImage(file, 256, 0.85);   // 头像无需大图，降采样到 256
    save(); renderProfileSettings(); renderEmptyGreeting(); renderSidebarProfile();
  } catch (e) { toast("读取头像失败"); }
}

/* ===================== 统计页：token 用量图 + AI 小结报告 ===================== */
let statsRange = "1m";   // 1m（默认）| 1y — 都用 GitHub 式格点图，只是范围不同
const DAY_MS = 86400000;
function renderStats() { renderStatsGraph(); renderStatsTiles(); renderStatsReport(); }
// Summary tiles beside the heatmap: today / last-30-days / this-week-vs-last / daily average.
function renderStatsTiles() {
  const box = document.getElementById("stats-tiles"); if (!box) return;
  const daily = (state.stats && state.stats.daily) || {}, dcost = (state.stats && state.stats.dailyCost) || {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tokAt = (d) => daily[dayKey(d)] || 0, costAt = (d) => dcost[dayKey(d)] || 0;
  const todayTok = tokAt(today), todayCost = costAt(today);
  let m30t = 0, m30c = 0, activeDays = 0;
  for (let i = 0; i < 30; i++) { const d = new Date(today.getTime() - i * DAY_MS); const t = tokAt(d); if (t > 0) { m30t += t; activeDays++; } m30c += costAt(d); }
  let w0 = 0, w1 = 0;
  for (let i = 0; i < 7; i++) w0 += tokAt(new Date(today.getTime() - i * DAY_MS));
  for (let i = 7; i < 14; i++) w1 += tokAt(new Date(today.getTime() - i * DAY_MS));
  const avg = activeDays ? Math.round(m30t / activeDays) : 0;
  let weekSub;
  if (w1 <= 0) weekSub = w0 > 0 ? "上周无记录" : "—";
  else { const d = Math.round((w0 - w1) / w1 * 100); weekSub = (d >= 0 ? "↑ " : "↓ ") + Math.abs(d) + "% 对比上周"; }
  const tiles = [
    { label: "今日", value: fmtTok(todayTok), unit: "tok", sub: todayCost > 0 ? fmtCost(todayCost) : "" },
    { label: "近 30 天", value: fmtTok(m30t), unit: "tok", sub: m30c > 0 ? fmtCost(m30c) : (activeDays + " 天活跃") },
    { label: "本周", value: fmtTok(w0), unit: "tok", sub: weekSub },
    { label: "活跃日均", value: fmtTok(avg), unit: "tok", sub: m30c > 0 && activeDays ? (fmtCost(m30c / activeDays) + "/天") : "" },
  ];
  box.innerHTML = "";
  tiles.forEach(t => {
    const el = document.createElement("div"); el.className = "stat-tile";
    const lab = document.createElement("div"); lab.className = "st-label"; lab.textContent = t.label;
    const val = document.createElement("div"); val.className = "st-value"; val.textContent = t.value;
    const u = document.createElement("span"); u.className = "st-unit"; u.textContent = " " + t.unit; val.appendChild(u);
    el.append(lab, val);
    if (t.sub) { const sub = document.createElement("div"); sub.className = "st-sub"; sub.textContent = t.sub; el.appendChild(sub); }
    box.appendChild(el);
  });
}
function renderStatsGraph() {
  const box = document.getElementById("stats-graph"); if (!box) return;
  setSeg("stats-range-seg", statsRange);
  renderHeatmap(box, statsRange === "1y" ? 52 : 4);   // 1 年 ≈ 53 列；1 个月 ≈ 5 列（格子更大）
}
// Heatmap (green) of daily total tokens, ANCHORED TO TODAY: top-right cell = today, going down = older
// (today, -1 … -6 down the rightmost column), columns to the left are older 7-day blocks. Every column is a
// full 7 days, so there's never a half-filled "protruding" current week (unlike a Sun–Sat calendar grid).
function renderHeatmap(box, weeksBack) {
  const isMonth = weeksBack < 52;
  box.className = "stats-graph" + (isMonth ? " hm-month" : "");
  box.innerHTML = "";
  const daily = (state.stats && state.stats.daily) || {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const N = weeksBack + 1;                                    // columns; rightmost = the 7 most recent days
  const dayBack = (offset) => new Date(today.getTime() - offset * DAY_MS);
  let max = 0;
  for (let i = 0; i < N * 7; i++) { const v = daily[dayKey(dayBack(i))] || 0; if (v > max) max = v; }
  const level = (v) => { if (!v) return 0; if (max <= 0) return 1; const r = v / max; return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1; };
  const MON = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const months = document.createElement("div"); months.className = "cg-months"; months.style.gridTemplateColumns = "repeat(" + N + ", var(--cg-cell))";
  let lastMonth = -1;
  for (let c = 0; c < N; c++) {                              // label each column by the month of its TOP (newest) cell
    const m = dayBack((N - 1 - c) * 7).getMonth();
    if (m !== lastMonth) { const s = document.createElement("span"); s.textContent = MON[m]; s.style.gridColumnStart = c + 1; months.appendChild(s); lastMonth = m; }
  }
  const grid = document.createElement("div"); grid.className = "cg-grid"; grid.style.gridTemplateColumns = "repeat(" + N + ", var(--cg-cell))";
  let total = 0, activeDays = 0;
  for (let c = 0; c < N; c++) {                              // column-major (matches grid-auto-flow:column); rightmost col, top row = today
    for (let r = 0; r < 7; r++) {
      const d = dayBack((N - 1 - c) * 7 + r);
      const v = daily[dayKey(d)] || 0;
      if (v > 0) { total += v; activeDays++; }
      const cell = document.createElement("div"); cell.className = "cg-cell lv" + level(v);
      cell.title = dayKey(d) + "：" + (v ? fmtTok(v) + " tokens" : "无");
      grid.appendChild(cell);
    }
  }
  box.appendChild(months); box.appendChild(grid);
  appendStatsFooter(box, (isMonth ? "最近一个月" : "最近一年") + "共 " + fmtTok(total) + " tokens · " + activeDays + " 天有使用", true);
}
function appendStatsFooter(box, summaryText, withLegend) {
  const sum = document.createElement("div"); sum.className = "cg-summary"; sum.textContent = summaryText;
  box.appendChild(sum);
  if (withLegend) {
    const legend = document.createElement("div"); legend.className = "cg-legend";
    legend.innerHTML = '<span class="cg-leg-t">少</span><span class="cg-cell lv0"></span><span class="cg-cell lv1"></span><span class="cg-cell lv2"></span><span class="cg-cell lv3"></span><span class="cg-cell lv4"></span><span class="cg-leg-t">多</span>';
    box.appendChild(legend);
  }
}
function renderStatsReport() {
  const out = document.getElementById("stats-report");
  const meta = document.getElementById("stats-report-meta");
  const btn = document.getElementById("stats-report-gen");
  const r = state.stats && state.stats.report;
  if (out) { out.innerHTML = (r && r.text) ? renderMarkdown(r.text) : ""; out.style.display = (r && r.text) ? "" : "none"; }
  if (meta) meta.textContent = (r && r.generatedAt) ? ("生成于 " + relTime(r.generatedAt) + " · 基于 " + (r.count || 0) + " 个对话标题") : "";
  if (btn && !btn.disabled) btn.textContent = (r && r.text) ? "重新生成" : "生成小结";
}
async function generateStatsReport() {
  const ref = state.settings.defaults.chat || nextModel;
  if (!ref || !ref.model) { openSettings("services"); toast("请先添加一个模型"); return; }
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置该模型的 API Key"); return; }
  const all = (state.conversations || []).concat(state.archived || []).filter(c => c.messages && c.messages.length);
  const titles = all.map(c => ({ t: (c.title || "").trim(), ts: convTime(c) }))
    .filter(x => x.t && x.t !== "新对话").sort((a, b) => b.ts - a.ts).map(x => x.t);
  if (!titles.length) { toast("还没有可分析的对话"); return; }
  const list = titles.slice(0, 250).join("\n").slice(0, 4000);
  const sys = "你是一个善于洞察的分析助手。下面是某人在 AI 对话工具里产生的一系列对话标题（按时间从新到旧）。请据此写一份简短、真诚、有洞察的「使用小结」：他最近在关注或推进哪些主题、有哪些兴趣或正在做的项目、使用上有什么特点或倾向。要求：用第二人称「你」、中文、markdown；可先一句总括，再分 3–5 个小点；只基于这些标题归纳，不要罗列标题原文、不要编造没有依据的细节；克制、不浮夸。180–320 字。";
  const btn = document.getElementById("stats-report-gen");
  const out = document.getElementById("stats-report");
  const meta = document.getElementById("stats-report-meta");
  if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
  if (meta) meta.textContent = "";
  if (out) { out.style.display = ""; out.innerHTML = '<span class="dim">正在读你的对话标题、归纳中…</span>'; }
  try {
    let acc = "";
    const r = await streamChat(ref, { system: sys, messages: [{ role: "user", content: "【对话标题】\n" + list }] }, {
      temp: 0.7, maxTokens: 800, reasoning: false,
      onDelta: (t) => { acc = t; if (out) out.innerHTML = renderMarkdown(t); },
    });
    const text = (r.text || acc || "").trim();
    if (!text) { toast("没有生成内容，请重试"); if (out) { out.innerHTML = ""; out.style.display = "none"; } }
    else { state.stats = state.stats || { daily: {} }; state.stats.report = { text, generatedAt: Date.now(), count: titles.length }; save(); }
  } catch (e) { toast("生成失败：" + (e.message || e)); }
  finally { if (btn) btn.disabled = false; renderStatsReport(); }
}

const EMPTY_GUIDES = [
  { icon: "bulb", title: "头脑风暴", desc: "10 个提升专注力的方法", text: "给我 10 个切实可行的提升专注力的方法，并简要说明每条背后的原理。" },
  { icon: "edit", title: "写作润色", desc: "把一段话改得更专业流畅", text: "帮我把下面这段话润色得更专业、更流畅，并保持原意：\n\n" },
  { icon: "chat", title: "解释概念", desc: "用通俗比喻讲清一个难点", text: "用通俗易懂的比喻，向完全的初学者解释什么是 Transformer 神经网络。" },
  { icon: "compress", title: "写代码", desc: "生成带注释的示例脚本", text: "用 Python 写一个读取 CSV、按指定列分组求和并打印结果的脚本，附中文注释。" },
];
function renderEmptyGuide() {
  const wrap = document.getElementById("empty-guide"); if (!wrap) return;
  wrap.innerHTML = "";
  if (!anyKey()) { wrap.style.display = "none"; return; }
  wrap.style.display = "grid";
  EMPTY_GUIDES.forEach(g => {
    const card = document.createElement("button"); card.type = "button"; card.className = "guide-card";
    card.innerHTML = '<div class="gc-title">' + ic(g.icon, 15) + '<span></span></div><div class="gc-desc"></div>';
    card.querySelector(".gc-title span").textContent = g.title;
    card.querySelector(".gc-desc").textContent = g.desc;
    card.onclick = () => {
      const inp = document.getElementById("input");
      inp.value = g.text; inp.focus(); autoGrow();
      inp.setSelectionRange(inp.value.length, inp.value.length);
    };
    wrap.appendChild(card);
  });
}
// Empty-home greeting + hint + example guide; reflects whether any provider has a key (refreshed live when a key is added).
function updateEmptyHint() {
  const h = document.getElementById("empty-hint");
  if (h) { const k = anyKey(); h.textContent = k ? "" : "先到设置里填入任意一个模型提供方的 API Key"; h.style.display = k ? "none" : ""; }   // 有 Key 就不再多那行提示
  renderEmptyGreeting();
  renderEmptyGuide();
}
/* ===================== Export current conversation ===================== */
function escHtml(s) { const d = document.createElement("div"); d.textContent = (s == null ? "" : String(s)); return d.innerHTML; }
function exportFileBase(conv) {
  const t = (conv.title || "对话").replace(/[\/\\:*?"<>|\n\r]+/g, "_").trim().slice(0, 60);
  return t || "对话";
}
function buildExportMarkdown(conv) {
  let md = "# " + (conv.title || "对话") + "\n\n";
  conv.messages.forEach(m => {
    if (m.role !== "user" && m.role !== "assistant") return;
    md += "## " + (m.role === "user" ? "用户" : "助手") + "\n\n";
    md += (m.content || "").trim() + "\n\n";
    (m.attachments || []).forEach(a => { if (a.kind !== "image") md += "> 📎 附件：" + a.name + "\n\n"; });
  });
  return md.trim() + "\n";
}
function buildExportContent(conv) {
  let body = '<h1 class="ex-title">' + escHtml(conv.title || "对话") + "</h1>";
  conv.messages.forEach(m => {
    if (m.role !== "user" && m.role !== "assistant") return;
    let atts = "";
    (m.attachments || []).forEach(a => {
      if (a.kind === "image" && a.dataUrl) atts += '<img class="ex-img" src="' + a.dataUrl + '">';
      else atts += '<div class="ex-file">📎 ' + escHtml(a.name) + "</div>";
    });
    const content = (m.content || "").trim() ? renderMarkdown(m.content) : "";
    body += '<div class="ex-turn ex-' + m.role + '"><div class="ex-who">' + (m.role === "user" ? "用户" : "助手") +
            '</div><div class="ex-bubble">' + atts + content + "</div></div>";
  });
  return { title: conv.title || "对话", bodyHTML: body, markdown: buildExportMarkdown(conv), name: exportFileBase(conv) };
}
function closeExportMenu() {
  const m = document.getElementById("export-menu"); if (m) m.remove();
  document.removeEventListener("mousedown", onDocClickExport, true);
}
function onDocClickExport(e) {
  const m = document.getElementById("export-menu");
  if (m && !m.contains(e.target) && e.target.closest && !e.target.closest("#export-chat")) closeExportMenu();
}
function openExportMenu(anchor) {
  if (document.getElementById("export-menu")) { closeExportMenu(); return; }
  const conv = currentConv();
  if (!conv || !conv.messages.length) { toast("当前没有可导出的对话"); return; }
  const menu = document.createElement("div"); menu.id = "export-menu"; menu.className = "export-menu";
  const items = [
    { label: "复制为 Markdown", fn: () => copyExportMarkdown(conv) },
    { label: "导出 Markdown（.md）", fn: () => doExport(conv, "md") },
    { label: "导出 PDF（.pdf）", fn: () => doExport(conv, "pdf") },
    { label: "导出图片（.png）", fn: () => doExport(conv, "png") },
  ];
  items.forEach(it => {
    const b = document.createElement("button"); b.className = "export-item"; b.textContent = it.label;
    b.onclick = () => { closeExportMenu(); it.fn(); };
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + 6) + "px";
  menu.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
  setTimeout(() => document.addEventListener("mousedown", onDocClickExport, true), 0);
}
function copyExportMarkdown(conv) {
  navigator.clipboard.writeText(buildExportMarkdown(conv))
    .then(() => toast("已复制为 Markdown")).catch(() => toast("复制失败"));
}
async function doExport(conv, format) {
  if (!window.chatbox || !window.chatbox.exportConversation) { toast("导出不可用"); return; }
  const c = buildExportContent(conv);
  toast(format === "md" ? "正在导出 Markdown…" : (format === "pdf" ? "正在生成 PDF…" : "正在生成图片…"));
  try {
    const res = await window.chatbox.exportConversation({ format, title: c.title, bodyHTML: c.bodyHTML, markdown: c.markdown, name: c.name });
    if (res && res.ok) toast("已导出到：" + res.path);
    else if (res && res.canceled) { /* user cancelled the save dialog */ }
    else toast("导出失败：" + ((res && res.error) || "未知错误"));
  } catch (e) { toast("导出失败：" + e.message); }
}

/* ===================== In-conversation search highlight + traversal ===================== */
function highlightInElement(el, lc) {
  const hits = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.toLowerCase().includes(lc)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = []; let n; while (n = walker.nextNode()) nodes.push(n);
  nodes.forEach(node => {
    const text = node.nodeValue, lower = text.toLowerCase();
    const frag = document.createDocumentFragment();
    let last = 0, pos, from = 0;
    while ((pos = lower.indexOf(lc, from)) !== -1) {
      if (pos > last) frag.appendChild(document.createTextNode(text.slice(last, pos)));
      const mark = document.createElement("mark"); mark.className = "search-hit";
      mark.textContent = text.slice(pos, pos + lc.length);
      frag.appendChild(mark); hits.push(mark);
      last = pos + lc.length; from = last;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
  return hits;
}
function clearSearchHighlight() {
  const box = document.getElementById("messages"); if (!box) return;
  box.querySelectorAll("mark.search-hit").forEach(m => { m.replaceWith(document.createTextNode(m.textContent)); });
  box.querySelectorAll(".msg-body > .msg-content").forEach(el => el.normalize());
  searchHits = []; searchHitIndex = -1;
}
function updateFindCount() {
  const c = document.getElementById("find-count");
  if (c) c.textContent = (searchHits.length ? (searchHitIndex + 1) : 0) + "/" + searchHits.length;
  ["find-prev", "find-next"].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = !searchHits.length; });
}
function setActiveHit(i, scroll) {
  if (!searchHits.length) { updateFindCount(); return; }
  searchHits.forEach(h => h.classList.remove("active"));
  searchHitIndex = ((i % searchHits.length) + searchHits.length) % searchHits.length;
  const h = searchHits[searchHitIndex];
  h.classList.add("active");
  if (scroll !== false) {
    const box = document.getElementById("messages");
    const target = box.scrollTop + (h.getBoundingClientRect().top - box.getBoundingClientRect().top) - Math.round(box.clientHeight * 0.35);
    animateScrollTo(box, Math.max(0, target), 260);
  }
  updateFindCount();
}
// Highlight the active search term across the open conversation and reveal the find bar.
function applySearchHighlight() {
  const bar = document.getElementById("find-bar");
  searchHits = []; searchHitIndex = -1;
  const q = (searchQuery || "").trim();
  const conv = currentConv();
  if (!q || !conv || !conv.messages.length) { if (bar) bar.hidden = true; return; }
  const box = document.getElementById("messages");
  if (!box) return;
  const lc = q.toLowerCase();
  box.querySelectorAll(".msg-body > .msg-content").forEach(el => { searchHits = searchHits.concat(highlightInElement(el, lc)); });
  if (bar) bar.hidden = false;
  if (searchHits.length) setActiveHit(0, true);
  else updateFindCount();
}

// Drafts (unsent composer text + attachments) belong to the conversation they were typed in. On every
// switch, stash the outgoing chat's draft and restore the incoming one — so half-written text and pasted
// images never bleed into (or get sent to) the wrong conversation. Kept in memory only, off the saved state.
function syncComposerDraft() {
  const inp = document.getElementById("input");
  if (!inp) return;
  const newId = state.currentId;
  if (newId === composerConvId) return;            // not an actual switch — nothing to do
  if (composerConvId != null) {
    if (inp.value.trim() || pending.length) _drafts.set(composerConvId, { text: inp.value, pending: pending.slice() });
    else _drafts.delete(composerConvId);
  }
  const d = (newId != null) ? _drafts.get(newId) : null;
  pending = d ? d.pending.slice() : [];
  inp.value = d ? d.text : "";
  composerConvId = newId;
  inputUserH = null;   // a manually-dragged input height belongs to the chat it was set in — don't carry it across
  autoGrow(); renderPending(); updateSendButton();
}
// Dim the send button when there's nothing to send (empty input + no attachments), so it no longer looks
// like a dead button. Skipped while it's in ■ "stop" form (a request is in flight).
function updateSendButton() {
  const btn = document.getElementById("send");
  if (!btn || btn.classList.contains("stop")) return;
  const inp = document.getElementById("input");
  const empty = !(inp && inp.value.trim()) && !pending.length;
  btn.classList.toggle("disabled", empty);
}

function renderMessages() {
  syncComposerDraft();   // stash/restore the per-conversation composer draft before (re)rendering
  const conv = currentConv();
  const box = document.getElementById("messages");
  const empty = document.getElementById("empty");
  const titleEl = document.getElementById("conv-title");
  if (!titleEl.isContentEditable) {   // don't clobber the field while the user is editing the title inline
    titleEl.textContent = conv ? (conv.title || "新对话") : "Quartz";
    evalTitleFade();
  }

  renderNodemap();
  updateModelPill();
  updatePromptPill();
  updateComposerToggles();

  const costPill = document.getElementById("cost-pill");
  if (conv) {
    const t = convTotals(conv);
    if (t.has) {
      costPill.style.display = "inline-block";
      const tokStr = fmtTok(t.pt + t.ct) + " tok";
      costPill.textContent = t.cost > 0 ? (fmtCost(t.cost) + " · " + tokStr) : tokStr;
      costPill.title = "本轮对话累计：输入 " + fmtTok(t.pt) + " tok，输出 " + fmtTok(t.ct) + " tok" + (t.cost > 0 ? "，花费 " + fmtCostExact(t.cost) : "（该提供方未返回费用）");
      costPill.dataset.tipDelay = "600";
    } else costPill.style.display = "none";
  } else costPill.style.display = "none";

  if (!conv || conv.messages.length === 0) {
    box.style.display = "none"; empty.style.display = "flex";
    updateEmptyHint();
    const fb = document.getElementById("find-bar"); if (fb) fb.hidden = true;
    return;
  }
  empty.style.display = "none"; box.style.display = "block";
  if (conv.id !== lastConvSeen) { box.classList.remove("switch-in"); void box.offsetWidth; box.classList.add("switch-in"); }
  lastConvSeen = conv.id;
  box.innerHTML = "";
  const boundary = conv.compaction ? Math.min(conv.compaction.count, conv.messages.length) : -1;
  conv.messages.forEach((m, i) => {
    box.appendChild(buildMessage(m, i));
    if (i + 1 === boundary) box.appendChild(compactionMarker(conv));
  });
  enhanceCode(box);
  if (autoScroll) { box.scrollTop = box.scrollHeight; lastSetTop = box.scrollTop; }
  updateScrollBtn();
  updateNodeActive();
  applySearchHighlight();   // highlight + reveal the find bar when a sidebar search is active
}

/* 应用内图片查看器：暗色遮罩 + 滚轮缩放 + 双击复原 + Esc / 点空白关闭（替代旧的 window.open 空白窗口） */
let _lb = null, _lbScale = 1;
function _lbZoom(img, factor) { _lbScale = Math.min(8, Math.max(0.25, _lbScale * factor)); img.style.transform = factor === 1 ? "" : "scale(" + _lbScale.toFixed(3) + ")"; }
function _lbKey(e) {
  if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); closeLightbox(); return; }
  const img = _lb && _lb.querySelector("img"); if (!img) return;
  if (e.key === "+" || e.key === "=") { e.preventDefault(); _lbZoom(img, 1.2); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); _lbZoom(img, 1 / 1.2); }
  else if (e.key === "0") { e.preventDefault(); _lbScale = 1; img.style.transform = ""; }
}
function closeLightbox() {
  if (!_lb) return;
  const el = _lb; _lb = null;
  document.removeEventListener("keydown", _lbKey, true);
  el.classList.remove("show");
  setTimeout(() => el.remove(), 200);
}
function openLightbox(src) {
  closeLightbox();
  _lbScale = 1;
  const ov = document.createElement("div"); ov.id = "lightbox";
  const img = document.createElement("img"); img.src = src;
  ov.appendChild(img);
  const hint = document.createElement("div"); hint.className = "lb-hint"; hint.textContent = "滚轮 / +− 缩放 · 双击或 0 复原 · Esc 关闭";
  ov.appendChild(hint);
  ov.onclick = (e) => { if (e.target === ov) closeLightbox(); };
  img.ondblclick = () => { _lbScale = 1; img.style.transform = ""; };
  ov.addEventListener("wheel", (e) => {
    e.preventDefault();
    _lbScale = Math.min(8, Math.max(0.25, _lbScale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
    img.style.transform = "scale(" + _lbScale.toFixed(3) + ")";
  }, { passive: false });
  document.addEventListener("keydown", _lbKey, true);   // capture：先于全局 Esc（中断生成）处理
  document.body.appendChild(ov);
  _lb = ov;
  requestAnimationFrame(() => ov.classList.add("show"));
}

// Serialize a selection to plain text for quoting. Replaces each KaTeX render with its LaTeX source
// ($…$ / $$…$$) — otherwise selection.toString() dumps the formula's many visual spans PLUS the hidden
// MathML across lots of separate lines, which then each get a "> " prefix (the「引用散在很多行」bug).
function selectionToText(sel) {
  if (!sel || !sel.rangeCount) return "";
  const wrap = document.createElement("div");
  for (let i = 0; i < sel.rangeCount; i++) wrap.appendChild(sel.getRangeAt(i).cloneContents());
  wrap.querySelectorAll(".katex").forEach(k => {
    const ann = k.querySelector("annotation[encoding='application/x-tex']");
    const tex = ((ann ? ann.textContent : k.textContent) || "").trim();
    const display = !!(k.closest && k.closest(".katex-display")) || (k.parentElement && (k.parentElement.classList.contains("math-block") || k.parentElement.classList.contains("math-bare")));
    k.replaceWith(document.createTextNode(tex ? (display ? "$$" + tex + "$$" : "$" + tex + "$") : ""));
  });
  // innerText (needs to be in the document) keeps real block breaks as newlines but ignores soft wraps,
  // so the quote only splits where the content actually splits — not every wrapped line.
  wrap.style.cssText = "position:absolute;left:-9999px;top:0;white-space:pre-wrap;";
  document.body.appendChild(wrap);
  const out = wrap.innerText;
  document.body.removeChild(wrap);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// 选区落在 row 这条消息内时返回其文本（公式转回 $LaTeX$），否则空串。用于「复制/引用选中文字」。
function rowSelectionText(row) {
  const s = window.getSelection && window.getSelection();
  if (!row || !s || s.isCollapsed || !s.rangeCount) return "";
  if (!(row.contains(s.anchorNode) || row.contains(s.focusNode))) return "";
  return selectionToText(s);
}
/* 引用：把选中的回答文字以引用块填入输入框追问。入口在助手消息的右键菜单——主动触发，
 * 不再用划词浮按钮（那个常被误碰，输入框莫名多出一段引用）。 */
function quoteText(text) {
  text = (text || "").trim();
  if (!text) return;
  const quote = text.split("\n").map(l => "> " + l).join("\n") + "\n\n";
  const inp = document.getElementById("input");
  inp.value = quote + inp.value;
  autoGrow(); inp.focus();
  inp.setSelectionRange(inp.value.length, inp.value.length);
  const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges();
}

function renderAttachments(el, atts) {
  if (!atts || !atts.length) { el.style.display = "none"; return; }
  el.style.display = "flex"; el.innerHTML = "";
  atts.forEach(a => {
    if (a.kind === "image") {
      const im = document.createElement("img"); im.className = "att-img"; im.src = a.dataUrl;
      im.onclick = () => openLightbox(a.dataUrl);
      el.appendChild(im);
    } else {
      const chip = document.createElement("div"); chip.className = "att-chip";
      const ico = document.createElement("span"); ico.className = "att-ico"; ico.innerHTML = ic("file", 14);
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = a.name;
      chip.append(ico, nm);
      el.appendChild(chip);
    }
  });
}

function buildMessage(msg, index) {
  const isUser = msg.role === "user";
  const row = document.createElement("div");
  row.className = "msg-row msg-" + msg.role;
  row.dataset.index = index;
  row.oncontextmenu = (e) => {
    if (editingIndex != null) return;
    e.preventDefault();
    // capture any text selected WITHIN this message NOW — opening/clicking the menu collapses the selection
    const selCap = rowSelectionText(row);
    showContextMenu(e.clientX, e.clientY, messageMenuItems(index, msg, selCap));
  };
  const inner = document.createElement("div");
  inner.className = "msg-inner";
  inner.innerHTML =
    '<div class="msg-body">' +
      '<div class="reasoning" data-exp="collapsed" style="display:none"><div class="reasoning-head">' + ic("bulb", 14) + '<span class="reasoning-title">思考过程</span></div><div class="reasoning-body msg-content"></div><button type="button" class="reasoning-more" tabindex="-1">展开全部 ▾</button></div>' +
      '<div class="attachments"></div>' +
      '<div class="msg-content"></div>' +
      '<div class="msg-meta"><div class="msg-actions"></div><div class="msg-usage"></div></div>' +
    '</div>';
  const contentEl = inner.querySelector(".msg-body > .msg-content");
  renderAttachments(inner.querySelector(".attachments"), msg.attachments);

  if (isUser && editingIndex === index) {
    row.classList.add("editing");
    const ta = document.createElement("textarea"); ta.className = "edit-area"; ta.value = msg.content;
    const bar = document.createElement("div"); bar.className = "edit-bar";
    const cancel = document.createElement("button"); cancel.className = "btn small"; cancel.textContent = "取消";
    const ok = document.createElement("button"); ok.className = "btn small primary"; ok.textContent = "保存并重新生成";
    cancel.onclick = () => { editingIndex = null; renderMessages(); };
    ok.onclick = () => {
      const v = ta.value.trim(); if (!v) return;
      const conv = currentConv();
      const asstIdx = index + 1;
      const oldAsst = conv.messages[asstIdx];
      const carry = (oldAsst && oldAsst.role === "assistant")
        ? ((Array.isArray(oldAsst.variants) && oldAsst.variants.length) ? oldAsst.variants.slice() : [snapshotVariant(conv, asstIdx)])
        : [];
      conv.messages[index].content = v;
      conv.messages = conv.messages.slice(0, index + 1);
      editingIndex = null; save();
      runCompletion(conv, { carryVariants: carry });
    };
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();                                  // don't let the global composer shortcuts fire
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ok.onclick(); }   // Enter = save & regenerate
      else if (e.key === "Escape") { e.preventDefault(); cancel.onclick(); }
    });
    bar.append(cancel, ok);
    contentEl.append(ta, bar);
    inner.querySelector(".msg-meta").remove();
    setTimeout(() => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 320) + "px"; ta.focus(); }, 0);
    row.appendChild(inner); return row;
  }

  if (isUser) { if (msg.content) { const p = document.createElement("div"); p.style.whiteSpace = "pre-wrap"; p.textContent = msg.content; contentEl.appendChild(p); } }
  else if (msg.error) {
    const e = msg.error;
    const wrap = document.createElement("div"); wrap.className = "msg-error";
    const head = document.createElement("div"); head.className = "msg-error-head";
    const ico = document.createElement("span"); ico.className = "msg-error-ico"; ico.textContent = "⚠";
    const ht = document.createElement("span"); ht.textContent = e.title || "出错了";
    head.append(ico, ht);
    const body = document.createElement("div"); body.className = "msg-error-body"; body.textContent = e.body || "";
    const retry = document.createElement("button"); retry.className = "btn small msg-error-retry"; retry.textContent = "重试"; retry.onclick = () => regenerate(index);
    wrap.append(head, body, retry);
    contentEl.appendChild(wrap);
  }
  else if (msg.content) { renderAnswer(contentEl, renderMarkdown(msg.content), false); }
  else contentEl.innerHTML = '<span class="dim">…</span>';

  if (!isUser && msg.reasoning) {
    const rEl = inner.querySelector(".reasoning");
    rEl.style.display = "block";
    inner.querySelector(".reasoning-body").innerHTML = renderMarkdown(msg.reasoning);
    setReasonExp(rEl, "collapsed");      // 历史/完成态：默认收起
    setReasonTitle(rEl, "思考过程");
    bindReason(rEl, row);
  }

  const actions = inner.querySelector(".msg-actions");
  const mk = (icoName, label, cls, fn) => { const b = document.createElement("button"); b.className = "act" + (cls ? " " + cls : ""); b.innerHTML = ic(icoName, 13) + "<span>" + label + "</span>"; b.onclick = fn; return b; };
  // 复制按钮：pointerdown 时（选区还没被 mousedown 清掉）先抓一次选中文字 → 有选区就复制选区，没选区复制整条
  const mkCopy = () => { const b = mk("copy", "复制", "", (e) => copyMessage(index, e)); b.addEventListener("pointerdown", () => { b._selText = rowSelectionText(row); }); return b; };
  if (isUser) {
    const conv0 = currentConv();
    // a prompt with no answer after it (e.g. its answer was deleted) gets a 重新回答 button, left of 编辑
    if (conv0 && index === conv0.messages.length - 1) actions.append(mk("refresh", "重新回答", "", () => answerFor(index)));
    actions.append(mk("edit", "编辑", "", () => { editingIndex = index; renderMessages(); }), mkCopy(), mk("fork", "分支", "", () => forkConversation(index)), mk("trash", "删除", "danger", () => deleteMessage(index)));
  } else if (msg.error) {
    actions.append(mk("trash", "删除", "danger", () => deleteMessage(index)));
  } else {
    if (msg.stopped) actions.append(mk("send", "继续", "continue", () => continueGeneration(index)));   // 被中断的回答：从断点接着写（视觉突出，别埋在按钮堆里）
    actions.append(mk("refresh", "重新回答", "", () => regenerate(index)), mkCopy(), mk("fork", "分支", "", () => forkConversation(index)), mk("trash", "删除", "danger", () => deleteMessage(index)));
  }

  // answer-version switcher (‹ 1/2 ›) — on any assistant message that has multiple versions. Regenerating
  // an earlier answer now keeps the following turns in place, so its old versions stay reachable here.
  if (!isUser && Array.isArray(msg.variants) && msg.variants.length > 1) {
    const vi = (typeof msg.vi === "number") ? msg.vi : msg.variants.length - 1;
    const sw = document.createElement("div"); sw.className = "variant-switch";
    const prev = document.createElement("button"); prev.className = "vs-btn"; prev.textContent = "‹"; prev.title = "上一个回答"; prev.setAttribute("aria-label", "上一个回答"); prev.disabled = vi <= 0;
    const lab = document.createElement("span"); lab.className = "vs-label"; lab.textContent = (vi + 1) + " / " + msg.variants.length;
    const next = document.createElement("button"); next.className = "vs-btn"; next.textContent = "›"; next.title = "下一个回答"; next.setAttribute("aria-label", "下一个回答"); next.disabled = vi >= msg.variants.length - 1;
    prev.onclick = () => switchVariant(index, vi - 1);
    next.onclick = () => switchVariant(index, vi + 1);
    sw.append(prev, lab, next);
    const meta = inner.querySelector(".msg-meta");
    meta.insertBefore(sw, meta.firstChild);
  }

  const usageEl = inner.querySelector(".msg-usage");
  if (!isUser && msg.usage) {
    const u = msg.usage; const tot = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    usageEl.textContent = fmtTok(u.prompt_tokens) + " ↑ + " + fmtTok(u.completion_tokens) + " ↓ = " + fmtTok(tot) + " tok" + (u.cost != null ? " · " + fmtCost(u.cost) : "");
    if (u.cost != null && u.cost > 0) { usageEl.title = "花费 " + fmtCostExact(u.cost); usageEl.dataset.tipDelay = "600"; } else usageEl.removeAttribute("title");
  }
  row.appendChild(inner); return row;
}

function compactionMarker(conv) {
  const n = Math.min(conv.compaction.count, conv.messages.length);
  if (conv.compaction.divider) {   // /newhere — a plain boundary line, no summary; the model just doesn't see anything above it
    const d = document.createElement("div"); d.className = "newhere-marker";
    const lab = document.createElement("span"); lab.className = "newhere-label"; lab.textContent = "新话题 · 以上不计入上下文";
    const undo = document.createElement("button"); undo.className = "newhere-undo"; undo.type = "button"; undo.textContent = "撤销"; undo.title = "撤销分界，恢复完整上下文";
    undo.onclick = (e) => { e.stopPropagation(); conv.compaction = null; save(); renderMessages(); toast("已撤销分界"); };
    lab.appendChild(undo);
    d.appendChild(lab);
    return d;
  }
  const wrap = document.createElement("div"); wrap.className = "compact-marker";
  const line = document.createElement("div"); line.className = "compact-line";
  const detail = document.createElement("div"); detail.className = "compact-detail"; detail.style.display = "block"; // expanded by default
  const txt = document.createElement("div"); txt.className = "compact-summary msg-content"; txt.innerHTML = renderMarkdown(conv.compaction.summary || "");
  const _box = document.getElementById("messages"); const _cap = Math.max(160, Math.round(((_box && _box.clientHeight) || 500) * 0.5));
  txt.style.maxHeight = _cap + "px"; txt.style.overflowY = "auto";
  const bar = document.createElement("div"); bar.className = "compact-bar";
  const undo = document.createElement("button"); undo.className = "btn small"; undo.textContent = "撤销压缩（恢复完整上下文）";
  undo.onclick = (e) => { e.stopPropagation(); conv.compaction = null; save(); renderMessages(); toast("已撤销压缩"); };
  bar.append(undo);
  detail.append(txt, bar);
  const setLabel = () => { line.textContent = "⊟ 以上 " + n + " 条消息已压缩为摘要（点击" + (detail.style.display === "none" ? "展开" : "收起") + "）"; };
  setLabel();
  line.onclick = () => { detail.style.display = detail.style.display === "none" ? "block" : "none"; setLabel(); };
  wrap.append(line, detail);
  return wrap;
}

// Friendly display names for code-fence language tags; unknown tags are shown verbatim.
const LANG_LABELS = { js: "JavaScript", jsx: "JSX", mjs: "JavaScript", ts: "TypeScript", tsx: "TSX", py: "Python", python: "Python", rb: "Ruby", ruby: "Ruby", go: "Go", golang: "Go", rs: "Rust", rust: "Rust", java: "Java", kt: "Kotlin", kotlin: "Kotlin", swift: "Swift", c: "C", cpp: "C++", "c++": "C++", cc: "C++", cs: "C#", "c#": "C#", csharp: "C#", php: "PHP", sh: "Shell", bash: "Bash", zsh: "Zsh", shell: "Shell", console: "Shell", ps1: "PowerShell", powershell: "PowerShell", sql: "SQL", json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "Sass", less: "Less", md: "Markdown", markdown: "Markdown", tex: "TeX", latex: "LaTeX", dockerfile: "Dockerfile", docker: "Dockerfile", makefile: "Makefile", make: "Makefile", cmake: "CMake", r: "R", lua: "Lua", dart: "Dart", scala: "Scala", clj: "Clojure", ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell", pl: "Perl", perl: "Perl", objc: "Objective-C", vue: "Vue", svelte: "Svelte", graphql: "GraphQL", gql: "GraphQL", proto: "Protobuf", ini: "INI", diff: "Diff", patch: "Diff", vim: "Vim", text: "Text", txt: "Text", plaintext: "Text", plain: "Text" };
function langLabel(lang) { if (!lang) return "code"; return LANG_LABELS[lang.toLowerCase()] || lang; }

/* ---- Bare-formula rescue ----
   Some models dump a formula into an unlabeled ``` fence instead of $$…$$. We detect a no-language block
   that is clearly LaTeX (a math command or x^{…}/a_{…}, and no code markers) and render it as math.
   Biased hard toward leaving things alone: a missed formula just stays a code block (status quo), but a
   real code block must never be mangled into KaTeX — so the math signal requires a backslash command. */
const MATH_CMD = /\\(frac|dfrac|tfrac|sqrt|sum|prod|coprod|int|iint|iiint|oint|lim|limsup|liminf|infty|partial|nabla|cdot|times|div|pm|mp|ast|star|circ|leq|geq|neq|approx|equiv|cong|sim|simeq|propto|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|forall|exists|nexists|neg|land|lor|implies|iff|to|gets|rightarrow|Rightarrow|leftarrow|Leftarrow|leftrightarrow|longrightarrow|mapsto|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|varrho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|mathbb|mathcal|mathrm|mathbf|mathfrak|boldsymbol|operatorname|left|right|begin|end|hat|widehat|vec|bar|tilde|widetilde|overline|underline|overrightarrow|binom|dbinom|langle|rangle|lfloor|rfloor|lceil|rceil|cdots|ldots|vdots|ddots|dots|prime|oplus|ominus|otimes|odot|wedge|vee|perp|parallel|angle|triangle|square|because|therefore|quad|qquad)(?![a-zA-Z])/;
const MATH_BRACE = /[\^_]\{/;   // x^{…} / a_{…} — almost exclusively math (rare in code, never in prose)
const CODE_SIG = /\/\/|\/\*|\*\/|=>|;\s*(\n|$)|&&|\|\||==|!=|::|\bfunction\b|\breturn\b|\bconsole\b|\bimport\b|\bexport\b|\bprintf\b|\bdef\s|\bclass\s|#include|System\.out/;
function looksLikeMath(s) {
  s = (s || "").trim();
  if (!s || s.length > 1200) return false;            // huge blocks are almost never a lone formula
  if (CODE_SIG.test(s)) return false;
  return MATH_CMD.test(s) || MATH_BRACE.test(s);
}
function renderTeX(tex, display) {
  if (!window.katex) return null;
  try { return katex.renderToString(tex, { displayMode: !!display, throwOnError: false }); }
  catch (e) { return null; }
}
// Render a bare fence's text as one or more display-math rows (one per non-blank line). null → leave as code.
function mathFromBare(raw) {
  if (!window.katex) return null;
  const lines = (raw || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  let out = "";
  for (const ln of lines) { const h = renderTeX(ln, true); if (h == null) return null; out += '<div class="math-block">' + h + "</div>"; }
  return out;
}

// opts.openTail: the LAST code fence is still streaming (unclosed). Every chunk re-renders the whole
// message (innerHTML is replaced), so to avoid churn we highlight / 公式救回 EVERY block except that last
// open one — already-closed blocks get re-coloured on every frame (so they never flicker on↔off), only the
// half-written tail stays raw until its fence closes. The WRAP step (header bar + copy button) ALWAYS runs
// for ALL blocks — that's what gives a block its height, so keeping it present from the first chunk (rather
// than popping it in when the fence finally closes) stops the block from「跳动」mid-stream.
function enhanceCode(scope, opts) {
  opts = opts || {};
  const openTail = !!opts.openTail;
  // Capture each fence's EXPLICIT language (from the ``` info string, set by marked as `language-xxx`)
  // BEFORE hljs runs — auto-highlight overwrites the class with its best guess, and an unlabeled fence
  // (e.g. an LLM dumping a bare formula) would otherwise get mislabeled "INI" / "Perl". No tag → "code".
  scope.querySelectorAll("pre > code").forEach(code => {
    if (code.dataset.lang == null) { const m = (code.className || "").match(/\blanguage-([\w+#.-]+)/i); code.dataset.lang = m ? m[1] : ""; }
  });
  // Rescue bare formulas: an unlabeled fence that is clearly LaTeX becomes math, not a code block.
  // Skip the still-streaming tail fence — its partial text could momentarily look like math.
  const mlist = [...scope.querySelectorAll("pre > code")];
  mlist.forEach((code, i) => {
    if (openTail && i === mlist.length - 1) return;
    const pre = code.parentElement;
    if (!pre || code.dataset.lang) return;                                   // only no-language fences
    if (pre.parentElement && pre.parentElement.classList.contains("code-block")) return;
    const raw = code.textContent || "";
    if (!looksLikeMath(raw)) return;
    const html = mathFromBare(raw);
    if (html == null) return;                                                // KaTeX unavailable / failed → keep as code
    const div = document.createElement("div"); div.className = "math-bare"; div.innerHTML = html;
    pre.replaceWith(div);
  });
  // Highlight every block EXCEPT the still-streaming tail — re-colouring half-written code each chunk is
  // what made the already-closed blocks above it flicker (highlight appearing then vanishing).
  if (window.hljs) {
    const codes = [...scope.querySelectorAll("pre > code")];
    const skip = openTail ? codes.length - 1 : -1;
    codes.forEach((code, i) => {
      if (i === skip) return;
      if (!code.dataset.highlighted) { try { hljs.highlightElement(code); } catch (e) {} }
    });
  }
  scope.querySelectorAll("pre").forEach(pre => {
    if (pre.parentElement && pre.parentElement.classList.contains("code-block")) return;
    const code = pre.querySelector("code");
    const lang = code ? (code.dataset.lang || "") : "";
    const block = document.createElement("div"); block.className = "code-block";
    const head = document.createElement("div"); head.className = "code-head";
    const lab = document.createElement("span"); lab.className = "code-lang"; lab.textContent = langLabel(lang);
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "code-copy"; btn.setAttribute("aria-label", "复制代码");
    const reset = () => { btn.classList.remove("done"); btn.innerHTML = ic("copy", 13) + "<span>复制</span>"; };
    reset();
    btn.onclick = () => {
      navigator.clipboard.writeText((pre.querySelector("code") || pre).textContent);   // textContent keeps long horizontally-scrolled lines intact (innerText can drop them)
      btn.classList.add("done"); btn.innerHTML = ic("check", 13) + "<span>已复制</span>";
      clearTimeout(btn._t); btn._t = setTimeout(reset, 1400);
    };
    head.appendChild(lab); head.appendChild(btn);
    pre.parentNode.insertBefore(block, pre);
    block.appendChild(head); block.appendChild(pre);
  });
}

function renderAll() { applySidebar(); renderSidebar(); renderMessages(); renderSidebarProfile(); renderArchiveSettings(); }

/* ===================== Conversation node minimap (top-left of chat) ===================== */
// the assistant reply that belongs to the user message at userIndex (null if none yet)
function turnReply(conv, userIndex) {
  for (let j = userIndex + 1; j < conv.messages.length; j++) {
    if (conv.messages[j].role === "user") break;
    const a = conv.messages[j];
    if (a.role === "assistant" && a.content && !a.content.startsWith("⚠️")) return a;
  }
  return null;
}
let nodeUserIndices = [];   // user-message indices, one per turn, in order
let nodeRaf = 0;
function renderNodemap() {
  const wrap = document.getElementById("nodemap");
  if (!wrap) return;
  const bars = wrap.querySelector(".nm-bars");
  const panel = wrap.querySelector(".nm-panel");
  const conv = currentConv();
  bars.innerHTML = ""; panel.innerHTML = ""; nodeUserIndices = [];
  const users = conv ? conv.messages.map((m, i) => ({ m, i })).filter(x => x.m.role === "user") : [];
  if (users.length < 2) { wrap.style.display = "none"; return; }
  wrap.style.display = "";
  // /newhere boundary: split the minimap between the old topic's nodes and the new one's. Collapsed view =
  // a touch more gap before the first new node (no visible mark); expanded panel = a「新话题」rule.
  const divAt = (conv.compaction && conv.compaction.divider) ? Math.min(conv.compaction.count, conv.messages.length) : -1;
  let divDone = false;
  const addPanelDivider = () => { const dp = document.createElement("div"); dp.className = "nm-div-item"; dp.textContent = "新话题"; panel.appendChild(dp); divDone = true; };
  users.forEach(({ m, i }) => {
    const splitHere = (divAt >= 0 && !divDone && i >= divAt);   // first turn past the boundary
    if (splitHere) addPanelDivider();
    nodeUserIndices.push(i);
    const bar = document.createElement("div"); bar.className = "nm-bar" + (splitHere ? " nm-after-div" : ""); bar.dataset.idx = i; bars.appendChild(bar);
    const item = document.createElement("button"); item.className = "nm-item"; item.dataset.idx = i;
    if (m.nodeTitle) item.textContent = m.nodeTitle;
    else { item.textContent = plainText(m).slice(0, 60); item.classList.add("untitled"); }
    item.onclick = () => { nodePinned = i; scrollToMessage(i); setNodeActive(i); };
    panel.appendChild(item);
  });
  if (divAt >= 0 && !divDone) addPanelDivider();   // boundary sits after the last turn (just ran /newhere) → panel marker only
  queueNodeTitles(conv);
  updateNodeActive();
}
function setNodeActive(idx) {
  const wrap = document.getElementById("nodemap"); if (!wrap) return;
  wrap.querySelectorAll(".nm-bar, .nm-item").forEach(el => el.classList.toggle("active", +el.dataset.idx === idx));
}
// scroll-spy: highlight the turn whose question has scrolled to (or past) the top of the viewport
function updateNodeActive() {
  if (!nodeUserIndices.length) return;
  if (nodePinned != null) { setNodeActive(nodePinned); return; }   // user jumped to a node; keep it lit until they scroll
  const box = document.getElementById("messages");
  if (!box) return;
  const boxTop = box.getBoundingClientRect().top;
  let active = nodeUserIndices[0];
  for (const idx of nodeUserIndices) {
    const row = box.querySelector('.msg-row[data-index="' + idx + '"]');
    if (!row) continue;
    if (row.getBoundingClientRect().top - boxTop <= 90) active = idx; else break;
  }
  if (isNearBottom(box)) active = nodeUserIndices[nodeUserIndices.length - 1];
  setNodeActive(active);
}
function scheduleNodeActive() { if (nodeRaf) return; nodeRaf = requestAnimationFrame(() => { nodeRaf = 0; updateNodeActive(); }); }
function scrollToMessage(index) {
  const box = document.getElementById("messages");
  const row = box.querySelector('.msg-row[data-index="' + index + '"]');
  if (!row) return;
  autoScroll = false;
  // land the clicked prompt ~20% down from the top (same as the auto-scroll pin), not glued to the top.
  // fixed-duration jump: reaches the target in ~280ms no matter how far the distance.
  const target = Math.max(0, row.offsetTop - Math.round(box.clientHeight * 0.2));
  animateScrollTo(box, target, 280);
  row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
  setTimeout(() => row.classList.remove("flash"), 1300);
  setTimeout(updateScrollBtn, 400);
}

/* Name each turn with the cheap title model — lazily, one at a time, cached on the user message. */
let nodeTitleQueue = [];
let nodeTitleBusy = false;
const nodeTitleTried = new Set(); // "convId:index" attempted this session (avoid hammering on failure)
function queueNodeTitles(conv) {
  if (!keyOf(state.settings.defaults.title)) return; // no naming model configured
  conv.messages.forEach((m, i) => {
    if (m.role !== "user" || m.nodeTitle) return;
    if (nodeTitleTried.has(conv.id + ":" + i)) return;
    if (!(m.content || (m.attachments || []).length)) return;   // name from the prompt alone — no reply needed
    if (!nodeTitleQueue.some(j => j.convId === conv.id && j.userIndex === i)) nodeTitleQueue.push({ convId: conv.id, userIndex: i });
  });
  processNodeTitleQueue();
}
async function processNodeTitleQueue() {
  if (nodeTitleBusy) return;
  nodeTitleBusy = true;
  try {
    while (nodeTitleQueue.length) {
      const job = nodeTitleQueue.shift();
      const conv = state.conversations.find(c => c.id === job.convId);
      if (!conv) continue;
      const m = conv.messages[job.userIndex];
      if (!m || m.role !== "user" || m.nodeTitle) continue;
      const tref = state.settings.defaults.title;
      if (!keyOf(tref)) break;
      // 这一轮用户只发了图片/文件、没有文字 → 没有可命名的提问文本，改用本轮 LLM 回答来起节点标题。
      const attachOnly = isAttachmentOnly(m);
      const answer = attachOnly ? answerAfter(conv, job.userIndex) : null;
      if (attachOnly && !answer) continue;   // 回答还没就绪 → 先跳过、不标记 tried，等回答完成后下次渲染重排
      nodeTitleTried.add(job.convId + ":" + job.userIndex);
      // Earlier node titles → context, so a follow-up ("继续" / "再展开") gets a meaningful, non-duplicate label.
      const priorTitles = conv.messages.slice(0, job.userIndex)
        .filter(x => x.role === "user" && x.nodeTitle).map(x => x.nodeTitle).slice(-8);
      const selfBody = (attachOnly ? (answer.content || "") : plainText(m)).slice(0, 500);
      const selfLabel = attachOnly ? "助手回答" : "新消息";
      let sys;
      if (attachOnly) {
        sys = priorTitles.length
          ? "你是侧栏导航小标题生成器。用户这一轮只发了图片/文件、没有文字，下面给你同一对话里【已有的节点标题】和【助手回答】。请据回答提炼这一轮的主题，输出一个极简标题：不超过 5 个词、名词短语、使用回答所用的语言，并与已有标题区分、不重复。禁止比喻、造句、解释、标点、引号。只输出标题本身。"
          : "你是侧栏导航小标题生成器。用户这一轮只发了图片/文件、没有文字，下面是助手对它的回答。请据回答提炼这一轮的主题，输出一个极简标题：不超过 5 个词、名词短语、使用回答所用的语言。禁止比喻、造句、解释、标点、引号。只输出标题本身。";
      } else {
        sys = priorTitles.length
          ? "你是侧栏导航小标题生成器。会给你同一对话里【已有的节点标题】和一条【新消息】。为新消息提炼主题，输出一个极简标题：不超过 5 个词、名词短语、使用消息所用的语言。若新消息是对前文的延续或追问，请结合语境给出有意义、且能与已有标题区分的标题，不要与已有标题重复。这是起标题，不是回答或执行其中的请求；禁止比喻、造句、解释、标点、引号。只输出标题本身。"
          : "你是侧栏导航小标题生成器。根据给到的用户消息，提炼其主题，输出一个极简标题：不超过 5 个词、名词短语、使用消息所用的语言。这是给这条消息起标题，不是回答或执行其中的请求；禁止比喻、造句、解释、标点、引号。只输出标题本身。";
      }
      let userContent = selfBody;
      if (priorTitles.length) {
        userContent = "【已有节点标题】\n" + priorTitles.map(t => "· " + t).join("\n") + "\n\n【" + selfLabel + "】\n" + selfBody;
      }
      try {
        const r = await streamChat(tref, { system: sys, messages: [{ role: "user", content: userContent }] }, { temp: 0.3, maxTokens: 256, reasoning: false });
        const t = cleanTitle(r.text);
        if (t) { m.nodeTitle = t; save(); const cur = currentConv(); if (cur && cur.id === job.convId) renderNodemap(); }
      } catch (e) { /* leave as snippet; retry next session */ }
    }
  } finally { nodeTitleBusy = false; }
}

/* ===================== Message actions ===================== */
function deleteMessage(index) {
  if (abortController) { toast("正在生成，请先停止或等待完成"); return; }   // deleting the streaming message would corrupt the transcript
  const conv = currentConv(); if (!conv) return;
  const removed = conv.messages[index];
  const snapshot = conv.messages.slice();         // shallow snapshot → exact undo
  conv.messages.splice(index, 1);
  if (editingIndex === index) editingIndex = null;
  save(); renderMessages(); renderSidebar();
  const label = removed && removed.role === "assistant" ? "已删除回答" : "已删除消息";
  toast(label, { label: "撤销", fn: () => { conv.messages = snapshot; save(); renderMessages(); renderSidebar(); } });
}
// Generate an answer for a user prompt that currently has none (its answer was deleted, etc.).
function answerFor(index) {
  if (abortController) return;
  const conv = currentConv(); if (!conv) return;
  const um = conv.messages[index];
  if (!um || um.role !== "user") return;
  conv.messages = conv.messages.slice(0, index + 1);   // drop anything after the prompt
  editingIndex = null; save(); renderMessages();
  runCompletion(conv);
}
// Regenerate the answer at `index` IN PLACE — the turns after it stay exactly where they are (regenerating
// an earlier reply no longer wipes the rest of the conversation). The previous answer is kept as a
// switchable version (‹ 1/2 ›).
function regenerate(index) {
  if (abortController) return;
  const conv = currentConv(); if (!conv) return;
  const old = conv.messages[index];
  if (!old || old.role !== "assistant") return;
  const carry = old.error ? []
              : (Array.isArray(old.variants) && old.variants.length) ? old.variants.slice()
              : [snapshotVariant(conv, index)];
  editingIndex = null;
  runCompletion(conv, { carryVariants: carry, regenAt: index });
}
function copyMessage(index, e, override) {
  const conv = currentConv(); if (!conv) return;
  const btn = e && e.currentTarget;
  // 优先级：显式传入的选中文字（右键菜单）> pointerdown 抓到的选区（操作栏按钮）> 实时选区 > 整条消息
  let text = (override || "").trim();
  if (!text && btn && btn._selText) text = btn._selText;
  if (!text && btn) text = rowSelectionText(btn.closest(".msg-row"));
  if (!text) text = conv.messages[index].content || "";
  navigator.clipboard.writeText(text);
  // currentTarget is always the .act button (clicking its icon would make e.target the <svg>); only swap the
  // label <span> so the icon survives, and flag .done for the "copied" state.
  const lab = btn && btn.querySelector("span");
  if (lab) {
    lab.textContent = "已复制"; btn.classList.add("done");
    clearTimeout(btn._t); btn._t = setTimeout(() => { lab.textContent = "复制"; btn.classList.remove("done"); }, 1200);
  } else toast("已复制");
}

/* ===================== Right-click context menus ===================== */
let ctxMenuEl = null;
function closeCtxMenu() {
  if (!ctxMenuEl) return;
  ctxMenuEl.remove(); ctxMenuEl = null;
  document.removeEventListener("mousedown", ctxOutside, true);
  document.removeEventListener("keydown", ctxKeydown, true);
}
function ctxOutside(e) { if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu(); }
function ctxKeydown(e) { if (e.key === "Escape") { e.preventDefault(); closeCtxMenu(); } }
function renderCtxItems(items, container) {
  items.forEach(it => {
    if (it.sep) { const s = document.createElement("div"); s.className = "ctx-sep"; container.appendChild(s); return; }
    const b = document.createElement("button");
    b.className = "ctx-item" + (it.danger ? " danger" : "") + (it.disabled ? " is-disabled" : "") + (it.sub ? " has-sub" : "");
    const icel = document.createElement("span"); icel.className = "ctx-ic"; if (it.icon) icel.innerHTML = ic(it.icon, 14);
    const lab = document.createElement("span"); lab.className = "ctx-label"; lab.textContent = it.label;
    b.append(icel, lab);
    if (it.sub) { const ar = document.createElement("span"); ar.className = "ctx-arrow"; ar.textContent = "›"; b.appendChild(ar); }
    if (it.disabled) { container.appendChild(b); return; }
    if (it.sub && it.sub.length) {
      const fly = document.createElement("div"); fly.className = "ctx-menu ctx-sub";
      renderCtxItems(it.sub, fly);
      b.appendChild(fly);
    } else if (it.onClick) {
      b.onclick = (e) => { e.stopPropagation(); closeCtxMenu(); it.onClick(); };
    }
    container.appendChild(b);
  });
}
function showContextMenu(x, y, items) {
  closeCtxMenu();
  const m = document.createElement("div"); m.className = "ctx-menu";
  m.oncontextmenu = (e) => e.preventDefault();
  renderCtxItems(items, m);
  document.body.appendChild(m);
  ctxMenuEl = m;
  const r = m.getBoundingClientRect();
  let left = x, top = y;
  if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
  if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
  if (left + r.width + 190 > window.innerWidth) m.classList.add("flip-sub");   // submenus open leftward near the right edge
  m.style.left = Math.round(left) + "px"; m.style.top = Math.round(top) + "px";
  setTimeout(() => {
    document.addEventListener("mousedown", ctxOutside, true);
    document.addEventListener("keydown", ctxKeydown, true);
  }, 0);
}
// regenerate the answer at `index` with a different model (keeps the old answer as a switchable version)
function regenerateWith(index, ref) {
  if (abortController) { toast("正在生成，请先停止或等待完成"); return; }
  const conv = currentConv(); if (!conv) return;
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }
  conv.model = clone(ref); save();
  regenerate(index);
}
function messageMenuItems(index, msg, selCap) {
  const conv = currentConv();
  const isLast = conv && index === conv.messages.length - 1;
  if (msg.role === "user") {
    const items = [
      { label: selCap ? "复制选中文字" : "复制", icon: "copy", onClick: () => copyMessage(index, null, selCap) },
      { label: "编辑", icon: "edit", onClick: () => { editingIndex = index; renderMessages(); } },
    ];
    if (isLast) items.push({ label: "重新回答", icon: "refresh", onClick: () => answerFor(index) });
    items.push({ label: "从这里分支", icon: "fork", onClick: () => forkConversation(index) });
    items.push({ sep: true }, { label: "删除", icon: "trash", danger: true, onClick: () => deleteMessage(index) });
    return items;
  }
  if (msg.error) return [
    { label: "重试", icon: "refresh", onClick: () => regenerate(index) },
    { label: "删除", icon: "trash", danger: true, onClick: () => deleteMessage(index) },
  ];
  const cur = activeRef();
  const models = modelRefList().map(ref => ({
    label: modelLabel(ref),
    icon: (cur && ref.provider === cur.provider && ref.model === cur.model) ? "check" : undefined,
    disabled: !keyOf(ref),
    onClick: () => regenerateWith(index, ref),
  }));
  const items = [];
  if (selCap) items.push({ label: "引用选中文字", icon: "chat", onClick: () => quoteText(selCap) }, { sep: true });
  items.push(
    { label: selCap ? "复制选中文字" : "复制", icon: "copy", onClick: () => copyMessage(index, null, selCap) },
    { label: "重新回答", icon: "refresh", onClick: () => regenerate(index) },
  );
  if (models.length) items.push({ label: "用其他模型重答", icon: "cube", sub: models });
  items.push({ label: "从这里分支", icon: "fork", onClick: () => forkConversation(index) });
  items.push({ sep: true }, { label: "删除", icon: "trash", danger: true, onClick: () => deleteMessage(index) });
  return items;
}
function convMenuItems(c) {
  const hasTitleKey = !!keyOf(state.settings.defaults.title);
  return [
    { label: c.pinned ? "取消置顶" : "置顶", icon: "pin", onClick: () => togglePin(c) },
    { label: "重命名", icon: "edit", onClick: () => { state.currentId = c.id; editingIndex = null; save(); renderAll(); setTimeout(startTitleRename, 40); } },
    { label: "AI 生成标题", icon: "refresh", disabled: !hasTitleKey, onClick: () => regenerateTitle(c) },
    { label: "导出对话…", icon: "down", onClick: () => { state.currentId = c.id; editingIndex = null; save(); renderAll(); setTimeout(() => openExportMenu(document.getElementById("export-chat")), 40); } },
    { sep: true },
    { label: "删除（移入已归档）", icon: "trash", danger: true, onClick: () => { const nm = c.title || "新对话"; archiveConversation(c); toast("已删除「" + nm + "」", { label: "撤销", fn: () => restoreConversation(c.id) }); } },
  ];
}

/* ===== Answer versions: regenerating / editing keeps the previous answer as a switchable variant ===== */
// Snapshot an assistant answer + the prompt that produced it (so switching can restore both).
function snapshotVariant(conv, asstIndex) {
  const a = conv.messages[asstIndex] || {};
  let ui = asstIndex - 1; while (ui >= 0 && conv.messages[ui].role !== "user") ui--;
  const u = ui >= 0 ? conv.messages[ui] : null;
  return {
    content: a.content || "", reasoning: a.reasoning || "", usage: a.usage || null,
    prompt: u ? (u.content || "") : null,
    attachments: u && Array.isArray(u.attachments) ? u.attachments.slice() : [],
  };
}
function switchVariant(asstIndex, newVi) {
  const conv = currentConv(); if (!conv) return;
  const a = conv.messages[asstIndex];
  if (!a || !Array.isArray(a.variants) || newVi < 0 || newVi >= a.variants.length) return;
  const v = a.variants[newVi];
  a.vi = newVi;
  a.content = v.content || ""; a.reasoning = v.reasoning || ""; a.usage = v.usage || null;
  let ui = asstIndex - 1; while (ui >= 0 && conv.messages[ui].role !== "user") ui--;
  let promptChanged = false;
  if (ui >= 0 && v.prompt != null) {
    if ((conv.messages[ui].content || "") !== (v.prompt || "")) promptChanged = true;   // 这个版本连带恢复了不同的提问
    conv.messages[ui].content = v.prompt; conv.messages[ui].attachments = (v.attachments || []).slice();
  }
  save(); renderMessages();
  if (promptChanged && ui >= 0) {   // 上面的提问被无声改写了——闪一下让用户察觉
    const row = document.querySelector('#messages .msg-row[data-index="' + ui + '"]');
    if (row) { row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 1300); }
  }
}

/* ===================== Provider request layer ===================== */
function dataUrlParts(d) { const m = /^data:([^;]+);base64,(.*)$/.exec(d); return m ? { media: m[1], data: m[2] } : null; }

function toOpenAIContent(m, providerKey) {
  const atts = m.attachments || [];
  const tf = atts.filter(a => a.kind === "textfile"), images = atts.filter(a => a.kind === "image"), pdfs = atts.filter(a => a.kind === "pdf"), notes = atts.filter(a => a.kind === "note");
  let text = m.content || "";
  for (const f of tf) text += "\n\n[文件: " + f.name + "]\n```\n" + f.text + "\n```";
  for (const n of notes) text += "\n\n[附件: " + n.name + "（未解析）]";
  const pdfAsFile = providerKey === "openrouter";
  if (!pdfAsFile) for (const p of pdfs) text += "\n\n[PDF: " + p.name + "（当前提供方不支持直接解析 PDF）]";
  const wantArray = images.length || (pdfAsFile && pdfs.length);
  if (!wantArray) return text;
  const parts = [{ type: "text", text: text || " " }];
  for (const img of images) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
  if (pdfAsFile) for (const p of pdfs) parts.push({ type: "file", file: { filename: p.name, file_data: p.dataUrl } });
  return parts;
}
function toAnthropicContent(m) {
  const atts = m.attachments || [];
  const tf = atts.filter(a => a.kind === "textfile"), images = atts.filter(a => a.kind === "image"), pdfs = atts.filter(a => a.kind === "pdf"), notes = atts.filter(a => a.kind === "note");
  let text = m.content || "";
  for (const f of tf) text += "\n\n[文件: " + f.name + "]\n```\n" + f.text + "\n```";
  for (const n of notes) text += "\n\n[附件: " + n.name + "（未解析）]";
  if (!images.length && !pdfs.length) return text;
  const parts = [];
  for (const img of images) { const p = dataUrlParts(img.dataUrl); if (p) parts.push({ type: "image", source: { type: "base64", media_type: p.media, data: p.data } }); }
  for (const pdf of pdfs) { const p = dataUrlParts(pdf.dataUrl); if (p) parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data } }); }
  parts.push({ type: "text", text: text || " " });
  return parts;
}

async function errText(resp) {
  let em = "请求失败：HTTP " + resp.status;
  try { const j = await resp.json(); em = (j.error && j.error.message) || j.message || JSON.stringify(j.error || j); } catch (e) {}
  return em;
}
// Turn a raw request error into a clear, actionable message (title + body) for the inline error block.
function friendlyError(err) {
  const raw = (err && err.message) || "";
  const status = err && err.status;
  if (!status && /Failed to fetch|NetworkError|ERR_|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|fetch failed/i.test(raw))
    return { title: "连接失败", body: "无法连接到模型服务，请检查网络或代理后重试。" };
  if (status === 401 || status === 403 || /invalid.*api.*key|incorrect api key|unauthorized|authentication|no auth/i.test(raw))
    return { title: "API Key 无效", body: "该服务商的 API Key 不正确或已失效。请到 设置 → 模型提供方 检查后重试。" };
  if (/insufficient|quota|billing|balance|credit|payment|欠费|余额/i.test(raw))
    return { title: "额度不足", body: "账户额度或余额不足，请到服务商后台充值或检查计费，然后重试。" };
  if (status === 429 || /rate limit|too many requests|rate_limit/i.test(raw))
    return { title: "请求过于频繁", body: "触发了服务商限流（429）。稍等几秒再点重试即可。" };
  if (status === 413 || /context length|maximum context|context window|too long|reduce the length|prompt is too long/i.test(raw))
    return { title: "上下文过长", body: "本轮对话超出了模型的上下文上限。可点底部「压缩上下文」后重试，或新开一个对话。" };
  if ((status && status >= 500) || /overloaded|server error|service unavailable|internal error|bad gateway/i.test(raw))
    return { title: "服务商繁忙", body: "模型服务暂时出错或过载（5xx）。稍后点重试即可。" };
  return { title: "出错了", body: raw || "未知错误，请重试。" };
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

// returns { text, usage }
async function streamChat(ref, payload, opts) {
  opts = opts || {};
  const prov = PROVIDERS[ref.provider];
  const key = keyOf(ref);
  if (!prov) throw new Error("未知的提供方：" + ref.provider);
  if (!key) throw new Error("未配置 " + (prov ? prov.label : ref.provider) + " 的 API Key");
  const onDelta = opts.onDelta || (() => {});
  const onReasoning = opts.onReasoning || (() => {});
  const system = payload.system || "";
  const messages = payload.messages || [];
  let acc = "", racc = "", usage = null;

  if (prov.kind === "openai") {
    const apiMessages = [];
    if (system) apiMessages.push({ role: "system", content: system });
    for (const m of messages) {
      const am = { role: m.role, content: toOpenAIContent(m, ref.provider) };
      // DeepSeek V4 thinking mode requires each prior assistant turn's reasoning_content to be echoed back
      if (ref.provider === "deepseek" && opts.reasoning && m.role === "assistant" && m.reasoning) am.reasoning_content = m.reasoning;
      apiMessages.push(am);
    }
    const body = { model: ref.model, messages: apiMessages, stream: true };
    if (opts.temp != null) body.temperature = opts.temp;
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.topP != null) body.top_p = opts.topP;
    if (opts.topK != null && ref.provider === "openrouter") body.top_k = opts.topK;   // OpenAI/DeepSeek/Gemini-compat reject top_k
    if (ref.provider === "openrouter") {
      body.usage = { include: true };
      const plugins = [];
      if (messages.some(m => (m.attachments || []).some(a => a.kind === "pdf"))) plugins.push({ id: "file-parser", pdf: { engine: "pdf-text" } });
      if (opts.web) plugins.push({ id: "web", max_results: 5 });
      if (plugins.length) body.plugins = plugins;
      if (opts.reasoning) body.reasoning = { effort: opts.effort || "medium" };
    } else if (ref.provider === "openai" || ref.provider === "deepseek") {
      body.stream_options = { include_usage: true };
    }
    // DeepSeek V4 hybrid models (deepseek-v4-flash/pro) think by default — control it explicitly.
    if (ref.provider === "deepseek" && typeof opts.reasoning === "boolean") {
      body.thinking = { type: opts.reasoning ? "enabled" : "disabled" };
    }
    const headers = { "Authorization": "Bearer " + key, "Content-Type": "application/json" };
    if (ref.provider === "openrouter") { headers["HTTP-Referer"] = "https://quartz.local"; headers["X-Title"] = "Quartz"; }
    const resp = await fetch(prov.base + "/chat/completions", { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
    if (!resp.ok) throw Object.assign(new Error(await errText(resp)), { status: resp.status });
    await pumpSSE(resp, (json) => {
      const delta = json.choices && json.choices[0] && json.choices[0].delta;
      if (delta) {
        if (delta.content) { acc += delta.content; onDelta(acc); }
        const rc = delta.reasoning != null ? delta.reasoning : delta.reasoning_content;
        if (rc) { racc += rc; onReasoning(racc); }
      }
      if (json.usage) {
        usage = { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens, cost: json.usage.cost };
        if (usage.cost == null && ref.provider === "deepseek") usage.cost = deepseekCost(ref.model, json.usage);  // DeepSeek 不回 cost，本地按价格表估算
      }
    });
  } else if (prov.kind === "anthropic") {
    const amsgs = messages.map(m => ({ role: m.role, content: toAnthropicContent(m) }));
    const _budget = ({ low: 1024, medium: 4096, high: 12000 })[opts.effort] || 4096;
    const maxTok = opts.reasoning ? Math.max(opts.maxTokens || 4096, _budget + 2048) : (opts.maxTokens || 4096);
    const body = { model: ref.model, messages: amsgs, max_tokens: maxTok, stream: true };
    if (system) body.system = system;
    if (opts.reasoning) body.thinking = { type: "enabled", budget_tokens: _budget };
    else { // sampling params (temperature / top_p / top_k) are all incompatible with extended thinking
      if (opts.temp != null) body.temperature = opts.temp;
      if (opts.topP != null) body.top_p = opts.topP;
      if (opts.topK != null) body.top_k = opts.topK;
    }
    const headers = { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
    const resp = await fetch(prov.base + "/messages", { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal });
    if (!resp.ok) throw Object.assign(new Error(await errText(resp)), { status: resp.status });
    let inTok = 0, outTok = 0;
    await pumpSSE(resp, (json) => {
      if (json.type === "content_block_delta" && json.delta) {
        if (json.delta.type === "text_delta") { acc += json.delta.text; onDelta(acc); }
        else if (json.delta.type === "thinking_delta") { racc += json.delta.thinking; onReasoning(racc); }
      }
      else if (json.type === "message_start" && json.message && json.message.usage) inTok = json.message.usage.input_tokens || 0;
      else if (json.type === "message_delta" && json.usage && json.usage.output_tokens != null) outTok = json.usage.output_tokens;
    });
    usage = { prompt_tokens: inTok, completion_tokens: outTok, cost: undefined };
  } else throw new Error("不支持的提供方类型");

  return { text: acc, reasoning: racc, usage };
}

/* ===================== Chat flow ===================== */
function newConversation() {
  autoScroll = true;
  clearConvSearch();
  // only ever keep one blank conversation — if an empty one already exists, just switch to it
  const blank = state.conversations.find(c => !c.messages || c.messages.length === 0);
  if (blank) {
    state.currentId = blank.id; editingIndex = null; save(); renderAll();
    document.getElementById("input").focus();
    return;
  }
  const c = { id: uid(), title: "新对话", titled: false, model: clone(nextModel), promptId: nextPromptId, webSearch: nextWeb, reasoning: nextReasoning, reasoningEffort: nextReasoningEffort, compaction: null, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  state.conversations.unshift(c);
  state.currentId = c.id; editingIndex = null;
  save(); renderAll();
  document.getElementById("input").focus();
}

// Fork: copy the conversation up to and including message `index` into a brand-new conversation (a branch).
// The original is left untouched; the branch carries the same model / prompt / settings so it continues cleanly.
function forkConversation(index) {
  if (abortController) { toast("正在生成，请先停止或等待完成"); return; }
  const src = currentConv(); if (!src) return;
  if (index < 0 || index >= src.messages.length) return;
  const srcId = src.id;
  // carry the compaction summary only if the branch still includes the whole summarised range
  const compaction = (src.compaction && (index + 1) >= (src.compaction.count || 0)) ? clone(src.compaction) : null;
  const c = {
    id: uid(),
    title: src.title ? src.title + " · 分支" : "分支",
    titled: true,
    model: clone(src.model || nextModel),
    promptId: src.promptId,
    webSearch: src.webSearch,
    reasoning: src.reasoning,
    reasoningEffort: src.reasoningEffort,
    compaction: compaction,
    createdAt: Date.now(), updatedAt: Date.now(),
    messages: clone(src.messages.slice(0, index + 1)),
  };
  state.conversations.unshift(c);
  state.currentId = c.id;
  editingIndex = null; autoScroll = true; nodePinned = null;
  clearConvSearch();
  save(); renderAll();
  toast("已分支到新对话", { label: "回到原对话", fn: () => { state.currentId = srcId; editingIndex = null; save(); renderAll(); } });
}

// DeepSeek 接口不支持图片（image_url 会直接 400）：发送 / 重答前拦截并给出清晰提示。
// PDF 不拦——toOpenAIContent 已对不支持的提供方降级为文字说明，不会炸请求。
function imageBlockFor(ref, conv, extraAtts) {
  if (!ref || ref.provider !== "deepseek") return false;
  const hasImg = (l) => (l || []).some(a => a.kind === "image");
  if (hasImg(extraAtts) || (conv && conv.messages.some(m => hasImg(m.attachments)))) {
    toast("DeepSeek 模型不支持图片，请更换模型或移除图片后再试");
    return true;
  }
  return false;
}

async function sendMessage() {
  closeSlash();
  const input = document.getElementById("input");
  const text = input.value.trim();
  const atts = pending.slice();
  if (!text && !atts.length) return;
  const ref = activeRef();
  if (!ref || !ref.model) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }
  if (imageBlockFor(ref, currentConv(), atts)) return;   // 输入与图片留在原处，便于换模型再发

  let conv = currentConv();
  if (!conv) { newConversation(); conv = currentConv(); }
  conv.messages.push({ role: "user", content: text, attachments: atts });
  conv.updatedAt = Date.now();
  if (!conv.titled && conv.messages.filter(m => m.role === "user").length === 1)
    conv.title = (text || (atts[0] && atts[0].name) || "新对话").slice(0, 30);
  input.value = ""; autoGrow(); pending = []; renderPending();
  maybeTitle(conv);                              // name / update the conversation title (node titles come from the node-map render)
  await runCompletion(conv, { restorable: true });
}

async function runCompletion(conv, opts) {
  const ref = activeRef();
  if (!ref || !ref.model) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }
  if (imageBlockFor(ref, conv, null)) return;   // 覆盖重答 / 继续：整段历史会一并发出，含图历史同样拦截
  conv.model = clone(ref);
  // Regenerate in place (keep the following turns) when given a target index; otherwise append a new turn.
  const at = (opts && typeof opts.regenAt === "number" && conv.messages[opts.regenAt] && conv.messages[opts.regenAt].role === "assistant") ? opts.regenAt : null;
  // 继续生成：保留这条回答已有的内容，从中断处接着写（不清空、不新建）。
  const cont = (at == null && opts && typeof opts.continueAt === "number" && conv.messages[opts.continueAt] && conv.messages[opts.continueAt].role === "assistant") ? opts.continueAt : null;
  let targetIndex, contBase = "";
  if (cont != null) {
    const tg = conv.messages[cont];
    tg.content = (tg.content || "").replace(/\s*_（已停止(?:生成)?）_\s*$/, "");   // 去掉中断标记，正文保留
    contBase = tg.content;
    delete tg.error;
    targetIndex = cont;
  } else if (at != null) {
    const tg = conv.messages[at];
    tg.content = ""; tg.reasoning = ""; delete tg.usage; delete tg.error;
    targetIndex = at;
  } else {
    conv.messages.push({ role: "assistant", content: "" });
    targetIndex = conv.messages.length - 1;
  }
  // A fresh user send arms "undo": after Esc stops it, a SECOND Esc returns the prompt (+attachments) to the box.
  undoSend = null;   // a new turn invalidates any pending undo from a previous stop
  const um = conv.messages[targetIndex - 1];
  restoreOnAbort = (opts && opts.restorable && um && um.role === "user")
    ? { text: um.content || "", attachments: Array.isArray(um.attachments) ? um.attachments.slice() : [] } : null;
  pinTop = null; autoScroll = false; nodePinned = null;   // the pin (below) drives the streaming scroll
  selPointerDown = false;   // clear any stuck selection-press flag from a prior turn (safety; mouseup normally clears it)
  save(); renderMessages(); renderSidebar();
  if (opts && opts.restorable) revealActiveConv({ smooth: true });   // 新发 prompt：当前对话不在可视区时，平滑滚到列表距顶 ~20%

  const box = document.getElementById("messages");
  const row = (at != null || cont != null) ? box.querySelector('.msg-row[data-index="' + targetIndex + '"]') : box.lastElementChild;
  if (!row) { setSending(false); return; }
  const contentEl = row.querySelector(".msg-body > .msg-content");
  const reasoningWrap = row.querySelector(".reasoning");
  const reasoningBody = row.querySelector(".reasoning-body");
  renderAnswer(contentEl, cont != null ? renderMarkdown(contBase) : "", true);

  // Auto-scroll the streaming reply, but STOP once the prompt↔answer boundary reaches ~20% from the top
  // (the answer then fills the lower ~80%). We pin the ANSWER'S TOP — not the prompt's top — so a long prompt
  // scrolls its opening off the top instead of filling the screen and shoving the answer below the fold.
  // Start at the bottom — no jarring jump — and let applyAutoScroll ease toward min(pinTop, maxScroll):
  // follow the bottom until the boundary hits 20%, then hold.
  box.classList.add("streaming");
  if (at == null && cont == null) {
    let ur = row ? row.previousElementSibling : null;
    while (ur && !ur.classList.contains("msg-row")) ur = ur.previousElementSibling;
    // row.offsetTop == bottom of the user row == the conceptual prompt/answer separator (adjacent siblings, no margin)
    pinTop = ur ? Math.max(0, row.offsetTop - Math.round(box.clientHeight * 0.2)) : null;
    box.scrollTop = box.scrollHeight; lastSetTop = box.scrollTop;
  } else {
    pinTop = null;   // in-place regenerate: stream where the answer already sits, don't move the viewport
  }

  setSending(true); abortController = new AbortController();
  if (conv.webSearch && ref.provider !== "openrouter") toast("联网搜索目前仅 OpenRouter 模型支持，本次未联网");

  const d = state.settings.defaults;
  let history = conv.messages.slice(0, cont != null ? cont : (at != null ? at : -1)).map(m => ({ role: m.role, content: m.content, attachments: m.attachments, reasoning: m.reasoning }));
  if (cont != null) {   // 继续生成：带上已有的半截回答 + 一条仅本次请求用的「继续」指令（不入库、不显示）
    history.push({ role: "assistant", content: contBase });
    history.push({ role: "user", content: "继续。直接从上文的中断处接着输出剩余内容，不要重复已输出的部分，不要重新开头，也不要加任何说明。" });
  }
  let system = activePromptText(conv);
  if (conv.compaction) {   // /compact summary OR /newhere divider — both cut the model's context at .count
    const cut = Math.min(conv.compaction.count, history.length);
    const sliced = history.slice(cut);
    if (sliced.length) { // only cut when there is something newer than the boundary
      if (conv.compaction.summary) {   // /compact carries a summary of the dropped history; /newhere drops it silently
        const note = "[以下是此前对话的摘要，请据此继续，无需重复其中内容]\n" + conv.compaction.summary;
        system = system ? (system + "\n\n" + note) : note;
      }
      history = sliced;
    }
  }
  // 让模型用可渲染的 LaTeX 写公式，而不是把 ASCII 公式塞进 ``` 代码块（本界面用 KaTeX 渲染数学）。
  // 只加在面向用户的对话请求上——标题/摘要/节点命名等工具调用不走这里，不受影响。
  const mathHint = "输出数学公式时请使用 LaTeX：行内用 $…$，单独成行用 $$…$$；不要把公式写成纯文本，也不要放进代码块（``` 仅用于真正的程序代码）。";
  system = system ? (system + "\n\n" + mathHint) : mathHint;
  let acc = "", racc = "", usage = null, aborted = false, errInfo = null, answerStarted = false, reasonShown = false;
  // While the user is selecting text in the transcript, don't rebuild the streaming DOM (replacing the
  // selection's anchor node mid-drag snaps the selection to the top of the conversation). Two guards together:
  //  · selPointerDown — covers the press→first-move window where the selection is still collapsed (a chunk
  //    landing then would replace the node under the caret); set on mousedown, cleared on mouseup (listeners below).
  //  · userSelecting() — covers an established (non-collapsed) selection that lingers after the mouse is released.
  // Either way we skip the re-render; acc still advances, and the next un-suppressed chunk (or completion) catches up.
  const userSelecting = () => { const s = window.getSelection && window.getSelection(); return !!(s && !s.isCollapsed && s.rangeCount && box.contains(s.anchorNode)); };
  try {
    const r = await streamChat(ref, { system: system, messages: history }, {
      temp: (d.temp != null && d.temp !== "") ? Number(d.temp) : undefined,
      maxTokens: d.maxTokens ? Number(d.maxTokens) : undefined,
      topP: (d.topP != null && d.topP !== "") ? Number(d.topP) : undefined,
      topK: (d.topK != null && d.topK !== "") ? Number(d.topK) : undefined,
      web: !!conv.webSearch,
      reasoning: !!conv.reasoning,
      effort: conv.reasoningEffort || "medium",
      signal: abortController.signal,
      onDelta: (t) => { acc = t; if (selPointerDown || userSelecting()) return; if (!answerStarted && t.trim()) { answerStarted = true; finishThinking(row); }  /* 回答一开始：思考收起、水晶落到回答首行 */ const full = cont != null ? contBase + t : t; renderAnswer(contentEl, renderMarkdown(full), true); const openTail = ((full.match(/```/g) || []).length % 2) === 1; enhanceCode(contentEl, { openTail }); /* 始终套代码外框（含头栏，稳住块高度、流式中不跳动）；围栏未闭合（代码还在写）时先不高亮/不救回公式——闭合后/完成时再扫。只扫当前这条消息。 */ applyAutoScroll(box); },
      onReasoning: (rt) => { racc = rt; if (selPointerDown || userSelecting()) return; if (reasoningWrap) { if (!reasonShown) { reasonShown = true; reasoningWrap.style.display = "block"; setReasonTitle(reasoningWrap, "思考中"); bindReason(reasoningWrap, row); row.classList.add("thinking"); void reasoningWrap.offsetHeight; setReasonExp(reasoningWrap, "half"); trackCrest(row);  /* 从折叠态动画展开（非 display 直接弹出）；水晶逐帧贴着窗口走 */ } } if (reasoningBody) { reasoningBody.innerHTML = renderMarkdown(rt); const rOpen = ((rt.match(/```/g) || []).length % 2) === 1; enhanceCode(reasoningBody, { openTail: rOpen }); if (reasoningWrap.dataset.exp !== "collapsed") reasoningBody.scrollTop = reasoningBody.scrollHeight; }  /* 思考流式时也高亮代码块（围栏闭合才扫，同正文）；markdown/公式 renderMarkdown 已内联渲染 */ applyAutoScroll(box); },
    });
    acc = r.text || ""; racc = r.reasoning || racc; usage = r.usage;
  } catch (err) {
    if (err.name === "AbortError") { aborted = true; acc = acc + (acc ? "\n\n_（已停止）_" : "_（已停止生成）_"); }
    else errInfo = friendlyError(err);
  }
  // 流式正常结束却完全没有内容（无正文、无思考）→ 当软错误处理：给重试卡片，而不是存一句「（没有返回内容）」占位文本
  if (!aborted && !errInfo && !acc.trim() && !(racc || "").trim()) errInfo = { title: "没有返回内容", body: "模型这次没有输出任何内容，可能是网络波动或模型异常。点「重试」再试一次。" };

  stopCrest(contentEl);
  finishThinking(row);   // 思考结束：标题→思考过程、窗口收起、水晶落回回答（reasoning-only 回复也走到这里）
  box.classList.remove("streaming");
  cancelSmooth();
  setSending(false); abortController = null;

  // 第一次 Esc 已停止生成；若这是一次「全新发送」，记下它，让「再按一次 Esc」可整轮撤销、prompt（+附件）退回输入框。
  const freshSend = (aborted && restoreOnAbort) ? restoreOnAbort : null;
  restoreOnAbort = null;

  const last = conv.messages[targetIndex];
  last.content = (cont != null ? contBase : "") + acc;
  if (racc) last.reasoning = (cont != null && last.reasoning) ? (last.reasoning + "\n\n" + racc) : racc;
  if (usage) {   // 继续生成：两段用量合并计入这条消息（费用累加）
    const ou = (cont != null) ? last.usage : null;
    last.usage = ou ? {
      prompt_tokens: (ou.prompt_tokens || 0) + (usage.prompt_tokens || 0),
      completion_tokens: (ou.completion_tokens || 0) + (usage.completion_tokens || 0),
      cost: (ou.cost != null || usage.cost != null) ? ((ou.cost || 0) + (usage.cost || 0)) : undefined,
    } : usage;
  }
  if (usage) recordDailyUsage(usage);   // 计入「每日 token」统计（贡献图）
  if (errInfo) last.error = errInfo; else delete last.error;   // structured error → inline error block + 重试
  if (aborted) {
    last.stopped = true;   // 被中断的回答 → 操作栏出现「继续」
    if (freshSend) { undoSend = { convId: conv.id, msgIndex: targetIndex, prompt: freshSend.text || "", attachments: (freshSend.attachments || []).slice() }; toast("已停止 · 再按一次 Esc 撤销本次发送"); }
  } else if (!errInfo) delete last.stopped;
  // if this turn was a regenerate / edit-resend, keep the previous answer(s) as switchable variants
  if (!errInfo && opts && Array.isArray(opts.carryVariants) && opts.carryVariants.length) {
    let ui = targetIndex - 1; while (ui >= 0 && conv.messages[ui].role !== "user") ui--;
    const u = ui >= 0 ? conv.messages[ui] : null;
    last.variants = opts.carryVariants.concat([{
      content: acc, reasoning: racc || "", usage: usage || null,
      prompt: u ? (u.content || "") : null,
      attachments: u && Array.isArray(u.attachments) ? u.attachments.slice() : [],
    }]);
    last.vi = last.variants.length - 1;
  }
  save();
  // Final re-render: if the reader was following the stream, land on the true bottom (the whole answer
  // is visible); otherwise keep them exactly where they had scrolled to.
  const keepTop = box.scrollTop;
  const wasFollowing = autoScroll;
  // renderSidebar 会因 innerHTML 重建把侧栏滚动弹回顶部；最后这次 render 保住其滚动位置（保留发送时的定位、不抖回顶部）。
  const convList = document.getElementById("conv-list");
  const sbKeep = convList ? convList.scrollTop : null;
  renderMessages(); renderSidebar();   // pinTop 仍非空 → 这轮 updateScrollBtn 不会误显按钮
  if (sbKeep != null) convList.scrollTop = sbKeep;
  pinTop = null;   // 紧挨着设最终 scrollTop 才释放流式锚定，中间不留「按钮闪一下」的空帧
  box.scrollTop = wasFollowing ? box.scrollHeight : keepTop;
  lastSetTop = box.scrollTop;
  updateScrollBtn();
  updateComposerToggles();   // 刷新压缩按钮上的上下文用量提示
  // 首轮只发了附件时，标题在发送时被延后（那时回答还不存在）；此刻回答已就绪，补一次对话命名（由回答生成）。
  if (!conv.titled) maybeTitle(conv);
}

// 「再按一次 Esc」撤销：仅当当前对话末尾仍是刚才那条「已停止的全新发送」、且输入框为空（用户还没打新内容）时有效。
function canUndoSend() {
  if (!undoSend) return false;
  const inp = document.getElementById("input");
  if (inp && inp.value.trim()) return false;             // 用户已在打新内容 → 不覆盖
  const conv = currentConv();
  if (!conv || conv.id !== undoSend.convId) return false;
  const ai = undoSend.msgIndex;
  if (ai !== conv.messages.length - 1) return false;     // 必须仍是最后一轮
  const a = conv.messages[ai], u = conv.messages[ai - 1];
  return !!(a && a.role === "assistant" && a.stopped && u && u.role === "user");
}
function undoLastSend() {
  if (!canUndoSend()) { undoSend = null; return; }
  const u = undoSend; undoSend = null;
  const conv = currentConv();
  conv.messages.pop();   // 已停止的回答
  conv.messages.pop();   // 对应的用户消息
  if (conv.messages.length === 0) { conv.title = "新对话"; conv.titled = false; }
  save(); renderMessages(); renderSidebar();
  const inp = document.getElementById("input");
  inp.value = u.prompt || ""; autoGrow();
  pending = (u.attachments || []).slice(); renderPending(); inp.focus();
  toast("已撤销发送，提示词退回输入框");
}

// 「继续」：被中断（已停止）的回答从中断处接着生成，保留已有内容，两段用量合并。
function continueGeneration(index) {
  if (abortController) { toast("正在生成，请先停止或等待完成"); return; }
  const conv = currentConv(); if (!conv) return;
  const m = conv.messages[index];
  if (!m || m.role !== "assistant") return;
  runCompletion(conv, { continueAt: index });
}

// Update only the header title (+ hover tooltip) for the current conversation, WITHOUT rebuilding
// the transcript. Calling renderMessages() mid-stream detaches the streaming message element, which
// froze the visible output until completion — the "new conversation's first reply doesn't stream" bug.
function refreshHeaderTitle(conv) {
  if (!conv || conv !== currentConv()) return;
  const te = document.getElementById("conv-title");
  if (!te || te.isContentEditable) return;
  te.textContent = conv.title || "新对话";
  evalTitleFade();
}
// Fade the title's right edge only when it actually overflows the available width.
function evalTitleFade() {
  const h1 = document.getElementById("conv-title");
  if (!h1) return;
  h1.classList.toggle("faded", !h1.isContentEditable && h1.scrollWidth > h1.clientWidth + 1);
}

// Clean a title model's raw output → last non-empty line, stripped of wrapping quotes / trailing punctuation.
function cleanTitle(s) {
  return ((s || "").trim().split("\n").filter(x => x.trim()).pop() || "")
    .replace(/^["'“”『「]+|["'“”』」.。!！?？]+$/g, "").slice(0, 40);
}
// Conversation title — its own focused call (separate from node titles, for reliability). On the first
// message it names from that message; afterwards each turn it re-checks whether the title still fits the
// whole thread and updates if not. Judged from the user's questions only (never the answers); a manually
// edited title is left untouched.
async function maybeTitle(conv) {
  const tref = state.settings.defaults.title;
  if (!tref || !keyOf(tref)) return;
  const prompts = conv.messages.filter(m => m.role === "user" && ((m.content || "").trim() || (m.attachments || []).length));
  if (!prompts.length) return;

  if (!conv.titled) {
    // 用户开场就只发了图片/文件、没有文字 → 没有可命名的提问文本，改由本轮 LLM 回答来起对话标题。
    const first = prompts[0];
    if (isAttachmentOnly(first)) {
      const ans = answerAfter(conv, conv.messages.indexOf(first));
      if (!ans) return;   // 本轮回答还没就绪 → 暂不命名（保持 titled=false），回答完成后由 runCompletion 再次调用
      const sys = "你是对话标题生成器。用户开场只发了图片/文件、没有文字，下面是助手对它的回答。请据回答提炼整个对话的主题，输出一个简短标题：不超过 6 个词、名词短语、使用回答所用的语言。禁止比喻、造句、解释、标点、引号。只输出标题本身。";
      conv.titled = true; save();
      try {
        const r = await streamChat(tref, { system: sys, messages: [{ role: "user", content: (ans.content || "").slice(0, 800) }] }, { temp: 0.3, maxTokens: 256, reasoning: false });
        const t = cleanTitle(r.text);
        if (t) { conv.title = t; save(); renderSidebar(); refreshHeaderTitle(conv); }
      } catch (e) {}
      return;
    }
    const sys = "你是对话标题生成器。根据给到的用户消息，提炼其主题，输出一个简短标题：不超过 6 个词、名词短语、使用消息所用的语言。这是给这条消息起标题，不是回答或执行其中的请求；禁止比喻、造句、解释、标点、引号。例如消息为「用比喻解释相对论」时应输出「相对论 通俗解释」，而不是某个比喻。只输出标题本身。";
    conv.titled = true; save();
    try {
      const r = await streamChat(tref, { system: sys, messages: [{ role: "user", content: plainText(prompts[0]).slice(0, 800) }] }, { temp: 0.3, maxTokens: 256, reasoning: false });
      const t = cleanTitle(r.text);
      if (t) { conv.title = t; save(); renderSidebar(); refreshHeaderTitle(conv); }
    } catch (e) {}
    return;
  }

  if (conv.titleManual || prompts.length < 2) return;
  const list = prompts.map((m, i) => (i + 1) + ". " + plainText(m).replace(/\s+/g, " ").slice(0, 140)).join("\n").slice(0, 1600);
  const sys = "你是对话标题维护器。给你这个对话的【当前标题】和用户【依次提出的问题】，判断标题要不要更新：\n"
    + "- 忽略「你好 / 在吗 / 谢谢」这类开场或客套，标题要反映对话真正的主题；\n"
    + "- 若当前标题只覆盖了开头、或对话主题已经转移 / 变得更具体，就给出更贴切的新标题（不超过 6 个词、名词短语、用对话所用的语言）；\n"
    + "- 只有当前标题确实已经能很好地概括整段对话，才原样输出 KEEP（四个大写字母）。\n"
    + "只输出新标题或 KEEP，禁止解释、标点、引号。";
  const usr = "【当前标题】" + conv.title + "\n\n【用户依次提出的问题】\n" + list;
  try {
    const r = await streamChat(tref, { system: sys, messages: [{ role: "user", content: usr }] }, { temp: 0.2, maxTokens: 256, reasoning: false });
    const lastLine = (r.text || "").trim().split("\n").filter(x => x.trim()).pop() || "";
    if (/^\s*keep\b/i.test(lastLine)) return;          // current title still fits
    const t = cleanTitle(r.text);
    if (t && t !== conv.title && !/keep/i.test(t)) { conv.title = t; save(); renderSidebar(); refreshHeaderTitle(conv); }
  } catch (e) { /* silent background refinement */ }
}

async function compactContext() {
  const conv = currentConv();
  if (!conv || !conv.messages.length) { toast("当前没有可压缩的对话"); return; }
  if (abortController) { toast("正在生成，请先停止或等待完成"); return; }
  const ref = conv.model || nextModel;
  if (!ref || !ref.model) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }

  const start = conv.compaction ? Math.min(conv.compaction.count, conv.messages.length) : 0;
  const toSummarize = conv.messages.slice(start).filter(m => (m.content || "").trim() || (m.attachments || []).length);
  if (!toSummarize.length) { toast("没有新的内容需要压缩"); return; }

  const prior = (conv.compaction && conv.compaction.summary) ? ("【已有摘要】\n" + conv.compaction.summary + "\n\n【后续对话】\n") : "";
  const body = toSummarize.map(m => (m.role === "user" ? "用户" : "助手") + "：" + plainText(m)).join("\n\n");
  const prompt = "你是一个对话压缩器。请把下面的对话压缩成一段简洁但信息完整的摘要，用于在后续对话中替代原文继续交流。务必保留：关键事实与结论、已做出的决定、涉及的代码/数据/数字、尚未完成的任务、用户的偏好与要求。用客观第三人称陈述，不要寒暄或评论。\n\n" + prior + body;

  showStatus("正在压缩上下文…");
  setSending(true, "compact"); abortController = new AbortController();
  try {
    const r = await streamChat(ref, { system: "", messages: [{ role: "user", content: prompt }] }, { temp: 0.3, maxTokens: 1200, signal: abortController.signal });
    const summary = (r.text || "").trim();
    if (!summary) { toast("压缩失败：未返回摘要"); return; }
    conv.compaction = { summary: summary, count: conv.messages.length };
    save(); renderMessages();
    toast("已把 " + toSummarize.length + " 条消息压缩为摘要");
  } catch (e) {
    if (e.name !== "AbortError") toast("压缩失败：" + e.message);
  } finally {
    setSending(false); abortController = null; hideStatus();
  }
}

async function regenerateTitle(conv) {
  if (!conv) return;
  const tref = state.settings.defaults.title;
  if (!tref) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (!keyOf(tref)) { _msProvider = tref.provider; openSettings("services"); toast("请先配置「话题命名模型」的 API Key"); return; }
  const text = conv.messages
    .filter(m => (m.content || "").trim() || (m.attachments || []).length)
    .map(m => (m.role === "user" ? "用户" : "助手") + "：" + plainText(m)).join("\n").slice(0, 2000);
  if (!text.trim()) { toast("对话内容为空，无法生成标题"); return; }
  const sys = "你是对话标题生成器。根据给到的对话内容，提炼其主题，输出一个简短标题：不超过 6 个词、名词短语、使用对话所用的语言。这是为对话起标题，不是回答或续写；禁止比喻、造句、解释、标点、引号。只输出标题本身。";
  showStatus("正在重新生成标题…");
  try {
    const r = await streamChat(tref, { system: sys, messages: [{ role: "user", content: text }] }, { temp: 0.3, maxTokens: 256, reasoning: false });
    let t = ((r.text || "").trim().split("\n").filter(s => s.trim()).pop() || "").replace(/^["'“”『「]+|["'“”』」.。!！?？]+$/g, "").slice(0, 40);
    if (t) { conv.title = t; conv.titled = true; save(); renderSidebar(); refreshHeaderTitle(conv); toast("标题已更新为「" + t + "」"); }
    else toast("生成失败：模型只输出了思考、没给出标题。建议把话题命名模型设为不推理的 deepseek-chat。");
  } catch (e) { toast("生成失败：" + e.message); }
  finally { hideStatus(); }
}

// Inline-rename the current conversation by editing the title text itself (double-click the title).
// No separate input box — the <h1> becomes contentEditable in place, with the text selected.
function startTitleRename() {
  const conv = currentConv(); if (!conv) return;
  const h1 = document.getElementById("conv-title");
  if (!h1 || h1.isContentEditable) return;
  h1.classList.remove("faded");
  h1.contentEditable = "plaintext-only";
  h1.spellcheck = false;
  h1.focus();
  // select the whole title so typing replaces it (or the user can click to place a cursor)
  const sel = window.getSelection(); const range = document.createRange();
  range.selectNodeContents(h1); sel.removeAllRanges(); sel.addRange(range);
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    h1.removeEventListener("keydown", onKey); h1.removeEventListener("blur", onBlur);
    const v = (h1.textContent || "").trim();
    h1.contentEditable = "false";
    if (commit && v && v !== conv.title) { conv.title = v; conv.titled = true; conv.titleManual = true; save(); renderSidebar(); }
    refreshHeaderTitle(conv);   // restore the canonical text + re-evaluate the fade
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(false);   // blur = cancel (only Enter commits) — a stray click no longer silently overwrites the title
  h1.addEventListener("keydown", onKey);
  h1.addEventListener("blur", onBlur);
}
function setSending(sending, reason) {
  const btn = document.getElementById("send");
  if (sending) { btn.classList.remove("disabled"); btn.classList.add("stop"); btn.innerHTML = ic("stop", 16); btn.title = (reason === "compact") ? "停止压缩" : "停止"; }
  else { btn.classList.remove("stop"); btn.innerHTML = ic("send", 18); btn.title = "发送"; updateSendButton(); }
  const rt = document.getElementById("retitle-chat");
  if (rt) rt.disabled = !!sending;   // AI 回答 / 压缩进行中：禁用「重新生成标题」，避免和正文生成抢占
}

/* ===================== Model picker popover (keyboard-navigable) ===================== */
let modelPop = { open: false, index: 0, refs: [] };
function modelRefList() {
  const byProv = {};
  state.settings.models.forEach(m => { (byProv[m.provider] = byProv[m.provider] || []).push(m); });
  const refs = [];
  PROVIDER_ORDER.forEach(pk => { (byProv[pk] || []).forEach(m => refs.push({ provider: pk, model: m.model })); });
  return refs;
}
function buildModelPopover() {
  const pop = document.getElementById("model-pop"); pop.innerHTML = "";
  const byProv = {};
  state.settings.models.forEach(m => { (byProv[m.provider] = byProv[m.provider] || []).push(m); });
  modelPop.refs = modelRefList();
  if (modelPop.index >= modelPop.refs.length) modelPop.index = Math.max(0, modelPop.refs.length - 1);
  let mi = 0, any = false;
  PROVIDER_ORDER.forEach(pk => {
    const models = byProv[pk]; if (!models || !models.length) return;
    any = true;
    const hasKey = !!keyOf({ provider: pk });
    const head = document.createElement("div"); head.className = "pop-head"; head.textContent = PROVIDERS[pk].label + (hasKey ? "" : "（未配置 Key）");
    pop.appendChild(head);
    models.forEach(m => {
      const myIdx = mi++;
      const it = document.createElement("button");
      it.className = "pop-item" + (myIdx === modelPop.index ? " active" : "");
      it.textContent = prettyModel(m.model, m.provider);   // name only — compact; raw id on hover
      it.title = m.model;
      it.onclick = () => pickModel({ provider: pk, model: m.model });
      pop.appendChild(it);
    });
  });
  if (!any) { const e = document.createElement("div"); e.className = "pop-empty"; e.textContent = "去 设置 → 管理模型 添加模型"; pop.appendChild(e); }
  const foot = document.createElement("button"); foot.className = "pop-foot"; foot.textContent = "⚙ 管理模型…";
  foot.onclick = () => { closePopover(); openSettings("services"); };
  pop.appendChild(foot);
}
function highlightModel() {
  const items = document.querySelectorAll("#model-pop .pop-item");
  items.forEach((el, i) => el.classList.toggle("active", i === modelPop.index));
  if (items[modelPop.index]) items[modelPop.index].scrollIntoView({ block: "nearest" });
}
function moveModel(dir) {
  if (!modelPop.open || !modelPop.refs.length) return;
  modelPop.index = (modelPop.index + dir + modelPop.refs.length) % modelPop.refs.length;
  highlightModel();
}
function confirmModel() {
  if (!modelPop.open || !modelPop.refs.length) return;
  const r = modelPop.refs[modelPop.index];
  if (r) pickModel({ provider: r.provider, model: r.model });
}
function openPopover() {
  closePromptPop();
  const cur = activeRef();
  const refs = modelRefList();
  const i = cur ? refs.findIndex(r => r.provider === cur.provider && r.model === cur.model) : -1;
  modelPop.index = i < 0 ? 0 : i;
  modelPop.open = true;
  buildModelPopover();
  const pill = document.getElementById("model-pill"); const r = pill.getBoundingClientRect();
  const pop = document.getElementById("model-pop");
  pop.style.display = "block";
  pop.style.top = "auto";
  pop.style.bottom = (window.innerHeight - r.top + 6) + "px";   // open upward (control bar sits at the bottom)
  pop.style.right = (window.innerWidth - r.right) + "px";
  pop.style.transformOrigin = "bottom";
  highlightModel();
  document.getElementById("input").focus();   // keep focus in composer so arrow keys drive the picker
  setTimeout(() => document.addEventListener("mousedown", outsidePop), 0);
}
function closePopover() { modelPop.open = false; document.getElementById("model-pop").style.display = "none"; document.removeEventListener("mousedown", outsidePop); }
function outsidePop(e) { const pop = document.getElementById("model-pop"); if (!pop.contains(e.target) && e.target.id !== "model-pill") closePopover(); }
function pickModel(ref) { const c = currentConv(); if (c) c.model = clone(ref); else nextModel = clone(ref); save(); closePopover(); renderMessages(); }
function updateModelPill() {
  const ref = activeRef();
  const pill = document.getElementById("model-pill");
  pill.textContent = modelLabel(ref) || "未设置模型";
  pill.dataset.tip = ref ? ((PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " · " + ref.model + "（点击切换）") : "前往设置添加模型";
}

/* ----- System-prompt switcher (header) ----- */
function updatePromptPill() {
  const pill = document.getElementById("prompt-pill"); if (!pill) return;
  const p = promptById(activePromptId());
  const name = p ? p.name : "无提示词";
  pill.innerHTML = "";
  const label = document.createElement("span"); label.className = "pp-label"; label.textContent = name;
  pill.appendChild(label);   // 文字放进内层 span：渐隐 mask 只作用于文字，不波及 pill 的 hover 底色
  pill.dataset.tip = p ? ("系统提示词：" + p.name + "（点击切换）") : "未使用系统提示词（点击切换）";
  // 名称真正溢出时才右侧透明渐隐（短名字到不了右边缘，不会被淡出），判定同顶栏标题
  label.classList.toggle("faded", label.scrollWidth > label.clientWidth + 1);
}
let promptPop = { open: false, index: 0, ids: [] }; // keyboard-navigable, ids[i] = prompt id or null
function buildPromptPopover() {
  const pop = document.getElementById("prompt-pop"); pop.innerHTML = "";
  const head = document.createElement("div"); head.className = "pop-head"; head.textContent = "系统提示词（↑↓ 选择，Enter 确认）"; pop.appendChild(head);
  const items = [{ id: null, name: "无（不使用）" }].concat(state.settings.prompts.map(p => ({ id: p.id, name: p.name || "(未命名)" })));
  promptPop.ids = items.map(it => it.id);
  items.forEach((p, i) => {
    const it = document.createElement("button"); it.className = "pop-item" + (i === promptPop.index ? " active" : "");
    it.textContent = p.name;
    it.onmousedown = (e) => { e.preventDefault(); promptPop.index = i; confirmPrompt(); };
    pop.appendChild(it);
  });
  const foot = document.createElement("button"); foot.className = "pop-foot"; foot.textContent = "✚ 新建 / 管理…";
  foot.onmousedown = (e) => { e.preventDefault(); closePromptPop(); openSettings("prompts"); };
  pop.appendChild(foot);
}
function openPromptPop() {
  closePopover(); closeEffortPop(); closeSlash();
  const active = activePromptId();
  const ids = [null].concat(state.settings.prompts.map(p => p.id));
  promptPop = { open: true, index: Math.max(0, ids.indexOf(active)), ids };
  buildPromptPopover();
  const pill = document.getElementById("prompt-pill"); const r = pill.getBoundingClientRect();
  const pop = document.getElementById("prompt-pop");
  pop.style.display = "block"; pop.style.top = "auto"; pop.style.bottom = (window.innerHeight - r.top + 6) + "px"; pop.style.left = r.left + "px"; pop.style.right = "auto"; pop.style.transformOrigin = "bottom";
  setTimeout(() => document.addEventListener("mousedown", outsidePromptPop), 0);
}
function closePromptPop() { promptPop.open = false; const p = document.getElementById("prompt-pop"); if (p) p.style.display = "none"; document.removeEventListener("mousedown", outsidePromptPop); }
function movePrompt(dir) { if (!promptPop.open) return; const n = promptPop.ids.length; promptPop.index = (promptPop.index + dir + n) % n; buildPromptPopover(); }
function confirmPrompt() { if (!promptPop.open) return; const id = promptPop.ids[promptPop.index]; closePromptPop(); pickPrompt(id); }
function outsidePromptPop(e) { const pop = document.getElementById("prompt-pop"); if (!pop.contains(e.target) && e.target.id !== "prompt-pill") closePromptPop(); }
function pickPrompt(id) { const c = currentConv(); if (c) c.promptId = id; else nextPromptId = id; save(); closePromptPop(); renderMessages(); renderSidebar(); }

/* ----- Reasoning effort: 关 / 低 / 中 / 高 slider (think control + /effort) ----- */
const EFFORT_OPTS = [
  { level: "low", name: "低" },
  { level: "medium", name: "中" },
  { level: "high", name: "高" },
];
const EFFORT_STEPS = ["关", "低", "中", "高"];   // slider index 0..3 (0 = reasoning off)
let effortPop = { open: false, index: 0 };
function effortIndex() {
  if (!activeReasoning()) return 0;
  const li = EFFORT_OPTS.findIndex(o => o.level === activeEffort());
  return li < 0 ? 2 : li + 1;
}
function applyEffortIndex(idx) {
  if (idx <= 0) { const c = currentConv(); if (c) c.reasoning = false; else nextReasoning = false; save(); updateComposerToggles(); }
  else setEffort(EFFORT_OPTS[idx - 1].level);   // setEffort also turns reasoning on
}
function markEffortTicks(pop) {
  pop.querySelectorAll(".es-ticks span").forEach((sp, i) => sp.classList.toggle("on", i === effortPop.index));
}
function buildEffortPop() {
  const pop = document.getElementById("effort-pop"); pop.innerHTML = ""; pop.classList.add("effort-slider-pop");
  const head = document.createElement("div"); head.className = "es-head";
  const ti = document.createElement("span"); ti.className = "es-title"; ti.textContent = "思考强度";
  const cur = document.createElement("span"); cur.className = "es-cur"; cur.textContent = EFFORT_STEPS[effortPop.index];
  head.append(ti, cur); pop.appendChild(head);
  const ends = document.createElement("div"); ends.className = "es-ends";
  const e1 = document.createElement("span"); e1.textContent = "更快";
  const e2 = document.createElement("span"); e2.textContent = "更强";
  ends.append(e1, e2); pop.appendChild(ends);
  const range = document.createElement("input"); range.type = "range"; range.className = "es-range";
  range.min = "0"; range.max = "3"; range.step = "1"; range.value = String(effortPop.index);
  range.addEventListener("input", () => {
    effortPop.index = Number(range.value);
    cur.textContent = EFFORT_STEPS[effortPop.index];
    markEffortTicks(pop);
    applyEffortIndex(effortPop.index);
  });
  pop.appendChild(range);
  const ticks = document.createElement("div"); ticks.className = "es-ticks";
  EFFORT_STEPS.forEach((s) => { const sp = document.createElement("span"); sp.textContent = s; ticks.appendChild(sp); });
  pop.appendChild(ticks); markEffortTicks(pop);
}
function openEffortPop() {
  closeSlash(); closePopover(); closePromptPop();
  effortPop = { open: true, index: effortIndex() };
  buildEffortPop();
  const btn = document.getElementById("think-btn"); const r = btn.getBoundingClientRect();
  const pop = document.getElementById("effort-pop");
  pop.style.display = "block"; pop.style.top = "auto"; pop.style.left = "auto";
  pop.style.right = (window.innerWidth - r.right) + "px";
  pop.style.bottom = (window.innerHeight - r.top + 6) + "px";
  pop.style.transformOrigin = "bottom";
  setTimeout(() => document.addEventListener("mousedown", outsideEffortPop), 0);
}
function closeEffortPop() { effortPop.open = false; const p = document.getElementById("effort-pop"); if (p) p.style.display = "none"; document.removeEventListener("mousedown", outsideEffortPop); }
function outsideEffortPop(e) { const pop = document.getElementById("effort-pop"); if (pop && !pop.contains(e.target) && e.target.id !== "think-btn") closeEffortPop(); }
function moveEffort(dir) {
  if (!effortPop.open) return;
  effortPop.index = Math.max(0, Math.min(3, effortPop.index + dir));
  const pop = document.getElementById("effort-pop");
  const range = pop.querySelector(".es-range"); if (range) range.value = String(effortPop.index);
  const cur = pop.querySelector(".es-cur"); if (cur) cur.textContent = EFFORT_STEPS[effortPop.index];
  markEffortTicks(pop);
  applyEffortIndex(effortPop.index);
}
function confirmEffort() { closeEffortPop(); }

/* ===================== Settings ===================== */
let orCatalog = []; // cached OpenRouter model catalog [{id, name}]

function openSettings(section, focusId) { fillSettings(); const ss = document.getElementById("set-search"); if (ss) ss.value = ""; filterSettingsNav(""); switchSection(section || (state && state.settings.lastSection) || "general"); document.getElementById("modal-bg").classList.add("show"); syncTitleBarOverlay(); requestAnimationFrame(() => { const t = focusId ? document.getElementById(focusId) : null; if (t) { t.focus(); if (t.select) t.select(); } else { const md = document.getElementById("modal"); if (md) md.focus(); } }); }   // 默认只把焦点落在弹窗本身（保证 Esc/Tab 生效），不自动聚焦搜索框
// Keep Tab focus inside a modal (a dialog the user can't Tab out of). Cycles among the visible focusable
// descendants; hidden sections (display:none) are skipped automatically (offsetParent === null).
function trapTab(container, e) {
  if (e.key !== "Tab") return;
  const f = [...container.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function closeSettings() { cancelShortcutRecording(); document.getElementById("modal-bg").classList.remove("show"); syncTitleBarOverlay(); maybeShowGuide(); }
function switchSection(sec) {
  document.querySelectorAll("#modal-nav .nav-item").forEach(b => b.classList.toggle("active", b.dataset.sec === sec));
  document.querySelectorAll("#modal-sections section").forEach(s => s.classList.toggle("hidden", s.dataset.sec !== sec));
  if (state && state.settings.lastSection !== sec) { state.settings.lastSection = sec; save(); }   // reopen on this page next time
  if (sec === "services") renderServices();
  if (sec === "prompts") refreshPromptsSection();
  if (sec === "defaults") {
    populateModelSelect(document.getElementById("chat-model-sel"), state.settings.defaults.chat);
    populateModelSelect(document.getElementById("title-model-sel"), state.settings.defaults.title);
  }
  if (sec === "quick") {
    populateQuickModelSelect();
    const sc = document.getElementById("set-quick-shortcut");
    if (sc) sc.textContent = fmtAccel(state.settings.quick.shortcut || defaultQuick());
    requestAnimationFrame(() => autoGrowEl(document.getElementById("set-quick-concise"), 360));
  }
  if (sec === "shortcuts") {
    const om = document.getElementById("set-openmain-shortcut");
    if (om) om.textContent = fmtAccel(state.settings.quick.openMainShortcut || defaultOpenMain());
  }
  if (sec === "stats") renderStats();
  if (sec === "data") { fillDataStats(); renderArchiveSettings(); }
  if (sec === "about") { fillAbout(); aboutCheckUpdate(); }
}

// Live settings search (top-left of the modal): filter nav items by label + data-keywords, hide now-empty
// group headers, and jump to the first match if the active section got filtered away.
function filterSettingsNav(q) {
  q = (q || "").trim().toLowerCase();
  const items = Array.from(document.querySelectorAll("#modal-nav .nav-item"));
  items.forEach(b => {
    const hay = (b.textContent + " " + (b.dataset.keywords || "")).toLowerCase();
    b.classList.toggle("hidden", q !== "" && !hay.includes(q));
  });
  const kids = Array.from(document.querySelectorAll("#nav-scroll > .nav-group, #nav-scroll > .nav-item"));
  for (let i = 0; i < kids.length; i++) {
    if (!kids[i].classList.contains("nav-group")) continue;
    let anyVisible = false;
    for (let j = i + 1; j < kids.length && !kids[j].classList.contains("nav-group"); j++) {
      if (!kids[j].classList.contains("hidden")) { anyVisible = true; break; }
    }
    kids[i].classList.toggle("hidden", q !== "" && !anyVisible);
  }
  const firstVisible = items.find(b => !b.classList.contains("hidden"));
  // zero-result note (otherwise the nav column just goes blank with no explanation)
  let note = document.getElementById("nav-empty");
  if (q !== "" && !firstVisible) {
    if (!note) { note = document.createElement("div"); note.id = "nav-empty"; note.className = "nav-empty"; (document.getElementById("nav-scroll") || document.getElementById("modal-nav")).appendChild(note); }
    note.textContent = "无匹配设置"; note.style.display = "";
  } else if (note) note.style.display = "none";
  if (q !== "" && firstVisible) {
    const active = document.querySelector("#modal-nav .nav-item.active");
    if (!active || active.classList.contains("hidden")) switchSection(firstVisible.dataset.sec);
  }
}
function bindSettingsSearch() {
  const inp = document.getElementById("set-search"); if (!inp) return;
  inp.addEventListener("input", () => filterSettingsNav(inp.value));
  inp.addEventListener("keydown", (e) => { if (e.key === "Escape" && inp.value) { e.stopPropagation(); inp.value = ""; filterSettingsNav(""); } });   // 只有有文字时才吞 Esc 去清空；空框放行冒泡，让首个 Esc 能关设置
}

// ----- Data backup / restore -----
function fillDataStats() {
  const el = document.getElementById("data-stats"); if (!el) return;
  const c = (state.conversations || []).length, a = (state.archived || []).length;
  const keyed = PROVIDER_ORDER.filter(pk => state.settings.providers[pk] && state.settings.providers[pk].key).length;
  const p = (state.settings.prompts || []).length, m = (state.settings.models || []).length;
  el.textContent = `当前：${c} 个对话 · ${a} 个已归档 · ${m} 个模型 · ${p} 套提示词 · ${keyed} 个已配置 Key 的服务商。`;
}
async function exportAllData() {
  if (!window.chatbox || !window.chatbox.exportData) { toast("导出不可用"); return; }
  const bundle = { app: "Quartz", kind: "quartz-backup", schema: 1, exportedAt: new Date().toISOString(), state };
  try {
    const res = await window.chatbox.exportData(JSON.stringify(bundle, null, 2));
    if (res && res.ok) toast("已导出到：" + res.path);
    else if (res && res.canceled) { /* user cancelled */ }
    else toast("导出失败：" + ((res && res.error) || "未知错误"));
  } catch (e) { toast("导出失败：" + e.message); }
}
async function importAllData() {
  if (!window.chatbox || !window.chatbox.importData) { toast("导入不可用"); return; }
  let res;
  try { res = await window.chatbox.importData(); } catch (e) { toast("导入失败：" + e.message); return; }
  if (!res || res.canceled) return;
  if (!res.ok) { toast("导入失败：" + (res.error || "未知错误")); return; }
  let data; try { data = JSON.parse(res.json); } catch (e) { toast("文件不是有效的 JSON"); return; }
  // Accept either a wrapped backup ({app,kind,state}) or a bare state object.
  const incoming = (data && data.state && data.state.settings) ? data.state : (data && data.settings ? data : null);
  if (!incoming || !incoming.settings || !incoming.settings.providers) { toast("不是有效的 Quartz 备份文件"); return; }
  const nConv = (incoming.conversations || []).length, nArch = (incoming.archived || []).length;
  const ok = await confirmDialog({
    title: "导入数据",
    body: `将导入 ${nConv} 个对话、${nArch} 个已归档，并覆盖当前的全部对话与设置（含 API Key）。此操作不可撤销，确定继续？`,
    okText: "覆盖并导入", danger: true,
  });
  if (!ok) return;
  try {
    const ns = ensureShape(incoming);
    await persist(ns);
    toast("导入成功，正在重新加载…");
    setTimeout(() => location.reload(), 600);
  } catch (e) { toast("导入失败：" + e.message); }
}
// ---- 从自动备份恢复（设置 → 数据）----
async function fillBackupList() {
  const sel = document.getElementById("set-backup-sel"); if (!sel) return;
  const btn = document.getElementById("set-backup-restore");
  sel.innerHTML = "";
  let items = [];
  try { items = (window.chatbox && window.chatbox.listBackups) ? (await window.chatbox.listBackups() || []) : []; } catch (e) {}
  if (!items.length) {
    const o = document.createElement("option"); o.value = ""; o.textContent = "暂无自动备份"; sel.appendChild(o);
    sel.disabled = true; if (btn) btn.disabled = true;
    return;
  }
  sel.disabled = false; if (btn) btn.disabled = false;
  const pad = (x) => String(x).padStart(2, "0");
  items.forEach(it => {
    const d = new Date(it.mtime);
    const o = document.createElement("option");
    o.value = it.name;
    o.textContent = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + " · " + Math.max(1, Math.round(it.size / 1024)) + " KB";
    sel.appendChild(o);
  });
}
async function restoreBackup() {
  const sel = document.getElementById("set-backup-sel");
  const name = sel && sel.value; if (!name) return;
  let res;
  try { res = await window.chatbox.readBackup(name); } catch (e) { toast("读取备份失败：" + e.message); return; }
  if (!res || !res.ok) { toast("读取备份失败：" + ((res && res.error) || "未知错误")); return; }
  let data; try { data = JSON.parse(res.json); } catch (e) { toast("备份文件已损坏"); return; }
  const incoming = (data && data.state && data.state.settings) ? data.state : null;
  if (!incoming || !incoming.settings || !incoming.settings.providers) { toast("不是有效的 Quartz 备份"); return; }
  const nConv = (incoming.conversations || []).length, nArch = (incoming.archived || []).length;
  const ok = await confirmDialog({
    title: "从自动备份恢复",
    body: `将恢复 ${nConv} 个对话、${nArch} 个已归档，并覆盖当前的全部对话与设置。自动备份不含 API Key，现有 Key 会保留。此操作不可撤销，确定继续？`,
    okText: "恢复", danger: true,
  });
  if (!ok) return;
  try {
    const ns = ensureShape(incoming);
    // 自动备份写入时剥掉了 API Key —— 恢复时把当前已配置的 Key 带回去
    for (const pk of Object.keys((state.settings && state.settings.providers) || {})) {
      const cur = state.settings.providers[pk];
      if (cur && cur.key) {
        ns.settings.providers[pk] = ns.settings.providers[pk] || {};
        if (!ns.settings.providers[pk].key) ns.settings.providers[pk].key = cur.key;
      }
    }
    await persist(ns);
    toast("恢复成功，正在重新加载…");
    setTimeout(() => location.reload(), 600);
  } catch (e) { toast("恢复失败：" + e.message); }
}
// The quick-bar model picker: a "follow default" option plus every enabled model.
function populateQuickModelSelect() {
  const sel = document.getElementById("set-quick-model"); if (!sel) return;
  sel.innerHTML = "";
  const dchat = state.settings.defaults.chat;
  const def = document.createElement("option");
  def.value = "__default__";
  def.textContent = "跟随默认";   // model name shown in the row hint instead — keeps the select from overflowing
  sel.appendChild(def);
  const hint = document.getElementById("quick-model-hint");
  if (hint) hint.textContent = dchat ? ("「跟随默认」即 " + prettyModel(dchat.model, dchat.provider)) : "请先在「默认模型」里设置默认对话模型";
  state.settings.models.forEach(m => {
    const o = document.createElement("option"); o.value = refKey(m);
    o.textContent = modelLabel(m); o.title = (PROVIDERS[m.provider] ? PROVIDERS[m.provider].label : m.provider) + " · " + m.model;
    sel.appendChild(o);
  });
  const qm = state.settings.quick.model;
  if (qm && qm.provider && qm.model) {
    if (!state.settings.models.some(m => modelsEqual(m, qm))) {
      const o = document.createElement("option"); o.value = refKey(qm);
      o.textContent = (PROVIDERS[qm.provider] ? PROVIDERS[qm.provider].label : qm.provider) + " · " + qm.model;
      sel.appendChild(o);
    }
    sel.value = refKey(qm);
  } else sel.value = "__default__";
}
// Format an Electron accelerator ("Cmd+Alt+Space") for display ("⌘⌥Space").
function isMacPlatform() {
  const dp = document.documentElement.dataset.platform;
  if (dp) return dp === "mac";
  if (window.chatbox && window.chatbox.platform) return window.chatbox.platform === "darwin";
  return /Mac/i.test(navigator.platform || navigator.userAgent || "");
}
function fmtAccel(acc) {
  if (!acc) return "—";
  if (isMacPlatform()) {
    const sym = { Cmd: "⌘", Command: "⌘", CmdOrCtrl: "⌘", Ctrl: "⌃", Control: "⌃", Alt: "⌥", Option: "⌥", Shift: "⇧", Super: "⌘", Meta: "⌘", Return: "↩", Enter: "↩", Space: "Space", Escape: "Esc" };
    return acc.split("+").map(p => sym[p] || p).join("");
  }
  // Windows / Linux: spelled-out modifier labels joined with "+"
  const sym = { Cmd: "Win", Command: "Win", CmdOrCtrl: "Ctrl", Ctrl: "Ctrl", Control: "Ctrl", Alt: "Alt", Option: "Alt", Shift: "Shift", Super: "Win", Meta: "Win", Return: "Enter", Enter: "Enter", Space: "Space", Escape: "Esc" };
  return acc.split("+").map(p => sym[p] || p).join("+");
}
// Default global shortcuts. Quick-ask is ⌥/Alt+Space on both platforms; open-main mirrors macOS ⌘⇧L as Alt+Shift+L on Windows.
function defaultQuick() { return "Alt+Space"; }
function defaultOpenMain() { return isMacPlatform() ? "Cmd+Shift+L" : "Alt+Shift+L"; }
// A KeyboardEvent's physical key → an Electron accelerator key token (layout-independent via e.code).
function codeToKey(code, key) {
  code = code || "";
  let m;
  if (m = /^Key([A-Z])$/.exec(code)) return m[1];
  if (m = /^Digit(\d)$/.exec(code)) return m[1];
  if (m = /^F(\d{1,2})$/.exec(code)) return "F" + m[1];
  if (m = /^Numpad(\d)$/.exec(code)) return "num" + m[1];
  const map = {
    Space: "Space", Enter: "Return", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  };
  return map[code] || null;
}
function populateModelSelect(sel, currentRef) {
  sel.innerHTML = "";
  const list = state.settings.models.slice();
  if (currentRef && !list.some(m => modelsEqual(m, currentRef))) list.unshift(currentRef);
  if (!list.length) { const o = document.createElement("option"); o.value = ""; o.textContent = "（请先在「管理模型」中添加模型）"; sel.appendChild(o); return; }
  list.forEach(m => { const o = document.createElement("option"); o.value = refKey(m); o.textContent = modelLabel(m); o.title = (PROVIDERS[m.provider] ? PROVIDERS[m.provider].label : m.provider) + " · " + m.model; sel.appendChild(o); });
  if (currentRef) sel.value = refKey(currentRef);
}
async function fillAbout() {
  try {
    const info = (window.chatbox && window.chatbox.getAppInfo) ? await window.chatbox.getAppInfo() : null;
    if (!info) return;
    const v = document.getElementById("about-version"); if (v) v.textContent = "v" + info.version;
    const m = document.getElementById("about-meta"); if (m) m.textContent = "Electron " + info.electron + " · Chromium " + info.chrome;
  } catch (e) {}
  // Render the bundled CHANGELOG.md (release history) into 关于 — fetched once per session.
  try {
    const el = document.getElementById("about-changelog");
    if (el && !el._loaded && window.chatbox && window.chatbox.getChangelog) {
      const md = await window.chatbox.getChangelog();
      if (md) {
        const i = md.indexOf("## ");                       // drop the H1 title + intro line
        el.innerHTML = renderMarkdown(i >= 0 ? md.slice(i) : md);
        el._loaded = true;
      }
    }
  } catch (e) {}
}
// The editable concise-prompt box is only relevant in the "简洁速答" mode.
function toggleConciseField() {
  const f = document.getElementById("quick-concise-field");
  if (f) f.style.display = (!state.settings.quick.promptMode || state.settings.quick.promptMode === "concise") ? "" : "none";
}
function fillSettings() {
  const p = state.settings.providers;
  PROVIDER_ORDER.forEach(pk => { const el = document.getElementById("key-" + pk); if (el) el.value = (p[pk] && p[pk].key) || ""; });
  updateKeyDots();
  PROVIDER_ORDER.forEach(pk => { const st = document.getElementById("keystat-" + pk); if (st) { st.textContent = ""; st.className = "key-test-status"; } });
  const a = state.settings.appearance;
  setSeg("set-theme-seg", a.theme || "auto");
  renderAccentSwatches();
  document.getElementById("set-font").value = a.fontFamily;
  document.getElementById("set-fontsize").value = a.fontSize;
  document.getElementById("fontsize-val").textContent = a.fontSize + "px";
  setSeg("set-density-seg", a.density || "comfortable");
  document.getElementById("set-width").value = a.contentPct || 90;
  document.getElementById("width-val").textContent = (a.contentPct || 90) + "%";
  setSeg("set-codetheme-seg", a.codeTheme || "muted");
  renderSettingsPreview();
  const d = state.settings.defaults;
  populateModelSelect(document.getElementById("chat-model-sel"), d.chat);
  populateModelSelect(document.getElementById("title-model-sel"), d.title);
  document.getElementById("set-temp").value = d.temp != null ? d.temp : 1;
  document.getElementById("set-maxtok").value = d.maxTokens || "";
  document.getElementById("set-topp").value = d.topP != null ? d.topP : "";
  document.getElementById("set-topk").value = d.topK != null ? d.topK : "";
  // quick-ask bar
  const q = state.settings.quick;
  setToggle("set-quick-enabled-tog", q.enabled !== false);
  if (window.chatbox && window.chatbox.getLoginItem) window.chatbox.getLoginItem().then(on => setToggle("set-login-tog", on)).catch(() => {});   // reflect the OS login-item state
  const scBtn = document.getElementById("set-quick-shortcut"); if (scBtn) scBtn.textContent = fmtAccel(q.shortcut || defaultQuick());
  setShortcutHint("quick-shortcut-hint", "", false);
  populateQuickModelSelect();
  setSeg("set-quick-prompt-seg", q.promptMode || "concise");
  const ce = document.getElementById("set-quick-concise"); if (ce) ce.value = (q.concisePrompt != null ? q.concisePrompt : QUICK_PROMPT);
  toggleConciseField();
  setToggle("set-quick-blur-tog", q.closeOnBlur !== false);
  document.getElementById("set-quick-width").value = q.width || 720;
  document.getElementById("quick-width-val").textContent = (q.width || 720) + "px";
  document.getElementById("set-quick-top").value = q.topPct != null ? q.topPct : 18;
  document.getElementById("quick-top-val").textContent = (q.topPct != null ? q.topPct : 18) + "%";
  setToggle("set-openmain-enabled-tog", q.openMainEnabled !== false);
  const omBtn = document.getElementById("set-openmain-shortcut"); if (omBtn) omBtn.textContent = fmtAccel(q.openMainShortcut || defaultOpenMain());
  setShortcutHint("openmain-shortcut-hint", "", false);
  // network proxy
  const px = state.settings.proxy || {};
  setToggle("set-proxy-enabled-tog", !!px.enabled);
  setSeg("set-proxy-scheme-seg", px.scheme === "socks5" ? "socks5" : "http");
  document.getElementById("set-proxy-host").value = px.host || "";
  document.getElementById("set-proxy-port").value = px.port || "";
  const ps = document.getElementById("proxy-test-status"); if (ps) { ps.textContent = ""; ps.className = "key-test-status"; }
  // general
  const g = state.settings.general || {};
  const un = document.getElementById("set-username"); if (un) un.value = (state.settings.profile && state.settings.profile.name) || "";
  renderProfileSettings();
  setToggle("set-restorelast-tog", g.restoreLast !== false);
  setSeg("set-sidebarsort-seg", g.sidebarSort === "created" ? "created" : "updated");
  fillBackupList();   // 数据页的「从自动备份恢复」下拉（异步填充）
  if (window.chatbox && window.chatbox.getAutoUpdate) window.chatbox.getAutoUpdate().then(on => setToggle("set-autoupdate-tog", on)).catch(() => {});   // reflect the main-process auto-update flag
}

// ---- segmented controls ----
function setSeg(id, val) { document.querySelectorAll("#" + id + " button").forEach(b => b.classList.toggle("on", b.dataset.val === val)); }
function bindSeg(id, onPick) { document.querySelectorAll("#" + id + " button").forEach(b => b.onclick = () => { setSeg(id, b.dataset.val); onPick(b.dataset.val); }); }

// ---- toggle switches (monochrome on/off) ----
function setToggle(id, on) { const t = document.getElementById(id); if (t) { t.classList.toggle("on", !!on); t.setAttribute("aria-checked", on ? "true" : "false"); } }
function bindToggle(id, fn) { const t = document.getElementById(id); if (t) t.onclick = () => { const on = !t.classList.contains("on"); setToggle(id, on); fn(on); }; }

// ---- appearance live preview ----
function renderSettingsPreview() {
  const body = document.getElementById("set-preview-body"); if (!body) return;
  body.classList.toggle("dense", (state.settings.appearance.density || "comfortable") === "compact");
  const code = body.querySelector("pre > code");
  if (code && window.hljs && !code.dataset.highlighted) { try { hljs.highlightElement(code); } catch (e) {} }
}

// ---- API key field decoration: status dot, show/hide eye, test connection ----
function decorateKeyFields() {
  PROVIDER_ORDER.forEach(pk => {
    const input = document.getElementById("key-" + pk); if (!input) return;
    const field = input.closest(".key-field"); if (!field || field.dataset.decorated) return;
    field.dataset.decorated = "1";
    const main = field.querySelector(".key-label-main");
    if (main && !document.getElementById("keydot-" + pk)) { const dot = document.createElement("span"); dot.className = "key-dot"; dot.id = "keydot-" + pk; main.prepend(dot); }
    const wrap = document.createElement("div"); wrap.className = "key-input-wrap";
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const eye = document.createElement("button"); eye.type = "button"; eye.className = "key-eye"; eye.title = "显示 / 隐藏"; eye.innerHTML = ic("eye", 16);
    eye.onclick = () => { const show = input.type === "password"; input.type = show ? "text" : "password"; eye.innerHTML = ic(show ? "eye-off" : "eye", 16); };
    wrap.appendChild(eye);
    const row = document.createElement("div"); row.className = "key-row2";
    const test = document.createElement("button"); test.type = "button"; test.className = "btn small key-test"; test.textContent = "测试连接";
    const status = document.createElement("span"); status.className = "key-test-status"; status.id = "keystat-" + pk;
    test.onclick = () => testProvider(pk, test, status);
    row.appendChild(test); row.appendChild(status); field.appendChild(row);
  });
}
function updateKeyDots() {
  PROVIDER_ORDER.forEach(pk => {
    const d = document.getElementById("keydot-" + pk); if (!d) return;
    const k = state.settings.providers[pk]; d.classList.toggle("on", !!(k && k.key && k.key.trim()));
  });
}
async function testProvider(pk, btn, status) {
  const k = (state.settings.providers[pk] && state.settings.providers[pk].key || "").trim();
  status.className = "key-test-status";
  if (!k) { status.textContent = "请先填入 Key"; status.classList.add("bad"); return; }
  const old = btn.textContent; btn.disabled = true; btn.textContent = "测试中…"; status.textContent = "";
  try {
    const prov = PROVIDERS[pk];
    const headers = prov.kind === "anthropic"
      ? { "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
      : { "Authorization": "Bearer " + k };
    const resp = await fetch(prov.base + "/models", { headers });
    if (resp.ok) { status.textContent = "✓ 连接正常"; status.classList.add("ok"); }
    else if (resp.status === 401 || resp.status === 403) { status.textContent = "✗ Key 无效（" + resp.status + "）"; status.classList.add("bad"); }
    else { status.textContent = "✗ 返回 " + resp.status; status.classList.add("bad"); }
  } catch (e) { status.textContent = "✗ 网络错误，请检查网络 / 代理"; status.classList.add("bad"); }
  finally { btn.disabled = false; btn.textContent = old; }
}

// ---- settings: nav icons + instant-apply wiring; called once at boot ----
function decorateSettingsNav() {
  const map = { general: "gear", stats: "chart", services: "cube", prompts: "chat", appearance: "sun", defaults: "sliders", quick: "zap", shortcuts: "command", network: "globe", data: "database", about: "info" };
  document.querySelectorAll("#modal-nav .nav-item").forEach(b => {
    const name = map[b.dataset.sec];
    if (name && !b.querySelector(".ic")) b.insertAdjacentHTML("afterbegin", ic(name, 16));
  });
}
function setupSettingsLive() {
  decorateSettingsNav();
  decorateKeyFields();
  PROVIDER_ORDER.forEach(pk => {
    const el = document.getElementById("key-" + pk); if (!el) return;
    el.addEventListener("input", () => {
      const had = !!(state.settings.providers[pk] && state.settings.providers[pk].key);
      state.settings.providers[pk] = { key: el.value.trim() };
      updateKeyDots();
      if (!had && el.value.trim()) onProviderConnected(pk);   // first time this provider gets a key
      save();
      const emp = document.getElementById("empty");
      if (emp && emp.style.display !== "none") updateEmptyHint();   // home page is open behind settings — refresh its hint/guide live
    });
  });
  bindSeg("set-theme-seg", v => { state.settings.appearance.theme = v; applyTheme(); save(); });
  document.getElementById("set-font").addEventListener("change", e => { state.settings.appearance.fontFamily = e.target.value; applyFont(); renderSettingsPreview(); save(); });
  document.getElementById("set-fontsize").addEventListener("input", e => {
    const n = Number(e.target.value) || 15; state.settings.appearance.fontSize = n;
    document.getElementById("fontsize-val").textContent = n + "px"; applyFont(); save();
  });
  bindSeg("set-density-seg", v => { state.settings.appearance.density = v; applyDensity(); renderSettingsPreview(); save(); });
  document.getElementById("set-width").addEventListener("input", e => {
    setContentPct(Number(e.target.value), true);
    document.getElementById("width-val").textContent = (state.settings.appearance.contentPct || 90) + "%";
  });
  bindSeg("set-codetheme-seg", v => { state.settings.appearance.codeTheme = v; applyCodeTheme(); save(); });
  document.getElementById("chat-model-sel").addEventListener("change", e => {
    if (!e.target.value) return;
    const d = state.settings.defaults; d.chat = parseRefKey(e.target.value);
    nextModel = clone(d.chat);
    const c = currentConv(); if (c && c.messages.length === 0) c.model = clone(d.chat);
    save(); updateModelPill();
  });
  document.getElementById("title-model-sel").addEventListener("change", e => { if (e.target.value) { state.settings.defaults.title = parseRefKey(e.target.value); save(); } });
  document.getElementById("set-temp").addEventListener("change", e => { const t = e.target.value; state.settings.defaults.temp = t === "" ? null : Number(t); save(); });
  document.getElementById("set-maxtok").addEventListener("change", e => { const mt = e.target.value; state.settings.defaults.maxTokens = mt === "" ? null : Number(mt); save(); });
  document.getElementById("set-topp").addEventListener("change", e => { const v = e.target.value; state.settings.defaults.topP = v === "" ? null : Number(v); save(); });
  document.getElementById("set-topk").addEventListener("change", e => { const v = e.target.value; state.settings.defaults.topK = v === "" ? null : Number(v); save(); });
  // ---- quick-ask bar ----
  bindToggle("set-quick-enabled-tog", on => { state.settings.quick.enabled = on; save(); });
  bindToggle("set-login-tog", on => { if (window.chatbox && window.chatbox.setLoginItem) window.chatbox.setLoginItem(on); });
  // ---- general ----
  bindToggle("set-autoupdate-tog", on => { if (window.chatbox && window.chatbox.setAutoUpdate) window.chatbox.setAutoUpdate(on); });
  bindToggle("set-restorelast-tog", on => { state.settings.general.restoreLast = on; save(); });
  bindSeg("set-sidebarsort-seg", v => { state.settings.general.sidebarSort = (v === "created") ? "created" : "updated"; save(); renderSidebar(); });
  // ---- profile: name + avatar ----
  { const un = document.getElementById("set-username");
    if (un) un.addEventListener("input", () => { state.settings.profile.name = un.value; save(); renderProfileSettings(); renderEmptyGreeting(); renderSidebarProfile(); });
    const ab = document.getElementById("set-avatar-btn"), ai = document.getElementById("avatar-input");
    if (ab && ai) ab.onclick = () => ai.click();
    if (ai) ai.onchange = (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) setAvatarFromFile(f); };
    const ar = document.getElementById("set-avatar-remove");
    if (ar) ar.onclick = (e) => { e.preventDefault(); state.settings.profile.avatar = ""; save(); renderProfileSettings(); renderEmptyGreeting(); renderSidebarProfile(); }; }
  { const sg = document.getElementById("set-show-guide"); if (sg) sg.onclick = openGuide; }
  bindSeg("set-quick-prompt-seg", v => { state.settings.quick.promptMode = v; toggleConciseField(); save(); });
  (function () {
    const ce = document.getElementById("set-quick-concise");
    if (ce) ce.addEventListener("input", () => { state.settings.quick.concisePrompt = ce.value; autoGrowEl(ce, 360); save(); });
    const cr = document.getElementById("quick-concise-reset");
    if (cr) cr.addEventListener("click", (e) => { e.preventDefault(); state.settings.quick.concisePrompt = QUICK_PROMPT; if (ce) ce.value = QUICK_PROMPT; autoGrowEl(ce, 360); save(); });
  })();
  bindToggle("set-quick-blur-tog", on => { state.settings.quick.closeOnBlur = on; save(); });
  document.getElementById("set-quick-model").addEventListener("change", e => { const v = e.target.value; state.settings.quick.model = (v === "__default__") ? null : parseRefKey(v); save(); });
  document.getElementById("set-quick-width").addEventListener("input", e => { const n = Number(e.target.value) || 720; state.settings.quick.width = n; document.getElementById("quick-width-val").textContent = n + "px"; save(); });
  document.getElementById("set-quick-top").addEventListener("input", e => { const n = Number(e.target.value); state.settings.quick.topPct = n; document.getElementById("quick-top-val").textContent = n + "%"; save(); });
  bindToggle("set-openmain-enabled-tog", on => { state.settings.quick.openMainEnabled = on; save(); });
  document.getElementById("quick-shortcut-reset").addEventListener("click", e => {
    e.preventDefault();
    state.settings.quick.shortcut = defaultQuick();
    document.getElementById("set-quick-shortcut").textContent = fmtAccel(defaultQuick());
    setShortcutHint("quick-shortcut-hint", "", false); save();
  });
  document.getElementById("openmain-shortcut-reset").addEventListener("click", e => {
    e.preventDefault();
    state.settings.quick.openMainShortcut = defaultOpenMain();
    document.getElementById("set-openmain-shortcut").textContent = fmtAccel(defaultOpenMain());
    setShortcutHint("openmain-shortcut-hint", "", false); save();
  });
  setupShortcutRecorder("set-quick-shortcut", "quick-shortcut-hint", () => state.settings.quick.shortcut, v => state.settings.quick.shortcut = v, defaultQuick());
  setupShortcutRecorder("set-openmain-shortcut", "openmain-shortcut-hint", () => state.settings.quick.openMainShortcut, v => state.settings.quick.openMainShortcut = v, defaultOpenMain());
  // network proxy — live-apply on every change
  bindToggle("set-proxy-enabled-tog", on => { state.settings.proxy.enabled = on; save(); applyProxy(); });
  bindSeg("set-proxy-scheme-seg", v => { state.settings.proxy.scheme = v; save(); applyProxy(); });
  document.getElementById("set-proxy-host").addEventListener("input", e => { state.settings.proxy.host = e.target.value.trim(); save(); applyProxy(); });
  document.getElementById("set-proxy-port").addEventListener("input", e => { state.settings.proxy.port = e.target.value.trim(); save(); applyProxy(); });
  document.getElementById("proxy-test").addEventListener("click", testProxy);
  document.getElementById("modal-close").onclick = closeSettings;
}
// Probe connectivity through the current proxy. Runs in the MAIN process (net.request) — a renderer fetch from a
// file:// page is blocked by CORS on no-CORS-header endpoints, which would fail regardless of the proxy.
async function testProxy() {
  const ps = document.getElementById("proxy-test-status"); if (!ps) return;
  const btn = document.getElementById("proxy-test");
  ps.className = "key-test-status"; ps.textContent = "测试中…";
  if (btn) { btn.disabled = true; btn.textContent = "测试中…"; }
  try {
    await applyProxy();                                    // make sure the latest config is live first
    const r = (window.chatbox && window.chatbox.testProxy) ? await window.chatbox.testProxy() : { ok: false, error: "不可用" };
    if (r && r.ok) { ps.className = "key-test-status ok"; ps.textContent = "✓ 连接正常 · " + r.ms + "ms"; }
    else { ps.className = "key-test-status bad"; ps.textContent = "✗ 连接失败：" + ((r && r.error) || "未知"); }
  } catch (e) {
    ps.className = "key-test-status bad"; ps.textContent = "✗ 连接失败：" + ((e && e.message) || "未知");
  } finally { if (btn) { btn.disabled = false; btn.textContent = "测试"; } }
}

function setShortcutHint(id, text, bad) {
  const h = document.getElementById(id); if (!h) return;
  h.textContent = text || "";
  h.className = "key-test-status" + (bad ? " bad" : (text ? " ok" : ""));
}
// Click a shortcut button → capture the next key combo and save it as an Electron accelerator.
const _shortcutRecorders = new Set();   // active recorders' stop() fns — cancelled if Settings closes mid-record
function cancelShortcutRecording() { [..._shortcutRecorders].forEach(stop => stop()); }
function setupShortcutRecorder(btnId, hintId, getVal, setVal, fallback) {
  const btn = document.getElementById(btnId);
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "1";
  let recording = false;
  const isMod = (e) => ["Shift", "Control", "Alt", "Meta"].includes(e.key);
  const stop = () => {
    recording = false; btn.classList.remove("recording");
    btn.textContent = fmtAccel(getVal() || fallback);
    document.removeEventListener("keydown", onKey, true);
    _shortcutRecorders.delete(stop);
  };
  const onKey = (e) => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(); return; }
    if (isMod(e)) return;                              // wait for the non-modifier key
    const key = codeToKey(e.code, e.key);
    if (!key) { setShortcutHint(hintId, "不支持的按键，换一个", true); return; }
    const mods = [];   // macOS visual order: ⌃ ⌥ ⇧ ⌘
    if (e.ctrlKey) mods.push("Ctrl"); if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift"); if (e.metaKey) mods.push("Cmd");
    if (!mods.length) { setShortcutHint(hintId, "请加上 " + (isMacPlatform() ? "⌘ / ⌥ / ⌃ / ⇧" : "Ctrl / Alt / Shift / Win"), true); return; }
    setVal(mods.join("+") + "+" + key);
    setShortcutHint(hintId, "", false); save();        // main re-registers and reports back
    stop();
  };
  btn.addEventListener("click", () => {
    if (recording) { stop(); return; }
    recording = true; btn.classList.add("recording");
    btn.textContent = "按下快捷键…"; setShortcutHint(hintId, "", false);
    _shortcutRecorders.add(stop);
    document.addEventListener("keydown", onKey, true);
  });
}

// ---- custom confirm dialog (replaces native confirm) ----
let _confirmResolve = null;
function confirmDialog(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const bg = document.getElementById("confirm-bg");
    bg.querySelector(".cf-title").textContent = opts.title || "确认操作";
    bg.querySelector(".cf-body").textContent = opts.body || "";
    const ok = document.getElementById("cf-ok"), cancel = document.getElementById("cf-cancel");
    ok.textContent = opts.okText || "确定";
    ok.classList.toggle("danger", opts.danger === true);   // 红色仅用于真正不可逆的操作（导入/恢复/清空），别处处皆红稀释信号
    cancel.textContent = opts.cancelText || "取消";
    bg.classList.add("show"); syncTitleBarOverlay();
    setTimeout(() => ok.focus(), 0);
  });
}
function closeConfirm(result) {
  document.getElementById("confirm-bg").classList.remove("show"); syncTitleBarOverlay();
  const r = _confirmResolve; _confirmResolve = null; if (r) r(result);
}

/* ----- OpenRouter model badge helpers (price / ctx / reasoning pills — used by 模型服务) ----- */
function fmtCtx(n) { return n >= 1000 ? Math.round(n / 1000) + "k" : (n || ""); }
// price/context/reasoning as small monochrome pills (values are numbers/fixed strings → innerHTML-safe)
function orBadges(m) {
  const out = [];
  if (m.reasoningOk) out.push('<span class="or-bdg">推理</span>');
  if (m.ctx) out.push('<span class="or-bdg">' + fmtCtx(m.ctx) + ' ctx</span>');
  if (m.pin != null && !isNaN(m.pin)) {
    const pout = (m.pout != null && !isNaN(m.pout)) ? m.pout.toFixed(2) : '?';
    out.push('<span class="or-bdg price">$' + m.pin.toFixed(2) + ' / $' + pout + '</span>');
  }
  return out.join("");
}

/* ===================== Model services (per-provider: key + its models) ===================== */
let _msProvider = "openrouter";   // currently selected provider in 模型服务
let _msFetched = {};              // pk -> [{id,name,ctx,pin,pout,reasoningOk}] once fetched from the API
// Stylized monochrome marks (original simplifications that evoke each brand), not the official logos.
const PROVIDER_ICONS = {
  openrouter: '<path d="M12 2.5 20 7v10l-8 4.5L4 17V7z"/><circle cx="12" cy="12" r="3"/>',                 // routing hub
  openai: '<ellipse cx="12" cy="12" rx="9.2" ry="3.5"/><ellipse cx="12" cy="12" rx="9.2" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.2" ry="3.5" transform="rotate(120 12 12)"/>',  // interlocking petals
  anthropic: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5.6 5.6l4.2 4.2M14.2 14.2l4.2 4.2M18.4 5.6l-4.2 4.2M9.8 14.2l-4.2 4.2"/>',  // starburst
  deepseek: '<path d="M3 12c2.5 0 3.6-2.6 6.6-2.6 3.5 0 5 3.4 8.4 3.4 1.6 0 3-.8 3-.8-.8 3.4-3.8 5.4-7.6 5.4C7.4 17.4 4 14.4 3 12z"/><circle cx="8" cy="11.3" r=".75"/>',  // whale
  google: '<path d="M12 2c.5 4.7 2.3 6.5 7 7-4.7.5-6.5 2.3-7 7-.5-4.7-2.3-6.5-7-7 4.7-.5 6.5-2.3 7-7z"/>',   // spark
};
// Show the official logo if the user dropped one into vendor/logos/<pk>.svg|png, else our stylized mark.
// (We don't ship the providers' trademarked logos; applyProviderLogos swaps them in at runtime if present.)
function provIcon(pk) { return '<span class="ms-ic" data-pk="' + pk + '"><svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (PROVIDER_ICONS[pk] || "") + '</svg></span>'; }
function applyProviderLogos(root) {
  (root || document).querySelectorAll(".ms-ic[data-pk]:not([data-logo])").forEach(el => {
    const pk = el.dataset.pk;
    for (const ext of ["svg", "png"]) {
      const im = new Image();
      im.onload = () => { if (el.dataset.logo) return; el.dataset.logo = "1"; el.innerHTML = ""; const img = document.createElement("img"); img.className = "ms-logo"; img.src = im.src; img.alt = ""; el.appendChild(img); };
      im.src = "vendor/logos/" + pk + "." + ext;
    }
  });
}
const KEY_URLS = { openrouter: "https://openrouter.ai/keys", openai: "https://platform.openai.com/api-keys", anthropic: "https://console.anthropic.com/settings/keys", deepseek: "https://platform.deepseek.com/api_keys", google: "https://aistudio.google.com/app/apikey" };
const KEY_PH = { openrouter: "sk-or-v1-…", openai: "sk-…", anthropic: "sk-ant-…", deepseek: "sk-…", google: "AIza…" };

function renderServices() { renderMsProviders(); renderMsDetail(); applyProviderLogos(); }
function renderMsProviders() {
  const box = document.getElementById("ms-providers"); if (!box) return;
  box.innerHTML = "";
  PROVIDER_ORDER.forEach(pk => {
    const b = document.createElement("button");
    b.className = "ms-prov" + (pk === _msProvider ? " active" : "");
    const n = state.settings.models.filter(m => m.provider === pk).length;
    b.innerHTML = '<span class="ms-prov-ic">' + provIcon(pk) + '</span>'
      + '<span class="ms-prov-name">' + PROVIDERS[pk].label + '</span>'
      + (n ? '<span class="ms-prov-n">' + n + '</span>' : '')
      + '<span class="ms-prov-dot' + (keyOf({ provider: pk }) ? ' on' : '') + '"></span>';
    b.onclick = () => { _msProvider = pk; renderServices(); };
    box.appendChild(b);
  });
}
function renderMsDetail() {
  const box = document.getElementById("ms-detail"); if (!box) return;
  const pk = _msProvider, prov = PROVIDERS[pk], key = keyOf({ provider: pk });
  box.innerHTML =
    '<div class="ms-head"><span class="ms-head-ic">' + provIcon(pk) + '</span><h4>' + prov.label + '</h4></div>'
    + '<div class="ms-field"><label>API Key <a href="' + KEY_URLS[pk] + '" target="_blank">获取 Key ↗</a></label>'
      + '<div class="key-input-wrap"><input type="password" id="ms-key" placeholder="' + KEY_PH[pk] + '" autocomplete="off" spellcheck="false">'
      + '<button type="button" class="key-eye" id="ms-eye">' + ic("eye", 16) + '</button></div>'
      + '<div class="key-row2"><button type="button" class="btn small" id="ms-test">检测</button><span class="key-test-status" id="ms-teststat"></span></div></div>'
    + '<div class="group-label">已启用的模型</div><div id="ms-enabled" class="ms-enabled"></div>'
    + '<div class="ms-actions"><button class="btn small" id="ms-fetch">从 API 获取模型 ↻</button>'
      + '<div class="model-row ms-add-row"><input id="ms-add" placeholder="或手动输入模型 ID 添加"><button class="btn small" id="ms-add-btn">添加</button></div></div>'
    + '<input id="ms-search" class="ms-search" placeholder="搜索模型…" hidden>'
    + '<div id="ms-list" class="or-list"></div>';
  const keyEl = box.querySelector("#ms-key"); keyEl.value = key || "";
  let connected = !!key;   // 打开面板时该服务商是否已配置过 key（已配置则不再触发「已接入」副作用）
  keyEl.addEventListener("input", () => {   // 实时保存，但不在这里触发「已接入」——否则敲第一个字符就误报成功
    state.settings.providers[pk] = { key: keyEl.value.trim() };
    renderMsProviders();   // 左栏圆点实时反映「已填 key」
    save();
  });
  // 「已接入」副作用（接入默认模型 + 成功提示）只在输入完成（失焦 / 回车）且 key 长度像样时触发一次。
  keyEl.addEventListener("change", () => {
    const v = keyEl.value.trim();
    if (v && !connected && v.length >= 16) { connected = true; onProviderConnected(pk); }
  });
  keyEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); keyEl.blur(); } });   // 回车 = 提交并移走焦点（blur 会触发上面的 change → 接入）
  const eye = box.querySelector("#ms-eye");
  eye.onclick = () => { const s = keyEl.type === "password"; keyEl.type = s ? "text" : "password"; eye.innerHTML = ic(s ? "eye-off" : "eye", 16); };
  box.querySelector("#ms-test").onclick = (e) => testProvider(pk, e.currentTarget, box.querySelector("#ms-teststat"));
  box.querySelector("#ms-fetch").onclick = () => fetchAndShowModels(pk);
  const addBtn = box.querySelector("#ms-add-btn"), addIn = box.querySelector("#ms-add");
  addBtn.onclick = () => { const v = addIn.value.trim(); if (!v) return; addModel({ provider: pk, model: v }); addIn.value = ""; renderMsDetail(); updateModelPill(); };
  addIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); addBtn.click(); } });
  box.querySelector("#ms-search").addEventListener("input", (e) => renderMsList(pk, e.target.value));
  if (_msFetched[pk]) { box.querySelector("#ms-search").hidden = false; box.querySelector("#ms-fetch").textContent = "重新获取 ↻ (" + _msFetched[pk].length + ")"; }
  renderMsEnabled(pk);
  renderMsList(pk, "");
}
function renderMsEnabled(pk) {
  const box = document.getElementById("ms-enabled"); if (!box) return;
  box.innerHTML = "";
  const list = state.settings.models.filter(m => m.provider === pk);
  if (!list.length) { box.innerHTML = '<div class="enabled-empty">还没启用模型 — 点下面「从 API 获取模型」或推荐项添加</div>'; return; }
  list.forEach(m => {
    const row = document.createElement("div"); row.className = "ms-en-row";
    const main = document.createElement("div"); main.className = "ms-en-main";
    const nm = document.createElement("span"); nm.className = "ms-en-name"; nm.textContent = prettyModel(m.model, m.provider);   // auto-generated display name
    const id = document.createElement("span"); id.className = "ms-en-id"; id.textContent = m.model; id.title = m.model;
    main.append(nm, id);
    const x = document.createElement("button"); x.className = "rm"; x.title = "移除"; x.innerHTML = ic("x", 14);
    x.onclick = () => { removeModel(m); renderMsDetail(); updateModelPill(); };
    row.append(main, x); box.appendChild(row);
  });
}
function msModelRow(pk, m) {
  const checked = hasModel({ provider: pk, model: m.id });
  const row = document.createElement("label"); row.className = "or-row" + (checked ? " on" : "");
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = checked;
  cb.onchange = () => {
    if (cb.checked) addModel({ provider: pk, model: m.id }); else removeModel({ provider: pk, model: m.id });
    row.classList.toggle("on", cb.checked); renderMsEnabled(pk); renderMsProviders(); updateModelPill();
  };
  const main = document.createElement("span"); main.className = "or-main";
  // prefer a real provider-supplied name; otherwise auto-generate from the id (recommended chips pass name===id)
  const disp = (m.name && m.name !== m.id) ? m.name : prettyModel(m.id, pk);
  const nm = document.createElement("span"); nm.className = "or-name"; nm.textContent = disp; main.appendChild(nm);
  if (disp !== m.id) { main.dataset.tip = m.id; main.dataset.tipDelay = "600"; }
  row.append(cb, main);
  if (pk === "openrouter") { const meta = document.createElement("span"); meta.className = "or-meta"; meta.innerHTML = orBadges(m); row.appendChild(meta); }
  return row;
}
function renderMsList(pk, filter) {
  const box = document.getElementById("ms-list"); if (!box) return;
  box.innerHTML = "";
  const fetched = _msFetched[pk];
  if (!fetched) {                                  // not fetched yet → show the recommended chips
    const ids = SUGGESTED[pk] || [];
    if (!ids.length) { box.innerHTML = '<div class="or-empty">点「从 API 获取模型」拉取该服务商支持的模型</div>'; return; }
    const h = document.createElement("div"); h.className = "or-group"; h.textContent = "推荐模型"; box.appendChild(h);
    ids.forEach(id => box.appendChild(msModelRow(pk, { id: id, name: id })));
    return;
  }
  const f = (filter || "").toLowerCase();
  const matched = fetched.filter(m => !f || m.id.toLowerCase().includes(f) || (m.name || "").toLowerCase().includes(f));
  const count = document.createElement("div"); count.className = "or-count";
  count.innerHTML = '<span>' + (f ? ("匹配 " + matched.length) : ("共 " + fetched.length + " 个")) + '</span><span>已启用 ' + state.settings.models.filter(m => m.provider === pk).length + '</span>';
  box.appendChild(count);
  if (!matched.length) { const e = document.createElement("div"); e.className = "or-empty"; e.textContent = "没有匹配的模型"; box.appendChild(e); return; }
  const CAP = 400; let n = 0, truncated = false;
  if (pk === "openrouter") {
    const groups = {}; matched.forEach(m => { const v = m.id.split("/")[0]; (groups[v] = groups[v] || []).push(m); });
    for (const v of Object.keys(groups).sort()) {
      if (n >= CAP) { truncated = true; break; }
      const h = document.createElement("div"); h.className = "or-group"; h.textContent = v + " (" + groups[v].length + ")"; box.appendChild(h);
      for (const m of groups[v]) { if (n++ >= CAP) { truncated = true; break; } box.appendChild(msModelRow(pk, m)); }
    }
  } else {
    for (const m of matched) { if (n++ >= CAP) { truncated = true; break; } box.appendChild(msModelRow(pk, m)); }
  }
  if (truncated) { const e = document.createElement("div"); e.className = "or-empty"; e.textContent = "结果较多，仅显示前 " + CAP + " 个，请用搜索缩小范围"; box.appendChild(e); }
}
async function fetchProviderModels(pk) {
  const prov = PROVIDERS[pk], key = keyOf({ provider: pk });
  const headers = prov.kind === "anthropic"
    ? { "x-api-key": key || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : (key ? { Authorization: "Bearer " + key } : {});
  const resp = await fetch(prov.base + "/models", { headers });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const j = await resp.json();
  const arr = j.data || j.models || [];
  if (pk === "openrouter") {
    return arr.map(m => ({
      id: m.id, name: m.name || m.id,
      ctx: m.context_length || (m.top_provider && m.top_provider.context_length) || 0,
      pin: m.pricing ? Number(m.pricing.prompt) * 1e6 : null,
      pout: m.pricing ? Number(m.pricing.completion) * 1e6 : null,
      reasoningOk: Array.isArray(m.supported_parameters) && (m.supported_parameters.includes("reasoning") || m.supported_parameters.includes("include_reasoning")),
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
  return arr.map(m => ({ id: m.id || m.name || "", name: m.id || m.name || "" })).filter(m => m.id).sort((a, b) => a.id.localeCompare(b.id));
}
async function fetchAndShowModels(pk) {
  const btn = document.getElementById("ms-fetch"), search = document.getElementById("ms-search"), box = document.getElementById("ms-list");
  if (btn) { btn.disabled = true; btn.textContent = "获取中…"; }
  if (box) box.innerHTML = '<div class="or-loading"><span class="spinner"></span> 正在从 ' + PROVIDERS[pk].label + ' 获取模型…</div>';
  try {
    _msFetched[pk] = await fetchProviderModels(pk);
    if (search) search.hidden = false;
    if (btn) btn.textContent = "重新获取 ↻ (" + _msFetched[pk].length + ")";
    renderMsList(pk, search ? search.value : "");
  } catch (e) {
    if (btn) btn.textContent = "从 API 获取模型 ↻";
    renderMsList(pk, "");
    toast("获取模型失败：" + e.message + (keyOf({ provider: pk }) ? "" : "（请先填 Key）"));
  } finally { if (btn) btn.disabled = false; }
}

/* ----- System prompts section ----- */
function refreshPromptsSection() { renderPromptsList(); }
function renderPromptsList() {
  const box = document.getElementById("prompts-list"); box.innerHTML = "";
  if (!state.settings.prompts.length) { box.innerHTML = '<div class="dim" style="font-size:13px;padding:4px 0">还没有提示词，点下方「新建提示词」</div>'; return; }
  state.settings.prompts.forEach(p => {
    const card = document.createElement("div"); card.className = "prompt-card";
    const top = document.createElement("div"); top.className = "prompt-top";
    const name = document.createElement("input"); name.className = "prompt-name"; name.value = p.name; name.placeholder = "名称";
    name.onchange = () => { p.name = name.value.trim() || "未命名"; save(); updatePromptPill(); renderSidebar(); };
    const defWrap = document.createElement("label"); defWrap.className = "prompt-default"; defWrap.title = "设为新对话的默认系统提示词";
    const def = document.createElement("input"); def.type = "checkbox"; def.checked = state.settings.defaults.promptId === p.id;
    def.onchange = () => {
      if (def.checked) {
        state.settings.defaults.promptId = p.id;
        document.querySelectorAll("#prompts-list .prompt-default input").forEach(cb => { if (cb !== def) cb.checked = false; });
      } else if (state.settings.defaults.promptId === p.id) {
        state.settings.defaults.promptId = null;
      }
      // the next new conversation always follows the default; an empty current chat adopts it too
      nextPromptId = state.settings.defaults.promptId;
      const c = currentConv();
      if (c && c.messages.length === 0) c.promptId = state.settings.defaults.promptId;
      save(); updatePromptPill(); renderSidebar();
    };
    defWrap.append(def, document.createTextNode(" 默认"));
    const del = document.createElement("button"); del.className = "btn small"; del.textContent = "删除";
    del.onclick = () => {
      if (state.settings.defaults.promptId === p.id) state.settings.defaults.promptId = null;
      if (nextPromptId === p.id) nextPromptId = null;
      state.settings.prompts = state.settings.prompts.filter(x => x.id !== p.id);
      save(); renderPromptsList(); updatePromptPill(); renderSidebar();
    };
    top.append(name, defWrap, del);
    const ta = document.createElement("textarea"); ta.className = "prompt-text"; ta.rows = 3; ta.value = p.text; ta.placeholder = "系统提示词内容…";
    ta.onchange = () => { p.text = ta.value; save(); };
    ta.oninput = () => autoGrowEl(ta, 420);
    card.append(top, ta); box.appendChild(card);
    requestAnimationFrame(() => autoGrowEl(ta, 420));
  });
}

/* ===================== Input UX ===================== */
// Composer input box: auto-grow with the text. Default ceiling is 5 lines — past that it scrolls (a
// scrollbar shows ONLY when the text truly overflows, never on empty space). Dragging the top edge sets
// inputUserH: an EXACT manual height (text scrolls inside, so it never snaps to fit all the text), capped
// at ~40vh. inputUserH is reset per conversation (see syncComposerDraft), so it isn't shared across chats.
function _inputMetrics() {
  const ta = document.getElementById("input"); const cs = getComputedStyle(ta);
  const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.5) || 22;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return { lh, pad };
}
function inputFiveLines() { const m = _inputMetrics(); return Math.round(m.lh * 5 + m.pad); }
function inputFloorMin() { const m = _inputMetrics(); return Math.round(m.lh + m.pad); }   // ~1 line
function inputCeil() { return Math.round(window.innerHeight * 0.4); }
function autoGrow() {
  const ta = document.getElementById("input"); if (!ta) return;
  ta.style.height = "auto";
  const content = ta.scrollHeight;
  const h = inputUserH != null
    ? Math.max(inputFloorMin(), Math.min(inputUserH, inputCeil()))   // manual: EXACT dragged height, text scrolls inside
    : Math.min(content, inputFiveLines());                           // default: grow up to 5 lines, then scroll
  ta.style.height = h + "px";
  ta.style.overflowY = content > h + 1 ? "auto" : "hidden";          // scrollbar only when the text actually overflows
}
// Keep the caret's line inside the visible part of the textarea — used while dragging the composer shorter/
// taller so the line you're typing on never scrolls out of view. Measures the caret's pixel offset with a
// cached hidden mirror that copies the textarea's wrapping (font / width / padding), then nudges scrollTop.
let _caretMirror = null;
function keepCaretVisible(ta) {
  if (!ta || ta.selectionStart == null) return;
  const cs = getComputedStyle(ta);
  const m = _caretMirror || (_caretMirror = document.createElement("div"));
  const s = m.style;
  s.position = "absolute"; s.left = "-9999px"; s.top = "0"; s.visibility = "hidden";
  s.whiteSpace = "pre-wrap"; s.overflowWrap = "break-word"; s.wordBreak = "break-word";
  s.width = ta.clientWidth + "px"; s.boxSizing = cs.boxSizing;
  s.fontFamily = cs.fontFamily; s.fontSize = cs.fontSize; s.fontWeight = cs.fontWeight; s.fontStyle = cs.fontStyle;
  s.lineHeight = cs.lineHeight; s.letterSpacing = cs.letterSpacing;
  s.paddingTop = cs.paddingTop; s.paddingRight = cs.paddingRight; s.paddingBottom = cs.paddingBottom; s.paddingLeft = cs.paddingLeft;
  m.textContent = ta.value.slice(0, ta.selectionStart);
  const marker = document.createElement("span"); marker.textContent = "​"; m.appendChild(marker);   // zero-width marker on the caret's line
  if (m.parentNode !== document.body) document.body.appendChild(m);
  const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.5) || 22;
  const top = marker.offsetTop;
  m.removeChild(marker);
  if (top < ta.scrollTop) ta.scrollTop = top;                                   // caret above the view → scroll up to it
  else if (top + lh > ta.scrollTop + ta.clientHeight) ta.scrollTop = top + lh - ta.clientHeight;  // below → scroll down
}
// Grow a textarea to fit its content (replaces the ugly native resize grip on settings textareas).
function autoGrowEl(el, max) { if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, max || 460) + "px"; }
function focusInput() { const el = document.getElementById("input"); if (el) el.focus(); }

/* ---- First-run usage guide — a small paginated carousel (left: text, right: illustration) ---- */
// Right-side art is a real screenshot of each feature, in two themes: assets/guide/<name>-<light|dark>.png
let _guideIdx = 0;
function guideSlides() {
  const cl = IS_MAC ? "⌘L" : "Ctrl+L", cn = IS_MAC ? "⌘N" : "Ctrl+N";
  const q = fmtAccel(state.settings.quick.shortcut || defaultQuick());
  const om = fmtAccel(state.settings.quick.openMainShortcut || defaultOpenMain());
  const kb = (s) => "<kbd>" + s + "</kbd>";
  return [
    { t: "速答浮条", d: "在任意 App 里按 " + kb(q) + " 唤起一个浮条，随手提问、即时得到回答；满意就回车，一键接力到 Quartz 继续多轮。", img: "quick" },
    { t: "系统提示词", d: "输入框左下角的「提示词」可一键切换不同风格的人设；在 设置 → 系统提示词 里编辑或新增你自己的。", img: "prompt" },
    { t: "思考强度", d: "输入框右下角的灯泡，点按在 关 / 低 / 中 / 高 之间切换——需要深思时让模型多想，日常问答则更快更省。", img: "think" },
    { t: "节点小地图", d: "长对话左侧的竖条是一张迷你导航图，点任意节点即可跳到那一轮；每个节点的小标题由 AI 自动生成。", img: "nodes" },
    { t: "顺手快捷键", d: kb(cl) + " 回到输入框 · " + kb(cn) + " 新对话 · 输入 " + kb("/") + " 唤出命令面板 · 全局 " + kb(om) + " 把 Quartz 唤到最前。<br><br>回答生成时按 " + kb("Esc") + " 停止，已写出的内容会保留（操作栏的「继续」可接着写）；停下后再按一次 " + kb("Esc") + " 撤销本次发送，提示词退回输入框。", img: "keys" },
    { t: "多模型 · 联网", d: "点底部模型名随时切换；同一个问题可用不同模型重答对比。用 OpenRouter 模型时还能点地球开启实时联网检索。", img: "models" },
  ];
}
function _guideKey(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeGuide(); }
  else if (e.key === "ArrowRight") { e.preventDefault(); guideGo(_guideIdx + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); guideGo(_guideIdx - 1); }
}
function guideGo(i) {
  const n = guideSlides().length;
  _guideIdx = Math.max(0, Math.min(n - 1, i));
  renderGuide();
}
function renderGuide() {
  const bg = document.getElementById("guide-bg"); if (!bg) return;
  const slides = guideSlides(), s = slides[_guideIdx];
  bg.querySelector(".guide-left h3").textContent = s.t;
  bg.querySelector(".guide-left p").innerHTML = s.d;
  const th = (document.documentElement.getAttribute("data-theme") === "dark") ? "dark" : "light";
  bg.querySelector(".guide-art").innerHTML = '<img alt="" src="assets/guide/' + s.img + "-" + th + '.png">';
  bg.querySelectorAll(".guide-dot").forEach((d, i) => d.classList.toggle("active", i === _guideIdx));
  bg.querySelector(".guide-btn.prev").disabled = _guideIdx === 0;
  bg.querySelector(".guide-btn.next").textContent = (_guideIdx === slides.length - 1) ? "开始使用" : "下一步";
}
function openGuide() {
  let bg = document.getElementById("guide-bg");
  if (!bg) {
    bg = document.createElement("div"); bg.id = "guide-bg"; bg.className = "guide-bg";
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) closeGuide(); });
    document.body.appendChild(bg);
  }
  _guideIdx = 0;
  const dots = guideSlides().map((_, i) => '<span class="guide-dot" data-i="' + i + '"></span>').join("");
  bg.innerHTML = '<div class="guide-modal" role="dialog" aria-label="使用指南">'
    + '<div class="guide-head"><h2>快速上手</h2><button class="guide-x" type="button" aria-label="关闭">✕</button></div>'
    + '<div class="guide-body"><div class="guide-left"><h3></h3><p></p></div><div class="guide-art"></div></div>'
    + '<div class="guide-foot"><div class="guide-dots">' + dots + '</div>'
    + '<div class="guide-nav"><button class="guide-btn prev" type="button">上一步</button><button class="guide-btn next" type="button">下一步</button></div>'
    + '</div></div>';
  bg.querySelector(".guide-x").onclick = closeGuide;
  bg.querySelector(".guide-btn.prev").onclick = () => guideGo(_guideIdx - 1);
  bg.querySelector(".guide-btn.next").onclick = () => { if (_guideIdx >= guideSlides().length - 1) closeGuide(); else guideGo(_guideIdx + 1); };
  bg.querySelectorAll(".guide-dot").forEach(d => d.onclick = () => guideGo(+d.dataset.i));
  renderGuide();
  bg.classList.add("show");
  document.addEventListener("keydown", _guideKey, true);
  if (typeof syncTitleBarOverlay === "function") syncTitleBarOverlay();
}
function closeGuide() {
  const bg = document.getElementById("guide-bg"); if (bg) bg.classList.remove("show");
  document.removeEventListener("keydown", _guideKey, true);
  const firstRun = state && !state.settings.guideSeen;   // auto-shown on first launch (not re-opened from 关于)
  if (firstRun) { state.settings.guideSeen = true; save(); }
  if (typeof syncTitleBarOverlay === "function") syncTitleBarOverlay();
  if (firstRun && !anyKey()) openSettings("services");   // first run finished → now guide them to add an API key
}
// Show once, on first launch, before anything else. Won't stack on an already-open Settings/dialog.
function maybeShowGuide() {
  if (!state || state.settings.guideSeen) return;
  if (anyModalOpen()) return;     // don't stack on Settings / a dialog
  openGuide();
}

/* First-run / idle hints (gray helper text) */
const IS_MAC = /mac/i.test(navigator.platform) || /Mac/.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl";

/* ===================== Slash commands ===================== */
// /newhere — start a fresh topic inside the SAME conversation: keep the history visible but draw a boundary
// the model won't read past, while keeping THIS conversation's model / 提示词 / 思考强度 (unlike /new, which
// opens a blank conversation on the global defaults). Implemented as a summary-less compaction boundary.
function newHere() {
  const conv = currentConv();
  if (!conv || !conv.messages.length) { toast("当前对话为空，无需分界"); return; }
  if (conv.compaction && conv.compaction.divider && conv.compaction.count === conv.messages.length) { toast("已经在新话题开头了"); return; }
  conv.compaction = { count: conv.messages.length, summary: "", divider: true };
  save(); renderMessages();
  toast("已开启新话题 · 以上不计入上下文");
  focusInput();
}
// /clear — wipe this conversation's messages but keep the conversation (and its model / 提示词 / 思考强度) in
// place. Undoable. Differs from /new, which spins up a blank conversation on the global default settings.
function clearConversation() {
  const conv = currentConv();
  if (!conv || !conv.messages.length) { toast("当前对话已经是空的"); return; }
  const snap = { messages: conv.messages.slice(), compaction: conv.compaction, title: conv.title, titled: conv.titled };
  conv.messages = []; conv.compaction = null; conv.title = "新对话"; conv.titled = false;
  save(); renderMessages(); renderSidebar();
  toast("已清空当前对话", { label: "撤销", fn: () => { conv.messages = snap.messages; conv.compaction = snap.compaction; conv.title = snap.title; conv.titled = snap.titled; save(); renderMessages(); renderSidebar(); } });
  focusInput();
}
const SLASH_COMMANDS = [
  { cmd: "/new", desc: "新建对话", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); newConversation(); } },
  { cmd: "/newhere", desc: "在当前对话里开启新话题（以上不计入上下文，保留模型/提示词/思考设置）", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); newHere(); } },
  { cmd: "/clear", desc: "清空当前对话（保留模型/提示词/思考设置）", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); clearConversation(); } },
  { cmd: "/model", desc: "切换模型", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); openPopover(); } },
  { cmd: "/prompt", desc: "切换系统提示词", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); openPromptPop(); } },
  { cmd: "/compact", desc: "压缩上下文（AI 总结早前对话）", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); compactContext(); } },
  { cmd: "/effort", desc: "思考强度（滑杆：关 / 低 / 中 / 高）", run: () => { const i = document.getElementById("input"); i.value = ""; autoGrow(); openEffortPop(); } },
];
let slash = { open: false, items: [], index: 0 };

// Fuzzy slash matching: the query must share the command's FIRST letter and be a subsequence of it (letters
// in order), so "/nh"→/newhere, "/eo"→/effort, "/cp"→/compact all hit without "e" matching everything.
// Prefix matches (e.g. "/new") rank above looser subsequence ones.
function isSubseq(q, s) { let i = 0; for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++; return i === q.length; }
function matchSlash(q) {
  if (!q) return SLASH_COMMANDS.slice();
  const hits = SLASH_COMMANDS.filter(c => { const n = c.cmd.slice(1).toLowerCase(); return n[0] === q[0] && isSubseq(q, n); });
  return hits.sort((a, b) => (b.cmd.slice(1).toLowerCase().startsWith(q) ? 1 : 0) - (a.cmd.slice(1).toLowerCase().startsWith(q) ? 1 : 0));
}
function updateSlash() {
  const v = document.getElementById("input").value;
  const m = /^\/(\S*)$/.exec(v);          // whole input is "/word" with no spaces yet
  if (!m) return closeSlash();
  const q = m[1].toLowerCase();
  const items = matchSlash(q);
  if (!items.length) return closeSlash();
  slash.open = true; slash.items = items; slash.index = 0;
  renderSlash();
}
function renderSlash() {
  const pop = document.getElementById("slash-pop");
  pop.innerHTML = "";
  slash.items.forEach((c, i) => {
    const it = document.createElement("button");
    it.className = "slash-item" + (i === slash.index ? " active" : "");
    const cmd = document.createElement("span"); cmd.className = "sc-cmd"; cmd.textContent = c.cmd;
    const desc = document.createElement("span"); desc.className = "sc-desc"; desc.textContent = c.desc;
    it.append(cmd, desc);
    it.onmousedown = (e) => { e.preventDefault(); slash.index = i; confirmSlash(); };
    pop.appendChild(it);
  });
  // align with the (centered, possibly-wider) input box, not the full-width composer
  const ci = document.getElementById("composer-inner").getBoundingClientRect();
  pop.style.display = "block";
  pop.style.top = "auto"; pop.style.right = "auto";
  pop.style.left = ci.left + "px";
  pop.style.bottom = (window.innerHeight - ci.top + 6) + "px";
}
function closeSlash() { slash.open = false; const p = document.getElementById("slash-pop"); if (p) p.style.display = "none"; }
function moveSlash(dir) { if (!slash.open) return; slash.index = (slash.index + dir + slash.items.length) % slash.items.length; renderSlash(); }
function confirmSlash() { if (!slash.open) return; const c = slash.items[slash.index]; closeSlash(); if (c) c.run(); }

/* ===================== Wire up ===================== */
document.getElementById("new-chat").onclick = newConversation;
(function () {
  const s = document.getElementById("conv-search");
  if (s) {
    let _searchTimer = null;
    s.addEventListener("input", () => {
      searchQuery = s.value.trim();
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => { renderSidebar(); clearSearchHighlight(); applySearchHighlight(); }, 120);   // 防抖：列表大时每键重建会抖、丢 hover/focus
    });
    // Enter / ↓ next, Shift+Enter / ↑ prev — step through matches in the open conversation; Esc clears
    s.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); if (searchHits.length) setActiveHit(searchHitIndex + ((e.key === "Enter" && e.shiftKey) ? -1 : 1), true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (searchHits.length) setActiveHit(searchHitIndex - 1, true); }
      else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
    });
  }
  const clr = document.getElementById("conv-search-clear");
  if (clr) clr.onclick = () => { clearConvSearch(); renderSidebar(); clearSearchHighlight(); applySearchHighlight(); const si = document.getElementById("conv-search"); if (si) si.focus(); };
  const fp = document.getElementById("find-prev"); if (fp) fp.onclick = () => setActiveHit(searchHitIndex - 1, true);
  const fn = document.getElementById("find-next"); if (fn) fn.onclick = () => setActiveHit(searchHitIndex + 1, true);
  const fc = document.getElementById("find-close"); if (fc) fc.onclick = () => closeFind();
})();
function closeFind() {
  clearConvSearch(); renderSidebar(); clearSearchHighlight();
  const bar = document.getElementById("find-bar"); if (bar) bar.hidden = true;
}
document.getElementById("toggle-sidebar").onclick = toggleSidebar;
document.getElementById("retitle-chat").onclick = () => { const c = currentConv(); if (c) regenerateTitle(c); };
document.getElementById("export-chat").onclick = (e) => { e.stopPropagation(); openExportMenu(e.currentTarget); };
document.getElementById("conv-title").ondblclick = startTitleRename;
window.addEventListener("resize", evalTitleFade);
window.addEventListener("resize", updateConvListFade);
// Open popovers are positioned at fixed coordinates — close them on resize so they don't hang in stale spots.
window.addEventListener("resize", () => { closePopover(); closePromptPop(); closeEffortPop(); closeSlash(); });
// Tab focus traps for the two modals
{ const md = document.getElementById("modal"); if (md) md.addEventListener("keydown", (e) => trapTab(md, e)); }
{ const cb = document.getElementById("confirm-box"); if (cb) cb.addEventListener("keydown", (e) => trapTab(cb, e)); }
// ⌘F / Ctrl+F — jump to search (the muscle-memory "find"); skipped while a modal/dialog is open
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
    if (anyModalOpen()) return;
    e.preventDefault(); focusSearch();
  }
});
document.getElementById("open-settings").onclick = () => openSettings();
{ const sa = document.getElementById("sidebar-profile"); if (sa) sa.onclick = () => {
    const named = ((state.settings.profile && state.settings.profile.name) || "").trim();
    if (named) openSettings("stats");                       // 已设名字 → 个人资料/统计页
    else openSettings("general", "set-username");           // 未设名字（「设置名字」）→ 常规页并聚焦名字输入框
  }; }
{ const enc = document.getElementById("empty-name-cta"); if (enc) enc.onclick = () => openSettings("general", "set-username"); }
{ const sg = document.getElementById("stats-report-gen"); if (sg) sg.onclick = generateStatsReport; }
bindSeg("stats-range-seg", v => { statsRange = v; renderStatsGraph(); });
document.getElementById("modal-bg").onclick = (e) => { if (e.target.id === "modal-bg") closeSettings(); };
document.querySelectorAll("#modal-nav .nav-item").forEach(b => b.onclick = () => switchSection(b.dataset.sec));
bindSettingsSearch();
{ const de = document.getElementById("data-export"); if (de) de.onclick = exportAllData;
  const di = document.getElementById("data-import"); if (di) di.onclick = importAllData;
  const br = document.getElementById("set-backup-restore"); if (br) br.onclick = restoreBackup; }
setupSettingsLive();
// custom confirm dialog
document.getElementById("cf-ok").onclick = () => closeConfirm(true);
document.getElementById("cf-cancel").onclick = () => closeConfirm(false);
document.getElementById("confirm-bg").onclick = (e) => { if (e.target.id === "confirm-bg") closeConfirm(false); };
// Esc closes the open confirm → else the settings modal. Enter is deliberately NOT handled globally:
// the focused button (确定 / 取消) responds to Enter/Space natively, so Enter no longer always = 确定.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (document.getElementById("confirm-bg").classList.contains("show")) { e.preventDefault(); closeConfirm(false); return; }
    if (document.getElementById("modal-bg").classList.contains("show")) { e.preventDefault(); closeSettings(); return; }
  }
});
document.getElementById("model-pill").onclick = () => {
  const pop = document.getElementById("model-pop");
  if (pop.style.display === "block") closePopover(); else openPopover();
};
document.getElementById("prompt-pill").onclick = () => {
  const pop = document.getElementById("prompt-pop");
  if (pop.style.display === "block") closePromptPop(); else openPromptPop();
};
document.getElementById("add-prompt-btn").onclick = () => {
  const p = { id: uid(), name: "新提示词", text: "" };
  state.settings.prompts.push(p); save();
  refreshPromptsSection(); updatePromptPill();
  const names = document.querySelectorAll("#prompts-list .prompt-name");
  const last = names[names.length - 1]; if (last) { last.focus(); last.select(); }
};


document.getElementById("attach-btn").onclick = () => document.getElementById("file-input").click();
document.getElementById("web-btn").onclick = toggleWeb;
document.getElementById("think-btn").onclick = () => {
  const pop = document.getElementById("effort-pop");
  if (pop.style.display === "block") closeEffortPop(); else openEffortPop();
};
document.getElementById("compact-btn").onclick = () => compactContext();
document.getElementById("file-input").onchange = (e) => { handleFiles(e.target.files); e.target.value = ""; };

const sendBtn = document.getElementById("send");
sendBtn.onclick = () => { if (abortController) abortController.abort(); else sendMessage(); };

const input = document.getElementById("input");
input.addEventListener("input", () => { autoGrow(); closeEffortPop(); updateSlash(); updateSendButton(); });
input.addEventListener("blur", () => { setTimeout(closeSlash, 120); });
input.addEventListener("keydown", (e) => {
  if (slash.open) {
    if (e.key === "Tab" || (e.key === "Enter" && !e.isComposing)) { e.preventDefault(); confirmSlash(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveSlash(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveSlash(-1); return; }
    if (e.key === "Escape") { e.preventDefault(); closeSlash(); return; }
  }
  if (effortPop.open) {
    if (e.key === "Tab" || (e.key === "Enter" && !e.isComposing)) { e.preventDefault(); confirmEffort(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); moveEffort(1); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); moveEffort(-1); return; }
    if (e.key === "Escape") { e.preventDefault(); closeEffortPop(); return; }
  }
  if (modelPop.open) {
    if (e.key === "Tab" || (e.key === "Enter" && !e.isComposing)) { e.preventDefault(); confirmModel(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveModel(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveModel(-1); return; }
    if (e.key === "Escape") { e.preventDefault(); closePopover(); return; }
  }
  if (promptPop.open) {
    if (e.key === "Tab" || (e.key === "Enter" && !e.isComposing)) { e.preventDefault(); confirmPrompt(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); movePrompt(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); movePrompt(-1); return; }
    if (e.key === "Escape") { e.preventDefault(); closePromptPop(); return; }
  }
  // Esc 正在生成 → 第一次停止（保留半截回答，操作栏出现「继续」）；停止后再按一次 Esc → 撤销这次「全新发送」，prompt 退回输入框
  if (e.key === "Escape" && abortController) { e.preventDefault(); abortController.abort(); return; }
  if (e.key === "Escape" && !abortController && canUndoSend()) { e.preventDefault(); undoLastSend(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!abortController) sendMessage(); }
});
// Cmd/Ctrl+V 粘贴图片 / 文件到输入框——聊天区任意位置均可，不必先聚焦输入框；纯文本粘贴保持默认行为。
document.addEventListener("paste", async (e) => {
  // 别抢走设置 / 对话框里的粘贴，也别在别的输入框（搜索、Key、行内改名）里把文件塞进聊天。
  if (anyModalOpen()) return;
  const ae = document.activeElement;
  const inOtherField = ae && ae.id !== "input" &&
    (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
  if (inOtherField) return;
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  const fs = items.filter(it => it.kind === "file").map(it => it.getAsFile()).filter(Boolean);
  if (!fs.length) return;
  e.preventDefault();
  await handleFiles(fs);
  focusInput();   // 带焦点回输入框，附件即在此，可直接补字发送
});

const composerInner = document.getElementById("composer-inner");
composerInner.addEventListener("dragover", (e) => { e.preventDefault(); composerInner.classList.add("drag"); });
// only clear when the cursor actually left the composer (relatedTarget outside it / null when leaving the window),
// not when it merely crossed into a child (textarea) — that used to leave the dashed border stuck.
composerInner.addEventListener("dragleave", (e) => { if (!composerInner.contains(e.relatedTarget)) composerInner.classList.remove("drag"); });
composerInner.addEventListener("drop", (e) => { e.preventDefault(); composerInner.classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
// window-level safety net: a drag that ends or drops anywhere clears the stuck hint.
// Only a stray FILE drop is preventDefault'd (so it can't navigate the window) — text drops into other
// inputs keep working natively.
window.addEventListener("dragend", () => composerInner.classList.remove("drag"));
window.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) e.preventDefault(); composerInner.classList.remove("drag"); });

// Scroll: follow streaming only when at the bottom; show a jump-to-bottom button otherwise
const messagesBox = document.getElementById("messages");
messagesBox.addEventListener("scroll", () => {
  // The pin is NEVER released here. While answering, the streaming markdown re-renders every chunk and the
  // browser clamps scrollTop a few px as scrollHeight jitters — indistinguishable from a small user scroll by
  // delta alone, which used to falsely clear the pin. So the pin is released only by an explicit gesture
  // (wheel / touchstart, below) or when the answer completes. When un-pinned, sync the bottom-follow flag,
  // ignoring our own programmatic scrolls (they stay within 6px of lastSetTop).
  if (pinTop == null && Math.abs(messagesBox.scrollTop - lastSetTop) > 6) {
    autoScroll = isNearBottom(messagesBox);
  }
  scheduleNodeActive();
  updateScrollBtn();
});
// a deliberate wheel / touch scroll releases the "pin user message to top" lock and stops the glide
messagesBox.addEventListener("wheel", () => { pinTop = null; nodePinned = null; cancelSmooth(); }, { passive: true });
messagesBox.addEventListener("touchstart", () => { pinTop = null; nodePinned = null; cancelSmooth(); }, { passive: true });
// Pressing in the transcript starts a (possibly text-selecting) drag — pause streaming re-renders until release
// so the selection's anchor node isn't replaced mid-drag (which would snap the selection to the top). See onDelta.
messagesBox.addEventListener("mousedown", () => { selPointerDown = true; });
document.addEventListener("mouseup", () => { selPointerDown = false; });
// Tap the floating ↓ to jump to the bottom and resume following the stream.
const _scrollBtn = document.getElementById("scroll-btn");
if (_scrollBtn) _scrollBtn.addEventListener("click", () => {
  pinTop = null; nodePinned = null; autoScroll = true;
  animateScrollTo(messagesBox, messagesBox.scrollHeight, 190);   // quick, smooth glide — not an instant jump
  updateScrollBtn();
});

// Sidebar resize
let resizing = false;
const resizer = document.getElementById("sidebar-resizer");
resizer.addEventListener("mousedown", (e) => { if (state.settings.sidebar.collapsed) return; resizing = true; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; e.preventDefault(); });
resizer.addEventListener("dblclick", () => { if (state.settings.sidebar.collapsed) return; state.settings.sidebar.width = 264; document.getElementById("sidebar").style.width = "264px"; save(); });   // 双击复位到默认宽度
document.addEventListener("mousemove", (e) => { if (!resizing) return; const w = Math.min(480, Math.max(210, e.clientX - 10)); state.settings.sidebar.width = w; document.getElementById("sidebar").style.width = w + "px"; });
document.addEventListener("mouseup", () => { if (resizing) { resizing = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; save(); } });

// Reading width lives in 设置 → 外观（the old top-bar width pill was removed）。

/* ----- Tooltips for [data-tip] / [title] controls ----- */
(function setupTips() {
  let tipEl = null, tipFor = null, tipTimer = null;
  var TIP_DELAY = 380;
  function ensure() {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.id = "cb-tip"; tipEl.setAttribute("role", "tooltip"); document.body.appendChild(tipEl); }
    return tipEl;
  }
  function textFor(el) {
    if (el.dataset.tip) return el.dataset.tip;
    if (el.hasAttribute("title")) { el.dataset.tipTitle = el.getAttribute("title"); el.removeAttribute("title"); }
    return el.dataset.tipTitle || "";
  }
  function restore(el) {
    if (el && el.dataset.tipTitle != null) { if (!el.hasAttribute("title")) el.setAttribute("title", el.dataset.tipTitle); delete el.dataset.tipTitle; }
  }
  function show(el) {
    const text = textFor(el); if (!text) return;
    const t = ensure(); t.textContent = text; t.style.display = "block";
    const r = el.getBoundingClientRect(); const tr = t.getBoundingClientRect();
    const above = r.top - tr.height - 7;
    const top = above >= 6 ? above : r.bottom + 7;
    let rightLimit = window.innerWidth - 8;
    const wco = navigator.windowControlsOverlay;
    if (wco && wco.visible) {
      // 顶部右侧被原生「最小化 / 最大化 / 关闭」按钮覆盖；落在该带内的 tooltip 夹到按钮左侧，避免被遮挡。
      // 兜底值取保守些（覆盖整条 ~60px 标题栏 + 余量）——某些 Windows 上 getTitlebarAreaRect 会给出偏小的
      // 高度，导致刚好在带子下沿的 tooltip（如右上角计费提示）漏判而不夹，仍被按钮遮住一部分。
      let capLeft = window.innerWidth - 160, capBottom = 64;
      try { const bar = wco.getTitlebarAreaRect(); if (bar && bar.width > 0) { capLeft = bar.x + bar.width; capBottom = Math.max(capBottom, bar.y + bar.height); } } catch (e) {}
      if (top < capBottom) rightLimit = Math.min(rightLimit, capLeft - 8);
    }
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, rightLimit - tr.width));
    t.style.left = Math.round(left) + "px";
    t.style.top = Math.round(top) + "px";
  }
  function cancelTimer() { if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; } }
  function hide() { cancelTimer(); if (tipEl) tipEl.style.display = "none"; if (tipFor) restore(tipFor); tipFor = null; }
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest && e.target.closest("[data-tip],[title]");
    if (el && el !== tipFor) {
      cancelTimer(); if (tipFor) restore(tipFor); tipFor = el;
      textFor(el);
      var d = el.dataset.tipDelay != null ? +el.dataset.tipDelay : TIP_DELAY;
      if (d <= 0) { show(el); } else { tipTimer = setTimeout(function () { tipTimer = null; if (tipFor === el) show(el); }, d); }
    }
  });
  document.addEventListener("mouseout", (e) => {
    if (tipFor && !tipFor.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("mousedown", hide, true);
  window.addEventListener("blur", hide);
})();

// System theme changes
mql.addEventListener("change", () => { if (state && state.settings.appearance.theme === "auto") applyTheme(); });

/* ===================== Init ===================== */
if (window.chatbox && window.chatbox.onMenu) {
  window.chatbox.onMenu((action) => {
    if (action === "new-conversation") newConversation();
    else if (action === "focus-input") focusInput();
    else if (action === "focus-search") focusSearch();
    else if (action === "open-settings") openSettings();
  });
}

// Hand-off from the Option+Space quick-ask bar: open a conversation (or prefill the
// composer for a not-yet-asked draft) so the user can continue turn-by-turn here.
let _pendingQuick = null;
function handleQuickOpen(p) {
  if (!p) return;
  if (!state) { _pendingQuick = p; return; }   // arrived before boot finished loading state
  clearConvSearch();
  const q = (p.question || "").trim();
  const model = (p.model && p.model.provider && p.model.model) ? { provider: p.model.provider, model: p.model.model } : clone(nextModel);
  if (p.answer) {
    const now = Date.now();
    const conv = {
      id: uid(), title: (q || "快速提问").slice(0, 30), titled: false,
      model: model, promptId: nextPromptId, webSearch: nextWeb,
      reasoning: nextReasoning, reasoningEffort: nextReasoningEffort, compaction: null,
      createdAt: now, updatedAt: now,
      messages: [
        { role: "user", content: q, attachments: [] },
        { role: "assistant", content: p.answer, reasoning: p.reasoning || "", usage: p.usage || null },
      ],
    };
    state.conversations.unshift(conv);
    state.currentId = conv.id; editingIndex = null;
    save(); renderAll();
    maybeTitle(conv);          // name the conversation, same as a normal send
    focusInput();
  } else {
    newConversation();
    const input = document.getElementById("input");
    if (input && q) { input.value = q; autoGrow(); }
    focusInput();
  }
}
if (window.chatbox && window.chatbox.onQuickOpen) {
  window.chatbox.onQuickOpen((p) => handleQuickOpen(p));
}
if (window.chatbox && window.chatbox.onQuickShortcutResult) {
  window.chatbox.onQuickShortcutResult((r) => {
    if (!r) return;
    const id = r.which === "openMain" ? "openmain-shortcut-hint" : "quick-shortcut-hint";
    if (!r.ok) setShortcutHint(id, "无法注册「" + fmtAccel(r.shortcut) + "」(可能被其它应用占用)", true);
    else setShortcutHint(id, "已生效", false);
  });
}
// Auto-update notice — lives at the SIDEBAR BOTTOM and replaces the 已归档 area while an update is
// pending (no separate floating box). Routine launch "checking" is ignored so it doesn't flicker.
let dismissedUpdate = "";   // 本会话内被用户从角落关掉的更新版本（仅压制角标，不写持久"忽略"、不影响设置里的检查/更新）
function renderUpdatePill(s) {
  const notice = document.getElementById("update-notice");
  const footer = document.getElementById("sidebar-footer");
  if (!notice) return;
  const main = notice.querySelector(".upd-main"), txt = notice.querySelector(".upd-text");
  const xbtn = notice.querySelector(".upd-x"), bar = notice.querySelector(".upd-bar");
  const barFill = bar && bar.querySelector("i");
  const st = s && s.state, v = (s && s.version) ? (" " + s.version) : "";
  let show = st === "ready" || st === "downloading" || st === "error" || st === "available";
  if (show && s && s.version && s.version === dismissedUpdate) show = false;   // 用户在角落关过这个版本 → 本会话不再弹（设置里仍照常显示、可更新）
  notice.hidden = !show;
  if (footer) footer.classList.toggle("has-update", show);   // hide the profile row, show the update notice in its place
  if (show) {
    notice.className = ""; if (bar) bar.hidden = true;
    if (main) main.onclick = null;
    let text = "";
    if (st === "ready") { notice.className = "ready"; text = "重启以更新" + v; if (main) main.onclick = () => window.chatbox.updateAction("install"); }
    else if (st === "downloading") { notice.className = "busy"; text = "下载更新" + v + (s.percent != null ? " · " + s.percent + "%" : "…"); if (bar) { bar.hidden = false; if (barFill) barFill.style.width = (s.percent != null ? s.percent : 8) + "%"; } }
    else if (st === "error") { notice.className = "err"; text = "更新失败 · 前往下载"; if (main) main.onclick = () => window.chatbox.updateAction("page"); }
    else if (st === "available") { notice.className = "ready"; text = "有新版本" + v; if (main) main.onclick = () => window.chatbox.updateAction("install"); }
    if (txt) txt.textContent = text;
    if (xbtn) xbtn.onclick = (e) => { e.stopPropagation(); dismissedUpdate = (s && s.version) || ""; notice.hidden = true; if (footer) footer.classList.remove("has-update"); };
  }
  updateAboutUpdateStatus(s);
}
function updateAboutUpdateStatus(s) {
  const el = document.getElementById("about-update-status");
  const btn = document.getElementById("about-restart-update");
  if (!el) return;
  const st = s && s.state, v = (s && s.version) ? (" " + s.version) : "";
  el.textContent =
    st === "checking" ? "正在检查…" :
    st === "downloading" ? ("正在下载" + v + (s.percent != null ? " · " + s.percent + "%" : "…")) :
    st === "ready" ? ("已下载" + v + "，重启即可更新") :
    st === "available" ? ("发现新版本" + v) :
    st === "error" ? "检查或下载失败，请稍后重试" :
    st === "none" ? "已是最新版本" :
    st === "dev" ? "开发模式不检查更新" : "";
  if (btn) {                                  // download done (or available) → offer to restart & apply
    const ready = (st === "ready" || st === "available");
    btn.hidden = !ready;
    btn.textContent = (st === "available") ? "立即更新" : "重启更新";
  }
}
if (window.chatbox && window.chatbox.onUpdateStatus) window.chatbox.onUpdateStatus(renderUpdatePill);
// Check for updates from the About page — used by both the manual button and the auto-check on open.
async function aboutCheckUpdate() {
  const st = document.getElementById("about-update-status");
  if (!window.chatbox || !window.chatbox.updateCheck) return;
  if (st) st.textContent = "正在检查…";
  try {
    const r = await window.chatbox.updateCheck();
    if (r && r.state === "dev" && st) st.textContent = "开发模式不检查更新";
  } catch (e) { if (st) st.textContent = "检查失败"; }
}
{ const cu = document.getElementById("about-check-update");
  if (cu) cu.onclick = aboutCheckUpdate;
  const og = document.getElementById("about-open-guide");
  if (og) og.onclick = openGuide;
  const ru = document.getElementById("about-restart-update");
  if (ru) ru.onclick = () => { if (window.chatbox && window.chatbox.updateAction) window.chatbox.updateAction("install"); };
}

// Auto-backup (data safety): a silent, rotating local snapshot WITHOUT API keys. Skipped when nothing
// changed since the last one. Lives in userData/backups; the manual export (with keys) is separate.
let _lastBackupSig = "";
async function autoBackup() {
  if (!window.chatbox || !window.chatbox.writeBackup || !state) return;
  const sig = (state.conversations || []).length + "/" + (state.archived || []).length + "/" + JSON.stringify(state).length;
  if (sig === _lastBackupSig) return;
  const providers = {};
  for (const pk of Object.keys(state.settings.providers)) providers[pk] = Object.assign({}, state.settings.providers[pk], { key: "" });
  const safe = Object.assign({}, state, { settings: Object.assign({}, state.settings, { providers }) });
  const bundle = { app: "Quartz", kind: "quartz-backup", schema: 1, auto: true, exportedAt: new Date().toISOString(), state: safe };
  try { const r = await window.chatbox.writeBackup(JSON.stringify(bundle)); if (r && r.ok) _lastBackupSig = sig; } catch (e) {}
}
setTimeout(autoBackup, 10000);
setInterval(autoBackup, 60 * 60 * 1000);
{ const ob = document.getElementById("data-open-backups"); if (ob) ob.onclick = () => window.chatbox.openBackups && window.chatbox.openBackups(); }
setupMarked();
// Track the floating composer's height so messages stay padded above it and the
// scroll-to-bottom button floats just over it.
(function () {
  const c = document.getElementById("composer");
  if (!c) return;
  const setH = () => document.documentElement.style.setProperty("--composer-h", c.offsetHeight + "px");
  setH();
  if (window.ResizeObserver) new ResizeObserver(setH).observe(c);
})();
// Pull the composer's top edge to resize the input box (Telegram/Slack-style). Drag sets an EXACT manual
// height clamped to [1 line, ~40vh] and keeps it (even below 5 lines, with long text scrolling inside) —
// double-click the grip to restore the default 5-line auto-grow.
(function () {
  const rz = document.getElementById("composer-resizer");
  const ta = document.getElementById("input");
  if (!rz || !ta) return;
  let dragging = false, startY = 0, startH = 0, pinBottom = false;
  // The composer grows UPWARD (it's anchored to the bottom), so sync --composer-h immediately and, when the
  // chat was scrolled to the bottom, re-pin it there — that lifts the last line up to stay above the composer.
  const reflow = () => {
    const c = document.getElementById("composer");
    if (c) document.documentElement.style.setProperty("--composer-h", c.offsetHeight + "px");
    const box = document.getElementById("messages");
    if (pinBottom && box) box.scrollTop = box.scrollHeight;
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("input-resizing");
    try { rz.releasePointerCapture(_pid); } catch (_) {}
  };
  let _pid = -1;
  rz.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true; startY = e.clientY; startH = ta.getBoundingClientRect().height; _pid = e.pointerId;
    const box = document.getElementById("messages");
    pinBottom = !!(box && box.style.display !== "none" && isNearBottom(box));
    document.body.classList.add("input-resizing");
    try { rz.setPointerCapture(e.pointerId); } catch (_) {}
  });
  rz.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (!e.buttons) { end(); return; }                       // button already released (e.g. let go off-window so pointerup was lost) → stop; don't keep following the bare cursor
    const h = startH + (startY - e.clientY);                 // drag up → taller
    inputUserH = Math.max(inputFloorMin(), Math.min(h, inputCeil()));   // EXACT height, clamped — never auto-resets (which, with >5 lines, would snap back up to the 5-line cap)
    autoGrow(); keepCaretVisible(ta); reflow();               // keep the caret's line in view as the box shrinks/grows
  });
  rz.addEventListener("pointerup", end);
  rz.addEventListener("pointercancel", end);
  rz.addEventListener("lostpointercapture", end);            // capture dropped for any reason → make sure we leave drag mode
  // belt-and-suspenders: a release that lands outside the window never reaches rz, so end on a window-level
  // pointerup/blur too — otherwise the drag sticks and the box keeps tracking the cursor with no button down.
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  window.addEventListener("blur", end);
  rz.addEventListener("dblclick", () => { inputUserH = null; autoGrow(); reflow(); });
})();
// Load persisted state from IndexedDB (async), then bring the UI up.
// Seed config from a bundled .env (for distribution builds): on first run only, pre-fill
// provider keys + default model so the recipient can use the app without configuring.
// NOTE: a key bundled this way is EXTRACTABLE from the app — only ship a low-limit/dedicated key.
function applySeed(seed) {
  if (!seed || !state || state.settings._seeded) return;
  let touched = false;
  PROVIDER_ORDER.forEach(pk => {
    if (seed.keys && seed.keys[pk]) { state.settings.providers[pk] = { key: String(seed.keys[pk]).trim() }; touched = true; }
  });
  const ensureModel = (m) => { if (m && m.provider && m.model && !state.settings.models.some(x => modelsEqual(x, m))) state.settings.models.unshift({ provider: m.provider, model: m.model }); };
  if (seed.chat && seed.chat.provider && seed.chat.model) { state.settings.defaults.chat = { provider: seed.chat.provider, model: seed.chat.model }; ensureModel(seed.chat); touched = true; }
  if (seed.title && seed.title.provider && seed.title.model) { state.settings.defaults.title = { provider: seed.title.provider, model: seed.title.model }; ensureModel(seed.title); touched = true; }
  if (touched) { state.settings._seeded = true; save(); }
}

(async function boot() {
  if (window.chatbox && window.chatbox.platform) {
    const p = window.chatbox.platform;
    document.documentElement.dataset.platform = (p === "darwin") ? "mac" : (p === "win32" ? "win" : "other");
  }
  state = await loadState();
  try { if (window.chatbox && window.chatbox.getSeedConfig) applySeed(await window.chatbox.getSeedConfig()); } catch (e) {}
  backfillDailyStats(); save();   // one-time: seed the token heatmap from existing conversations (approximate history)
  nextModel = clone(state.settings.defaults.chat);
  nextPromptId = state.settings.defaults.promptId || null;
  if (state.settings.general && state.settings.general.restoreLast === false) state.currentId = null;   // start on a fresh new chat each launch
  applyTheme();
  applyFont();
  applyContentWidth();
  applyCodeTheme();
  applyProxy();          // route API traffic through the saved proxy before any request fires
  renderAll();
  requestAnimationFrame(scrollActiveConvIntoView);   // land the restored conversation ~20% down the sidebar
  applyDensity();
  updateSendButton();   // start with the send button correctly dimmed when the composer is empty
  pushQuickConfig();   // hand the quick-ask bar its initial config as soon as we're up
  try { if (window.chatbox && window.chatbox.getUpdateStatus) renderUpdatePill(await window.chatbox.getUpdateStatus()); } catch (e) {}
  if (_pendingQuick) { const q = _pendingQuick; _pendingQuick = null; handleQuickOpen(q); }
  // First run: usage guide first — closeGuide() then opens Settings for the API key.
  // Returning users who still have no key go straight to Settings.
  if (!state.settings.guideSeen) setTimeout(maybeShowGuide, 500);
  else if (!anyKey()) setTimeout(() => openSettings("services"), 300);
})();
// Best-effort flush of any pending debounced save before the window goes away.
window.addEventListener("pagehide", () => { if (_saveDirty) flushSave(); });
window.addEventListener("beforeunload", () => { if (_saveDirty) flushSave(); });
