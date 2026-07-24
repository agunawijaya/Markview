const { invoke } = window.__TAURI__.core;
const { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;
const { open: shellOpen } = window.__TAURI__.shell;
const { getCurrentWebviewWindow, WebviewWindow } = window.__TAURI__.webviewWindow;
const { getCurrentWindow } = window.__TAURI__.window;

let currentFilePath = null;
let currentFileDir = null;
let currentZoom = 100; // percentage 50-300
let currentReadingWidth = "default"; // "optimal" | "fit" | "default"
let isDarkMode = false;
let currentViewMode = "rendered"; // "rendered", "code", "split"
let currentRawContent = ""; // raw markdown source
let sidebarOpen = false;
let isDirty = false;
let currentFilename = "";
let mermaidRenderTimer = null;
let turndownService = null;
let wysiwygInputTimer = null;
let savedSelection = null; // saved selection range for context menu
let suppressWysiwygInput = false; // suppress input events during programmatic DOM changes

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  initMenu();
  initToolbar();
  initDragDrop();
  initKeyboard();
  initSidebar();
  initContextMenu();
  initFindReplace();
  initTextareas();
  initUnsavedModal();
  initWysiwyg();
  initStatusBarControls();
  initCloseGuard();
  await loadPreferences();
  await checkStartupFile();
});

// --- Check if this window should open a file on startup ---
async function checkStartupFile() {
  try {
    const cliFile = await invoke("get_cli_file");
    if (cliFile) {
      await openFile(cliFile);
      return;
    }
  } catch (e) {}

  try {
    const filePath = await invoke("get_pending_file");
    if (filePath) {
      await openFile(filePath);
    }
  } catch (e) {}
}

// --- Preferences ---
async function loadPreferences() {
  try {
    const dark = await invoke("load_preference", { key: "dark_mode" });
    if (dark === "true") {
      isDarkMode = true;
      document.body.classList.add("dark");
    }
    const sidebar = await invoke("load_preference", { key: "sidebar" });
    if (sidebar === "true") {
      sidebarOpen = true;
      document.getElementById("sidebar").classList.remove("collapsed");
    }
    const viewMode = await invoke("load_preference", { key: "view_mode" });
    if (viewMode && ["rendered", "code", "split"].includes(viewMode)) {
      currentViewMode = viewMode;
    }
  } catch (e) {}

  // Zoom level — localStorage
  try {
    const z = localStorage.getItem("markview-zoom-level");
    if (z !== null) {
      const n = parseInt(z, 10);
      if (!Number.isNaN(n)) currentZoom = clampZoom(n);
    }
  } catch (e) {}
  applyZoom(currentZoom);
  syncZoomUI();

  // Reading width — localStorage
  try {
    const rw = localStorage.getItem("markview-reading-width");
    if (rw && ["optimal", "fit", "default"].includes(rw)) {
      currentReadingWidth = rw;
    }
  } catch (e) {}
  applyReadingWidth(currentReadingWidth);
}

async function savePrefs() {
  try {
    await invoke("save_preference", { key: "dark_mode", value: String(isDarkMode) });
    await invoke("save_preference", { key: "sidebar", value: String(sidebarOpen) });
    await invoke("save_preference", { key: "view_mode", value: currentViewMode });
  } catch (e) {}
}

// --- Menu ---
function initMenu() {
  let openMenu = null;

  document.querySelectorAll(".menu-item").forEach((item) => {
    item.querySelector(".menu-label").addEventListener("click", (e) => {
      e.stopPropagation();
      if (item.classList.contains("open")) {
        item.classList.remove("open");
        openMenu = null;
      } else {
        if (openMenu) openMenu.classList.remove("open");
        item.classList.add("open");
        openMenu = item;
      }
    });

    item.addEventListener("mouseenter", () => {
      if (openMenu && openMenu !== item) {
        openMenu.classList.remove("open");
        item.classList.add("open");
        openMenu = item;
      }
    });
  });

  document.addEventListener("click", () => {
    if (openMenu) {
      openMenu.classList.remove("open");
      openMenu = null;
    }
  });

  document.querySelectorAll(".menu-entry[data-action]").forEach((entry) => {
    entry.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = entry.dataset.action;
      handleAction(action);
      document.querySelectorAll(".menu-item.open").forEach((m) => m.classList.remove("open"));
    });
  });

  document.getElementById("about-close").addEventListener("click", () => {
    document.getElementById("about-modal").style.display = "none";
  });
}

// --- Toolbar ---
function initToolbar() {
  document.querySelectorAll(".tb-btn[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      handleAction(btn.dataset.action);
    });
  });
  initToolbarOverflow();
}

// --- Toolbar overflow (Word-style): groups collapse rightmost-first into a chevron popup ---
const TOOLBAR_GROUP_ORDER = ["file", "edit", "structure", "format", "view"];
let toolbarGroupWidths = [];
let toolbarChevronWidth = 0;
let toolbarInterGroupGap = 0;

function initToolbarOverflow() {
  const toolbar = document.getElementById("toolbar");
  if (!toolbar) return;

  // 1. Wrap flat button/separator layout into .tb-group divs, split at .tb-sep.
  //    Moving buttons via appendChild preserves their attached click handlers.
  const nodes = Array.from(toolbar.childNodes);
  let groupIdx = 0;
  let current = document.createElement("div");
  current.className = "tb-group";
  current.dataset.group = TOOLBAR_GROUP_ORDER[groupIdx] || `group-${groupIdx}`;
  const newChildren = [current];

  nodes.forEach((node) => {
    if (node.nodeType === 1 && node.classList && node.classList.contains("tb-sep")) {
      groupIdx++;
      current = document.createElement("div");
      current.className = "tb-group";
      current.dataset.group = TOOLBAR_GROUP_ORDER[groupIdx] || `group-${groupIdx}`;
      newChildren.push(current);
      // .tb-sep is dropped; visual divider now comes from CSS ::before
    } else if (node.nodeType === 1) {
      current.appendChild(node);
    }
  });

  toolbar.innerHTML = "";
  newChildren.forEach((g) => toolbar.appendChild(g));

  // 2. Overflow chevron button appended after all groups
  const chevron = document.createElement("button");
  chevron.id = "toolbar-overflow-btn";
  chevron.className = "tb-btn";
  chevron.type = "button";
  chevron.title = "More toolbar items";
  chevron.setAttribute("aria-label", "More toolbar items");
  chevron.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 17 11 12 6 7"/><polyline points="13 17 18 12 13 7"/></svg>`;
  toolbar.appendChild(chevron);

  // 3. Popup container attached to body (absolute positioning)
  const menu = document.createElement("div");
  menu.id = "toolbar-overflow-menu";
  document.body.appendChild(menu);

  // 4. Measure natural widths once, with all groups in toolbar and chevron
  //    temporarily visible so we know its footprint.
  requestAnimationFrame(() => {
    measureToolbarGroups();
    updateToolbarOverflow();
  });

  // 5. Chevron click toggles popup
  chevron.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains("open")) {
      closeOverflowMenu();
    } else {
      openOverflowMenu();
    }
  });

  // Close popup when clicking a button inside it (the action still fires
  // via the button's own click handler, which is unaffected by the DOM move)
  menu.addEventListener("click", (e) => {
    if (e.target.closest(".tb-btn")) {
      closeOverflowMenu();
    }
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("open")) return;
    if (menu.contains(e.target)) return;
    if (chevron.contains(e.target)) return;
    closeOverflowMenu();
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("open")) {
      closeOverflowMenu();
    }
  });

  // 6. Recompute on toolbar size change
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => updateToolbarOverflow());
    ro.observe(toolbar);
  } else {
    window.addEventListener("resize", () => updateToolbarOverflow());
  }
}

function measureToolbarGroups() {
  const toolbar = document.getElementById("toolbar");
  const chevron = document.getElementById("toolbar-overflow-btn");
  if (!toolbar) return;

  // Force the chevron to be visible so its width is measurable, but remember
  // its previous inline display so we can restore it.
  const prevChevronDisplay = chevron.style.display;
  chevron.style.visibility = "hidden";
  chevron.style.display = "inline-flex";

  const groups = Array.from(toolbar.querySelectorAll(".tb-group"));
  // The first group has no ::before divider; subsequent groups do. Grab that
  // pseudo-element width by comparing first vs subsequent group offsets, or
  // just approximate — the CSS uses 1px + 4px + 6px = 11px. Use offsetLeft
  // deltas for accuracy.
  toolbarGroupWidths = groups.map((g) => g.getBoundingClientRect().width);
  if (groups.length >= 2) {
    const gap =
      groups[1].getBoundingClientRect().left -
      groups[0].getBoundingClientRect().right;
    toolbarInterGroupGap = Math.max(0, gap);
  } else {
    toolbarInterGroupGap = 11;
  }
  toolbarChevronWidth = chevron.getBoundingClientRect().width;

  chevron.style.display = prevChevronDisplay;
  chevron.style.visibility = "";
}

function updateToolbarOverflow() {
  const toolbar = document.getElementById("toolbar");
  const chevron = document.getElementById("toolbar-overflow-btn");
  const menu = document.getElementById("toolbar-overflow-menu");
  if (!toolbar || !chevron || !menu) return;
  if (!toolbarGroupWidths.length) return;

  const styles = getComputedStyle(toolbar);
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const gapBetween = parseFloat(styles.columnGap || styles.gap) || 0;

  const available = toolbar.clientWidth - paddingLeft - paddingRight;

  // Try 1: fit all groups without chevron. Each subsequent group also costs
  // the between-groups gap (from #toolbar's flex gap + the ::before divider).
  const perGroupCost = (i) =>
    toolbarGroupWidths[i] + (i > 0 ? toolbarInterGroupGap + gapBetween : 0);

  let sum = 0;
  let allFit = true;
  for (let i = 0; i < toolbarGroupWidths.length; i++) {
    sum += perGroupCost(i);
    if (sum > available) {
      allFit = false;
      break;
    }
  }

  if (allFit) {
    reflowToolbarGroups(toolbarGroupWidths.length);
    chevron.classList.remove("visible");
    return;
  }

  // Try 2: reserve room for the chevron and greedy-fit from the left
  const availableWithChevron = available - toolbarChevronWidth - gapBetween;
  sum = 0;
  let firstHidden = 0;
  for (let i = 0; i < toolbarGroupWidths.length; i++) {
    const cost = perGroupCost(i);
    if (sum + cost > availableWithChevron) {
      firstHidden = i;
      break;
    }
    sum += cost;
    firstHidden = i + 1;
  }

  // At least ONE group should stay visible if it fits alongside the chevron;
  // if not even the file group fits, we still keep it visible (overflow-hidden
  // will clip a pixel at worst, but this is the least-bad UX).
  if (firstHidden === 0) firstHidden = 1;

  reflowToolbarGroups(firstHidden);
  chevron.classList.add("visible");
}

function reflowToolbarGroups(firstHiddenIdx) {
  const toolbar = document.getElementById("toolbar");
  const menu = document.getElementById("toolbar-overflow-menu");
  const chevron = document.getElementById("toolbar-overflow-btn");
  if (!toolbar || !menu || !chevron) return;

  // Collect all .tb-group elements (in either container) ordered by
  // original position index.
  const allGroups = new Array(TOOLBAR_GROUP_ORDER.length);
  document.querySelectorAll(".tb-group").forEach((g) => {
    const idx = TOOLBAR_GROUP_ORDER.indexOf(g.dataset.group);
    if (idx >= 0) allGroups[idx] = g;
  });

  // Place each group in the correct container, in order.
  allGroups.forEach((group, idx) => {
    if (!group) return;
    if (idx < firstHiddenIdx) {
      // Belongs in toolbar (before chevron)
      if (group.parentNode !== toolbar || group.nextSibling !== chevron) {
        toolbar.insertBefore(group, chevron);
      }
    } else {
      // Belongs in popup
      if (group.parentNode !== menu) {
        menu.appendChild(group);
      }
    }
  });

  // If the popup is now empty and the menu was open, close it.
  if (!menu.children.length && menu.classList.contains("open")) {
    menu.classList.remove("open");
  }
}

function openOverflowMenu() {
  const chevron = document.getElementById("toolbar-overflow-btn");
  const menu = document.getElementById("toolbar-overflow-menu");
  if (!chevron || !menu || !menu.children.length) return;
  const rect = chevron.getBoundingClientRect();
  // Position below the chevron, right-aligned to it
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.left = "auto";
  menu.style.right = `${Math.max(4, window.innerWidth - rect.right)}px`;
  menu.classList.add("open");
}

function closeOverflowMenu() {
  const menu = document.getElementById("toolbar-overflow-menu");
  if (menu) menu.classList.remove("open");
}

// --- Unified Action Handler ---
function handleAction(action) {
  switch (action) {
    case "new": doNew(); break;
    case "new-window": doNewWindow(); break;
    case "open": doOpen(); break;
    case "save": doSave(); break;
    case "save-as": doSaveAs(); break;
    case "reload": doReload(); break;
    case "export-html": doExportHTML(); break;
    case "export-pdf": doExportPDF(); break;
    case "export-docx-md": doExportDOCX("markdown"); break;
    case "export-docx-word": doExportDOCX("word"); break;
    case "quit": getCurrentWebviewWindow().close(); break;
    case "undo": doUndo(); break;
    case "redo": doRedo(); break;
    case "cut": doCut(); break;
    case "copy": doCopy(); break;
    case "paste": doPaste(); break;
    case "clear-format": doClearFormat(); break;
    case "find-replace": toggleFindReplace(); break;
    case "bold": doFormatWrap("**"); break;
    case "italic": doFormatWrap("*"); break;
    case "underline": doFormatTag("u"); break;
    case "strikethrough": doFormatWrap("~~"); break;
    case "inline-code": doFormatWrap("`"); break;
    case "hyperlink": doHyperlink(); break;
    case "h1": doHeading(1); break;
    case "h2": doHeading(2); break;
    case "h3": doHeading(3); break;
    case "h4": doHeading(4); break;
    case "h5": doHeading(5); break;
    case "h6": doHeading(6); break;
    case "heading-increase": doHeadingChange(1); break;
    case "heading-decrease": doHeadingChange(-1); break;
    case "ordered-list": doList("ordered"); break;
    case "bullet-list": doList("bullet"); break;
    case "insert-table": doInsertTable(); break;
    case "insert-codeblock": doInsertCodeBlock(); break;
    case "insert-mermaid": doInsertMermaid(); break;
    case "insert-hr": doInsertAtCursor("\n---\n"); break;
    case "zoom-in": doZoom(0.1); break;
    case "zoom-out": doZoom(-0.1); break;
    case "zoom-reset": doZoomReset(); break;
    case "toggle-dark": doToggleDark(); break;
    case "toggle-sidebar": toggleSidebar(); break;
    case "view-rendered": setViewMode("rendered"); break;
    case "view-code": setViewMode("code"); break;
    case "view-split": setViewMode("split"); break;
    case "about": document.getElementById("about-modal").style.display = "flex"; break;
  }
}

// --- Keyboard Shortcuts ---
function initKeyboard() {
  document.addEventListener("keydown", (e) => {
    // Ctrl+Shift combos
    if (e.ctrlKey && e.shiftKey) {
      switch (e.key) {
        case "D": e.preventDefault(); doToggleDark(); return;
        case "S": e.preventDefault(); doSaveAs(); return;
        case "Z": e.preventDefault(); doRedo(); return;
      }
    }
    // Ctrl combos (no shift)
    if (e.ctrlKey && !e.shiftKey) {
      switch (e.key) {
        case "n": e.preventDefault(); doNew(); return;
        case "o": e.preventDefault(); doOpen(); return;
        case "s": e.preventDefault(); doSave(); return;
        case "r": e.preventDefault(); doReload(); return;
        case "q": e.preventDefault(); getCurrentWebviewWindow().close(); return;
        case "=": e.preventDefault(); doZoom(0.1); return;
        case "-": e.preventDefault(); doZoom(-0.1); return;
        case "0": e.preventDefault(); doZoomReset(); return;
        case "\\": e.preventDefault(); toggleSidebar(); return;
        case "1": e.preventDefault(); setViewMode("rendered"); return;
        case "2": e.preventDefault(); setViewMode("code"); return;
        case "3": e.preventDefault(); setViewMode("split"); return;
        case "b": e.preventDefault(); doFormatWrap("**"); return;
        case "i": e.preventDefault(); doFormatWrap("*"); return;
        case "u": e.preventDefault(); doFormatTag("u"); return;
        case "h": e.preventDefault(); toggleFindReplace(); return;
      }
    }
    if (e.key === "Escape") {
      document.getElementById("about-modal").style.display = "none";
      document.getElementById("unsaved-modal").style.display = "none";
      closeFindReplace();
      hideContextMenu();
    }
  });
}

// --- Textareas ---
function initTextareas() {
  const codeTextarea = document.getElementById("code-textarea");
  const splitTextarea = document.getElementById("split-textarea");

  const handleInput = (e) => {
    const ta = e.target;
    currentRawContent = ta.textContent !== undefined ? ta.value : ta.value;
    syncTextareas(ta);
    markDirty();
    debouncedRenderPreview();
  };

  const handleCursor = (e) => {
    updateCursorPosition(e.target);
  };

  codeTextarea.addEventListener("input", handleInput);
  splitTextarea.addEventListener("input", handleInput);

  codeTextarea.addEventListener("click", handleCursor);
  codeTextarea.addEventListener("keyup", handleCursor);
  splitTextarea.addEventListener("click", handleCursor);
  splitTextarea.addEventListener("keyup", handleCursor);

  // Tab key inserts tab character
  const handleTab = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + "\t" + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      currentRawContent = ta.value;
      syncTextareas(ta);
      markDirty();
      debouncedRenderPreview();
    }
  };

  codeTextarea.addEventListener("keydown", handleTab);
  splitTextarea.addEventListener("keydown", handleTab);
}

function syncTextareas(source) {
  const code = document.getElementById("code-textarea");
  const split = document.getElementById("split-textarea");
  if (source === code) {
    split.value = code.value;
  } else {
    code.value = split.value;
  }
}

function updateCursorPosition(textarea) {
  const val = textarea.value;
  const pos = textarea.selectionStart;
  const lines = val.substring(0, pos).split("\n");
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  document.getElementById("status-cursor").textContent = `Ln ${line}, Col ${col}`;
}

// --- WYSIWYG (Rendered View Editing) ---
function initWysiwyg() {
  // Configure Turndown for our markdown style
  turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  // Add strikethrough rule
  turndownService.addRule("strikethrough", {
    filter: ["del", "s"],
    replacement: function (content) {
      return "~~" + content + "~~";
    },
  });

  // Add underline rule (preserve as HTML)
  turndownService.addRule("underline", {
    filter: "u",
    replacement: function (content) {
      return "<u>" + content + "</u>";
    },
  });

  // Remove mermaid wrappers — keep them as fenced code blocks
  turndownService.addRule("mermaid", {
    filter: function (node) {
      return node.classList && node.classList.contains("mermaid-wrapper");
    },
    replacement: function (content, node) {
      const editor = node.querySelector(".mermaid-editor");
      const code = editor ? (editor.value || editor.textContent) : "";
      return "\n\n```mermaid\n" + code + "\n```\n\n";
    },
  });

  // Code block wrapper → fenced code block
  turndownService.addRule("codeblockWrapper", {
    filter: function (node) {
      return node.classList && node.classList.contains("codeblock-wrapper");
    },
    replacement: function (content, node) {
      const editor = node.querySelector(".codeblock-editor");
      const code = editor ? (editor.value || editor.textContent) : (node.querySelector("pre code") ? node.querySelector("pre code").textContent : "");
      const lang = node.dataset.lang || "";
      return "\n\n```" + lang + "\n" + code + "\n```\n\n";
    },
  });

  // Remove mermaid/codeblock toolbar elements from conversion
  turndownService.remove(function (node) {
    return node.classList && (
      node.classList.contains("mermaid-toolbar") ||
      node.classList.contains("mermaid-toggle-btn") ||
      node.classList.contains("mermaid-copy-btn") ||
      node.classList.contains("mermaid-copy-png-btn") ||
      node.classList.contains("codeblock-lang-bar") ||
      node.classList.contains("codeblock-editor")
    );
  });

  const mdContent = document.getElementById("markdown-content");

  mdContent.addEventListener("input", () => {
    if (suppressWysiwygInput) return;
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => {
      wysiwygToMarkdown();
    }, 300);
  });

  // Handle paste — strip formatting from pasted content if it's plain text
  mdContent.addEventListener("paste", (e) => {
    // Let the browser handle it, then convert
  });

  // Click below content → place cursor at end (create new paragraph if needed)
  mdContent.addEventListener("click", (e) => {
    if (e.target !== mdContent) return; // only when clicking the container itself, not a child
    // Check if click is below the last child
    const lastChild = mdContent.lastElementChild;
    if (lastChild) {
      const lastRect = lastChild.getBoundingClientRect();
      if (e.clientY > lastRect.bottom) {
        // Check if last child is already an empty paragraph
        const isEmptyP = lastChild.tagName === "P" && (!lastChild.textContent.trim());
        if (!isEmptyP) {
          const p = document.createElement("p");
          p.innerHTML = "<br>";
          mdContent.appendChild(p);
        }
        // Place cursor in the last paragraph
        const target = mdContent.lastElementChild;
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  });
}

function enableWysiwyg() {
  const mdContent = document.getElementById("markdown-content");
  mdContent.contentEditable = "true";
  mdContent.style.outline = "none";
  mdContent.style.cursor = "text";
  // Ensure there's at least one paragraph so the cursor has a place to land
  if (!mdContent.textContent.trim() && !mdContent.querySelector("p, h1, h2, h3, h4, h5, h6, pre, div")) {
    mdContent.innerHTML = "<p><br></p>";
  }
}

function disableWysiwyg() {
  const mdContent = document.getElementById("markdown-content");
  mdContent.contentEditable = "false";
  mdContent.style.cursor = "";
}

function wysiwygToMarkdown() {
  if (!turndownService) return;
  const mdContent = document.getElementById("markdown-content");

  // Sync textarea values into textContent/attribute so Turndown's clone can read them.
  // Turndown clones the DOM, and cloned textareas don't carry live .value.
  mdContent.querySelectorAll(".codeblock-editor").forEach((ta) => {
    ta.textContent = ta.value;
  });
  mdContent.querySelectorAll(".mermaid-editor").forEach((ta) => {
    ta.textContent = ta.value;
  });

  // Convert HTML to markdown
  const markdown = turndownService.turndown(mdContent.innerHTML);
  currentRawContent = markdown;

  // Sync to textareas
  document.getElementById("code-textarea").value = markdown;
  document.getElementById("split-textarea").value = markdown;

  markDirty();

  // Update word count
  const words = markdown.trim().split(/\s+/).filter((w) => w.length > 0).length;
  document.getElementById("status-wordcount").textContent = words.toLocaleString() + " words";

  // Update outline
  buildOutline();
}

// --- Format commands for WYSIWYG mode ---
function restoreSavedSelection() {
  if (savedSelection) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection);
    savedSelection = null;
    return true;
  }
  return false;
}

function wysiwygExecCommand(command, value) {
  const mdContent = document.getElementById("markdown-content");
  if (currentViewMode !== "rendered" || mdContent.contentEditable !== "true") return false;
  mdContent.focus();
  // Restore selection (lost when clicking context menu)
  restoreSavedSelection();
  document.execCommand(command, false, value || null);
  // Trigger conversion after format
  clearTimeout(wysiwygInputTimer);
  wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
  return true;
}

// --- Dirty State ---
function markDirty() {
  if (!isDirty) {
    isDirty = true;
    updateWindowTitle(currentFilename);
  }
}

function clearDirty() {
  isDirty = false;
  updateWindowTitle(currentFilename);
}

// --- Debounced Preview Render ---
let renderTimer = null;
function debouncedRenderPreview() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    renderPreview();
  }, 150);
}

function renderPreview() {
  const content = currentRawContent;
  renderMarkdownToElement(content, document.getElementById("markdown-content"));

  if (currentViewMode === "split") {
    renderMarkdownToElement(content, document.getElementById("split-markdown-content"));
  }

  // Re-enable WYSIWYG if in rendered mode
  if (currentViewMode === "rendered") {
    enableWysiwyg();
  }

  // Update word count
  const words = content.trim().split(/\s+/).filter((w) => w.length > 0).length;
  document.getElementById("status-wordcount").textContent = words.toLocaleString() + " words";

  buildOutline();
}

// --- Drag & Drop ---
function initDragDrop() {
  getCurrentWebviewWindow().onDragDropEvent((event) => {
    if (event.payload.type === "over") {
      document.body.classList.add("drag-over");
    } else if (event.payload.type === "drop") {
      document.body.classList.remove("drag-over");
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        const path = paths[0];
        if (path.endsWith(".md")) {
          guardUnsaved(() => openFile(path));
        }
      }
    } else if (event.payload.type === "leave") {
      document.body.classList.remove("drag-over");
    }
  });

  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
}

// --- File Operations ---
let windowCounter = 0;

async function doNew() {
  guardUnsaved(() => {
    currentFilePath = null;
    currentFileDir = null;
    currentFilename = "";
    currentRawContent = "";
    isDirty = false;
    try { invoke("unwatch_file"); } catch (e) {}
    document.getElementById("code-textarea").value = "";
    document.getElementById("split-textarea").value = "";
    document.getElementById("markdown-content").innerHTML = "<p><br></p>";
    document.getElementById("markdown-content").style.display = "block";
    document.getElementById("split-markdown-content").innerHTML = "";
    document.getElementById("drop-zone").style.display = "none";
    document.getElementById("sidebar-content").innerHTML = "";
    updateWindowTitle("");
    updateStatusBar("", "");
    setViewMode("rendered");
  });
}

async function doNewWindow() {
  try {
    windowCounter++;
    const label = "main_" + windowCounter;
    new WebviewWindow(label, {
      url: "index.html",
      title: "MarkView",
      width: 1100,
      height: 750,
      minWidth: 600,
      minHeight: 400,
    });
  } catch (e) {
    console.error("New window error:", e);
  }
}

async function doOpen() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (selected) {
      if (currentFilePath) {
        // Open in new window
        try {
          windowCounter++;
          const label = "main_" + windowCounter;
          await invoke("store_pending_file", { label, filePath: selected });
          new WebviewWindow(label, {
            url: "index.html",
            title: "MarkView",
            width: 1100,
            height: 750,
            minWidth: 600,
            minHeight: 400,
          });
        } catch (e2) {
          console.error("New window error:", e2);
        }
      } else {
        await openFile(selected);
      }
    }
  } catch (e) {
    console.error("Open dialog error:", e);
  }
}

async function openFile(path) {
  try {
    const result = await invoke("read_file", { path });
    currentFilePath = result.path;
    currentFileDir = result.dir;
    currentFilename = result.filename;
    currentRawContent = result.content;
    isDirty = false;

    // Populate textareas
    document.getElementById("code-textarea").value = result.content;
    document.getElementById("split-textarea").value = result.content;

    renderMarkdown(result.content, result.filename);
    setViewMode(currentViewMode);
    await invoke("watch_file", { path: result.path });
    listenForChanges();
  } catch (e) {
    console.error("Failed to open file:", e);
  }
}

let changeListenerSetup = false;
function listenForChanges() {
  if (changeListenerSetup) return;
  changeListenerSetup = true;
  getCurrentWebviewWindow().listen("file-changed", (event) => {
    const data = event.payload;
    // Skip if content matches what we have (e.g. we just saved)
    if (data.content === currentRawContent) return;
    currentRawContent = data.content;
    document.getElementById("code-textarea").value = data.content;
    document.getElementById("split-textarea").value = data.content;
    renderMarkdown(data.content, data.filename);
  });
}

async function doReload() {
  if (currentFilePath) {
    await openFile(currentFilePath);
  }
}

async function doSave() {
  if (!currentFilePath) {
    await doSaveAs();
    return;
  }
  try {
    await invoke("save_file", { path: currentFilePath, content: currentRawContent });
    clearDirty();
  } catch (e) {
    console.error("Save error:", e);
  }
}

async function doSaveAs() {
  const defaultName = currentFilename || "untitled.md";
  const savePath = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!savePath) return;
  try {
    await invoke("save_file", { path: savePath, content: currentRawContent });
    currentFilePath = savePath;
    const parts = savePath.replace(/\\/g, "/").split("/");
    currentFilename = parts[parts.length - 1];
    currentFileDir = parts.slice(0, -1).join("/");
    clearDirty();
    await invoke("watch_file", { path: savePath });
    listenForChanges();
  } catch (e) {
    console.error("Save As error:", e);
  }
}

// --- Unsaved Changes Guard ---
let unsavedCallback = null;

function initUnsavedModal() {
  document.getElementById("unsaved-save").addEventListener("click", async () => {
    document.getElementById("unsaved-modal").style.display = "none";
    await doSave();
    if (unsavedCallback) { unsavedCallback(); unsavedCallback = null; }
  });
  document.getElementById("unsaved-discard").addEventListener("click", () => {
    document.getElementById("unsaved-modal").style.display = "none";
    isDirty = false;
    if (unsavedCallback) { unsavedCallback(); unsavedCallback = null; }
  });
  document.getElementById("unsaved-cancel").addEventListener("click", () => {
    document.getElementById("unsaved-modal").style.display = "none";
    unsavedCallback = null;
  });
}

function guardUnsaved(callback) {
  if (isDirty) {
    unsavedCallback = callback;
    document.getElementById("unsaved-modal").style.display = "flex";
  } else {
    callback();
  }
}

// --- Window Close Guard ---
function initCloseGuard() {
  getCurrentWebviewWindow().onCloseRequested(async (event) => {
    if (!isDirty) return; // allow close
    event.preventDefault(); // block close

    // Show the unsaved modal, but wire the callbacks to actually close
    unsavedCallback = async () => {
      isDirty = false; // prevent re-prompt
      await getCurrentWebviewWindow().close();
    };

    document.getElementById("unsaved-save").onclick = async () => {
      document.getElementById("unsaved-modal").style.display = "none";
      await doSave();
      isDirty = false;
      await getCurrentWebviewWindow().close();
    };

    document.getElementById("unsaved-discard").onclick = async () => {
      document.getElementById("unsaved-modal").style.display = "none";
      isDirty = false;
      await getCurrentWebviewWindow().close();
    };

    document.getElementById("unsaved-cancel").onclick = () => {
      document.getElementById("unsaved-modal").style.display = "none";
    };

    document.getElementById("unsaved-modal").style.display = "flex";
  });
}

// --- Markdown Rendering ---
function renderMarkdown(content, filename) {
  const contentArea = document.getElementById("content-area");
  const scrollTop = contentArea.scrollTop;

  currentRawContent = content;

  const dropZone = document.getElementById("drop-zone");
  const mdContent = document.getElementById("markdown-content");
  dropZone.style.display = "none";
  mdContent.style.display = "block";

  updateWindowTitle(filename);
  currentFilename = filename;

  renderMarkdownToElement(content, mdContent);

  updateStatusBar(filename, content);
  buildOutline();

  if (currentViewMode === "split") {
    renderMarkdownToElement(content, document.getElementById("split-markdown-content"));
  }

  // Enable WYSIWYG if in rendered mode
  if (currentViewMode === "rendered") {
    enableWysiwyg();
  }

  contentArea.addEventListener("scroll", updateActiveOutlineItem);

  requestAnimationFrame(() => {
    contentArea.scrollTop = scrollTop;
  });
}

function renderMarkdownToElement(content, targetEl) {
  const renderer = new marked.Renderer();
  let mermaidBlocks = [];

  renderer.code = function ({ text, lang }) {
    if (lang === "mermaid") {
      const id = "mermaid-" + mermaidBlocks.length + "-" + Date.now();
      mermaidBlocks.push({ id, code: text });
      return `<div class="mermaid-wrapper" data-mermaid-id="${id}" contenteditable="false">
        <div class="mermaid-toolbar">
          <button class="mermaid-toggle-btn" title="Toggle code/diagram">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>
          </button>
          <button class="mermaid-copy-btn" data-mermaid-code="${escapeHtml(text)}" title="Copy code">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          <button class="mermaid-copy-png-btn" title="Copy diagram as PNG">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </button>
        </div>
        <div class="mermaid-diagram" id="${id}">${escapeHtml(text)}</div>
        <div class="mermaid-source"><textarea class="mermaid-editor" spellcheck="false">${escapeHtml(text)}</textarea></div>
      </div>`;
    }
    const langAttr = lang || "";
    const highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(text, { language: lang }).value
      : hljs.highlightAuto(text).value;
    return `<div class="codeblock-wrapper" data-lang="${escapeHtml(langAttr)}" contenteditable="false">
      <div class="codeblock-lang-bar"><input class="codeblock-lang-input" type="text" value="${escapeHtml(langAttr)}" placeholder="language" spellcheck="false"></div>
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
    return `<img src="${src}" alt="${escapeHtml(text || "")}"${titleAttr}>`;
  };

  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(href)}"${titleAttr} data-external-link="true">${text}</a>`;
  };

  marked.setOptions({ renderer, gfm: true, breaks: false });

  targetEl.innerHTML = marked.parse(content);

  // External links
  targetEl.querySelectorAll("a[data-external-link]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const href = link.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        shellOpen(href);
      }
    });
  });

  // Mermaid
  renderMermaidDiagramsDebounced(mermaidBlocks, targetEl);

  // Mermaid blocks
  targetEl.querySelectorAll(".mermaid-wrapper").forEach((wrapper) => {
    wireMermaidBlock(wrapper);
  });

  // Code block editors
  targetEl.querySelectorAll(".codeblock-wrapper").forEach((wrapper) => {
    wireCodeBlock(wrapper);
  });
}

function wireCodeBlock(wrapper) {
  const editor = wrapper.querySelector(".codeblock-editor");
  const pre = wrapper.querySelector("pre");
  const codeEl = wrapper.querySelector("pre code");
  const langInput = wrapper.querySelector(".codeblock-lang-input");

  // Sync pre content → textarea when entering edit mode
  const enterEditMode = () => {
    if (!wrapper.classList.contains("editing")) {
      // Copy current code text into the textarea
      editor.value = codeEl.textContent;
    }
    // Position editor absolutely on top of pre to prevent collapse
    editor.style.position = "absolute";
    editor.style.top = pre.offsetTop + "px";
    editor.style.left = "0";
    editor.style.width = "100%";
    editor.style.height = Math.max(pre.offsetHeight, 60) + "px";
    editor.style.boxSizing = "border-box";
    wrapper.classList.add("editing");
    editor.focus();
  };

  // Show editor on click on the pre block (but not when selecting text)
  pre.addEventListener("click", () => {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    enterEditMode();
  });

  // Also allow clicking the wrapper background (when pre is empty/small)
  wrapper.addEventListener("click", (e) => {
    if (e.target === wrapper || e.target.closest(".codeblock-lang-bar")) return;
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
    if (!wrapper.classList.contains("editing") && !e.target.closest(".codeblock-lang-bar")) {
      enterEditMode();
    }
  });

  // Update highlighted code on blur
  editor.addEventListener("blur", (e) => {
    // Don't exit editing if focus moves to lang input
    if (e.relatedTarget === langInput) return;

    const lang = langInput.value.trim();
    const text = editor.value;
    wrapper.dataset.lang = lang;
    if (lang && hljs.getLanguage(lang)) {
      codeEl.innerHTML = hljs.highlight(text, { language: lang }).value;
    } else if (text) {
      codeEl.innerHTML = hljs.highlightAuto(text).value;
    } else {
      codeEl.textContent = "";
    }
    codeEl.className = "hljs language-" + lang;
    wrapper.classList.remove("editing");
    if (currentViewMode === "rendered") {
      clearTimeout(wysiwygInputTimer);
      wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    }
  });

  // When lang input blurs back to editor, don't exit editing
  langInput.addEventListener("blur", (e) => {
    if (e.relatedTarget !== editor) {
      // Blurred away from both — commit
      editor.dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
    }
  });

  // Language input updates
  langInput.addEventListener("change", () => {
    wrapper.dataset.lang = langInput.value.trim();
  });

  // Tab in editor inserts tab
  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.substring(0, start) + "\t" + editor.value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 1;
    }
    // Escape exits editing mode
    if (e.key === "Escape") {
      editor.blur();
    }
  });
}

function wireMermaidBlock(wrapper) {
  // Toggle button
  const toggleBtn = wrapper.querySelector(".mermaid-toggle-btn");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      wrapper.classList.toggle("show-source");
      if (wrapper.classList.contains("show-source")) {
        const editor = wrapper.querySelector(".mermaid-editor");
        if (editor) setTimeout(() => editor.focus(), 50);
      }
    });
  }

  // Copy code button
  const copyBtn = wrapper.querySelector(".mermaid-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const editor = wrapper.querySelector(".mermaid-editor");
      const code = editor ? editor.value : (copyBtn.dataset.mermaidCode || "");
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.title = "Copied!";
        setTimeout(() => { copyBtn.title = "Copy code"; }, 1500);
      });
    });
  }

  // Copy as PNG button
  const pngBtn = wrapper.querySelector(".mermaid-copy-png-btn");
  if (pngBtn) {
    pngBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const svgEl = wrapper.querySelector(".mermaid-diagram svg");
      if (!svgEl) return;
      try {
        const arrayBuffer = await svgToPngArrayBuffer(svgEl);
        const blob = new Blob([arrayBuffer], { type: "image/png" });
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        pngBtn.title = "Copied!";
        setTimeout(() => { pngBtn.title = "Copy diagram as PNG"; }, 1500);
      } catch (err) {
        console.error("Copy PNG error:", err);
      }
    });
  }

  // Editor
  const editor = wrapper.querySelector(".mermaid-editor");
  if (editor) {
    const mermaidId = wrapper.dataset.mermaidId;

    editor.addEventListener("input", () => {
      if (copyBtn) copyBtn.dataset.mermaidCode = editor.value;
    });

    const reRenderMermaid = async () => {
      const code = editor.value;
      const diagramEl = wrapper.querySelector(".mermaid-diagram");
      if (!diagramEl) return;
      const renderId = mermaidId + "-svg-" + Date.now();
      suppressWysiwygInput = true;
      try {
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: isDarkMode ? "dark" : "default" });
        const { svg } = await mermaid.render(renderId, code);
        diagramEl.innerHTML = svg;
      } catch (err) {
        diagramEl.innerHTML = '<pre style="color:red;padding:8px;">Mermaid error: ' + escapeHtml(String(err)) + '</pre>';
      } finally {
        cleanupMermaidTempElements(renderId);
        suppressWysiwygInput = false;
      }
    };

    editor.addEventListener("blur", reRenderMermaid);
    editor.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        reRenderMermaid();
        wrapper.classList.remove("show-source");
      }
      if (e.key === "Escape") {
        editor.blur();
      }
    });
  }
}

// Mermaid v11 has a bug where render() doesn't clean up its temp elements on
// parse/draw errors. The temp div (id="d"+renderId) stays in document.body,
// causing a visible "Syntax error" overlay. Clean it up manually.
function cleanupMermaidTempElements(renderId) {
  // Only remove mermaid's temp wrapper elements (d-prefix and i-prefix),
  // NOT the rendered SVG itself (which has id=renderId and lives in the diagram div).
  document.getElementById("d" + renderId)?.remove();
  document.getElementById("i" + renderId)?.remove();
}

function renderMermaidDiagramsDebounced(blocks, targetEl) {
  if (blocks.length === 0) return;
  clearTimeout(mermaidRenderTimer);
  mermaidRenderTimer = setTimeout(() => {
    renderMermaidDiagrams(blocks, targetEl);
  }, 500);
}

async function renderMermaidDiagrams(blocks, targetEl) {
  if (blocks.length === 0) return;

  // Suppress wysiwyg input events — mermaid DOM mutations are programmatic,
  // not user edits, and must not trigger wysiwygToMarkdown() round-trips.
  suppressWysiwygInput = true;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: isDarkMode ? "dark" : "default",
  });

  for (const block of blocks) {
    const renderId = block.id + "-svg";
    try {
      const el = targetEl ? targetEl.querySelector("#" + CSS.escape(block.id)) : document.getElementById(block.id);
      if (el) {
        const { svg } = await mermaid.render(renderId, block.code);
        el.innerHTML = svg;
      }
    } catch (e) {
      console.error("Mermaid render error:", e);
      const el = targetEl ? targetEl.querySelector("#" + CSS.escape(block.id)) : document.getElementById(block.id);
      if (el) {
        el.innerHTML = `<pre style="color:red;">Mermaid diagram error: ${escapeHtml(String(e))}</pre>`;
      }
    } finally {
      cleanupMermaidTempElements(renderId);
    }
  }

  suppressWysiwygInput = false;
}

function updateStatusBar(filename, content) {
  document.getElementById("status-filename").textContent = filename || "";
  if (content) {
    const words = content.trim().split(/\s+/).filter((w) => w.length > 0).length;
    document.getElementById("status-wordcount").textContent = words.toLocaleString() + " words";
  } else {
    document.getElementById("status-wordcount").textContent = "";
  }
}

// --- Zoom ---
function clampZoom(percent) {
  if (!Number.isFinite(percent)) return 100;
  if (percent < 50) return 50;
  if (percent > 300) return 300;
  return Math.round(percent);
}

function applyZoom(percent) {
  document.getElementById("content-area").style.zoom = percent / 100;
}

function persistZoom() {
  try {
    localStorage.setItem("markview-zoom-level", String(currentZoom));
  } catch (e) {}
}

function syncZoomUI() {
  const slider = document.getElementById("zoom-slider");
  const label = document.getElementById("zoom-percent");
  if (slider) slider.value = String(currentZoom);
  if (label) label.textContent = currentZoom + "%";
}

function setZoom(percent, opts) {
  const snapStep = opts && opts.snapStep;
  let next = clampZoom(percent);
  if (snapStep) next = Math.round(next / snapStep) * snapStep;
  next = clampZoom(next);
  currentZoom = next;
  applyZoom(currentZoom);
  syncZoomUI();
  persistZoom();
}

// delta is a fraction (e.g. 0.1 = +10%) — kept for back-compat with menu actions
function doZoom(delta) {
  setZoom(currentZoom + Math.round(delta * 100));
}

function doZoomReset() {
  setZoom(100);
}

// --- Reading Width ---
function applyReadingWidth(mode) {
  const body = document.body;
  body.classList.remove("rw-optimal", "rw-fit", "rw-default");
  body.classList.add("rw-" + mode);
  document.querySelectorAll(".rw-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.rw === mode);
  });
}

function setReadingWidth(mode) {
  if (!["optimal", "fit", "default"].includes(mode)) return;
  currentReadingWidth = mode;
  applyReadingWidth(mode);
  try {
    localStorage.setItem("markview-reading-width", mode);
  } catch (e) {}
}

// --- Status Bar Controls ---
function initStatusBarControls() {
  // Reading Width buttons
  document.querySelectorAll(".rw-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setReadingWidth(btn.dataset.rw);
    });
  });

  // Zoom buttons
  const minus = document.getElementById("zoom-minus");
  const plus = document.getElementById("zoom-plus");
  if (minus) minus.addEventListener("click", (e) => { e.preventDefault(); setZoom(currentZoom - 10); });
  if (plus) plus.addEventListener("click", (e) => { e.preventDefault(); setZoom(currentZoom + 10); });

  // Zoom slider — live update on input
  const slider = document.getElementById("zoom-slider");
  if (slider) {
    slider.addEventListener("input", () => {
      const v = parseInt(slider.value, 10);
      if (!Number.isNaN(v)) setZoom(v);
    });
  }

  // Percentage label — click to edit
  const label = document.getElementById("zoom-percent");
  const input = document.getElementById("zoom-percent-input");
  if (label && input) {
    const startEdit = () => {
      input.value = String(currentZoom);
      label.style.display = "none";
      input.style.display = "inline-block";
      input.dataset.previous = String(currentZoom);
      input.focus();
      input.select();
    };
    const cancelEdit = () => {
      input.style.display = "none";
      label.style.display = "inline-block";
    };
    const commitEdit = () => {
      const raw = input.value.trim().replace(/%$/, "");
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) {
        // Non-numeric — revert
        const prev = parseInt(input.dataset.previous || "100", 10);
        setZoom(Number.isNaN(prev) ? 100 : prev);
      } else {
        setZoom(n);
      }
      cancelEdit();
    };

    label.addEventListener("click", startEdit);
    label.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(); }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    });
    input.addEventListener("blur", () => {
      if (input.style.display !== "none") commitEdit();
    });
  }

  // Ctrl + MouseWheel — zoom by 5% per tick
  document.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    setZoom(currentZoom + dir * 5);
  }, { passive: false });
}

// --- Dark Mode ---
function doToggleDark() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle("dark", isDarkMode);
  savePrefs();
  if (currentRawContent) {
    renderPreview();
  }
}

// --- Sidebar ---
function initSidebar() {
  document.getElementById("sidebar-close").addEventListener("click", () => {
    toggleSidebar();
  });
  document.getElementById("sidebar-expand").addEventListener("click", () => {
    toggleSidebar();
  });
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebarOpen = !sidebarOpen;
  sidebar.classList.toggle("collapsed", !sidebarOpen);
  updateToolbarState();
  savePrefs();
}

function buildOutline() {
  const sidebarContent = document.getElementById("sidebar-content");
  sidebarContent.innerHTML = "";

  const contentEl = document.getElementById("markdown-content");
  const headings = contentEl.querySelectorAll("h1, h2, h3, h4, h5, h6");

  headings.forEach((heading, index) => {
    const level = parseInt(heading.tagName.charAt(1));
    const id = "outline-heading-" + index;
    heading.id = id;

    const item = document.createElement("div");
    item.className = "outline-item";
    item.dataset.level = level;
    item.dataset.targetId = id;
    item.textContent = heading.textContent;
    item.title = heading.textContent;

    item.addEventListener("click", () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      sidebarContent.querySelectorAll(".outline-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
    });

    sidebarContent.appendChild(item);
  });
}

function updateActiveOutlineItem() {
  const contentArea = document.getElementById("content-area");
  const sidebarContent = document.getElementById("sidebar-content");
  const items = sidebarContent.querySelectorAll(".outline-item");
  if (items.length === 0) return;

  const scrollTop = contentArea.scrollTop;
  let activeItem = items[0];

  items.forEach(item => {
    const target = document.getElementById(item.dataset.targetId);
    if (target && target.offsetTop <= scrollTop + 60) {
      activeItem = item;
    }
  });

  items.forEach(i => i.classList.remove("active"));
  if (activeItem) activeItem.classList.add("active");
}

// --- Window Title ---
async function updateWindowTitle(filename) {
  let title;
  if (filename) {
    const prefix = isDirty ? "\u25CF " : "";
    title = prefix + filename + " - MarkView";
  } else {
    title = "MarkView";
  }
  document.title = title;
  try {
    await getCurrentWindow().setTitle(title);
  } catch (e) {}
}

// --- View Modes ---
function setViewMode(mode) {
  const prevMode = currentViewMode;

  // Cancel any pending wysiwygToMarkdown timer to prevent stale Turndown
  // conversions from overwriting currentRawContent after a view switch.
  clearTimeout(wysiwygInputTimer);

  // Clean up any orphaned mermaid temp elements left in document.body
  // (mermaid v11 bug: temp elements survive render errors)
  document.querySelectorAll('body > [id^="d"][id*="mermaid"]').forEach(el => el.remove());

  // If leaving rendered view, populate textareas with current markdown.
  // Skip wysiwygToMarkdown() — the Turndown HTML-to-markdown roundtrip
  // can corrupt mermaid diagram source code and other fenced blocks.
  // Since this is a viewer, currentRawContent is authoritative.
  if (prevMode === "rendered" && mode !== "rendered") {
    document.getElementById("code-textarea").value = currentRawContent;
    document.getElementById("split-textarea").value = currentRawContent;
  }

  currentViewMode = mode;

  const renderedView = document.getElementById("rendered-view");
  const codeView = document.getElementById("code-view");
  const splitView = document.getElementById("split-view");

  renderedView.style.display = "none";
  codeView.style.display = "none";
  splitView.style.display = "none";

  if (mode === "rendered") {
    renderedView.style.display = "block";
    // Re-render from current markdown to get fresh HTML
    if (prevMode !== "rendered" && currentRawContent) {
      renderMarkdownToElement(currentRawContent, document.getElementById("markdown-content"));
    }
    enableWysiwyg();
  } else if (mode === "code") {
    disableWysiwyg();
    codeView.style.display = "flex";
  } else if (mode === "split") {
    disableWysiwyg();
    splitView.style.display = "flex";
    renderMarkdownToElement(currentRawContent, document.getElementById("split-markdown-content"));
  }

  updateToolbarState();
  savePrefs();
}

// Force all active code block editors to commit their content
function commitCodeBlockEditors() {
  const mdContent = document.getElementById("markdown-content");
  mdContent.querySelectorAll(".codeblock-wrapper.editing").forEach((wrapper) => {
    const editor = wrapper.querySelector(".codeblock-editor");
    const pre = wrapper.querySelector("pre");
    const codeEl = wrapper.querySelector("pre code");
    const langInput = wrapper.querySelector(".codeblock-lang-input");
    if (editor && codeEl) {
      const lang = langInput ? langInput.value.trim() : "";
      const text = editor.value;
      wrapper.dataset.lang = lang;
      if (lang && hljs.getLanguage(lang)) {
        codeEl.innerHTML = hljs.highlight(text, { language: lang }).value;
      } else if (text) {
        codeEl.innerHTML = hljs.highlightAuto(text).value;
      } else {
        codeEl.textContent = "";
      }
      codeEl.className = "hljs language-" + lang;
      wrapper.classList.remove("editing");
    }
  });
  // Also commit mermaid editors
  mdContent.querySelectorAll(".mermaid-wrapper.show-source").forEach((wrapper) => {
    // Leave them as-is, the Turndown rule reads from the textarea
  });
}

// --- Toolbar Active State ---
function updateToolbarState() {
  // View mode buttons
  document.querySelectorAll('.tb-btn[data-action="view-rendered"], .tb-btn[data-action="view-code"], .tb-btn[data-action="view-split"]').forEach((btn) => {
    btn.classList.remove("tb-active");
  });
  const viewAction = "view-" + currentViewMode;
  const activeViewBtn = document.querySelector(`.tb-btn[data-action="${viewAction}"]`);
  if (activeViewBtn) activeViewBtn.classList.add("tb-active");

  // Sidebar button
  const sidebarBtn = document.querySelector('.tb-btn[data-action="toggle-sidebar"]');
  if (sidebarBtn) sidebarBtn.classList.toggle("tb-active", sidebarOpen);

  // Format state (heading, bold, italic, etc.) — only meaningful in rendered view
  const formatActions = ["h1", "h2", "h3", "h4", "h5", "h6", "bold", "italic", "underline", "strikethrough"];
  formatActions.forEach((action) => {
    const btn = document.querySelector(`.tb-btn[data-action="${action}"]`);
    if (btn) btn.classList.remove("tb-active");
  });

  if (currentViewMode === "rendered") {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      let node = sel.anchorNode;
      // Walk up from cursor to find formatting context
      while (node && node !== document.getElementById("markdown-content")) {
        if (node.nodeType === 1) {
          const tag = node.nodeName;
          // Headings
          if (/^H[1-6]$/.test(tag)) {
            const level = tag.charAt(1);
            const hBtn = document.querySelector(`.tb-btn[data-action="h${level}"]`);
            if (hBtn) hBtn.classList.add("tb-active");
          }
          // Bold
          if (tag === "STRONG" || tag === "B") {
            const btn = document.querySelector('.tb-btn[data-action="bold"]');
            if (btn) btn.classList.add("tb-active");
          }
          // Italic
          if (tag === "EM" || tag === "I") {
            const btn = document.querySelector('.tb-btn[data-action="italic"]');
            if (btn) btn.classList.add("tb-active");
          }
          // Underline
          if (tag === "U") {
            const btn = document.querySelector('.tb-btn[data-action="underline"]');
            if (btn) btn.classList.add("tb-active");
          }
          // Strikethrough
          if (tag === "DEL" || tag === "S") {
            const btn = document.querySelector('.tb-btn[data-action="strikethrough"]');
            if (btn) btn.classList.add("tb-active");
          }
          // Inline code
          if (tag === "CODE" && node.parentNode.nodeName !== "PRE") {
            const btn = document.querySelector('.tb-btn[data-action="inline-code"]');
            if (btn) btn.classList.add("tb-active");
          }
        }
        node = node.parentNode;
      }
    }
  }
}

// Listen for selection changes to update toolbar state
document.addEventListener("selectionchange", () => {
  if (currentViewMode === "rendered") {
    updateToolbarState();
  }
});

// --- Get Active Textarea ---
function getActiveTextarea() {
  if (currentViewMode === "code") {
    return document.getElementById("code-textarea");
  } else if (currentViewMode === "split") {
    return document.getElementById("split-textarea");
  }
  return null;
}

// Ensure we're in an editing view
function ensureEditMode() {
  if (currentViewMode === "rendered") {
    // In WYSIWYG mode, return null (caller should use WYSIWYG commands)
    return null;
  }
  return getActiveTextarea();
}

// --- Format Commands ---
function doFormatWrap(marker) {
  // Handle WYSIWYG mode
  if (currentViewMode === "rendered") {
    const cmdMap = { "**": "bold", "*": "italic", "~~": "strikethrough", "`": null };
    const cmd = cmdMap[marker];
    if (cmd) {
      wysiwygExecCommand(cmd);
    } else if (marker === "`") {
      // Inline code: wrap selection in <code> tag
      const mdContent = document.getElementById("markdown-content");
      mdContent.focus();
      restoreSavedSelection();
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const code = document.createElement("code");
        try {
          range.surroundContents(code);
        } catch (e) {
          // If surroundContents fails (cross-element selection), use insertHTML
          const text = sel.toString();
          document.execCommand("insertHTML", false, "<code>" + escapeHtml(text) + "</code>");
        }
        clearTimeout(wysiwygInputTimer);
        wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
      }
    }
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.substring(start, end);
  const len = marker.length;

  // Check if already wrapped — unwrap
  if (start >= len && end + len <= val.length) {
    const before = val.substring(start - len, start);
    const after = val.substring(end, end + len);
    if (before === marker && after === marker) {
      ta.value = val.substring(0, start - len) + selected + val.substring(end + len);
      ta.selectionStart = start - len;
      ta.selectionEnd = end - len;
      onTextareaChange(ta);
      return;
    }
  }

  // Wrap
  const replacement = marker + selected + marker;
  ta.value = val.substring(0, start) + replacement + val.substring(end);
  ta.selectionStart = start + len;
  ta.selectionEnd = end + len;
  onTextareaChange(ta);
}

function doFormatTag(tag) {
  // Handle WYSIWYG mode
  if (currentViewMode === "rendered") {
    if (tag === "u") {
      wysiwygExecCommand("underline");
    }
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.substring(start, end);
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Check if already wrapped — unwrap
  if (start >= openTag.length && end + closeTag.length <= val.length) {
    const before = val.substring(start - openTag.length, start);
    const after = val.substring(end, end + closeTag.length);
    if (before === openTag && after === closeTag) {
      ta.value = val.substring(0, start - openTag.length) + selected + val.substring(end + closeTag.length);
      ta.selectionStart = start - openTag.length;
      ta.selectionEnd = end - openTag.length;
      onTextareaChange(ta);
      return;
    }
  }

  const replacement = openTag + selected + closeTag;
  ta.value = val.substring(0, start) + replacement + val.substring(end);
  ta.selectionStart = start + openTag.length;
  ta.selectionEnd = end + openTag.length;
  onTextareaChange(ta);
}

function doHyperlink() {
  if (currentViewMode === "rendered") {
    const url = prompt("Enter URL:");
    if (url) wysiwygExecCommand("createLink", url);
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const selected = val.substring(start, end);

  const replacement = `[${selected || "text"}](url)`;
  ta.value = val.substring(0, start) + replacement + val.substring(end);

  if (selected) {
    // Select "url"
    ta.selectionStart = start + selected.length + 3;
    ta.selectionEnd = start + selected.length + 6;
  } else {
    // Select "text"
    ta.selectionStart = start + 1;
    ta.selectionEnd = start + 5;
  }
  onTextareaChange(ta);
}

function doHeading(level) {
  if (currentViewMode === "rendered") {
    wysiwygExecCommand("formatBlock", "<h" + level + ">");
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const val = ta.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = val.indexOf("\n", start);
  const actualEnd = lineEnd === -1 ? val.length : lineEnd;
  const line = val.substring(lineStart, actualEnd);

  // Remove existing heading prefix
  const stripped = line.replace(/^#{1,6}\s*/, "");
  const prefix = "#".repeat(level) + " ";
  const newLine = prefix + stripped;

  ta.value = val.substring(0, lineStart) + newLine + val.substring(actualEnd);
  ta.selectionStart = ta.selectionEnd = lineStart + newLine.length;
  onTextareaChange(ta);
}

function doHeadingChange(delta) {
  if (currentViewMode === "rendered") {
    // Restore selection first, then find current heading level
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    restoreSavedSelection();
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      let node = sel.anchorNode;
      while (node && node !== document.getElementById("markdown-content")) {
        if (/^H[1-6]$/.test(node.nodeName)) {
          const cur = parseInt(node.nodeName.charAt(1));
          const newLevel = Math.max(1, Math.min(6, cur + delta));
          wysiwygExecCommand("formatBlock", "<h" + newLevel + ">");
          return;
        }
        node = node.parentNode;
      }
      // Not in a heading, make it H1 if increasing
      if (delta > 0) wysiwygExecCommand("formatBlock", "<h1>");
    }
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const val = ta.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = val.indexOf("\n", start);
  const actualEnd = lineEnd === -1 ? val.length : lineEnd;
  const line = val.substring(lineStart, actualEnd);

  const match = line.match(/^(#{0,6})\s*/);
  let currentLevel = match ? match[1].length : 0;
  let newLevel = Math.max(0, Math.min(6, currentLevel + delta));

  const stripped = line.replace(/^#{1,6}\s*/, "");
  const newLine = newLevel > 0 ? "#".repeat(newLevel) + " " + stripped : stripped;

  ta.value = val.substring(0, lineStart) + newLine + val.substring(actualEnd);
  ta.selectionStart = ta.selectionEnd = lineStart + newLine.length;
  onTextareaChange(ta);
}

function doList(type) {
  if (currentViewMode === "rendered") {
    wysiwygExecCommand(type === "ordered" ? "insertOrderedList" : "insertUnorderedList");
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = val.indexOf("\n", end);
  const actualEnd = lineEnd === -1 ? val.length : lineEnd;
  const selectedText = val.substring(lineStart, actualEnd);

  const lines = selectedText.split("\n");
  const newLines = lines.map((line, i) => {
    // Remove existing list prefix
    const stripped = line.replace(/^\s*(?:[-*+]|\d+\.)\s*/, "");
    if (type === "ordered") {
      return `${i + 1}. ${stripped}`;
    } else {
      return `- ${stripped}`;
    }
  });

  const newText = newLines.join("\n");
  ta.value = val.substring(0, lineStart) + newText + val.substring(actualEnd);
  ta.selectionStart = lineStart;
  ta.selectionEnd = lineStart + newText.length;
  onTextareaChange(ta);
}

function doInsertTable() {
  const template = "\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell 1 | Cell 2 | Cell 3 |\n| Cell 4 | Cell 5 | Cell 6 |\n";
  doInsertAtCursor(template);
}

function doInsertCodeBlock() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");

    // Build the code block wrapper via DOM
    const wrapper = document.createElement("div");
    wrapper.className = "codeblock-wrapper editing";
    wrapper.dataset.lang = "";
    wrapper.contentEditable = "false";
    wrapper.innerHTML = `<div class="codeblock-lang-bar"><input class="codeblock-lang-input" type="text" value="" placeholder="language" spellcheck="false"></div><pre><code class="hljs"></code></pre><textarea class="codeblock-editor" spellcheck="false"></textarea>`;

    // Create a paragraph after the block so user can keep typing below
    const afterPara = document.createElement("p");
    afterPara.innerHTML = "<br>";

    // Find insertion point: at cursor or append to end
    const sel = window.getSelection();
    restoreSavedSelection();
    let inserted = false;

    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Find the block-level parent to insert after
      let insertAfter = range.startContainer;
      while (insertAfter && insertAfter !== mdContent && insertAfter.parentNode !== mdContent) {
        insertAfter = insertAfter.parentNode;
      }
      if (insertAfter && insertAfter !== mdContent && insertAfter.parentNode === mdContent) {
        insertAfter.after(wrapper);
        wrapper.after(afterPara);
        inserted = true;
      }
    }

    if (!inserted) {
      mdContent.appendChild(wrapper);
      mdContent.appendChild(afterPara);
    }

    // Wire up events and focus the editor
    wireCodeBlock(wrapper);
    const editor = wrapper.querySelector(".codeblock-editor");
    if (editor) setTimeout(() => editor.focus(), 50);

    markDirty();
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 500);
    return;
  }
  doInsertAtCursor("\n```\ncode here\n```\n");
}

function doInsertMermaid() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    const defaultCode = "graph TD\n    A[Start] --> B[End]";
    const id = "mermaid-new-" + Date.now();

    // Build the mermaid wrapper via DOM
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-wrapper show-source";
    wrapper.dataset.mermaidId = id;
    wrapper.contentEditable = "false";
    wrapper.innerHTML = `<div class="mermaid-toolbar">
      <button class="mermaid-toggle-btn" title="Toggle code/diagram">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>
      </button>
      <button class="mermaid-copy-btn" data-mermaid-code="${escapeHtml(defaultCode)}" title="Copy code">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>
      <button class="mermaid-copy-png-btn" title="Copy diagram as PNG">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
      </button>
    </div>
    <div class="mermaid-diagram" id="${id}"></div>
    <div class="mermaid-source"><textarea class="mermaid-editor" spellcheck="false">${escapeHtml(defaultCode)}</textarea></div>`;

    // Paragraph after for continued editing
    const afterPara = document.createElement("p");
    afterPara.innerHTML = "<br>";

    // Find insertion point
    const sel = window.getSelection();
    restoreSavedSelection();
    let inserted = false;

    if (sel.rangeCount > 0) {
      let insertAfter = sel.getRangeAt(0).startContainer;
      while (insertAfter && insertAfter !== mdContent && insertAfter.parentNode !== mdContent) {
        insertAfter = insertAfter.parentNode;
      }
      if (insertAfter && insertAfter !== mdContent && insertAfter.parentNode === mdContent) {
        insertAfter.after(wrapper);
        wrapper.after(afterPara);
        inserted = true;
      }
    }

    if (!inserted) {
      mdContent.appendChild(wrapper);
      mdContent.appendChild(afterPara);
    }

    // Wire up toggle/copy/editor events
    wireMermaidBlock(wrapper);

    // Focus the editor
    const editor = wrapper.querySelector(".mermaid-editor");
    if (editor) setTimeout(() => editor.focus(), 50);

    markDirty();
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 500);
    return;
  }
  doInsertAtCursor("\n```mermaid\ngraph TD\n    A[Start] --> B[End]\n```\n");
}

function doInsertAtCursor(text) {
  if (currentViewMode === "rendered") {
    // In WYSIWYG mode: append as markdown to raw content, then re-render
    currentRawContent += text;
    document.getElementById("code-textarea").value = currentRawContent;
    document.getElementById("split-textarea").value = currentRawContent;
    renderMarkdownToElement(currentRawContent, document.getElementById("markdown-content"));
    enableWysiwyg();
    markDirty();
    buildOutline();
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const val = ta.value;
  ta.value = val.substring(0, start) + text + val.substring(start);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  onTextareaChange(ta);
}

function doClearFormat() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    restoreSavedSelection();
    document.execCommand("removeFormat", false, null);
    // Also remove block-level formatting (headings → paragraph)
    document.execCommand("formatBlock", false, "<p>");
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  let selected = val.substring(start, end);

  // Strip common format markers
  selected = selected.replace(/\*\*(.+?)\*\*/g, "$1");
  selected = selected.replace(/\*(.+?)\*/g, "$1");
  selected = selected.replace(/~~(.+?)~~/g, "$1");
  selected = selected.replace(/`(.+?)`/g, "$1");
  selected = selected.replace(/<u>(.+?)<\/u>/g, "$1");

  ta.value = val.substring(0, start) + selected + val.substring(end);
  ta.selectionStart = start;
  ta.selectionEnd = start + selected.length;
  onTextareaChange(ta);
}

// --- Clipboard ---
function doUndo() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    document.execCommand("undo");
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    return;
  }
  const ta = getActiveTextarea();
  if (ta) { ta.focus(); document.execCommand("undo"); }
}

function doRedo() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    document.execCommand("redo");
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    return;
  }
  const ta = getActiveTextarea();
  if (ta) { ta.focus(); document.execCommand("redo"); }
}

function doCut() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    restoreSavedSelection();
    document.execCommand("cut");
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    return;
  }
  const ta = getActiveTextarea();
  if (ta) { ta.focus(); document.execCommand("cut"); }
}

function doCopy() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    const contentArea = document.getElementById("content-area");
    const scrollTop = contentArea.scrollTop;
    mdContent.focus();
    restoreSavedSelection();
    document.execCommand("copy");
    contentArea.scrollTop = scrollTop;
    return;
  }
  const ta = getActiveTextarea();
  if (ta) { ta.focus(); document.execCommand("copy"); }
}

async function doPaste() {
  if (currentViewMode === "rendered") {
    const mdContent = document.getElementById("markdown-content");
    mdContent.focus();
    restoreSavedSelection();
    try {
      const text = await navigator.clipboard.readText();
      document.execCommand("insertText", false, text);
    } catch (e) {
      document.execCommand("paste");
    }
    clearTimeout(wysiwygInputTimer);
    wysiwygInputTimer = setTimeout(() => wysiwygToMarkdown(), 300);
    return;
  }
  const ta = getActiveTextarea();
  if (!ta) return;
  ta.focus();
  try {
    const text = await navigator.clipboard.readText();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    onTextareaChange(ta);
  } catch (e) {
    document.execCommand("paste");
  }
}

function onTextareaChange(ta) {
  currentRawContent = ta.value;
  syncTextareas(ta);
  markDirty();
  debouncedRenderPreview();
  updateCursorPosition(ta);
}

// --- Context Menu ---
function initContextMenu() {
  const ctxMenu = document.getElementById("context-menu");

  // Use delegation on content-area to catch all editable surfaces
  document.getElementById("content-area").addEventListener("contextmenu", (e) => {
    // Only show custom context menu on editable surfaces
    const target = e.target;
    const isTextarea = target.id === "code-textarea" || target.id === "split-textarea";
    const isRenderedEditable = currentViewMode === "rendered" && document.getElementById("markdown-content").contentEditable === "true";
    const isInsideRendered = isRenderedEditable && (target.id === "markdown-content" || document.getElementById("markdown-content").contains(target));

    if (isTextarea || isInsideRendered) {
      showContextMenu(e);
    }
  });

  // Prevent context menu from stealing focus/selection
  ctxMenu.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  // Context menu entries — use delegation on the menu itself
  ctxMenu.addEventListener("click", (e) => {
    e.preventDefault();
    const entry = e.target.closest(".ctx-entry[data-action]");
    if (entry) {
      e.stopPropagation();
      handleAction(entry.dataset.action);
      hideContextMenu();
    }
  });

  document.addEventListener("click", hideContextMenu);
}

function showContextMenu(e) {
  e.preventDefault();
  e.stopPropagation();

  // Save the current selection before focus moves to the menu
  const sel = window.getSelection();
  if (sel.rangeCount > 0) {
    savedSelection = sel.getRangeAt(0).cloneRange();
  }

  const ctxMenu = document.getElementById("context-menu");
  ctxMenu.style.display = "block";

  // Position
  let x = e.clientX;
  let y = e.clientY;
  const rect = ctxMenu.getBoundingClientRect();
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Show first to measure
  ctxMenu.style.left = x + "px";
  ctxMenu.style.top = y + "px";

  // Adjust if off-screen
  const menuRect = ctxMenu.getBoundingClientRect();
  if (x + menuRect.width > w) x = w - menuRect.width - 4;
  if (y + menuRect.height > h) y = h - menuRect.height - 4;

  ctxMenu.style.left = x + "px";
  ctxMenu.style.top = y + "px";
}

function hideContextMenu() {
  document.getElementById("context-menu").style.display = "none";
}

// --- Find & Replace ---
let frMatches = [];
let frCurrentIndex = -1;

function initFindReplace() {
  const findInput = document.getElementById("fr-find-input");
  const replaceInput = document.getElementById("fr-replace-input");

  findInput.addEventListener("input", doFind);
  document.getElementById("fr-prev").addEventListener("click", () => frNavigate(-1));
  document.getElementById("fr-next").addEventListener("click", () => frNavigate(1));
  document.getElementById("fr-close").addEventListener("click", closeFindReplace);
  document.getElementById("fr-replace").addEventListener("click", doReplace);
  document.getElementById("fr-replace-all").addEventListener("click", doReplaceAll);

  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      frNavigate(1);
    }
  });
}

function toggleFindReplace() {
  const panel = document.getElementById("find-replace-panel");
  if (panel.style.display === "none") {
    panel.style.display = "block";
    document.getElementById("fr-find-input").focus();
  } else {
    closeFindReplace();
  }
}

function closeFindReplace() {
  document.getElementById("find-replace-panel").style.display = "none";
  frMatches = [];
  frCurrentIndex = -1;
  document.getElementById("fr-match-count").textContent = "0 of 0";
}

function doFind() {
  const query = document.getElementById("fr-find-input").value;
  const ta = getActiveTextarea();
  if (!ta || !query) {
    frMatches = [];
    frCurrentIndex = -1;
    document.getElementById("fr-match-count").textContent = "0 of 0";
    return;
  }

  const text = ta.value;
  frMatches = [];
  let idx = 0;
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();
  while (true) {
    const pos = lowerText.indexOf(lowerQuery, idx);
    if (pos === -1) break;
    frMatches.push(pos);
    idx = pos + 1;
  }

  frCurrentIndex = frMatches.length > 0 ? 0 : -1;
  updateFrDisplay();
  if (frCurrentIndex >= 0) selectFrMatch();
}

function frNavigate(dir) {
  if (frMatches.length === 0) return;
  frCurrentIndex = (frCurrentIndex + dir + frMatches.length) % frMatches.length;
  updateFrDisplay();
  selectFrMatch();
}

function updateFrDisplay() {
  const total = frMatches.length;
  const current = frCurrentIndex >= 0 ? frCurrentIndex + 1 : 0;
  document.getElementById("fr-match-count").textContent = `${current} of ${total}`;
}

function selectFrMatch() {
  const ta = getActiveTextarea();
  if (!ta || frCurrentIndex < 0) return;
  const query = document.getElementById("fr-find-input").value;
  const pos = frMatches[frCurrentIndex];
  ta.focus();
  ta.selectionStart = pos;
  ta.selectionEnd = pos + query.length;
  // Scroll into view: set scrollTop to approximate position
  const linesBefore = ta.value.substring(0, pos).split("\n").length;
  const lineHeight = 22; // approximate
  ta.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
}

function doReplace() {
  const ta = getActiveTextarea();
  if (!ta || frCurrentIndex < 0) return;
  const query = document.getElementById("fr-find-input").value;
  const replacement = document.getElementById("fr-replace-input").value;
  const pos = frMatches[frCurrentIndex];

  ta.value = ta.value.substring(0, pos) + replacement + ta.value.substring(pos + query.length);
  currentRawContent = ta.value;
  syncTextareas(ta);
  markDirty();
  debouncedRenderPreview();
  doFind(); // re-search
}

function doReplaceAll() {
  const ta = getActiveTextarea();
  if (!ta) return;
  const query = document.getElementById("fr-find-input").value;
  const replacement = document.getElementById("fr-replace-input").value;
  if (!query) return;

  // Case-insensitive replace all
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  ta.value = ta.value.replace(new RegExp(escaped, "gi"), replacement);
  currentRawContent = ta.value;
  syncTextareas(ta);
  markDirty();
  debouncedRenderPreview();
  doFind(); // re-search (should show 0 matches)
}

// --- Export HTML ---
async function doExportHTML() {
  if (!currentRawContent) return;

  const defaultName = (currentFilename || "untitled").replace(/\.md$/, ".html");

  const savePath = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "HTML", extensions: ["html"] }],
  });

  if (!savePath) return;

  const mdContent = document.getElementById("markdown-content");
  let cssText = "";
  try {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          cssText += rule.cssText + "\n";
        }
      } catch (e) {}
    }
  } catch (e) {}

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(defaultName)}</title>
<style>${cssText}
/* Override app-specific styles for standalone HTML */
html, body { height: auto; overflow: auto; }
#content-area { height: auto; overflow: visible; }
#menu-bar, #toolbar, #status-bar { display: none; }
</style>
</head>
<body${isDarkMode ? ' class="dark"' : ''}>
<div id="markdown-content" style="display:block; max-width:860px; margin:0 auto; padding:32px 48px;">
${mdContent.innerHTML}
</div>
<script>
document.querySelectorAll(".mermaid-toggle-btn").forEach(function(btn) {
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    var wrapper = btn.closest(".mermaid-wrapper");
    wrapper.classList.toggle("show-source");
  });
});
document.querySelectorAll(".mermaid-copy-btn").forEach(function(btn) {
  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    var wrapper = btn.closest(".mermaid-wrapper");
    var editor = wrapper.querySelector(".mermaid-editor");
    var code = editor ? editor.value : (btn.dataset.mermaidCode || "");
    navigator.clipboard.writeText(code);
  });
});
</script>
</body>
</html>`;

  try {
    await invoke("save_file", { path: savePath, content: html });
  } catch (e) {
    console.error("Export HTML error:", e);
  }
}

// --- Export PDF ---
function doExportPDF() {
  if (!currentRawContent) return;
  // Ensure rendered view is up to date
  renderMarkdownToElement(currentRawContent, document.getElementById("markdown-content"));
  window.print();
}

// --- SVG to PNG for DOCX ---
function svgToPngArrayBuffer(svgElement) {
  return new Promise((resolve, reject) => {
    const clone = svgElement.cloneNode(true);
    const bbox = svgElement.getBoundingClientRect();
    const width = Math.ceil(bbox.width) || 600;
    const height = Math.ceil(bbox.height) || 400;
    clone.setAttribute("width", width);
    clone.setAttribute("height", height);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const svgData = new XMLSerializer().serializeToString(clone);
    const dataUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (blob) {
          blob.arrayBuffer().then(resolve).catch(reject);
        } else {
          reject(new Error("Canvas toBlob returned null"));
        }
      }, "image/png");
    };
    img.onerror = () => reject(new Error("Failed to load SVG as image"));
    img.src = dataUri;
  });
}

// --- DOCX DOM-to-docx converter ---
// Matches the HTML rendering styles from style.css as closely as possible
const {
  Document: DocxDocument,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ExternalHyperlink,
  ImageRun,
  Table: DocxTable,
  TableRow: DocxTableRow,
  TableCell: DocxTableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  convertInchesToTwip,
  TabStopPosition,
  TabStopType,
} = docx;

// --- Style presets for DOCX export ---

// "markdown" style: matches the HTML/CSS rendering exactly
const DOCX_STYLE_MARKDOWN = {
  bodyFont: "Calibri",
  codeFont: "Consolas",
  headingFont: "Calibri",
  colors: {
    text: "1a1a1a",
    codeBg: "f5f5f5",
    border: "e0e0e0",
    blockquoteBorder: "d0d0d0",
    blockquoteText: "6a737d",
    link: "0366d6",
    tableStripe: "f6f8fa",
  },
  headings: {
    H1: { size: 48, color: "1a1a1a", bold: true, border: true },   // 24pt, bold, bottom border
    H2: { size: 36, color: "1a1a1a", bold: true, border: true },   // 18pt, bold, bottom border
    H3: { size: 28, color: "1a1a1a", bold: true },                 // 14pt, bold
    H4: { size: 24, color: "1a1a1a", bold: true },                 // 12pt, bold
    H5: { size: 22, color: "1a1a1a", bold: true },                 // 11pt, bold
    H6: { size: 20, color: "6a737d", bold: true },                 // 10pt, bold, gray
  },
  headingSpacing: (tag) => ({
    before: 360,
    after: (tag === "H1" || tag === "H2") ? 200 : 120,
  }),
  sizes: { body: 22, code: 20 },
  spacing: {
    paragraphAfter: 240, codeBlockLine: 276, codeBlockPad: 120,
    blockquotePad: 120, hrMargin: 360, listItemAfter: 60,
  },
  lineSpacing: 360, // ~1.6 line-height
};

// "word" style: matches Normal.dotm / Word built-in defaults
const DOCX_STYLE_WORD = {
  bodyFont: "Calibri",
  codeFont: "Consolas",
  headingFont: "Calibri Light",
  colors: {
    text: "1a1a1a",
    codeBg: "f5f5f5",
    border: "e0e0e0",
    blockquoteBorder: "d0d0d0",
    blockquoteText: "6a737d",
    link: "0366d6",
    tableStripe: "f6f8fa",
  },
  headings: {
    H1: { size: 32, color: "2F5496", bold: false },                // 16pt, accent blue
    H2: { size: 26, color: "2F5496", bold: false },                // 13pt, accent blue
    H3: { size: 24, color: "1F3763", bold: false },                // 12pt, darker blue
    H4: { size: 22, color: "2F5496", bold: false, italic: true },  // 11pt, italic
    H5: { size: 22, color: "2F5496", bold: false },                // 11pt
    H6: { size: 22, color: "1F3763", bold: false },                // 11pt, darker blue
  },
  headingSpacing: (tag) => ({
    before: tag === "H1" ? 240 : 40,
    after: 0,
  }),
  sizes: { body: 22, code: 20 },
  spacing: {
    paragraphAfter: 240, codeBlockLine: 276, codeBlockPad: 120,
    blockquotePad: 120, hrMargin: 360, listItemAfter: 60,
  },
  lineSpacing: 259, // Word default
};

function extractInlineRuns(node, inherited) {
  const runs = [];
  const style = inherited || {};
  const preset = style._preset || DOCX_STYLE_MARKDOWN;

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text) {
      const props = {
        text,
        bold: style.bold || false,
        italics: style.italics || false,
        strike: style.strike || false,
      };
      // Font: heading context > code > body default
      if (style.headingFont) {
        props.font = { name: style.headingFont };
        props.size = style.headingSize || preset.sizes.body;
        props.color = style.headingColor || preset.colors.text;
      } else if (style.code) {
        props.font = { name: preset.codeFont };
        props.size = preset.sizes.code;
        props.color = preset.colors.text;
        props.shading = { type: ShadingType.CLEAR, color: "auto", fill: preset.colors.codeBg };
      } else {
        props.font = { name: preset.bodyFont };
        props.size = preset.sizes.body;
        props.color = style.blockquoteText ? preset.colors.blockquoteText : preset.colors.text;
      }
      if (style.link) {
        props.color = preset.colors.link;
        props.underline = { type: "single" };
      }
      runs.push(style.link ? { linkRun: props, url: style.link } : new TextRun(props));
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return runs;

  const tag = node.tagName;
  const newStyle = { ...style };

  if (tag === "STRONG" || tag === "B") newStyle.bold = true;
  if (tag === "EM" || tag === "I") newStyle.italics = true;
  if (tag === "DEL" || tag === "S") newStyle.strike = true;
  if (tag === "CODE") newStyle.code = true;
  if (tag === "A") newStyle.link = node.getAttribute("href") || "";
  if (tag === "BR") {
    runs.push(new TextRun({ break: 1 }));
    return runs;
  }

  for (const child of node.childNodes) {
    runs.push(...extractInlineRuns(child, newStyle));
  }

  return runs;
}

function resolveInlineRuns(rawRuns, preset) {
  const p = preset || DOCX_STYLE_MARKDOWN;
  const resolved = [];
  for (const r of rawRuns) {
    if (r instanceof TextRun) {
      resolved.push(r);
    } else if (r.linkRun) {
      const { linkRun, url } = r;
      resolved.push(
        new ExternalHyperlink({
          children: [new TextRun({
            text: linkRun.text,
            bold: linkRun.bold,
            italics: linkRun.italics,
            strike: linkRun.strike,
            color: p.colors.link,
            underline: { type: "single" },
            font: linkRun.font,
            size: linkRun.size,
          })],
          link: url,
        })
      );
    }
  }
  return resolved;
}

function makeHeadingParagraph(tag, el, preset) {
  const h = preset.headings[tag] || preset.headings.H4;
  const rawRuns = extractInlineRuns(el, {
    _preset: preset,
    headingFont: preset.headingFont,
    headingSize: h.size,
    headingColor: h.color,
    bold: h.bold || false,
    italics: h.italic || false,
  });

  const level = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3,
                  H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6 }[tag] || HeadingLevel.HEADING_4;

  const spacing = preset.headingSpacing(tag);

  const para = {
    heading: level,
    children: resolveInlineRuns(rawRuns, preset),
    spacing,
  };

  // Bottom border for H1/H2 if the preset specifies it
  if (h.border) {
    para.border = { bottom: { style: BorderStyle.SINGLE, size: 1, color: preset.colors.border, space: 4 } };
  }

  return new Paragraph(para);
}

function convertElementToDocx(el, images, listLevel, preset) {
  const items = [];
  const tag = el.tagName;
  const sp = preset.spacing;
  const co = preset.colors;

  if (/^H[1-6]$/.test(tag)) {
    items.push(makeHeadingParagraph(tag, el, preset));

  } else if (tag === "P") {
    const imgEl = el.querySelector("img");
    if (imgEl && images.has(imgEl)) {
      const imgData = images.get(imgEl);
      items.push(new Paragraph({
        children: [new ImageRun({
          data: imgData.buffer,
          transformation: { width: imgData.width, height: imgData.height },
          type: "png",
        })],
        spacing: { after: sp.paragraphAfter },
      }));
    } else {
      const rawRuns = extractInlineRuns(el, { _preset: preset });
      items.push(new Paragraph({
        children: resolveInlineRuns(rawRuns, preset),
        spacing: { after: sp.paragraphAfter },
      }));
    }

  } else if (tag === "BLOCKQUOTE") {
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      const rawRuns = extractInlineRuns(child, { _preset: preset, blockquoteText: true });
      items.push(new Paragraph({
        children: resolveInlineRuns(rawRuns, preset),
        indent: { left: convertInchesToTwip(0.4) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: co.blockquoteBorder, space: 8 } },
        spacing: {
          before: i === 0 ? sp.blockquotePad : 0,
          after: i === el.children.length - 1 ? sp.blockquotePad : 60,
        },
      }));
    }
    if (el.children.length === 0 && el.textContent.trim()) {
      const rawRuns = extractInlineRuns(el, { _preset: preset, blockquoteText: true });
      items.push(new Paragraph({
        children: resolveInlineRuns(rawRuns, preset),
        indent: { left: convertInchesToTwip(0.4) },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: co.blockquoteBorder, space: 8 } },
        spacing: { before: sp.blockquotePad, after: sp.blockquotePad },
      }));
    }

  } else if (tag === "PRE") {
    const codeEl = el.querySelector("code");
    const text = codeEl ? codeEl.textContent : el.textContent;
    const lines = text.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    for (let i = 0; i < lines.length; i++) {
      items.push(new Paragraph({
        children: [new TextRun({
          text: lines[i] || " ",
          font: { name: preset.codeFont },
          size: preset.sizes.code,
          color: co.text,
        })],
        shading: { type: ShadingType.CLEAR, color: "auto", fill: co.codeBg },
        spacing: {
          before: i === 0 ? sp.codeBlockPad : 0,
          after: i === lines.length - 1 ? sp.codeBlockPad : 0,
          line: sp.codeBlockLine,
        },
        indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
      }));
    }
    items.push(new Paragraph({ spacing: { after: sp.paragraphAfter }, children: [] }));

  } else if (tag === "UL" || tag === "OL") {
    const lvl = listLevel || 0;
    for (const li of el.children) {
      if (li.tagName !== "LI") continue;
      const inlineRuns = [];
      for (const child of li.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === "UL" || child.tagName === "OL")) continue;
        inlineRuns.push(...extractInlineRuns(child, { _preset: preset }));
      }
      items.push(new Paragraph({
        children: resolveInlineRuns(inlineRuns, preset),
        bullet: tag === "UL" ? { level: lvl } : undefined,
        numbering: tag === "OL" ? { reference: "docx-ordered-list", level: lvl } : undefined,
        spacing: { after: sp.listItemAfter },
      }));
      for (const child of li.children) {
        if (child.tagName === "UL" || child.tagName === "OL") {
          items.push(...convertElementToDocx(child, images, lvl + 1, preset));
        }
      }
    }
    items.push(new Paragraph({ spacing: { after: sp.paragraphAfter - sp.listItemAfter }, children: [] }));

  } else if (tag === "TABLE") {
    const allRows = el.querySelectorAll("tr");
    const tableRows = [];
    let rowIndex = 0;
    for (const tr of allRows) {
      const cells = [];
      for (const td of tr.children) {
        if (td.tagName !== "TD" && td.tagName !== "TH") continue;
        const isHeader = td.tagName === "TH";
        const rawRuns = extractInlineRuns(td, { _preset: preset, bold: isHeader });
        const isEvenRow = !isHeader && rowIndex % 2 === 0;
        const shading = isHeader
          ? { type: ShadingType.CLEAR, color: "auto", fill: co.codeBg }
          : isEvenRow
            ? { type: ShadingType.CLEAR, color: "auto", fill: co.tableStripe }
            : undefined;
        cells.push(new DocxTableCell({
          children: [new Paragraph({
            children: resolveInlineRuns(rawRuns, preset),
            spacing: { before: 60, after: 60 },
          })],
          width: { size: 0, type: WidthType.AUTO },
          shading,
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: co.border },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: co.border },
            left: { style: BorderStyle.SINGLE, size: 1, color: co.border },
            right: { style: BorderStyle.SINGLE, size: 1, color: co.border },
          },
        }));
      }
      if (cells.length > 0) {
        tableRows.push(new DocxTableRow({ children: cells }));
        if (!tr.querySelector("th")) rowIndex++;
      }
    }
    if (tableRows.length > 0) {
      items.push(new DocxTable({
        rows: tableRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      items.push(new Paragraph({ spacing: { after: sp.paragraphAfter }, children: [] }));
    }

  } else if (tag === "HR") {
    items.push(new Paragraph({
      children: [],
      border: { top: { style: BorderStyle.SINGLE, size: 3, color: co.border } },
      spacing: { before: sp.hrMargin, after: sp.hrMargin },
    }));

  } else if (tag === "IMG") {
    if (images.has(el)) {
      const imgData = images.get(el);
      items.push(new Paragraph({
        children: [new ImageRun({
          data: imgData.buffer,
          transformation: { width: imgData.width, height: imgData.height },
          type: "png",
        })],
        spacing: { after: sp.paragraphAfter },
      }));
    } else {
      items.push(new Paragraph({
        children: [new TextRun({ text: "[Image]", italics: true, color: co.blockquoteText, size: preset.sizes.body })],
        spacing: { after: sp.paragraphAfter },
      }));
    }

  } else if (tag === "DIV" || tag === "SECTION" || tag === "ARTICLE") {
    for (const child of el.children) {
      items.push(...convertElementToDocx(child, images, listLevel, preset));
    }

  } else {
    const rawRuns = extractInlineRuns(el, { _preset: preset });
    if (rawRuns.length > 0) {
      items.push(new Paragraph({
        children: resolveInlineRuns(rawRuns, preset),
        spacing: { after: sp.paragraphAfter },
      }));
    }
  }

  return items;
}

async function fetchImageAsArrayBuffer(src) {
  try {
    const resp = await fetch(src);
    if (!resp.ok) return null;
    return await resp.arrayBuffer();
  } catch {
    return null;
  }
}

// --- Export DOCX ---
async function doExportDOCX(styleMode) {
  const preset = styleMode === "word" ? DOCX_STYLE_WORD : DOCX_STYLE_MARKDOWN;
  if (!currentRawContent) return;

  const defaultName = (currentFilename || "untitled").replace(/\.md$/, ".docx");

  const savePath = await saveDialog({
    defaultPath: defaultName,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });

  if (!savePath) return;

  const mdContent = document.getElementById("markdown-content");

  // Collect all images (including mermaid SVG→PNG) as ArrayBuffers
  const imageMap = new Map();

  // Convert mermaid SVGs to PNG
  const mermaidWrappers = mdContent.querySelectorAll(".mermaid-wrapper");
  for (const wrapper of mermaidWrappers) {
    const svgEl = wrapper.querySelector(".mermaid-diagram svg");
    if (svgEl) {
      try {
        const pngBuf = await svgToPngArrayBuffer(svgEl);
        const bbox = svgEl.getBoundingClientRect();
        const width = Math.min(Math.ceil(bbox.width) || 600, 600);
        const height = Math.min(Math.ceil(bbox.height) || 400, 400);
        // Store against a marker so we can reference it
        imageMap.set(wrapper, { buffer: pngBuf, width, height });
      } catch (e) {
        console.error("Mermaid SVG to PNG error:", e);
      }
    }
  }

  // Collect regular images
  const imgElements = mdContent.querySelectorAll("img");
  for (const imgEl of imgElements) {
    if (imageMap.has(imgEl)) continue;
    const src = imgEl.getAttribute("src");
    if (!src) continue;
    try {
      const buf = await fetchImageAsArrayBuffer(src);
      if (buf) {
        const naturalW = imgEl.naturalWidth || 400;
        const naturalH = imgEl.naturalHeight || 300;
        const maxW = 560;
        const scale = naturalW > maxW ? maxW / naturalW : 1;
        imageMap.set(imgEl, {
          buffer: buf,
          width: Math.round(naturalW * scale),
          height: Math.round(naturalH * scale),
        });
      }
    } catch (e) {
      console.error("Image fetch error:", e);
    }
  }

  // Build a temporary clone to convert mermaid wrappers for the walker
  const clone = mdContent.cloneNode(true);

  // Replace mermaid wrappers in clone with image placeholders that map to our imageMap
  const cloneMermaidWrappers = clone.querySelectorAll(".mermaid-wrapper");
  const origMermaidWrappers = mdContent.querySelectorAll(".mermaid-wrapper");
  for (let i = 0; i < cloneMermaidWrappers.length; i++) {
    const cloneWrapper = cloneMermaidWrappers[i];
    const origWrapper = origMermaidWrappers[i];
    if (imageMap.has(origWrapper)) {
      const imgData = imageMap.get(origWrapper);
      // Create a placeholder img to map in clone
      const placeholderImg = document.createElement("img");
      placeholderImg.setAttribute("data-mermaid-png", "true");
      imageMap.set(placeholderImg, imgData);

      // Also add the mermaid source code as a code block
      const sourceDiv = cloneWrapper.querySelector(".mermaid-source");
      const container = document.createElement("div");
      container.appendChild(placeholderImg);
      if (sourceDiv) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = sourceDiv.textContent;
        pre.appendChild(code);
        container.appendChild(pre);
      }
      cloneWrapper.replaceWith(container);
    } else {
      // No image, just export as code block
      const sourceDiv = cloneWrapper.querySelector(".mermaid-source");
      if (sourceDiv) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = sourceDiv.textContent;
        pre.appendChild(code);
        cloneWrapper.replaceWith(pre);
      } else {
        cloneWrapper.remove();
      }
    }
  }

  // Walk the clone DOM and build docx elements
  const docxChildren = [];
  for (const child of clone.children) {
    docxChildren.push(...convertElementToDocx(child, imageMap, 0, preset));
  }

  try {
    const doc = new DocxDocument({
      numbering: {
        config: [{
          reference: "docx-ordered-list",
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: "decimal",
            text: `%${i + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5 * (i + 1)), hanging: convertInchesToTwip(0.25) } } },
          })),
        }],
      },
      styles: {
        default: {
          document: {
            run: {
              font: { name: preset.bodyFont },
              size: preset.sizes.body,
              color: preset.colors.text,
            },
            paragraph: {
              spacing: { line: preset.lineSpacing },
            },
          },
          ...Object.fromEntries(["heading1","heading2","heading3","heading4","heading5","heading6"].map((key, i) => {
            const tag = `H${i + 1}`;
            const h = preset.headings[tag];
            const sp = preset.headingSpacing(tag);
            return [key, {
              run: {
                font: { name: preset.headingFont },
                size: h.size,
                color: h.color,
                bold: h.bold || false,
                italics: h.italic || false,
              },
              paragraph: { spacing: { before: sp.before, after: sp.after, line: preset.lineSpacing, lineRule: "auto" } },
            }];
          })),
        },
        characterStyles: [{
          id: "Hyperlink",
          name: "Hyperlink",
          run: { color: preset.colors.link, underline: { type: "single" } },
        }],
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.2),
              right: convertInchesToTwip(1.2),
            },
          },
        },
        children: docxChildren,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);
    await invoke("save_base64_file", { path: savePath, base64Data });
  } catch (e) {
    console.error("Export DOCX error:", e);
  }
}

// --- Helpers ---
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function convertFileSrc(path) {
  const normalized = path.replace(/\\/g, "/");
  return window.__TAURI__.core.convertFileSrc(normalized);
}
