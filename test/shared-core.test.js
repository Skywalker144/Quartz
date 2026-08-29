const assert = require("node:assert/strict");
const test = require("node:test");

const core = require("../shared/quartz-core");

function streamingResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true };
            return { done: false, value: encoder.encode(chunks[index++]) };
          },
        };
      },
    },
  };
}

test("provider URLs have one normalized source", () => {
  assert.equal(core.providers.openai.base, "https://api.openai.com/v1");
  assert.equal(core.apiUrl("openai", "/chat/completions"), "https://api.openai.com/v1/chat/completions");
  assert.equal(core.apiUrl("openai", "models", "https://gateway.example/v1/"), "https://gateway.example/v1/models");
  assert.throws(() => core.apiUrl("missing", "models"), /未知的提供方/);
});

test("compact and exact token formats cannot shadow each other", () => {
  assert.equal(core.formatCompactTokens(999), "999");
  assert.equal(core.formatCompactTokens(1250), "1.3k");
  assert.equal(core.formatCompactTokens(12500), "13k");
  assert.equal(core.formatTokens(12500), "12,500");
});

test("CJK emphasis normalization preserves code", () => {
  assert.equal(core.fixCjkEmphasis("** 文字 **"), "**文字**");
  assert.equal(core.fixCjkEmphasis("`** 文字 **`"), "`** 文字 **`");
  assert.match(core.fixCjkEmphasis("**加粗（注）**的"), /\u200b/);
});

test("attachment conversion is shared across provider protocols", () => {
  const message = {
    role: "user",
    content: "分析",
    attachments: [
      { kind: "textfile", name: "a.txt", text: "hello" },
      { kind: "image", name: "a.png", dataUrl: "data:image/png;base64,AAAA" },
      { kind: "pdf", name: "a.pdf", dataUrl: "data:application/pdf;base64,BBBB" },
    ],
  };
  const openai = core.toOpenAIContent(message, "openrouter");
  assert.equal(openai[0].type, "text");
  assert.equal(openai[1].type, "image_url");
  assert.equal(openai[2].type, "file");
  const anthropic = core.toAnthropicContent(message);
  assert.deepEqual(anthropic.map(part => part.type), ["image", "document", "text"]);
});

test("OpenAI-compatible streaming builds the canonical request and joins split SSE chunks", async () => {
  let request;
  const result = await core.streamCompletion({
    ref: { provider: "openrouter", model: "model-x" },
    key: "secret",
    system: "system",
    messages: [{ role: "user", content: "hello", attachments: [] }],
    temperature: 0.3,
    topP: 0.8,
    topK: 12,
    web: true,
    reasoning: true,
    effort: "high",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return streamingResponse([
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"lo\",\"reasoning\":\"Think\"}}]",
        ",\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":1}}\n\n",
        "data: [DONE]\n\n",
      ]);
    },
  });
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.init.headers.Authorization, "Bearer secret");
  const body = JSON.parse(request.init.body);
  assert.deepEqual(body.plugins, [{ id: "web", max_results: 5 }]);
  assert.deepEqual(body.reasoning, { effort: "high" });
  assert.equal(body.temperature, 0.3);
  assert.equal(body.top_p, 0.8);
  assert.equal(body.top_k, 12);
  assert.equal(result.text, "Hello");
  assert.equal(result.reasoning, "Think");
  assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, cost: undefined });
});

test("Anthropic extended thinking omits incompatible sampling fields", async () => {
  let body;
  const result = await core.streamCompletion({
    ref: { provider: "anthropic", model: "claude-x" },
    key: "secret",
    messages: [{ role: "user", content: "hello", attachments: [] }],
    temperature: 0.2,
    topP: 0.7,
    topK: 10,
    reasoning: true,
    effort: "low",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return streamingResponse([
        "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":3}}}\n",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"T\"}}\n",
        "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"A\"}}\n",
        "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":4}}\n",
      ]);
    },
  });
  assert.deepEqual(body.thinking, { type: "enabled", budget_tokens: 1024 });
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.temperature, undefined);
  assert.equal(body.top_p, undefined);
  assert.equal(body.top_k, undefined);
  assert.deepEqual(result, {
    text: "A",
    reasoning: "T",
    usage: { prompt_tokens: 3, completion_tokens: 4, cost: undefined },
  });
});

test("provider-specific cost calculation receives the unmodified usage payload", async () => {
  let rawUsage;
  const result = await core.streamCompletion({
    ref: { provider: "deepseek", model: "deepseek-v4-pro" },
    key: "secret",
    messages: [{ role: "user", content: "hello", attachments: [] }],
    reasoning: false,
    usageCost: usage => {
      rawUsage = usage;
      return 0.25;
    },
    fetchImpl: async () => streamingResponse([
      "data: {\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":2,\"prompt_cache_hit_tokens\":7}}\n",
    ]),
  });
  assert.equal(rawUsage.prompt_cache_hit_tokens, 7);
  assert.equal(result.usage.cost, 0.25);
});
