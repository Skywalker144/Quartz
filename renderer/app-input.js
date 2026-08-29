"use strict";

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
// 发送后把输入框平滑收回默认高度（≈1 行）：直接 autoGrow() 是瞬间跳，这里给 height 加一次性过渡。
// 同时清掉手动拖拽高度 inputUserH，真正回到默认（否则发完会停在之前拖过的高度）。
function collapseInputToDefault() {
  const ta = document.getElementById("input"); if (!ta) return;
  inputUserH = null;                                   // 丢弃手动拖拽高度 → 回默认
  const from = ta.offsetHeight, target = inputFloorMin();
  ta.style.overflowY = "hidden";                       // 收缩动画期间不显示滚动条
  if (from <= target + 1) { ta.style.transition = ""; autoGrow(); return; }   // 本就是默认高度，无需动画
  ta.style.height = from + "px";                       // 固定当前高度作为动画起点
  ta.style.transition = "height .18s ease";
  requestAnimationFrame(() => { ta.style.height = target + "px"; });           // 下一帧再改目标值 → 触发过渡
  ta.addEventListener("transitionend", function done(e) {
    if (e.propertyName !== "height") return;
    ta.removeEventListener("transitionend", done);
    ta.style.transition = "";
    autoGrow();                                        // 收完交回 autoGrow 接管（恢复正常 overflow 等）
  });
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }   // 清空正在流式的对话会清掉 messages，收尾处 conv.messages[targetIndex] 变 undefined → 崩溃
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
