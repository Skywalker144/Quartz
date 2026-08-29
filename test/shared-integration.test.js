const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const appScripts = [
  "renderer/app-core.js",
  "renderer/app-conversations.js",
  "renderer/app-chat.js",
  "renderer/app-settings.js",
  "renderer/app-input.js",
  "app.js",
];

test("both renderers load the shared core before their entry point", () => {
  const index = read("index.html");
  const quickbar = read("quickbar.html");
  const indexShared = index.indexOf('src="shared/quartz-core.js"');
  const indexMarkdown = index.indexOf('src="renderer/markdown.js"');
  const indexState = index.indexOf('src="renderer/state.js"');
  const indexStorage = index.indexOf('src="renderer/storage.js"');
  const orderedAppScripts = appScripts.map(name => index.indexOf(`src="${name}"`));
  const quickbarShared = quickbar.indexOf('src="shared/quartz-core.js"');
  const quickbarMarkdown = quickbar.indexOf('src="renderer/markdown.js"');
  assert.ok(indexShared >= 0 && indexShared < indexMarkdown && indexMarkdown < indexState && indexState < indexStorage);
  assert.ok(orderedAppScripts.every((position, index) => position >= 0 && (!index || orderedAppScripts[index - 1] < position)));
  assert.ok(indexStorage < orderedAppScripts[0]);
  assert.ok(quickbarShared >= 0 && quickbarShared < quickbarMarkdown && quickbarMarkdown < quickbar.indexOf('src="quickbar.js"'));
});

test("both renderers use one provider and streaming implementation", () => {
  for (const name of ["renderer/app-core.js", "renderer/app-chat.js", "quickbar.js"]) {
    const source = read(name);
    assert.doesNotMatch(source, /^const PROVIDERS = \{/m);
    assert.doesNotMatch(source, /^(?:async )?function (?:pumpSSE|errText|fixCjkEmphasis)\(/m);
  }
  assert.match(read("renderer/app-chat.js"), /QuartzCore\.streamCompletion/);
  assert.match(read("quickbar.js"), /QuartzCore\.streamCompletion/);
});

test("renderer top-level function declarations have unique names", () => {
  const source = appScripts.map(read).join("\n");
  const names = [...source.matchAll(/^(?:async )?function ([A-Za-z_$][A-Za-z0-9_$]*)\(/gm)].map(match => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual(duplicates, []);
});

test("renderer domains stay below the structural review threshold", () => {
  for (const name of appScripts) {
    const lines = read(name).split("\n").length;
    assert.ok(lines < 2000, `${name} has ${lines} lines`);
  }
});

test("renderer adapters initialize only after their domain dependencies load", () => {
  assert.doesNotMatch(read("renderer/app-core.js"), /QuartzMarkdown\.createMarkdown/);
  assert.match(read("app.js"), /QuartzMarkdown\.createMarkdown\(\{ root: window, core: QuartzCore, icon: ic \}\)/);
});

test("desktop and web packages include the shared core", () => {
  assert.match(read("package.json"), /"shared\/\*\*\/\*"/);
  assert.match(read("package.json"), /"renderer\/\*\*\/\*"/);
  assert.match(read("package.json"), /"main\/\*\*\/\*"/);
  assert.match(read("build-web.sh"), /cp -R shared "\$OUT"\/shared/);
  assert.match(read("build-web.sh"), /cp -R renderer "\$OUT"\/renderer/);
});
