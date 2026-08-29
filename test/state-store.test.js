const assert = require("node:assert/strict");
const test = require("node:test");

const { createStateStore } = require("../renderer/storage");

function memoryRecords(seed) {
  const values = new Map(Object.entries(seed || {}));
  const writes = [];
  const deletes = [];
  return {
    values,
    writes,
    deletes,
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, structuredClone(value)); writes.push(key); },
    async delete(key) { values.delete(key); deletes.push(key); },
  };
}

function localMemory(seed) {
  const values = new Map(Object.entries(seed || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
  };
}

function create(records, localStorage, overrides) {
  return createStateStore(Object.assign({
    records,
    localStorage,
    normalizeState: state => Object.assign(state, { normalized: true }),
    migrateLegacyState: state => ({ migrated: state }),
    freshState: () => ({ fresh: true }),
    decryptSecret: async value => "plain:" + value,
  }, overrides || {}));
}

test("split storage writes only changed conversations and removes deleted records", async () => {
  const records = memoryRecords();
  const store = create(records, localMemory());
  const state = {
    settings: { providers: {} },
    conversations: [{ id: "a", messages: [{ content: "one" }] }, { id: "b", messages: [] }],
    archived: [],
    currentId: "a",
  };
  assert.equal(await store.persist(state), true);
  assert.deepEqual(records.writes.sort(), ["c:a", "c:b", "meta"]);
  records.writes.length = 0;
  await store.persist(state);
  assert.deepEqual(records.writes, []);
  state.conversations[0].messages[0].content = "two";
  state.conversations.pop();
  await store.persist(state);
  assert.deepEqual(records.writes, ["meta", "c:a"]);
  assert.deepEqual(records.deletes, ["c:b"]);
});

test("split storage restores order and converts legacy encrypted keys", async () => {
  const records = memoryRecords({
    meta: { settings: { providers: { openai: { key: "qzenc1:cipher" } } }, order: ["b", "a"], archivedOrder: [], currentId: "b", _split: 1 },
    "c:a": { id: "a", messages: [] },
    "c:b": { id: "b", messages: [] },
  });
  const state = await create(records, localMemory()).load();
  assert.deepEqual(state.conversations.map(item => item.id), ["b", "a"]);
  assert.equal(state.settings.providers.openai.key, "plain:cipher");
  assert.equal(state.normalized, true);
  assert.equal(records.values.get("meta").settings.providers.openai.key, "plain:cipher");
});

test("legacy blobs migrate through the injected state model", async () => {
  const old = { settings: { model: "old" } };
  const store = create(memoryRecords(), localMemory({ chatbox_state_v1: JSON.stringify(old) }));
  assert.deepEqual(await store.load(), { migrated: old });
});

test("failed IndexedDB writes fall back to the legacy local blob", async () => {
  const localStorage = localMemory();
  const records = memoryRecords();
  records.set = async () => { throw new Error("unavailable"); };
  const state = { settings: { providers: {} }, conversations: [], archived: [] };
  const store = create(records, localStorage);
  assert.equal(await store.persist(state), true);
  assert.deepEqual(JSON.parse(localStorage.getItem("chatbox_state_v2")), state);
});
