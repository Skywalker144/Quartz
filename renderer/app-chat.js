"use strict";

/* ===================== Provider request layer ===================== */
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
// returns { text, usage }
async function streamChat(ref, payload, opts) {
  opts = opts || {};
  const result = await QuartzCore.streamCompletion({
    ref,
    key: keyOf(ref),
    baseUrl: customBaseOf(ref.provider),
    system: payload.system || "",
    messages: payload.messages || [],
    temperature: opts.temp,
    maxTokens: opts.maxTokens,
    topP: opts.topP,
    topK: opts.topK,
    web: opts.web,
    reasoning: opts.reasoning,
    effort: opts.effort,
    signal: opts.signal,
    onDelta: opts.onDelta,
    onReasoning: opts.onReasoning,
    usageCost: ref.provider === "deepseek" ? usage => deepseekCost(ref.model, usage) : null,
  });
  return result;
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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

// 本次请求真正会发给模型的历史消息。与 runCompletion 的 history=sliced 裁剪保持一致：
// 压缩边界（compaction.count）之前的历史已被摘要文本替代、不随请求发出，故不计入。
// endExclusive：历史终点（重答=at、继续=cont、普通发送=消息数）；缺省=全部。
// newOutgoing=true 表示本次还会在边界之后追加一条新用户消息（普通发送尚未 push 它），
// 它保证裁剪一定发生——即便此刻边界之后暂无消息（正是「压缩后换模型再发」的情形）。
function outgoingHistory(conv, endExclusive, newOutgoing) {
  if (!conv || !conv.messages) return [];
  let base = conv.messages.slice(0, endExclusive == null ? conv.messages.length : endExclusive);
  if (conv.compaction) {
    const cut = Math.min(conv.compaction.count, base.length);
    const sliced = base.slice(cut);
    if (sliced.length || newOutgoing) base = sliced;
  }
  return base;
}

// 不支持读图的模型（如 DeepSeek，image_url 会直接 400）：发送 / 重答前拦截并给出清晰提示。
// 只检查 msgs（本次真正会发出的历史，见 outgoingHistory）+ 本次新附件 extraAtts——
// 被压缩进摘要、不会发送的历史图片不应触发拦截。visionSupport 只在可靠数据下判 "no"，不会误拦能读图的模型。
function imageBlockFor(ref, msgs, extraAtts) {
  if (!ref || visionSupport(ref) !== "no") return false;
  const hasImg = (l) => (l || []).some(a => a.kind === "image");
  if (hasImg(extraAtts) || (msgs || []).some(m => hasImg(m.attachments))) {
    toast("当前模型不支持读图，请更换模型或移除图片后再试");
    return true;
  }
  return false;
}

// 发图但当前模型读不了图时：优先切到「读图模型」默认项后继续发送；未配置 / 配置无效则明确提示并拦截。
// 返回 true = 已拦截（调用方应 return，不再发送）；false = 可继续（可能已切换到读图模型）。
function ensureVisionModel(atts) {
  const ref = activeRef();
  const hasImg = (atts || []).some(a => a.kind === "image");
  if (!hasImg || visionSupport(ref) !== "no") return false;           // 无图 / 当前模型能读图 → 不干预
  const vref = state.settings.defaults.vision;
  if (!vref || !vref.model) {
    openSettings("defaults");
    toast("当前模型不支持读图，请在「默认模型 → 读图模型」里指定一个，或更换模型 / 移除图片");
    return true;
  }
  if (visionSupport(vref) === "no") {
    openSettings("defaults");
    toast("已设置的读图模型「" + modelLabel(vref) + "」本身不支持读图，请改选一个支持读图的模型");
    return true;
  }
  if (!keyOf(vref)) {
    _msProvider = vref.provider; openSettings("services");
    toast("读图模型「" + modelLabel(vref) + "」还没配置 API Key，请先填写");
    return true;
  }
  const c = currentConv();
  if (c) c.model = clone(vref); else nextModel = clone(vref);         // 切换后 runCompletion 会自动沿用（conv.model = activeRef）
  save(); updateModelPill();
  toast("当前模型不支持读图，已切换到读图模型「" + modelLabel(vref) + "」");
  return false;
}

async function sendMessage() {
  closeSlash();
  const input = document.getElementById("input");
  const text = input.value.trim();
  const atts = pending.slice();
  if (!text && !atts.length) return;
  let ref = activeRef();
  if (!ref || !ref.model) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (ensureVisionModel(atts)) return;   // 发图但当前模型读不了图 → 切到读图默认模型（或提示配置）；输入与图片留在原处
  ref = activeRef();                     // 可能已被 ensureVisionModel 切换
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }
  if (imageBlockFor(ref, outgoingHistory(currentConv(), null, true), atts)) return;   // 兜底：仍读不了图则拦截（正常已由上面切换/提示处理）

  let conv = currentConv();
  if (!conv) { newConversation(); conv = currentConv(); }
  conv.messages.push({ role: "user", content: text, attachments: atts });
  conv.updatedAt = Date.now();
  if (!conv.titled && conv.messages.filter(m => m.role === "user").length === 1)
    conv.title = (text || (atts[0] && atts[0].name) || "新对话").slice(0, 30);
  input.value = ""; collapseInputToDefault(); pending = []; renderPending();
  maybeTitle(conv);                              // name / update the conversation title (node titles come from the node-map render)
  await runCompletion(conv, { restorable: true });
}

async function runCompletion(conv, opts) {
  const ref = activeRef();
  if (!ref || !ref.model) { openSettings("services"); toast("请先在「模型服务」里添加一个模型"); return; }
  if (!keyOf(ref)) { _msProvider = ref.provider; openSettings("services"); toast("请先配置 " + (PROVIDERS[ref.provider] ? PROVIDERS[ref.provider].label : ref.provider) + " 的 API Key"); return; }
  // Regenerate in place (keep the following turns) when given a target index; otherwise append a new turn.
  const at = (opts && typeof opts.regenAt === "number" && conv.messages[opts.regenAt] && conv.messages[opts.regenAt].role === "assistant") ? opts.regenAt : null;
  // 继续生成：保留这条回答已有的内容，从中断处接着写（不清空、不新建）。
  const cont = (at == null && opts && typeof opts.continueAt === "number" && conv.messages[opts.continueAt] && conv.messages[opts.continueAt].role === "assistant") ? opts.continueAt : null;
  // 覆盖重答 / 继续 / 追加：只检查本次真正会发出的历史（压缩边界前的历史已被摘要替代、通常不发送，
  // 与下方 history=sliced 的裁剪一致）。endExclusive：重答=at、继续=cont、追加=当前消息数（占位回答尚未 push）。
  if (imageBlockFor(ref, outgoingHistory(conv, cont != null ? cont : (at != null ? at : conv.messages.length), false), null)) return;
  conv.model = clone(ref);
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
  const restoreOnAbort = (opts && opts.restorable && um && um.role === "user")
    ? { text: um.content || "", attachments: Array.isArray(um.attachments) ? um.attachments.slice() : [] } : null;
  pinTop = null; autoScroll = false; nodePinned = null;   // the pin (below) drives the streaming scroll
  selPointerDown = false;   // clear any stuck selection-press flag from a prior turn (safety; mouseup normally clears it)
  save(); renderMessages(); renderSidebar();
  if (opts && opts.restorable) revealActiveConv({ smooth: true });   // 新发 prompt：当前对话不在可视区时，平滑滚到列表距顶 ~20%

  const box = document.getElementById("messages");
  let row = (at != null || cont != null) ? box.querySelector('.msg-row[data-index="' + targetIndex + '"]') : box.lastElementChild;
  if (!row) { setSending(false); return; }
  let contentEl = row.querySelector(".msg-body > .msg-content");   // row/contentEl 用 let：中途切走再切回会重建 DOM，onDelta 里重新抓当前元素继续更新
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

  setSending(true); const controller = new AbortController(); streams.set(conv.id, { controller, targetIndex, pin: (at == null && cont == null) });   // 注册本对话的流（并发表）；pin=全新发送（需把 prompt↔回答分界钉在距顶 ~20%）
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
      signal: controller.signal,
      onDelta: (t) => {
        acc = t;
        const full = cont != null ? contBase + t : t;
        const tgt = conv.messages[targetIndex]; if (tgt) tgt.content = full;   // 增量写回消息对象：中途切到别的对话再切回，正文不丢、也不会被渲染成「…」（后台流照常跑完并保存）
        if (selPointerDown || userSelecting()) return;
        if (state.currentId !== conv.id) return;   // 正在看别的对话：后台继续累积+写回，但不动 DOM（不抢滚动、不渲染到别的对话）
        if (!contentEl || !contentEl.isConnected) {   // 切回本对话后 DOM 被 renderMessages 重建过 → 重新抓当前元素，接着实时更新（不再卡在快照）
          row = box.querySelector('.msg-row[data-index="' + targetIndex + '"]');
          contentEl = row && row.querySelector(".msg-body > .msg-content");
          if (!contentEl) return;
        }
        if (!answerStarted && t.trim()) { answerStarted = true; finishThinking(row); }   // 回答一开始：思考收起、水晶落到回答首行
        renderAnswer(contentEl, renderMarkdown(full), true);
        const openTail = ((full.match(/```/g) || []).length % 2) === 1; enhanceCode(contentEl, { openTail });   // 始终套代码外框（稳住块高度、流式中不跳动）；围栏未闭合时先不高亮，闭合/完成再扫
        applyAutoScroll(box);
      },
      onReasoning: (rt) => {
        racc = rt;
        if (cont == null) { const tgt = conv.messages[targetIndex]; if (tgt) tgt.reasoning = rt; }   // 增量写回思考内容（继续生成的合并仍交给收尾处理）
        if (selPointerDown || userSelecting()) return;
        if (state.currentId !== conv.id) return;   // 看别的对话时不动 DOM（后台仍写回思考内容）
        if (reasoningWrap) { if (!reasonShown) { reasonShown = true; reasoningWrap.style.display = "block"; setReasonTitle(reasoningWrap, "思考中"); bindReason(reasoningWrap, row); row.classList.add("thinking"); void reasoningWrap.offsetHeight; setReasonExp(reasoningWrap, "half"); trackCrest(row);  /* 从折叠态动画展开；水晶逐帧贴着窗口走 */ } }
        if (reasoningBody) { reasoningBody.innerHTML = renderMarkdown(rt); const rOpen = ((rt.match(/```/g) || []).length % 2) === 1; enhanceCode(reasoningBody, { openTail: rOpen }); if (reasoningWrap.dataset.exp !== "collapsed" && reasoningBody._follow !== false) reasoningBody.scrollTop = reasoningBody.scrollHeight; }
        applyAutoScroll(box);
      },
    });
    acc = r.text || ""; racc = r.reasoning || racc; usage = r.usage;
  } catch (err) {
    if (err.name === "AbortError") { aborted = true; acc = acc + (acc ? "\n\n_（已停止）_" : "_（已停止生成）_"); }
    else errInfo = friendlyError(err);
  }
  // 流式正常结束却完全没有内容（无正文、无思考）→ 当软错误处理：给重试卡片，而不是存一句「（没有返回内容）」占位文本
  if (!aborted && !errInfo && !acc.trim() && !(racc || "").trim()) errInfo = { title: "没有返回内容", body: "模型这次没有输出任何内容，可能是网络波动或模型异常。点「重试」再试一次。" };

  streams.delete(conv.id);   // 本对话的流结束，从并发表移除
  const isCurrent = (conv.id === state.currentId);   // 只有正在看这条对话时才动视图（滚动/正文/发送键）；后台完成只存数据 + 刷侧栏
  if (isCurrent) { stopCrest(contentEl); finishThinking(row); box.classList.remove("streaming"); cancelSmooth(); setSending(false); }

  // 第一次 Esc 已停止生成；若这是一次「全新发送」，记下它，让「再按一次 Esc」可整轮撤销、prompt（+附件）退回输入框。
  const freshSend = (aborted && restoreOnAbort) ? restoreOnAbort : null;

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
  // Final re-render. 后台对话（非当前视图）完成时只刷新侧栏，绝不动当前视图的滚动/正文。
  const convList = document.getElementById("conv-list");
  const sbKeep = convList ? convList.scrollTop : null;
  if (isCurrent) {
    const keepTop = box.scrollTop;
    const wasFollowing = (pinTop == null) && autoScroll;   // 「钉着 20% 分界」就保持在锚点位置；只有真正未钉、在跟随底部时才落到底（切回流式对话时切换处理器会把 autoScroll 置真，必须用 pinTop 排除，否则答完瞬间跳底）
    renderMessages(); renderSidebar();   // pinTop 仍非空 → 这轮 updateScrollBtn 不会误显按钮
    if (sbKeep != null) convList.scrollTop = sbKeep;
    pinTop = null;   // 紧挨着设最终 scrollTop 才释放流式锚定，中间不留「按钮闪一下」的空帧
    box.scrollTop = wasFollowing ? box.scrollHeight : keepTop;
    lastSetTop = box.scrollTop;
    updateScrollBtn();
    updateComposerToggles();   // 刷新压缩按钮上的上下文用量提示
  } else {
    renderSidebar();   // 后台完成：仅更新侧栏（移除生成中圆点、刷新标题/预览），不碰当前视图
    if (sbKeep != null) convList.scrollTop = sbKeep;
  }
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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
  const faded = !h1.isContentEditable && h1.scrollWidth > h1.clientWidth + 1;
  h1.classList.toggle("faded", faded);
  h1.title = faded ? (h1.textContent || "") : "";   // 标题被右缘渐隐截断时，悬停看全名（与侧栏项一致）
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
  if (currentStreaming()) { toast("正在生成，请先停止或等待完成"); return; }
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
  setSending(true, "compact"); const controller = new AbortController(); streams.set(conv.id, { controller, reason: "compact" });
  try {
    const r = await streamChat(ref, { system: "", messages: [{ role: "user", content: prompt }] }, { temp: 0.3, maxTokens: 1200, signal: controller.signal });
    const summary = (r.text || "").trim();
    if (!summary) { toast("压缩失败：未返回摘要"); return; }
    conv.compaction = { summary: summary, count: conv.messages.length };
    save(); if (conv.id === state.currentId) renderMessages();
    toast("已把 " + toSummarize.length + " 条消息压缩为摘要");
  } catch (e) {
    if (e.name !== "AbortError") toast("压缩失败：" + e.message);
  } finally {
    streams.delete(conv.id); if (conv.id === state.currentId) setSending(false); hideStatus();
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
