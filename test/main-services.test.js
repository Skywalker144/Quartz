const assert = require("node:assert/strict");
const test = require("node:test");

test("backup filenames are constrained to the rotating backup namespace", () => {
  const { isBackupFileName } = require("../main/data-transfer");
  assert.equal(isBackupFileName("quartz-auto-2026-08-29T10-20-30-000Z.json"), true);
  assert.equal(isBackupFileName("../quartz-auto-secret.json"), false);
  assert.equal(isBackupFileName("Quartz-备份.json"), false);
});

test("automatic backup registration rotates the oldest files", async () => {
  const { registerDataTransfer } = require("../main/data-transfer");
  const handlers = new Map();
  const removed = [];
  const files = Array.from({ length: 9 }, (_, index) => `quartz-auto-2026-08-${String(index + 1).padStart(2, "0")}.json`);
  registerDataTransfer({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    app: { getPath: () => "/quartz" },
    dialog: {},
    shell: {},
    fs: {
      mkdirSync() {},
      writeFileSync() {},
      readdirSync: () => files.slice(),
      unlinkSync: name => removed.push(name),
    },
    path: require("node:path"),
    getMainWindow: () => null,
    now: () => new Date("2026-08-29T10:20:30.000Z"),
  });
  const result = await handlers.get("backup-write")(null, "{}");
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(removed, ["/quartz/backups/quartz-auto-2026-08-01.json"]);
});

test("export document keeps a local-only content policy", () => {
  const { buildExportDocument } = require("../main/conversation-export");
  const html = buildExportDocument({ title: "A < B & C", bodyHTML: "<p>ok</p>", katexHref: "file:///katex.css" });
  assert.match(html, /default-src 'none'; img-src data:/);
  assert.match(html, /href="file:\/\/\/katex\.css"/);
  assert.match(html, /<title>A  B  C<\/title>/);
  assert.doesNotMatch(html, /https?:/);
});

test("mac updater prefers a universal archive over a mismatched architecture", () => {
  const { selectMacUpdateFile } = require("../main/auto-update");
  const files = [
    { url: "Quartz-1.2.3-x64-mac.zip" },
    { url: "Quartz-1.2.3-universal-mac.zip" },
    { url: "Quartz-1.2.3-arm64-mac.zip" },
  ];
  assert.equal(selectMacUpdateFile(files, "arm64").url, "Quartz-1.2.3-universal-mac.zip");
  assert.equal(selectMacUpdateFile(files.filter(file => !file.url.includes("universal")), "arm64").url, "Quartz-1.2.3-arm64-mac.zip");
});
