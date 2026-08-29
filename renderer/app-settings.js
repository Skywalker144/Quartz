"use strict";

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
    populateModelSelect(document.getElementById("vision-model-sel"), state.settings.defaults.vision, "（不设置）");
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
function populateModelSelect(sel, currentRef, noneLabel) {
  sel.innerHTML = "";
  const list = state.settings.models.slice();
  if (currentRef && !list.some(m => modelsEqual(m, currentRef))) list.unshift(currentRef);
  if (noneLabel) { const o = document.createElement("option"); o.value = ""; o.textContent = noneLabel; sel.appendChild(o); }   // 可选项（如「读图模型」允许不设置）
  if (!list.length) {
    if (!noneLabel) { const o = document.createElement("option"); o.value = ""; o.textContent = "（请先在「管理模型」中添加模型）"; sel.appendChild(o); }
    sel.value = ""; return;
  }
  list.forEach(m => { const o = document.createElement("option"); o.value = refKey(m); o.textContent = modelLabel(m); o.title = (PROVIDERS[m.provider] ? PROVIDERS[m.provider].label : m.provider) + " · " + m.model; sel.appendChild(o); });
  sel.value = currentRef ? refKey(currentRef) : "";
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
  populateModelSelect(document.getElementById("vision-model-sel"), d.vision, "（不设置）");
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
    const resp = await fetch(apiUrl(pk, "models"), { headers });
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
      state.settings.providers[pk] = Object.assign({}, state.settings.providers[pk], { key: el.value.trim() });
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
  document.getElementById("vision-model-sel").addEventListener("change", e => { state.settings.defaults.vision = e.target.value ? parseRefKey(e.target.value) : null; save(); });
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
    // 危险操作（导入覆盖/彻底删除/恢复）默认聚焦「取消」，随手回车不会直接执行不可逆动作；非危险确认才默认聚焦「确定」
    setTimeout(() => (opts.danger === true ? cancel : ok).focus(), 0);
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
const CUSTOM_BASE_PROVIDERS = new Set(["openai", "anthropic"]);

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
    + (CUSTOM_BASE_PROVIDERS.has(pk)
      ? '<div class="ms-field ms-base-field"><label>Base URL <span>第三方兼容接口（可选）</span></label>'
        + '<input id="ms-base" type="url" placeholder="' + prov.base + '" autocomplete="off" spellcheck="false">'
        + '<div class="ms-help">留空使用官方地址；请填写 API 版本根路径，例如 https://example.com/v1，无需填写 /chat/completions 或 /messages。</div></div>'
      : '')
    + '<div class="group-label">已启用的模型</div><div id="ms-enabled" class="ms-enabled"></div>'
    + '<div class="ms-actions"><button class="btn small" id="ms-fetch">从 API 获取模型 ↻</button>'
      + '<div class="model-row ms-add-row"><input id="ms-add" placeholder="或手动输入模型 ID 添加"><button class="btn small" id="ms-add-btn">添加</button></div></div>'
    + '<input id="ms-search" class="ms-search" placeholder="搜索模型…" hidden>'
    + '<div id="ms-list" class="or-list"></div>';
  const keyEl = box.querySelector("#ms-key"); keyEl.value = key || "";
  let connected = !!key;   // 打开面板时该服务商是否已配置过 key（已配置则不再触发「已接入」副作用）
  keyEl.addEventListener("input", () => {   // 实时保存，但不在这里触发「已接入」——否则敲第一个字符就误报成功
    state.settings.providers[pk] = Object.assign({}, state.settings.providers[pk], { key: keyEl.value.trim() });
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
  const baseEl = box.querySelector("#ms-base");
  if (baseEl) {
    baseEl.value = customBaseOf(pk);
    baseEl.addEventListener("input", () => {
      state.settings.providers[pk] = Object.assign({}, state.settings.providers[pk], { baseUrl: baseEl.value.trim() });
      delete _msFetched[pk];
      save();
    });
    baseEl.addEventListener("change", () => {
      const v = baseEl.value.trim();
      if (!v) return;
      try {
        const u = new URL(v);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        baseEl.value = v.replace(/\/+$/, "");
        state.settings.providers[pk].baseUrl = baseEl.value;
        save();
      } catch (_) { toast("Base URL 必须是以 http:// 或 https:// 开头的完整地址"); baseEl.focus(); }
    });
  }
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
  const resp = await fetch(apiUrl(pk, "models"), { headers });
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
      visionOk: Array.isArray(m.architecture && m.architecture.input_modalities)
        ? m.architecture.input_modalities.includes("image")
        : (m.architecture && typeof m.architecture.modality === "string" ? m.architecture.modality.includes("image") : undefined),
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
