// End-to-end DOCX generation test: render math via KaTeX MathML,
// convert to OMML, build a DOCX, unzip, inspect document.xml.
//
// Verifies:
//   - Inline `$a^2+b^2=c^2$` produces <m:oMath> with <m:sSup>
//   - Block `$$\sum_{i=1}^n x_i^2$$` produces <m:nary> with sub/sup limits
//   - Fraction `$\frac{a}{b}$` produces <m:f> with <m:num>/<m:den>
//   - Root `$\sqrt{x+1}$` produces <m:rad> with <m:degHide>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import AdmZip from "adm-zip";

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
global.XMLSerializer = dom.window.XMLSerializer;

dom.window.eval(fs.readFileSync(path.join(root, "src/lib/marked.min.js"), "utf8"));
dom.window.eval(fs.readFileSync(path.join(root, "src/lib/katex/katex.min.js"), "utf8"));

const marked = dom.window.marked;
const katex = dom.window.katex;

// KaTeX renders full <math> when we ask for htmlAndMathml; we'll extract that.
function renderMathToken(latex, displayMode) {
  const encoded = encodeURIComponent(latex);
  const rendered = katex.renderToString(latex, {
    displayMode, throwOnError: false, output: "htmlAndMathml", strict: "ignore",
  });
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "katex-block" : "katex-inline";
  return `<${tag} class="${cls}" data-latex-src="${encoded}">${rendered}</${tag}>`;
}

marked.use({
  extensions: [
    {
      name: "mathBlock", level: "block",
      start(src) { return src.indexOf("$$"); },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
        if (m) return { type: "mathBlock", raw: m[0], text: m[1].trim() };
      },
      renderer(t) { return renderMathToken(t.text, true); },
    },
    {
      name: "mathInline", level: "inline",
      start(src) { return src.indexOf("$"); },
      tokenizer(src) {
        if (src.startsWith("$$")) return;
        const m = /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: "mathInline", raw: m[0], text: m[1] };
      },
      renderer(t) { return renderMathToken(t.text, false); },
    },
  ],
});

// --- MathML → OMML transform (mirrors main.js) ---
const OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math";
const OMML_NARY_CHARS = { "∑": true, "∏": true, "∐": true, "∫": true, "∬": true, "∭": true, "∮": true, "⋃": true, "⋂": true };

function escapeXmlText(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeXmlAttr(s) { return escapeXmlText(s).replace(/"/g, "&quot;").replace(/\r?\n/g, " "); }
function localName(el) { return el.tagName ? el.tagName.toLowerCase().replace(/^.*:/, "") : ""; }
function mmlChildren(el) { const out = []; for (const c of el.children) out.push(c); return out; }
function mmlText(el) { return el ? (el.textContent || "").trim() : ""; }

function mmlRunToOMML(el, forceStyle) {
  const tag = localName(el);
  const text = mmlText(el);
  if (!text) return "";
  const italic = forceStyle === "i" ? true
               : forceStyle === "p" ? false
               : tag === "mi" && text.length === 1 && /[a-zA-Z]/.test(text);
  const styleXml = italic ? '<m:rPr><m:sty m:val="i"/></m:rPr>' : '<m:rPr><m:sty m:val="p"/></m:rPr>';
  return `<m:r>${styleXml}<m:t xml:space="preserve">${escapeXmlText(text)}</m:t></m:r>`;
}

function mmlNodeToOMML(el) {
  if (!el) return "";
  if (el.nodeType === 3) {
    const t = (el.textContent || "").trim();
    if (!t) return "";
    return `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">${escapeXmlText(t)}</m:t></m:r>`;
  }
  if (el.nodeType !== 1) return "";
  const tag = localName(el);
  switch (tag) {
    case "math": case "mrow": case "mstyle": case "mpadded": case "menclose":
      return mmlChildren(el).map(mmlNodeToOMML).join("");
    case "semantics": { const f = el.firstElementChild; return f ? mmlNodeToOMML(f) : ""; }
    case "annotation": case "annotation-xml": return "";
    case "mi": case "mn": case "mo": case "mtext": case "ms":
      return mmlRunToOMML(el);
    case "mspace": return "";
    case "msup": { const [b, s] = mmlChildren(el); return `<m:sSup><m:sSupPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:sup>${mmlNodeToOMML(s)}</m:sup></m:sSup>`; }
    case "msub": { const [b, s] = mmlChildren(el); return `<m:sSub><m:sSubPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:sub>${mmlNodeToOMML(s)}</m:sub></m:sSub>`; }
    case "msubsup": {
      const [b, sub, sup] = mmlChildren(el);
      const bt = mmlText(b);
      if (bt.length === 1 && OMML_NARY_CHARS[bt]) {
        return `<m:nary><m:naryPr><m:chr m:val="${escapeXmlAttr(bt)}"/><m:limLoc m:val="subSup"/></m:naryPr><m:sub>${mmlNodeToOMML(sub)}</m:sub><m:sup>${mmlNodeToOMML(sup)}</m:sup><m:e></m:e></m:nary>`;
      }
      return `<m:sSubSup><m:sSubSupPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:sub>${mmlNodeToOMML(sub)}</m:sub><m:sup>${mmlNodeToOMML(sup)}</m:sup></m:sSubSup>`;
    }
    case "mfrac": { const [n, d] = mmlChildren(el); return `<m:f><m:fPr/><m:num>${mmlNodeToOMML(n)}</m:num><m:den>${mmlNodeToOMML(d)}</m:den></m:f>`; }
    case "msqrt": return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${mmlChildren(el).map(mmlNodeToOMML).join("")}</m:e></m:rad>`;
    case "mroot": { const [r, d] = mmlChildren(el); return `<m:rad><m:radPr/><m:deg>${mmlNodeToOMML(d)}</m:deg><m:e>${mmlNodeToOMML(r)}</m:e></m:rad>`; }
    case "munder": {
      const [b, l] = mmlChildren(el); const bt = mmlText(b);
      if (bt.length === 1 && OMML_NARY_CHARS[bt]) return `<m:nary><m:naryPr><m:chr m:val="${escapeXmlAttr(bt)}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${mmlNodeToOMML(l)}</m:sub><m:sup></m:sup><m:e></m:e></m:nary>`;
      return `<m:limLow><m:limLowPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:lim>${mmlNodeToOMML(l)}</m:lim></m:limLow>`;
    }
    case "mover": {
      const [b, l] = mmlChildren(el);
      if (el.getAttribute("accent") === "true") return `<m:acc><m:accPr><m:chr m:val="${escapeXmlAttr(mmlText(l))}"/></m:accPr><m:e>${mmlNodeToOMML(b)}</m:e></m:acc>`;
      return `<m:limUpp><m:limUppPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:lim>${mmlNodeToOMML(l)}</m:lim></m:limUpp>`;
    }
    case "munderover": {
      const [b, sub, sup] = mmlChildren(el); const bt = mmlText(b);
      if (bt.length === 1 && OMML_NARY_CHARS[bt]) return `<m:nary><m:naryPr><m:chr m:val="${escapeXmlAttr(bt)}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${mmlNodeToOMML(sub)}</m:sub><m:sup>${mmlNodeToOMML(sup)}</m:sup><m:e></m:e></m:nary>`;
      return `<m:sSubSup><m:sSubSupPr/><m:e>${mmlNodeToOMML(b)}</m:e><m:sub>${mmlNodeToOMML(sub)}</m:sub><m:sup>${mmlNodeToOMML(sup)}</m:sup></m:sSubSup>`;
    }
    case "mfenced": {
      const open = el.getAttribute("open") || "("; const close = el.getAttribute("close") || ")";
      return `<m:d><m:dPr><m:begChr m:val="${escapeXmlAttr(open)}"/><m:endChr m:val="${escapeXmlAttr(close)}"/></m:dPr><m:e>${mmlChildren(el).map(mmlNodeToOMML).join("")}</m:e></m:d>`;
    }
    case "mtable": {
      const rows = mmlChildren(el).filter((c) => localName(c) === "mtr");
      const colCount = rows.reduce((n, r) => Math.max(n, mmlChildren(r).length), 0);
      const mcs = `<m:mcs><m:mc><m:mcPr><m:count m:val="${colCount || 1}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>`;
      let out = `<m:m><m:mPr>${mcs}</m:mPr>`;
      for (const row of rows) { out += "<m:mr>"; for (const cell of mmlChildren(row)) out += `<m:e>${mmlChildren(cell).map(mmlNodeToOMML).join("")}</m:e>`; out += "</m:mr>"; }
      out += "</m:m>";
      return out;
    }
    default:
      if (el.children && el.children.length > 0) return mmlChildren(el).map(mmlNodeToOMML).join("");
      return mmlRunToOMML(el, "p");
  }
}

function katexWrapperToOMMLXml(wrapper) {
  const mathEl = wrapper.querySelector(".katex-mathml math") || wrapper.querySelector("math");
  if (!mathEl) return null;
  const body = mmlNodeToOMML(mathEl);
  if (!body || !body.trim()) return null;
  return `<m:oMath xmlns:m="${OMML_NS}">${body}</m:oMath>`;
}

// --- Load docx as npm module (jsdom+UMD combo tends to hang Packer) ---
const docx = await import("docx");
const { Document, Packer, Paragraph, TextRun, ImportedXmlComponent } = docx;

// --- Build sample markdown, render, walk math wrappers ---
const sample = `# Math test

Inline: $a^2 + b^2 = c^2$ then $\\frac{a}{b}$ then $\\sqrt{x+1}$.

Sum block:

$$
\\sum_{i=1}^{n} x_i^2
$$

Integral block:

$$
\\int_0^1 f(x)\\,dx = F(1) - F(0)
$$
`;

const html = marked.parse(sample);
document.getElementById("markdown-content").innerHTML = html;
const container = document.getElementById("markdown-content");

const paragraphs = [];
paragraphs.push(new Paragraph({ children: [new TextRun("Sample math export")] }));

const wrappers = container.querySelectorAll(".katex-inline, .katex-block");
const inlineChildren = [];
for (const w of wrappers) {
  const xml = katexWrapperToOMMLXml(w);
  if (!xml) { console.error("no OMML from wrapper:", w.className); continue; }
  const wrapped = ImportedXmlComponent.fromXmlString(xml);
  const cmp = wrapped && wrapped.root && wrapped.root[0] ? wrapped.root[0] : wrapped;
  if (w.classList.contains("katex-inline")) {
    inlineChildren.push(cmp);
    inlineChildren.push(new TextRun({ text: " | " }));
  } else {
    paragraphs.push(new Paragraph({ children: [cmp] }));
  }
}
if (inlineChildren.length) paragraphs.unshift(new Paragraph({ children: inlineChildren }));

const doc = new Document({
  sections: [{ children: paragraphs }],
});
const buffer = await Packer.toBuffer(doc);
const outPath = path.join(root, "math-test.docx");
fs.writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${buffer.length} bytes)`);

// --- Inspect document.xml ---
const zip = new AdmZip(outPath);
const docXml = zip.getEntry("word/document.xml").getData().toString("utf8");

function check(name, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + ": " + name + (detail ? " — " + detail : ""));
  if (!cond) process.exitCode = 1;
}

check("document.xml declares OMML namespace",
  docXml.includes('xmlns:m="' + OMML_NS + '"') || docXml.includes('xmlns:m=&quot;' + OMML_NS));
check("at least one <m:oMath> present", /<m:oMath[\s>]/.test(docXml));
check("Pythagorean uses <m:sSup>", /<m:sSup>/.test(docXml));
check("fraction uses <m:f>", /<m:f>/.test(docXml));
check("sqrt uses <m:rad> with <m:degHide>", /<m:rad>[^]*?<m:degHide/.test(docXml));
check("summation uses <m:nary> with sum char", /<m:nary>[^]*?<m:chr m:val="∑"/.test(docXml));
check("integral uses <m:nary> with integral char", /<m:nary>[^]*?<m:chr m:val="∫"/.test(docXml));
check("no <m:r> without <m:t> orphans", !/<m:r>\s*<\/m:r>/.test(docXml));

// Quick dump for eyeball
fs.writeFileSync(path.join(root, "math-test-document.xml"), docXml);
console.log("Wrote math-test-document.xml for inspection");
