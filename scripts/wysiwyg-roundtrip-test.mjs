// Headless round-trip test for the WYSIWYG save path.
//
// Loads sample_benar.md, simulates: parse with marked (using our custom
// renderer overrides) -> inject into a jsdom container -> call the same
// wysiwygToMarkdown logic -> compare against original.
//
// This mirrors what happens inside Markview when a user edits in Rendered
// View and hits Save.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="markdown-content"></div></body></html>`, { url: "http://localhost/", runScripts: "outside-only" });
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.self = dom.window;

// Stub Tauri global (only convertFileSrc is used by main.js on this path)
global.window.__TAURI__ = {
  core: { convertFileSrc: (p) => `http://asset.localhost/${encodeURIComponent(p).replace(/%2F/g, "%2F")}` },
};

// Load the bundled libs into the jsdom window
function loadLib(rel) {
  const code = fs.readFileSync(path.join(root, rel), "utf8");
  const script = new dom.window.Function(code + "\n; return { marked: typeof marked !== 'undefined' ? marked : undefined, TurndownService: typeof TurndownService !== 'undefined' ? TurndownService : undefined, hljs: typeof hljs !== 'undefined' ? hljs : undefined };");
  return script();
}

// marked & turndown define themselves as globals when evaluated in a browser
// context. We evaluate them inside the jsdom window.
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/marked.min.js"), "utf8"));
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/turndown.js"), "utf8"));
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/highlight.min.js"), "utf8"));

const marked = dom.window.marked;
const TurndownService = dom.window.TurndownService;
const hljs = dom.window.hljs;

if (!marked || !TurndownService || !hljs) {
  console.error("libs missing:", { marked: !!marked, TurndownService: !!TurndownService, hljs: !!hljs });
  process.exit(1);
}

// ---- Copy of escapeHtml + convertFileSrc from main.js ----
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
function convertFileSrc(p) {
  const normalized = p.replace(/\\/g, "/");
  return global.window.__TAURI__.core.convertFileSrc(normalized);
}

// currentFileDir mimics what main.js sets after opening a file.
const sampleFile = process.argv[2] || path.join(root, "sample_benar.md");
const currentFileDir = path.dirname(sampleFile).replace(/\\/g, "/");
const originalMarkdown = fs.readFileSync(sampleFile, "utf8");

// ---- Copy renderer setup from renderMarkdownToElement (post-fix) ----
const renderer = new marked.Renderer();
let mermaidBlocks = [];

renderer.code = function ({ text, lang }) {
  if (lang === "mermaid") {
    const id = "mermaid-" + mermaidBlocks.length + "-" + Date.now();
    mermaidBlocks.push({ id, code: text });
    const encoded = encodeURIComponent(text);
    return `<div class="mermaid-wrapper" data-mermaid-id="${id}" data-mermaid-src="${encoded}" contenteditable="false">
      <div class="mermaid-toolbar"></div>
      <div class="mermaid-diagram" id="${id}">${escapeHtml(text)}</div>
      <div class="mermaid-source"><textarea class="mermaid-editor" spellcheck="false">${escapeHtml(text)}</textarea></div>
    </div>`;
  }
  const langAttr = lang || "";
  const highlighted = lang && hljs.getLanguage(lang)
    ? hljs.highlight(text, { language: lang }).value
    : hljs.highlightAuto(text).value;
  const encoded = encodeURIComponent(text);
  return `<div class="codeblock-wrapper" data-lang="${escapeHtml(langAttr)}" data-code-src="${encoded}" contenteditable="false">
    <div class="codeblock-lang-bar"><input class="codeblock-lang-input" type="text" value="${escapeHtml(langAttr)}"></div>
    <pre><code class="hljs language-${langAttr}">${highlighted}</code></pre>
    <textarea class="codeblock-editor" spellcheck="false">${escapeHtml(text)}</textarea>
  </div>`;
};

renderer.image = function ({ href, title, text }) {
  let src = href;
  if (currentFileDir && href && !href.startsWith("http") && !href.startsWith("data:")) {
    src = convertFileSrc(currentFileDir + "/" + href);
  }
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const originalAttr = href ? ` data-original-src="${escapeHtml(href)}"` : "";
  return `<img src="${src}" alt="${escapeHtml(text || "")}"${titleAttr}${originalAttr}>`;
};

renderer.link = function ({ href, title, tokens }) {
  const t = this.parser.parseInline(tokens);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${titleAttr}>${t}</a>`;
};

marked.setOptions({ renderer, gfm: true, breaks: false });

const container = document.getElementById("markdown-content");
container.innerHTML = marked.parse(originalMarkdown);

// ---- Copy Turndown setup from initWysiwyg (post-fix) ----
const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});

turndownService.addRule("strikethrough", {
  filter: ["del", "s"],
  replacement: (c) => "~~" + c + "~~",
});
turndownService.addRule("underline", {
  filter: "u",
  replacement: (c) => "<u>" + c + "</u>",
});
turndownService.addRule("mermaid", {
  filter: (node) => node.classList && node.classList.contains("mermaid-wrapper"),
  replacement: (content, node) => {
    const encoded = node.getAttribute("data-mermaid-src") || "";
    let code = "";
    try { code = decodeURIComponent(encoded); } catch (e) { code = encoded; }
    if (!code) {
      const editor = node.querySelector(".mermaid-editor");
      code = editor ? (editor.value || editor.textContent || "") : "";
    }
    return "\n\n```mermaid\n" + code + "\n```\n\n";
  },
});
turndownService.addRule("codeblockWrapper", {
  filter: (node) => node.classList && node.classList.contains("codeblock-wrapper"),
  replacement: (content, node) => {
    const encoded = node.getAttribute("data-code-src") || "";
    let code = "";
    try { code = decodeURIComponent(encoded); } catch (e) { code = encoded; }
    if (!code) {
      const editor = node.querySelector(".codeblock-editor");
      code = editor ? (editor.value || editor.textContent || "") : "";
    }
    const lang = node.getAttribute("data-lang") || "";
    return "\n\n```" + lang + "\n" + code + "\n```\n\n";
  },
});
turndownService.remove((node) => node.classList && (
  node.classList.contains("mermaid-toolbar") ||
  node.classList.contains("mermaid-toggle-btn") ||
  node.classList.contains("mermaid-copy-btn") ||
  node.classList.contains("mermaid-copy-png-btn") ||
  node.classList.contains("codeblock-lang-bar") ||
  node.classList.contains("codeblock-editor")
));
turndownService.addRule("preserveImagePath", {
  filter: "img",
  replacement: (content, node) => {
    const src = node.getAttribute("data-original-src") || node.getAttribute("src") || "";
    const alt = node.getAttribute("alt") || "";
    const title = node.getAttribute("title");
    const titlePart = title ? ' "' + title.replace(/"/g, '\\"') + '"' : "";
    return "![" + alt + "](" + src + titlePart + ")";
  },
});
const tableCellContent = (cell) => {
  let text = turndownService.turndown(cell.innerHTML || "");
  text = text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  return text || " ";
};
turndownService.addRule("tableCell", { filter: ["th", "td"], replacement: () => "" });
turndownService.addRule("tableRow", { filter: "tr", replacement: () => "" });
turndownService.addRule("tableSection", { filter: ["thead", "tbody", "tfoot"], replacement: () => "" });
turndownService.addRule("table", {
  filter: "table",
  replacement: (content, node) => {
    const rows = Array.from(node.querySelectorAll("tr"));
    if (rows.length === 0) return "";
    const cellsPerRow = rows.map((tr) => Array.from(tr.querySelectorAll("th,td")).map(tableCellContent));
    const colCount = Math.max(...cellsPerRow.map((r) => r.length));
    cellsPerRow.forEach((r) => { while (r.length < colCount) r.push(" "); });
    const hasHeader = rows[0].querySelector("th") !== null;
    const header = hasHeader ? cellsPerRow[0] : Array(colCount).fill(" ");
    const bodyStart = hasHeader ? 1 : 0;
    const sep = Array(colCount).fill("---");
    const lines = [];
    lines.push("| " + header.join(" | ") + " |");
    lines.push("| " + sep.join(" | ") + " |");
    for (let i = bodyStart; i < cellsPerRow.length; i++) lines.push("| " + cellsPerRow[i].join(" | ") + " |");
    return "\n\n" + lines.join("\n") + "\n\n";
  },
});
turndownService.addRule("listItem", {
  filter: "li",
  replacement: (content, node, options) => {
    content = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n  ");
    let prefix = (options.bulletListMarker || "-") + " ";
    const parent = node.parentNode;
    if (parent.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = (start ? Number(start) + index : index + 1) + ". ";
    }
    return prefix + content + (node.nextSibling && !/\n$/.test(content) ? "\n" : "");
  },
});
turndownService.escape = function (str) {
  if (!str) return str;
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/^(#{1,6}) /gm, "\\$1 ")
    .replace(/^>/gm, "\\>")
    .replace(/^(\d+)\. /gm, "$1\\. ")
    .replace(/^([-+*]) /gm, "\\$1 ");
};

// ---- Simulate wysiwygToMarkdown ----
container.querySelectorAll(".mermaid-wrapper").forEach((wrapper) => {
  const ta = wrapper.querySelector(".mermaid-editor");
  if (ta) wrapper.setAttribute("data-mermaid-src", encodeURIComponent(ta.value));
});
container.querySelectorAll(".codeblock-wrapper").forEach((wrapper) => {
  const ta = wrapper.querySelector(".codeblock-editor");
  if (ta) wrapper.setAttribute("data-code-src", encodeURIComponent(ta.value));
});

const roundTripped = turndownService.turndown(container.innerHTML);

// Write output for inspection
const outFile = path.join(root, "sample_roundtrip.md");
fs.writeFileSync(outFile, roundTripped, "utf8");
console.log(`Wrote ${outFile} (${roundTripped.length} bytes)`);

// ---- Assertions ----
function check(name, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
  if (!cond) process.exitCode = 1;
}

check("tables preserved (pipe row)",
  /\| Komponen \| SP2010 \| SUPAS 2015 \| SP2020 \| SUPAS 2025 \|/.test(roundTripped),
  "table 1 header row");

check("table separator row present",
  /\| --- \| --- \| --- \| --- \| --- \|/.test(roundTripped));

check("mermaid multi-line preserved",
  /```mermaid\nflowchart TB\n {4}A\["<b>Tekanan dari atas<\/b>/.test(roundTripped),
  "first mermaid block");

check("image path relative preserved",
  /!\[Gambar 2[^\]]*\]\(01-rasio-ketergantungan\.png\)/.test(roundTripped),
  "no asset.localhost URL");

check("no asset.localhost URLs anywhere in output",
  !/asset\.localhost/.test(roundTripped));

check("[CATATAN...] brackets not escaped",
  /\[CATATAN UNTUK PENULIS/.test(roundTripped) && !/\\\[CATATAN/.test(roundTripped));

check("list uses '- ' single space (no '-   ' padding)",
  /^- \*\*SP2010\*\* dan/m.test(roundTripped));

check("ordered list uses '1. ' single space",
  /^1\. {1,2}Badan Pusat Statistik/m.test(roundTripped));

check("mermaid classDef lines preserved",
  /classDef atas fill:#C1440E/.test(roundTripped));

// Sanity: length within tolerance
const sizeRatio = roundTripped.length / originalMarkdown.length;
check("output size similar to original (0.85–1.15×)",
  sizeRatio > 0.85 && sizeRatio < 1.15,
  `ratio=${sizeRatio.toFixed(3)}`);
