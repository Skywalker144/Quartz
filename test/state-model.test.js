const assert = require("node:assert/strict");
const test = require("node:test");

const { createStateModel } = require("../renderer/state");

function model() {
  let sequence = 0;
  return createStateModel({
    providerOrder: ["openrouter", "openai", "anthropic", "deepseek", "google"],
    defaultQuick: () => "Alt+Space",
    defaultOpenMain: () => "Cmd+Shift+L",
    visionSupport: ref => ref && ref.model === "vision" ? "yes" : "unknown",
    uid: () => "id-" + (++sequence),
  });
}

test("fresh state owns defaults and returns independent values", () => {
  const stateModel = model();
  const first = stateModel.freshState();
  const second = stateModel.freshState();
  assert.deepEqual(Object.keys(first.settings.providers), ["openrouter", "openai", "anthropic", "deepseek", "google"]);
  assert.equal(first.settings.quick.shortcut, "Alt+Space");
  assert.equal(first.settings.quick.openMainShortcut, "Cmd+Shift+L");
  assert.equal(first.settings.defaults.promptId, "daily-default");
  first.settings.prompts[0].name = "changed";
  assert.equal(second.settings.prompts[0].name, "日常");
});

test("normalization applies migrations once and flattens branch conversations", () => {
  const stateModel = model();
  const state = stateModel.freshState();
  state.settings.quick.promptMode = "default";
  delete state.settings.quick.promptModeMigrated;
  state.settings.appearance.accent = "amethyst";
  state.settings.appearance.accentCustom = "#bd9cff";
  delete state.settings.accentDefaultedClear;
  state.settings.defaults.temp = 0.7;
  delete state.settings.tempBumped;
  state.settings.models = [{ provider: "openrouter", model: "vision" }];
  delete state.settings.visionSeeded;
  state.conversations = [{
    id: "conversation",
    title: "branch",
    turns: {
      root: { id: "root", parent: null, children: ["child"], user: { content: "Q", attachments: [] }, assistant: { content: "A" } },
      child: { id: "child", parent: "root", children: [], user: { content: "Q2", attachments: [] }, assistant: { content: "A2" } },
    },
    roots: ["root"],
    current: "child",
  }];
  const normalized = stateModel.normalizeState(state);
  assert.equal(normalized.settings.quick.promptMode, "concise");
  assert.equal(normalized.settings.appearance.accent, "clear");
  assert.equal(normalized.settings.appearance.accentCustom, "#d6d6d6");
  assert.equal(normalized.settings.defaults.temp, 1);
  assert.deepEqual(normalized.settings.defaults.vision, { provider: "openrouter", model: "vision" });
  assert.deepEqual(normalized.conversations[0].messages.map(message => message.content), ["Q", "A", "Q2", "A2"]);
  assert.equal(normalized.conversations[0].turns, undefined);
});

test("legacy v1 state migrates through one model boundary", () => {
  const stateModel = model();
  const migrated = stateModel.migrateLegacyState({
    settings: { apiKey: "key", model: "model-x", system: "custom", temp: 0.7, maxTokens: 123, theme: "dark" },
    conversations: [{ id: "c1", title: "old", messages: [{ role: "user", content: "hello" }] }],
    currentId: "c1",
  });
  assert.equal(migrated.settings.providers.openrouter.key, "key");
  assert.deepEqual(migrated.settings.defaults.chat, { provider: "openrouter", model: "model-x" });
  assert.equal(migrated.settings.defaults.temp, 1);
  assert.equal(migrated.settings.appearance.theme, "dark");
  assert.equal(migrated.conversations[0].model.model, "model-x");
  assert.equal(migrated.currentId, "c1");
});
