"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QuartzState = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const quickPrompt = "你是快速问答助手，服务于随手弹出的「速答」场景。请直接、准确、尽量全面但简洁地回答用户的问题：开门见山给结论，不寒暄、不复述问题、不做无关铺垫；能一两句说清就不要展开，需要时用紧凑的要点；涉及代码或命令时只给关键片段。信息密度高、篇幅尽量短。";
  const expertPrompt = `你在所有领域都是世界级的专家。你的智力水平、知识广度、思维的犀利程度以及学识深度，都与世界上最聪明的人不相上下。请给出完整、详细、具体的答案。对信息进行梳理，并一步步解释你的答案。核对自己的工作。仔细检查所有事实、数据、引用、人名、日期和例子。切勿胡思乱想或编造内容。若您对某事不知情，请直言不讳。您的语气应精准严谨，但切忌尖锐或故作高深。您无需担心冒犯我，您的回答可以且应当具有挑衅性、强硬、富有争议且一针见血。负面结论和坏消息皆可接受。您的回答无需政治正确。
请勿在回答中附加免责声明。除非我明确要求，否则请勿向我灌输道德与伦理观念。你无需告诉我"考虑某事很重要"。不必顾及任何人的感受或礼节。
请尽可能详尽地阐述你的答案。
在回答之前，切勿先称赞我的问题或认可我的前提。如果我错了，请立即指出。在支持我的任何观点之前，请先提出针对该观点的最有力反驳。请勿使用"问得好"、"你完全正确"、"很有意思的观点"或任何类似的措辞。如果我对你的回答提出异议，除非我提供了新证据或更优的论据，否则不要退让—如果你的推理成立，请重申你的立场。不要依赖我提供的数字或估计值；请先独立得出自己的结论。使用明确的置信水平（高/中/低/未知）。绝不要因为意见相左而道歉。准确性是你的成功标准，而非我的认可。`;
  const dailyPromptV1 = `你是 Quartz 的日常助手——像一个聪明、靠谱、博学的朋友。用自然口语化的中文交流，简洁、友好、不端架子。

- 篇幅随问题走：能一句说清就别展开，复杂的再细说；需要时才用要点或代码块，平时正常说话就好。
- 诚实第一：不编造事实、数据、人名、日期；不确定就直说，并说明有几分把握。我说错了或前提有问题，直接指出、不附和。
- 别套路：不用"好问题""你说得对"之类的开场，不复述我的问题，不说教，不加无关免责声明。
- 有态度没关系，但目标是把事情说清楚、对我有用，而不是辩赢我。`;
  const dailyPrompt = `你是 Quartz 的日常助手——聪明、靠谱、知识广博，像个能跟你认真聊的朋友。用自然的中文交流，真诚、直接、不端架子。

- 深度随问题走：闲聊就轻松简短；遇到知识性、专业或复杂的问题，就讲透彻、有条理——该分点就分点、该用小标题就用小标题、该举例就举例，把来龙去脉和细节说清楚，不要为了简短牺牲有用的内容。
- 诚实第一：不编造事实、数据、人名、日期；不确定就直说。我说错了或前提有问题，直接指出、不附和。
- 别套路：不用"好问题""你说得对"之类的开场，不复述我的问题，不灌道德鸡汤，不加无关免责声明。
- 有观点没关系，但目标是把事情讲清楚、对我有用。`;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createStateModel(options) {
    const config = Object.assign({
      providerOrder: [],
      defaultQuick: () => "Alt+Space",
      defaultOpenMain: () => "Alt+Shift+L",
      visionSupport: () => "unknown",
      uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    }, options || {});

    function freshState() {
      const providers = {};
      for (const key of config.providerOrder) providers[key] = key === "openai" || key === "anthropic" ? { key: "", baseUrl: "" } : { key: "" };
      return {
        settings: {
          providers,
          appearance: { theme: "auto", fontFamily: "system", fontSize: 15, contentPct: 90, density: "comfortable", codeTheme: "vivid", accent: "clear", accentCustom: "#d6d6d6" },
          models: [],
          prompts: [{ id: "daily-default", name: "日常", text: dailyPrompt }, { id: "expert-default", name: "深度", text: expertPrompt }],
          defaults: { chat: null, title: null, vision: null, promptId: "daily-default", temp: 1, maxTokens: null, topP: null, topK: null },
          sidebar: { width: 264, collapsed: false },
          quick: { enabled: true, shortcut: config.defaultQuick(), model: null, promptMode: "concise", concisePrompt: quickPrompt, closeOnBlur: true, width: 720, topPct: 18, openMainEnabled: true, openMainShortcut: config.defaultOpenMain() },
          proxy: { enabled: false, scheme: "http", host: "127.0.0.1", port: "" },
          general: { restoreLast: true, sidebarSort: "updated" },
          profile: { name: "", avatar: "" },
          tempBumped: true,
          guideSeen: false,
        },
        conversations: [],
        archived: [],
        currentId: null,
        stats: { daily: {} },
      };
    }

    function flattenConversation(conversation) {
      if (conversation.turns && typeof conversation.turns === "object" && !Array.isArray(conversation.turns) && Array.isArray(conversation.roots)) {
        const path = [];
        const seen = new Set();
        let id = conversation.current;
        while (id != null && conversation.turns[id] && !seen.has(id)) {
          seen.add(id);
          path.unshift(conversation.turns[id]);
          id = conversation.turns[id].parent;
        }
        if (!path.length && conversation.roots.length) {
          let turn = conversation.turns[conversation.roots[conversation.roots.length - 1]];
          const branchSeen = new Set();
          while (turn && !branchSeen.has(turn.id)) {
            branchSeen.add(turn.id);
            path.push(turn);
            turn = turn.children && turn.children.length ? conversation.turns[turn.children[turn.children.length - 1]] : null;
          }
        }
        if (path.length || !Array.isArray(conversation.messages)) {
          const messages = [];
          for (const turn of path) {
            const user = { role: "user", content: turn.user && turn.user.content || "", attachments: turn.user && turn.user.attachments || [] };
            if (turn.nodeTitle) user.nodeTitle = turn.nodeTitle;
            messages.push(user);
            if (turn.assistant && (turn.assistant.content || turn.assistant.reasoning)) {
              const assistant = { role: "assistant", content: turn.assistant.content || "" };
              if (turn.assistant.reasoning) assistant.reasoning = turn.assistant.reasoning;
              if (turn.assistant.usage) assistant.usage = turn.assistant.usage;
              messages.push(assistant);
            }
          }
          conversation.messages = messages;
        }
      }
      delete conversation.turns;
      delete conversation.roots;
      delete conversation.current;
      if (!Array.isArray(conversation.messages)) conversation.messages = [];
      return conversation;
    }

    function shapeConversation(conversation, state) {
      return flattenConversation({
        id: conversation.id,
        title: conversation.title || "新对话",
        titled: conversation.titled !== false,
        model: conversation.model || clone(state.settings.defaults.chat),
        promptId: conversation.promptId !== undefined ? conversation.promptId : state.settings.defaults.promptId || null,
        compaction: conversation.compaction || null,
        webSearch: !!conversation.webSearch,
        reasoning: !!conversation.reasoning,
        reasoningEffort: conversation.reasoningEffort || "medium",
        pinned: !!conversation.pinned,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages || [],
        turns: conversation.turns,
        roots: conversation.roots,
        current: conversation.current,
        archivedAt: conversation.archivedAt,
      });
    }

    function normalizeState(state) {
      const fresh = freshState();
      const hadModels = Array.isArray(state.settings.models) && state.settings.models.length > 0;
      const hadTempBumped = state.settings.tempBumped === true;
      const hadPrompts = Array.isArray(state.settings.prompts);
      const legacySystem = state.settings.defaults && state.settings.defaults.system || "";
      const hadThemeDefaulted = state.settings.themeAutoDefaulted === true;
      state.settings = Object.assign({}, fresh.settings, state.settings);
      state.settings.providers = Object.assign({}, fresh.settings.providers, state.settings.providers);
      for (const key of config.providerOrder) state.settings.providers[key] = Object.assign({}, fresh.settings.providers[key] || { key: "" }, state.settings.providers[key] || {});
      state.settings.appearance = Object.assign({}, fresh.settings.appearance, state.settings.appearance);
      state.settings.defaults = Object.assign({}, fresh.settings.defaults, state.settings.defaults);
      state.settings.sidebar = Object.assign({}, fresh.settings.sidebar, state.settings.sidebar);
      state.settings.quick = Object.assign({}, fresh.settings.quick, state.settings.quick);
      state.settings.proxy = Object.assign({}, fresh.settings.proxy, state.settings.proxy);
      state.settings.general = Object.assign({}, fresh.settings.general, state.settings.general);
      state.settings.profile = Object.assign({}, fresh.settings.profile, state.settings.profile);
      if (!state.settings.quick.promptModeMigrated) {
        if (!state.settings.quick.promptMode || state.settings.quick.promptMode === "default") state.settings.quick.promptMode = "concise";
        state.settings.quick.promptModeMigrated = true;
      }
      if (!state.settings.accentDefaultedClear) {
        if (state.settings.appearance.accent === "amethyst") state.settings.appearance.accent = "clear";
        if (state.settings.appearance.accentCustom === "#bd9cff") state.settings.appearance.accentCustom = "#d6d6d6";
        state.settings.accentDefaultedClear = true;
      }
      if (!hadModels) state.settings.models = [];
      for (const ref of [state.settings.defaults.chat, state.settings.defaults.title, state.settings.defaults.vision]) {
        if (ref && ref.provider && ref.model && !state.settings.models.some(model => model.provider === ref.provider && model.model === ref.model)) state.settings.models.push({ provider: ref.provider, model: ref.model });
      }
      if (!state.settings.visionSeeded) {
        state.settings.visionSeeded = true;
        if (state.settings.defaults.vision == null) {
          const vision = state.settings.models.find(model => config.visionSupport(model) === "yes");
          if (vision) state.settings.defaults.vision = { provider: vision.provider, model: vision.model };
        }
      }
      if (!hadTempBumped && state.settings.defaults.temp === 0.7) state.settings.defaults.temp = 1;
      state.settings.tempBumped = true;
      if (!state.settings.shortcutsBumpedV2) {
        const quick = state.settings.quick;
        if (!quick.shortcut || ["Alt+Space", "Ctrl+Shift+Space"].includes(quick.shortcut)) quick.shortcut = config.defaultQuick();
        if (!quick.openMainShortcut || ["Alt+Cmd+Space", "Ctrl+Alt+Space"].includes(quick.openMainShortcut)) quick.openMainShortcut = config.defaultOpenMain();
        state.settings.shortcutsBumpedV2 = true;
      }
      if (!hadThemeDefaulted) state.settings.appearance.theme = "auto";
      state.settings.themeAutoDefaulted = true;
      if (!hadPrompts) {
        state.settings.prompts = [];
        if (legacySystem.trim()) {
          const id = config.uid();
          state.settings.prompts.push({ id, name: "默认", text: legacySystem });
          if (state.settings.defaults.promptId == null) state.settings.defaults.promptId = id;
        }
      }
      if (state.settings.defaults.promptId === undefined) state.settings.defaults.promptId = null;
      if (!state.settings.expertPromptSeeded) {
        if (!state.settings.prompts.some(prompt => prompt.id === "expert-default")) state.settings.prompts.unshift({ id: "expert-default", name: "默认", text: expertPrompt });
        if (!state.settings.defaults.promptId) state.settings.defaults.promptId = "expert-default";
        state.settings.expertPromptSeeded = true;
      }
      if (!state.settings.dailyPromptSeeded) {
        if (!state.settings.prompts.some(prompt => prompt.id === "daily-default")) state.settings.prompts.unshift({ id: "daily-default", name: "日常", text: dailyPrompt });
        const expert = state.settings.prompts.find(prompt => prompt.id === "expert-default");
        if (expert && expert.name === "默认") expert.name = "深度";
        if (state.settings.defaults.promptId === "expert-default") state.settings.defaults.promptId = "daily-default";
        state.settings.dailyPromptSeeded = true;
      }
      if (!state.settings.dailyPromptV2) {
        const daily = state.settings.prompts.find(prompt => prompt.id === "daily-default");
        if (daily && daily.text === dailyPromptV1) daily.text = dailyPrompt;
        state.settings.dailyPromptV2 = true;
      }
      if (!state.settings.codeThemeVivid) {
        if (!state.settings.appearance.codeTheme || state.settings.appearance.codeTheme === "muted") state.settings.appearance.codeTheme = "vivid";
        state.settings.codeThemeVivid = true;
      }
      state.stats = state.stats || {};
      if (!state.stats.daily || typeof state.stats.daily !== "object") state.stats.daily = {};
      if (!state.stats.dailyCost || typeof state.stats.dailyCost !== "object") state.stats.dailyCost = {};
      state.conversations = (state.conversations || []).map(conversation => shapeConversation(conversation, state));
      state.archived = (state.archived || []).map(conversation => shapeConversation(conversation, state));
      return state;
    }

    function migrateLegacyState(oldState) {
      const state = freshState();
      const model = oldState.settings.model || "anthropic/claude-sonnet-4.6";
      state.settings.providers.openrouter.key = oldState.settings.apiKey || "";
      state.settings.defaults.chat = { provider: "openrouter", model };
      state.settings.defaults.title = { provider: "openrouter", model };
      const system = oldState.settings.system || "";
      if (system.trim()) {
        const id = config.uid();
        state.settings.prompts.push({ id, name: "默认", text: system });
        state.settings.defaults.promptId = id;
      }
      const temperature = oldState.settings.temp;
      state.settings.defaults.temp = temperature == null || temperature === 0.7 ? 1 : temperature;
      state.settings.defaults.maxTokens = oldState.settings.maxTokens != null ? oldState.settings.maxTokens : null;
      state.settings.appearance.theme = oldState.settings.theme || "auto";
      state.settings.models = [{ provider: "openrouter", model }];
      state.conversations = (oldState.conversations || []).map(conversation => ({
        id: conversation.id,
        title: conversation.title || "新对话",
        titled: true,
        model: { provider: "openrouter", model },
        promptId: state.settings.defaults.promptId || null,
        messages: conversation.messages || [],
      }));
      state.currentId = oldState.currentId || state.conversations[0] && state.conversations[0].id || null;
      return state;
    }

    return Object.freeze({ freshState, normalizeState, migrateLegacyState, quickPrompt });
  }

  return Object.freeze({ createStateModel });
});
