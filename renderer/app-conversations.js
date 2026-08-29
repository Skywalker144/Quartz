"use strict";

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
  el.className = "conv" + (c.id === state.currentId ? " active" : "") + (c.pinned ? " pinned" : "") + (isStreaming(c.id) ? " gen" : "");   // gen：该对话正在生成（后台或当前）→ 标题前脉冲圆点
  el.dataset.convId = c.id;
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
  // 删除正在生成的对话：先停掉它的流。否则流会孤儿化——停止键/Esc 只对「当前对话」生效，删掉后再也停不下来，
  // 白烧 token；若随后彻底删除，跑完的答案还会写不回（记录已删）。停止后归档里保留这半截「已停止」的回答。
  const s = streams.get(c.id); if (s) { try { s.controller.abort(); } catch (e) {} streams.delete(c.id); }
  state.conversations = state.conversations.filter(x => x.id !== c.id);
  state.archived = state.archived || [];
  c.archivedAt = Date.now();
  state.archived.unshift(c);
  if (state.currentId === c.id) state.currentId = (state.conversations[0] && state.conversations[0].id) || null;
  editingIndex = null;   // 若删的正是行内编辑中的对话，清掉编辑态，避免序号错位到新当前对话
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
  syncStreamingUI();   // 发送/停止键、流式视觉态按「当前对话」对齐（多对话并发生成）
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
    updateScrollBtn();   // 空对话：清掉可能从上一条对话残留的「回到底部」按钮（否则切到新对话/缩放窗口时会残留冒出）
    return;
  }
  empty.style.display = "none"; box.style.display = "block";
  const switchedConversation = conv.id !== lastConvSeen;
  if (switchedConversation) { box.classList.remove("switch-in"); void box.offsetWidth; box.classList.add("switch-in"); }
  lastConvSeen = conv.id;
  box.innerHTML = "";
  const boundary = conv.compaction ? Math.min(conv.compaction.count, conv.messages.length) : -1;
  conv.messages.forEach((m, i) => {
    box.appendChild(buildMessage(m, i));
    if (i + 1 === boundary) box.appendChild(compactionMarker(conv));
  });
  enhanceCode(box);
  // 每次切换对话都从消息区顶部开始，避免沿用上一条对话的滚动位置导致首行大幅漂移。
  // 同一对话内的重渲染仍保留原有的自动跟随/手动滚动行为。
  if (switchedConversation) { box.scrollTop = 0; lastSetTop = 0; autoScroll = false; pinTop = null; }
  else if (autoScroll) { box.scrollTop = box.scrollHeight; lastSetTop = box.scrollTop; }
  // 多对话并发：DOM 重建后按「当前对话的流」恢复滚动锚——「全新发送」的流把 prompt↔回答分界钉在距顶 ~20%（切走再切回也保持，不退化成跟随底部）；
  // 无流 / 原地重答（pin 假）则清掉锚、跟随底部。发送当下（流还没注册）走 else 清空，紧接着 runCompletion 再算一次，两边一致。
  const _cs = currentStream();
  if (!switchedConversation && _cs && _cs.pin) {
    const _r = box.querySelector('.msg-row[data-index="' + _cs.targetIndex + '"]');
    if (_r) { pinTop = Math.max(0, _r.offsetTop - Math.round(box.clientHeight * 0.2)); box.scrollTop = Math.min(pinTop, box.scrollHeight - box.clientHeight); lastSetTop = box.scrollTop; }
  } else pinTop = null;
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
    item.onclick = (e) => {
      nodePinned = i;
      scrollToMessage(i);
      setNodeActive(i);
      // A pointer click leaves the button focused, which would keep :focus-within open
      // after the pointer leaves. Keyboard activation keeps focus for accessibility.
      if (e.detail > 0) item.blur();
      setTimeout(() => {
        if (nodePinned === i) nodePinned = null;
        updateNodeActive();
      }, 300);
    };
    panel.appendChild(item);
  });
  if (divAt >= 0 && !divDone) addPanelDivider();   // boundary sits after the last turn (just ran /newhere) → panel marker only
  queueNodeTitles(conv);
  updateNodeActive();
}
function setNodeActive(indices) {
  const wrap = document.getElementById("nodemap"); if (!wrap) return;
  const active = new Set(Array.isArray(indices) ? indices : [indices]);
  wrap.querySelectorAll(".nm-bar, .nm-item").forEach(el => el.classList.toggle("active", active.has(+el.dataset.idx)));
}
// Scroll-spy: every question/answer turn intersecting the visible transcript gets a lit node.
function updateNodeActive() {
  if (!nodeUserIndices.length) return;
  if (nodePinned != null) { setNodeActive(nodePinned); return; }   // keep the jump target stable during its short animation
  const box = document.getElementById("messages");
  if (!box) return;
  const boxRect = box.getBoundingClientRect();
  const composer = document.getElementById("composer-inner");
  const visibleTop = boxRect.top;
  const visibleBottom = composer ? Math.min(boxRect.bottom, composer.getBoundingClientRect().top) : boxRect.bottom;
  const messageRows = box.querySelectorAll('.msg-row[data-index]');
  const lastBottom = messageRows.length ? messageRows[messageRows.length - 1].getBoundingClientRect().bottom : visibleBottom;
  const active = [];
  for (let n = 0; n < nodeUserIndices.length; n++) {
    const idx = nodeUserIndices[n];
    const row = box.querySelector('.msg-row[data-index="' + idx + '"]');
    if (!row) continue;
    const nextIdx = nodeUserIndices[n + 1];
    const nextRow = nextIdx == null ? null : box.querySelector('.msg-row[data-index="' + nextIdx + '"]');
    const turnTop = row.getBoundingClientRect().top;
    const turnBottom = nextRow ? nextRow.getBoundingClientRect().top : lastBottom;
    if (turnBottom > visibleTop && turnTop < visibleBottom) active.push(idx);
  }
  // During elastic scrolling there can briefly be no intersection; retain a stable nearest node.
  if (!active.length) {
    let nearest = nodeUserIndices[0];
    for (const idx of nodeUserIndices) {
      const row = box.querySelector('.msg-row[data-index="' + idx + '"]');
      if (row && row.getBoundingClientRect().top <= visibleTop) nearest = idx;
    }
    active.push(nearest);
  }
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }   // deleting the streaming message would corrupt the transcript
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
  if (currentStreaming()) return;
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
  if (currentStreaming()) return;
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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
