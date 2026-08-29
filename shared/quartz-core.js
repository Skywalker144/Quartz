"use strict";

(function (root, factory) {
  const core = factory(root);
  if (typeof module === "object" && module.exports) module.exports = core;
  if (root) root.QuartzCore = core;
})(typeof globalThis === "object" ? globalThis : this, function (root) {
  const providers = Object.freeze({
    openrouter: Object.freeze({ label: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1" }),
    openai: Object.freeze({ label: "OpenAI", kind: "openai", base: "https://api.openai.com/v1" }),
    anthropic: Object.freeze({ label: "Anthropic", kind: "anthropic", base: "https://api.anthropic.com/v1" }),
    deepseek: Object.freeze({ label: "DeepSeek", kind: "openai", base: "https://api.deepseek.com/v1" }),
    google: Object.freeze({ label: "Google Gemini", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai" }),
  });
  const providerOrder = Object.freeze(["openrouter", "openai", "anthropic", "deepseek", "google"]);
  const cjkLetter = "\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3040-\\u30FF\\uAC00-\\uD7AF\\uF900-\\uFAFF\\u3005\\u3007";
  const cjkPunct = "()\\[\\]{}<>\"'`!?.,:;~|@#%^&=+/\\\\\\u2018\\u2019\\u201C\\u201D\\u2013\\u2014\\u2026\\u3000-\\u303F\\uFF00-\\uFFEF";
  const emphasisOpen = new RegExp("([" + cjkLetter + "])([*_]+)([" + cjkPunct + "])", "g");
  const emphasisClose = new RegExp("([" + cjkPunct + "])([*_]+)([" + cjkLetter + "])", "g");
  const looseStrongLead = /\*\*[ \t]+([^\s*](?:[^\n*]*?[^\s*])?)[ \t]*\*\*/g;
  const looseStrongTrail = /\*\*([^\s*](?:[^\n*]*?[^\s*])?)[ \t]+\*\*/g;

  function provider(providerKey) {
    const value = providers[providerKey];
    if (!value) throw new Error("未知的提供方：" + providerKey);
    return value;
  }

  function apiUrl(providerKey, requestPath, baseUrl) {
    const base = String(baseUrl || provider(providerKey).base).trim().replace(/\/+$/, "");
    return base + "/" + String(requestPath || "").replace(/^\/+/, "");
  }

  function formatCompactTokens(value) {
    const n = Number(value) || 0;
    return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n);
  }

  function formatTokens(value) {
    return (Number(value) || 0).toLocaleString("en-US");
  }

  function fixCjkEmphasis(source) {
    if (!source || (source.indexOf("*") < 0 && source.indexOf("_") < 0)) return source;
    return source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g)
      .map((segment, index) => {
        if (index % 2) return segment;
        const paired = segment.replace(looseStrongLead, "**$1**").replace(looseStrongTrail, "**$1**");
        return paired.replace(emphasisOpen, "$1$2​$3").replace(emphasisClose, "$1​$2$3");
      })
      .join("");
  }

  function dataUrlParts(dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    return match ? { media: match[1], data: match[2] } : null;
  }

  function attachmentText(message) {
    const attachments = message.attachments || [];
    let text = message.content || "";
    for (const file of attachments.filter(item => item.kind === "textfile")) text += "\n\n[文件: " + file.name + "]\n```\n" + file.text + "\n```";
    for (const note of attachments.filter(item => item.kind === "note")) text += "\n\n[附件: " + note.name + "（未解析）]";
    return text;
  }

  function toOpenAIContent(message, providerKey) {
    const attachments = message.attachments || [];
    const images = attachments.filter(item => item.kind === "image");
    const pdfs = attachments.filter(item => item.kind === "pdf");
    let text = attachmentText(message);
    const pdfAsFile = providerKey === "openrouter";
    if (!pdfAsFile) for (const pdf of pdfs) text += "\n\n[PDF: " + pdf.name + "（当前提供方不支持直接解析 PDF）]";
    if (!images.length && !(pdfAsFile && pdfs.length)) return text;
    const parts = [{ type: "text", text: text || " " }];
    for (const image of images) parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
    if (pdfAsFile) for (const pdf of pdfs) parts.push({ type: "file", file: { filename: pdf.name, file_data: pdf.dataUrl } });
    return parts;
  }

  function toAnthropicContent(message) {
    const attachments = message.attachments || [];
    const images = attachments.filter(item => item.kind === "image");
    const pdfs = attachments.filter(item => item.kind === "pdf");
    const text = attachmentText(message);
    if (!images.length && !pdfs.length) return text;
    const parts = [];
    for (const image of images) {
      const parsed = dataUrlParts(image.dataUrl);
      if (parsed) parts.push({ type: "image", source: { type: "base64", media_type: parsed.media, data: parsed.data } });
    }
    for (const pdf of pdfs) {
      const parsed = dataUrlParts(pdf.dataUrl);
      if (parsed) parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: parsed.data } });
    }
    parts.push({ type: "text", text: text || " " });
    return parts;
  }

  async function responseError(response) {
    let message = "请求失败：HTTP " + response.status;
    try {
      const json = await response.json();
      message = (json.error && json.error.message) || json.message || JSON.stringify(json.error || json);
    } catch (_) {}
    return message;
  }

  async function pumpSSE(response, onData) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        const value = line.trim();
        if (!value.startsWith("data:")) continue;
        const data = value.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try { onData(JSON.parse(data)); } catch (_) {}
      }
    }
  }

  function createOpenAIRequest(input, definition) {
    const messages = [];
    if (input.system) messages.push({ role: "system", content: input.system });
    for (const message of input.messages) {
      const apiMessage = { role: message.role, content: toOpenAIContent(message, input.ref.provider) };
      if (input.ref.provider === "deepseek" && input.reasoning && message.role === "assistant" && message.reasoning) apiMessage.reasoning_content = message.reasoning;
      messages.push(apiMessage);
    }
    const body = { model: input.ref.model, messages, stream: true };
    if (input.temperature != null) body.temperature = input.temperature;
    if (input.maxTokens) body.max_tokens = input.maxTokens;
    if (input.topP != null) body.top_p = input.topP;
    if (input.topK != null && input.ref.provider === "openrouter") body.top_k = input.topK;
    if (input.ref.provider === "openrouter") {
      body.usage = { include: true };
      const plugins = [];
      if (input.messages.some(message => (message.attachments || []).some(attachment => attachment.kind === "pdf"))) plugins.push({ id: "file-parser", pdf: { engine: "pdf-text" } });
      if (input.web) plugins.push({ id: "web", max_results: 5 });
      if (plugins.length) body.plugins = plugins;
      if (input.reasoning) body.reasoning = { effort: input.effort || "medium" };
    } else if ((input.ref.provider === "openai" && !input.baseUrl) || input.ref.provider === "deepseek") {
      body.stream_options = { include_usage: true };
    }
    if (input.ref.provider === "deepseek" && typeof input.reasoning === "boolean") body.thinking = { type: input.reasoning ? "enabled" : "disabled" };
    const headers = { Authorization: "Bearer " + input.key, "Content-Type": "application/json" };
    if (input.ref.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://quartz.local";
      headers["X-Title"] = "Quartz";
    }
    return {
      url: apiUrl(input.ref.provider, "chat/completions", input.baseUrl),
      init: { method: "POST", headers, body: JSON.stringify(body), signal: input.signal },
      definition,
    };
  }

  function createAnthropicRequest(input, definition) {
    const budget = ({ low: 1024, medium: 4096, high: 12000 })[input.effort] || 4096;
    const maxTokens = input.reasoning ? Math.max(input.maxTokens || 4096, budget + 2048) : (input.maxTokens || 4096);
    const body = {
      model: input.ref.model,
      messages: input.messages.map(message => ({ role: message.role, content: toAnthropicContent(message) })),
      max_tokens: maxTokens,
      stream: true,
    };
    if (input.system) body.system = input.system;
    if (input.reasoning) body.thinking = { type: "enabled", budget_tokens: budget };
    else {
      if (input.temperature != null) body.temperature = input.temperature;
      if (input.topP != null) body.top_p = input.topP;
      if (input.topK != null) body.top_k = input.topK;
    }
    return {
      url: apiUrl(input.ref.provider, "messages", input.baseUrl),
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": input.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal: input.signal,
      },
      definition,
    };
  }

  async function streamCompletion(options) {
    const input = Object.assign({ messages: [] }, options || {});
    if (!input.ref || !input.ref.provider || !input.ref.model) throw new Error("未指定模型");
    const definition = provider(input.ref.provider);
    if (!input.key) throw new Error("未配置 " + definition.label + " 的 API Key");
    const fetchImpl = input.fetchImpl || (root && root.fetch);
    if (typeof fetchImpl !== "function") throw new Error("当前环境不支持网络请求");
    const request = definition.kind === "openai" ? createOpenAIRequest(input, definition) : createAnthropicRequest(input, definition);
    const response = await fetchImpl(request.url, request.init);
    if (!response.ok) throw Object.assign(new Error(await responseError(response)), { status: response.status });
    let text = "";
    let reasoning = "";
    let usage = null;
    let inputTokens = 0;
    let outputTokens = 0;
    await pumpSSE(response, json => {
      if (definition.kind === "openai") {
        const delta = json.choices && json.choices[0] && json.choices[0].delta;
        if (delta) {
          if (delta.content) {
            text += delta.content;
            if (input.onDelta) input.onDelta(text);
          }
          const value = delta.reasoning != null ? delta.reasoning : delta.reasoning_content;
          if (value) {
            reasoning += value;
            if (input.onReasoning) input.onReasoning(reasoning);
          }
        }
        if (json.usage) {
          const cost = json.usage.cost == null && input.usageCost ? input.usageCost(json.usage) : json.usage.cost;
          usage = { prompt_tokens: json.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens, cost };
        }
      } else {
        if (json.type === "content_block_delta" && json.delta) {
          if (json.delta.type === "text_delta") {
            text += json.delta.text;
            if (input.onDelta) input.onDelta(text);
          } else if (json.delta.type === "thinking_delta") {
            reasoning += json.delta.thinking;
            if (input.onReasoning) input.onReasoning(reasoning);
          }
        } else if (json.type === "message_start" && json.message && json.message.usage) inputTokens = json.message.usage.input_tokens || 0;
        else if (json.type === "message_delta" && json.usage && json.usage.output_tokens != null) outputTokens = json.usage.output_tokens;
      }
    });
    if (definition.kind === "anthropic") usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, cost: undefined };
    return { text, reasoning, usage };
  }

  return Object.freeze({
    providers,
    providerOrder,
    apiUrl,
    formatCompactTokens,
    formatTokens,
    fixCjkEmphasis,
    dataUrlParts,
    toOpenAIContent,
    toAnthropicContent,
    responseError,
    pumpSSE,
    streamCompletion,
  });
});
