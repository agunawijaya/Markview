// Headless test for math (LaTeX/KaTeX) render + round-trip.
//
// Simulates: raw markdown with $...$ and $$...$$ -> marked (with math extension)
// -> DOM in jsdom -> Turndown (with math rules) -> markdown -> compare to input.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const dom = new JSDOM(
  `<!DOCTYPE html><html><body><div id="markdown-content"></div></body></html>`,
  { url: "http://localhost/", runScripts: "outside-only" },
);
global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;

// Load libs into jsdom window
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/marked.min.js"), "utf8"));
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/turndown.js"), "utf8"));
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/katex/katex.min.js"), "utf8"));

const marked = dom.window.marked;
const TurndownService = dom.window.TurndownService;
const katex = dom.window.katex;

if (!marked || !TurndownService || !katex) {
  console.error("libs missing:", { marked: !!marked, TurndownService: !!TurndownService, katex: !!katex });
  process.exit(1);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Register math extension (mirrors main.js initMarkedExtensions) ---
function renderMathToken(latex, displayMode) {
  const encoded = encodeURIComponent(latex);
  let rendered;
  try {
    rendered = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      output: "htmlAndMathml",
      strict: "ignore",
    });
  } catch (e) {
    rendered = `<span class="katex-error-msg">${escapeHtml(String(e))}</span>`;
  }
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "katex-block" : "katex-inline";
  return `<${tag} class="${cls}" data-latex-src="${encoded}" contenteditable="false">${rendered}</${tag}>`;
}

marked.use({
  extensions: [
    {
      name: "mathBlock",
      level: "block",
      start(src) { return src.indexOf("$$"); },
      tokenizer(src) {
        const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        if (match) return { type: "mathBlock", raw: match[0], text: match[1].trim() };
      },
      renderer(token) { return renderMathToken(token.text, true); },
    },
    {
      name: "mathInline",
      level: "inline",
      start(src) { return src.indexOf("$"); },
      tokenizer(src) {
        if (src.startsWith("$$")) return;
        const match = /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (match) return { type: "mathInline", raw: match[0], text: match[1] };
      },
      renderer(token) { return renderMathToken(token.text, false); },
    },
  ],
});

marked.setOptions({ gfm: true, breaks: false });

// --- Turndown setup (mirrors main.js initWysiwyg for math rules) ---
const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

turndown.addRule("katexInline", {
  filter: (node) => node.classList && node.classList.contains("katex-inline"),
  replacement: (content, node) => {
    const encoded = node.getAttribute("data-latex-src") || "";
    let src;
    try { src = decodeURIComponent(encoded); } catch (e) { src = encoded; }
    return "$" + src + "$";
  },
});
turndown.addRule("katexBlock", {
  filter: (node) => node.classList && node.classList.contains("katex-block"),
  replacement: (content, node) => {
    const encoded = node.getAttribute("data-latex-src") || "";
    let src;
    try { src = decodeURIComponent(encoded); } catch (e) { src = encoded; }
    return "\n\n$$\n" + src + "\n$$\n\n";
  },
});

// --- Test cases ---
const cases = [
  {
    name: "simple inline",
    md: "The formula is $a^2 + b^2 = c^2$ per Pythagoras.",
    expectContains: "$a^2 + b^2 = c^2$",
  },
  {
    name: "inline with subscript (underscore) should not be eaten by marked",
    md: "Let $x_i$ be the i-th element.",
    expectContains: "$x_i$",
  },
  {
    name: "inline with product (asterisk) should not be eaten",
    md: "We compute $y = m * x + b$ here.",
    expectContains: "$y = m * x + b$",
  },
  {
    name: "block math",
    md: "$$\n\\int_0^1 f(x)\\,dx = F(1) - F(0)\n$$",
    expectContains: "$$",
  },
  {
    name: "block with underscores and asterisks",
    md: "$$\n\\sum_{i=1}^{n} x_i * y_i\n$$",
    expectContains: "\\sum_{i=1}^{n} x_i * y_i",
  },
  {
    name: "prices should NOT be math",
    md: "Buy 10 for $100 or 20 for $200 today.",
    notRendered: "katex-inline", // no math wrappers expected
  },
  {
    name: "malformed math falls back to error span, not crash",
    md: "This is broken: $\\frac{1$",
    expectHtml: "katex-error", // KaTeX's own error span class in rendered HTML
    expectContains: "$\\frac{1$", // round-trip still preserves original LaTeX
  },
];

let failed = 0;
let passed = 0;

for (const t of cases) {
  const html = marked.parse(t.md);
  const container = document.getElementById("markdown-content");
  container.innerHTML = html;
  const roundTripped = turndown.turndown(container.innerHTML);

  const okContains = t.expectContains ? roundTripped.includes(t.expectContains) : true;
  const okNoRender = t.notRendered ? !html.includes(t.notRendered) : true;
  const okHtml = t.expectHtml ? html.includes(t.expectHtml) : true;
  const ok = okContains && okNoRender && okHtml;

  console.log((ok ? "PASS" : "FAIL") + ": " + t.name);
  if (!ok) {
    console.log("  MD in:      " + JSON.stringify(t.md));
    console.log("  HTML:       " + html.substring(0, 200));
    console.log("  Roundtrip:  " + JSON.stringify(roundTripped));
    if (t.expectContains) console.log("  Expected:   " + JSON.stringify(t.expectContains) + " (contains=" + okContains + ")");
    if (t.expectHtml) console.log("  ExpectHtml: " + JSON.stringify(t.expectHtml) + " (contains=" + okHtml + ")");
    if (t.notRendered) console.log("  NotRendered:" + JSON.stringify(t.notRendered) + " (present=" + !okNoRender + ")");
    failed++;
  } else {
    passed++;
  }
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
