"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.QuartzMarkdown = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  const languageLabels = Object.freeze({ js: "JavaScript", jsx: "JSX", mjs: "JavaScript", ts: "TypeScript", tsx: "TSX", py: "Python", python: "Python", rb: "Ruby", ruby: "Ruby", go: "Go", golang: "Go", rs: "Rust", rust: "Rust", java: "Java", kt: "Kotlin", kotlin: "Kotlin", swift: "Swift", c: "C", cpp: "C++", "c++": "C++", cc: "C++", cs: "C#", "c#": "C#", csharp: "C#", php: "PHP", sh: "Shell", bash: "Bash", zsh: "Zsh", shell: "Shell", console: "Shell", ps1: "PowerShell", powershell: "PowerShell", sql: "SQL", json: "JSON", jsonc: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", xml: "XML", html: "HTML", htm: "HTML", css: "CSS", scss: "SCSS", sass: "Sass", less: "Less", md: "Markdown", markdown: "Markdown", tex: "TeX", latex: "LaTeX", dockerfile: "Dockerfile", docker: "Dockerfile", makefile: "Makefile", make: "Makefile", cmake: "CMake", r: "R", lua: "Lua", dart: "Dart", scala: "Scala", clj: "Clojure", ex: "Elixir", exs: "Elixir", erl: "Erlang", hs: "Haskell", pl: "Perl", perl: "Perl", objc: "Objective-C", vue: "Vue", svelte: "Svelte", graphql: "GraphQL", gql: "GraphQL", proto: "Protobuf", ini: "INI", diff: "Diff", patch: "Diff", vim: "Vim", text: "Text", txt: "Text", plaintext: "Text", plain: "Text" });
  const mathCommand = /\\(frac|dfrac|tfrac|sqrt|sum|prod|coprod|int|iint|iiint|oint|lim|limsup|liminf|infty|partial|nabla|cdot|times|div|pm|mp|ast|star|circ|leq|geq|neq|approx|equiv|cong|sim|simeq|propto|subset|subseteq|supset|supseteq|cup|cap|setminus|emptyset|forall|exists|nexists|neg|land|lor|implies|iff|to|gets|rightarrow|Rightarrow|leftarrow|Leftarrow|leftrightarrow|longrightarrow|mapsto|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|varrho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|mathbb|mathcal|mathrm|mathbf|mathfrak|boldsymbol|operatorname|left|right|begin|end|hat|widehat|vec|bar|tilde|widetilde|overline|underline|overrightarrow|binom|dbinom|langle|rangle|lfloor|rfloor|lceil|rceil|cdots|ldots|vdots|ddots|dots|prime|oplus|ominus|otimes|odot|wedge|vee|perp|parallel|angle|triangle|square|because|therefore|quad|qquad)(?![a-zA-Z])/;
  const mathBrace = /[\^_]\{/;
  const codeSignal = /\/\/|\/\*|\*\/|=>|;\s*(\n|$)|&&|\|\||==|!=|::|\bfunction\b|\breturn\b|\bconsole\b|\bimport\b|\bexport\b|\bprintf\b|\bdef\s|\bclass\s|#include|System\.out/;

  function createMarkdown(options) {
    const config = options || {};
    const root = config.root || globalThis;
    const core = config.core;
    const icon = config.icon || (() => "");
    let configured = false;

    function renderTex(tex, display) {
      if (!root.katex) return null;
      try { return root.katex.renderToString(tex, { displayMode: !!display, throwOnError: false }); } catch (_) { return null; }
    }

    function setup() {
      if (configured || !root.marked) return;
      configured = true;
      const renderMath = (tex, display) => renderTex(tex, display) || (display ? "$$" + tex + "$$" : "$" + tex + "$");
      const blockMath = {
        name: "blockMath",
        level: "block",
        start(source) {
          const positions = [source.indexOf("$$"), source.indexOf("\\[")].filter(index => index >= 0);
          return positions.length ? Math.min.apply(null, positions) : undefined;
        },
        tokenizer(source) {
          let match = /^\$\$([\s\S]+?)\$\$/.exec(source);
          if (match) return { type: "blockMath", raw: match[0], text: match[1].trim() };
          match = /^\\\[([\s\S]+?)\\\]/.exec(source);
          if (match) return { type: "blockMath", raw: match[0], text: match[1].trim() };
        },
        renderer(token) { return '<div class="math-block">' + renderMath(token.text, true) + "</div>"; },
      };
      const inlineMath = {
        name: "inlineMath",
        level: "inline",
        start(source) {
          const positions = [source.indexOf("$"), source.indexOf("\\(")].filter(index => index >= 0);
          return positions.length ? Math.min.apply(null, positions) : undefined;
        },
        tokenizer(source) {
          let match = /^\$\$([^\n]+?)\$\$/.exec(source);
          if (match) return { type: "inlineMath", raw: match[0], text: match[1].trim(), display: true };
          match = /^\\\(([\s\S]+?)\\\)/.exec(source);
          if (match) return { type: "inlineMath", raw: match[0], text: match[1], display: false };
          match = /^\$([^\n$]+?)\$/.exec(source);
          if (!match) return;
          const body = match[1];
          if (/^\s|\s$/.test(body) || /\d/.test(source.charAt(match[0].length))) return;
          return { type: "inlineMath", raw: match[0], text: body, display: false };
        },
        renderer(token) { return renderMath(token.text, !!token.display); },
      };
      root.marked.use({ extensions: [blockMath, inlineMath] });
    }

    function sanitize(html) {
      if (!root.DOMPurify) return html;
      return root.DOMPurify.sanitize(html, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
        ADD_ATTR: ["target"],
        FORBID_TAGS: ["style", "form"],
        ALLOW_DATA_ATTR: false,
      });
    }

    function render(text) {
      let html;
      if (root.marked) {
        try { html = root.marked.parse(core.fixCjkEmphasis(text), { breaks: true, gfm: true }); } catch (_) {}
      }
      if (html == null) {
        const element = root.document.createElement("div");
        element.textContent = text;
        html = "<p>" + element.innerHTML.replace(/\n/g, "<br>") + "</p>";
      }
      return sanitize(html.replace(/​/g, ""));
    }

    function languageLabel(language) {
      if (!language) return "code";
      return languageLabels[language.toLowerCase()] || language;
    }

    function looksLikeMath(source) {
      const value = (source || "").trim();
      if (!value || value.length > 1200 || codeSignal.test(value)) return false;
      return mathCommand.test(value) || mathBrace.test(value);
    }

    function mathFromBare(raw) {
      if (!root.katex) return null;
      const lines = (raw || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!lines.length) return null;
      let html = "";
      for (const line of lines) {
        const rendered = renderTex(line, true);
        if (rendered == null) return null;
        html += '<div class="math-block">' + rendered + "</div>";
      }
      return html;
    }

    function enhanceCode(scope, options) {
      const openTail = !!(options && options.openTail);
      scope.querySelectorAll("pre > code").forEach(code => {
        if (code.dataset.lang == null) {
          const match = (code.className || "").match(/\blanguage-([\w+#.-]+)/i);
          code.dataset.lang = match ? match[1] : "";
        }
      });
      const mathCandidates = [...scope.querySelectorAll("pre > code")];
      mathCandidates.forEach((code, index) => {
        if (openTail && index === mathCandidates.length - 1) return;
        const pre = code.parentElement;
        if (!pre || code.dataset.lang || pre.parentElement && pre.parentElement.classList.contains("code-block")) return;
        const raw = code.textContent || "";
        if (!looksLikeMath(raw)) return;
        const html = mathFromBare(raw);
        if (html == null) return;
        const element = root.document.createElement("div");
        element.className = "math-bare";
        element.innerHTML = html;
        pre.replaceWith(element);
      });
      if (root.hljs) {
        const codes = [...scope.querySelectorAll("pre > code")];
        const skip = openTail ? codes.length - 1 : -1;
        codes.forEach((code, index) => {
          if (index === skip || code.dataset.highlighted) return;
          try { root.hljs.highlightElement(code); } catch (_) {}
        });
      }
      scope.querySelectorAll("pre").forEach(pre => {
        if (pre.parentElement && pre.parentElement.classList.contains("code-block")) return;
        const code = pre.querySelector("code");
        const language = code ? code.dataset.lang || "" : "";
        const block = root.document.createElement("div");
        block.className = "code-block";
        const head = root.document.createElement("div");
        head.className = "code-head";
        const label = root.document.createElement("span");
        label.className = "code-lang";
        label.textContent = languageLabel(language);
        const button = root.document.createElement("button");
        button.type = "button";
        button.className = "code-copy";
        button.setAttribute("aria-label", "复制代码");
        const reset = () => {
          button.classList.remove("done");
          button.innerHTML = icon("copy", 13) + "<span>复制</span>";
        };
        reset();
        button.onclick = () => {
          root.navigator.clipboard.writeText((pre.querySelector("code") || pre).textContent);
          button.classList.add("done");
          button.innerHTML = icon("check", 13) + "<span>已复制</span>";
          clearTimeout(button._t);
          button._t = setTimeout(reset, 1400);
        };
        head.appendChild(label);
        head.appendChild(button);
        pre.parentNode.insertBefore(block, pre);
        block.appendChild(head);
        block.appendChild(pre);
      });
    }

    return Object.freeze({ setup, render, sanitize, renderTex, mathFromBare, enhanceCode, looksLikeMath, languageLabel });
  }

  return Object.freeze({ createMarkdown });
});
