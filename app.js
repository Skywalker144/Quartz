"use strict";

const MARKDOWN = QuartzMarkdown.createMarkdown({ root: window, core: QuartzCore, icon: ic });
const setupMarked = MARKDOWN.setup;
const renderMarkdown = MARKDOWN.render;
const enhanceCode = MARKDOWN.enhanceCode;

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
// 缩放窗口后按当前溢出情况重算「回到底部」按钮：空对话隐藏、内容变化时同步显隐（不再靠残留状态）
window.addEventListener("resize", updateScrollBtn);
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
// ⌘B / Ctrl+B toggles the sidebar; ⌘1…⌘9 / Ctrl+1…Ctrl+9 open the first nine visible conversations.
// Reading the rendered rows keeps the shortcut order identical to the sidebar order (including search results).
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.shiftKey || (!e.metaKey && !e.ctrlKey) || anyModalOpen()) return;
  if (e.key === "b" || e.key === "B") {
    e.preventDefault(); toggleSidebar(); return;
  }
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  e.preventDefault();
  const row = document.querySelectorAll("#conv-list .conv")[n - 1];
  if (!row || row.dataset.convId === state.currentId) return;
  const c = state.conversations.find(x => x.id === row.dataset.convId);
  if (!c) return;
  state.currentId = c.id; editingIndex = null; autoScroll = true; nodePinned = null;
  save(); renderAll();
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
sendBtn.onclick = () => { const s = currentStream(); if (s) s.controller.abort(); else sendMessage(); };

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
  if (e.key === "Escape" && currentStreaming()) { e.preventDefault(); currentStream().controller.abort(); return; }
  if (e.key === "Escape" && !currentStreaming() && canUndoSend()) { e.preventDefault(); undoLastSend(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!currentStreaming()) sendMessage(); }
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
// pending (no separate floating box). ONLY the "ready" (download finished) state surfaces here —
// checking/downloading/error stay silent in the corner so it neither flickers nor nags; full status
// still lives in 设置 → 关于。即：只在下载完成后角落才提示「重启以更新」，不展示下载过程。
let dismissedUpdate = "";   // 本会话内被用户从角落关掉的更新版本（仅压制角标，不写持久"忽略"、不影响设置里的检查/更新）
function renderUpdatePill(s) {
  const notice = document.getElementById("update-notice");
  const footer = document.getElementById("sidebar-footer");
  if (!notice) return;
  const main = notice.querySelector(".upd-main"), txt = notice.querySelector(".upd-text");
  const xbtn = notice.querySelector(".upd-x"), bar = notice.querySelector(".upd-bar");
  const barFill = bar && bar.querySelector("i");
  const st = s && s.state, v = (s && s.version) ? (" " + s.version) : "";
  let show = st === "ready";   // 只在下载完成后才在角落提示「重启以更新」；下载/检查/出错过程一律不在角落展示（设置→关于 里仍有完整状态）
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
// scroll-to-bottom button floats just over it. The visible half-height also keeps
// the node minimap centred between the header edge and the input card's top edge.
function syncComposerMetrics() {
  const c = document.getElementById("composer");
  if (!c) return;
  const root = document.documentElement;
  const h = c.offsetHeight;
  const fade = parseFloat(getComputedStyle(root).getPropertyValue("--edge-fade-depth")) || 56;
  root.style.setProperty("--composer-h", h + "px");
  root.style.setProperty("--composer-visible-half", Math.max(0, (h - fade) / 2) + "px");
}
(function () {
  const c = document.getElementById("composer");
  if (!c) return;
  syncComposerMetrics();
  if (window.ResizeObserver) new ResizeObserver(syncComposerMetrics).observe(c);
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
    syncComposerMetrics();
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
    if (seed.keys && seed.keys[pk]) { state.settings.providers[pk] = Object.assign({}, state.settings.providers[pk], { key: String(seed.keys[pk]).trim() }); touched = true; }
    if (seed.baseUrls && seed.baseUrls[pk]) { state.settings.providers[pk] = Object.assign({}, state.settings.providers[pk], { baseUrl: String(seed.baseUrls[pk]).trim().replace(/\/+$/, "") }); touched = true; }
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
