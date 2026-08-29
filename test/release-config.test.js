const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

test("release artifact names are defined by package configuration", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.build.nsis.artifactName, "Quartz-Setup-${version}.${ext}");
  assert.match(read("RELEASE.md"), /Quartz-Setup-<ver>\.exe/);
  assert.match(read("README.md"), /Quartz-Setup-<版本>\.exe/);
});

test("public publishing has only the tag-triggered workflow entry", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /--mac --universal/);
  assert.match(workflow, /--win nsis --x64/);
  assert.doesNotMatch(read("build.sh"), /--publish|PUBLISH/);
});

test("documentation index points to canonical project sources", () => {
  const index = read("docs/README.md");
  for (const target of ["../RULES.md", "../AGENTS.md", "../README.md", "../RELEASE.md", "../.github/workflows/release.yml", "../CHANGELOG.md"]) {
    assert.match(index, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
