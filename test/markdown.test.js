const assert = require("node:assert/strict");
const test = require("node:test");

const { createMarkdown } = require("../renderer/markdown");
const core = require("../shared/quartz-core");

test("math detection is conservative around source code", () => {
  const markdown = createMarkdown({ root: {}, core });
  assert.equal(markdown.looksLikeMath("\\frac{a}{b}"), true);
  assert.equal(markdown.looksLikeMath("x^{2} + y_{1}"), true);
  assert.equal(markdown.looksLikeMath("function x() { return 1; }"), false);
  assert.equal(markdown.looksLikeMath("plain text"), false);
});

test("language labels have one renderer source", () => {
  const markdown = createMarkdown({ root: {}, core });
  assert.equal(markdown.languageLabel("ts"), "TypeScript");
  assert.equal(markdown.languageLabel("unknown"), "unknown");
  assert.equal(markdown.languageLabel(""), "code");
});

test("rendering normalizes emphasis and sanitizes with the full content profile", () => {
  let source;
  let options;
  const root = {
    marked: { parse(value) { source = value; return "<p>ok</p>"; } },
    DOMPurify: { sanitize(html, config) { options = config; return html; } },
  };
  const markdown = createMarkdown({ root, core });
  assert.equal(markdown.render("** 文字 **"), "<p>ok</p>");
  assert.equal(source, "**文字**");
  assert.equal(options.USE_PROFILES.mathMl, true);
  assert.equal(options.ALLOW_DATA_ATTR, false);
});

test("marked math extensions are registered once", () => {
  let registrations = 0;
  const root = { marked: { use(config) { registrations++; assert.equal(config.extensions.length, 2); } } };
  const markdown = createMarkdown({ root, core });
  markdown.setup();
  markdown.setup();
  assert.equal(registrations, 1);
});
