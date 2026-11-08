# Changelog

All notable changes to **Markview** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- **Android build (phones & tablets, Android 7.0+).** Same frontend and Rust
  commands, packaged as an APK by `npm run android:build`
  (`scripts/android-build.mjs`, which also works on Windows without
  Developer Mode). The Android Studio project in `src-tauri/gen/android/` is
  now tracked.
  - Documents open **read-only in Rendered View** so tapping while reading
    doesn't pop up the keyboard; the toolbar pencil / View → Edit Mode turns
    WYSIWYG editing on. New documents start in Edit Mode.
  - **Pinch to zoom** reflows the text (same zoom as `Ctrl+wheel`) and keeps
    the reading position.
  - Touch-sized menu bar, toolbar and status bar; submenus expand inline on
    tap; dropdowns stay on screen.
  - Phones: outline becomes an overlay drawer opened from a status-bar
    button; split view stacks preview above source; reading-width buttons
    and zoom slider are hidden (`−` / `+` stay).
  - Very narrow screens (foldable cover screens, ~320–419 dp): menu labels
    and toolbar buttons scale down so all six menus and the File group + `»`
    still fit; the toolbar re-measures when a foldable is folded/unfolded.
  - Wide tables scroll on their own and long words/URLs wrap, so the page
    never pans sideways.
  - **Open with Markview** from file managers, Drive, mail and chat apps
    (`.md`/`.markdown`, including files sent as `application/octet-stream`).
  - Files are Android `content://` URIs: `read_file` / `save_file` /
    `save_base64_file` handle them via `tauri-plugin-fs`; Save falls back to
    Save As when the grant is read-only. Picked documents keep a persistable
    grant and the last one reopens after Android kills the app.
  - **Export → PDF** goes through the Android print dialog (*Save as PDF*);
    HTML and DOCX save through the system file picker.
  - Back closes dialogs, menus, find panel and the outline drawer first,
    then sends the app to the background (with the unsaved-changes prompt).
  - Dark mode follows the system theme on first launch; status and
    navigation bars follow the app theme. Content is padded clear of system
    bars, display cutouts and the on-screen keyboard (Android 15
    edge-to-edge).
  - Kotlin bridge `MarkviewBridgePlugin.kt` + `src-tauri/src/android.rs` for
    the document picker, "Open with" intents, display names, printing,
    system-bar colors and Back-to-background.

- **LaTeX math** via bundled KaTeX (`lib/katex/`, incl. `.woff2` fonts —
  no CDN, works offline). Inline `$…$` and block `$$…$$` are tokenized
  before `marked`'s default inline rules so `_` and `*` inside math are
  preserved. Malformed math renders as a red inline error rather than
  crashing the render pass.
- **DOCX math export as native OMML.** KaTeX's MathML output is translated
  to `<m:oMath>` (with `<m:sSup>`, `<m:f>`, `<m:rad>`, `<m:nary>`, …) and
  inserted via `docx`'s `ImportedXmlComponent`, so Word renders the
  equation with its own math engine, not as an image or literal text.
  Falls back to shaded LaTeX source if the transform produces nothing
  usable.
- **HTML export inlines KaTeX CSS with fonts as base64 data URIs**, so
  exported files render math offline in any browser.
- Turndown round-trip preserves original LaTeX (via `data-latex-src`) so
  WYSIWYG edits never mangle `$…$` blocks.
- Headless test scripts for math (`scripts/math-roundtrip-test.mjs` and
  `scripts/math-docx-test.mjs`).
- Screenshots section in `README.md` (rendered light + dark, split, code).
- `design-assets/showcase.md` — reference document used to capture the
  screenshots.
- `scripts/screenshot.ps1` — PowerShell utility that launches Markview with
  a given `.md`, positions the window, and captures a PNG. Supports
  `-SendKeys` to switch view modes or toggle dark mode before capture.

### Fixed

- Menu bar: after picking a menu entry, the menu state is now fully reset,
  so merely hovering another menu label no longer pops a menu open (and a
  tap no longer opens-then-closes a menu on touch screens).

---

## [0.2.0] - 2026-07-26

The "not just a viewer anymore" release. Markview graduates from a read-only
renderer to a full Markdown editor while staying a single portable `.exe`.

### Distribution

- Portable-build convenience: `npm run build` now copies the compiled
  `markview.exe` to the project root as `Markview.exe` via
  `scripts/copy-portable.mjs`.
- Release workflow uploads the renamed portable `.exe`
  (`Markview-vX.Y.Z-portable.exe`) alongside the NSIS installer on tagged
  releases.
- Version numbers reconciled — `Cargo.toml`, `tauri.conf.json`, and the
  About modal now all report `0.2.0`.
- Project documentation set: `ARCHITECTURE.md`, `PRODUCT_SPEC.md`,
  `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  plus GitHub issue and pull-request templates.

### Added

- **Editing surfaces in all three view modes:**
  - Rendered view is now `contentEditable` — WYSIWYG edits round-trip back
    to Markdown via Turndown (300 ms debounce).
  - Code view is a plain Markdown textarea with toggling format markers
    (`**bold**`, `*italic*`, `~~strike~~`, `` `code` ``).
  - Split view combines a read-only preview with a synchronized textarea.
- **Top toolbar** (Word-style ribbon) with five groups — File, Edit,
  Structure, Format, View — and a `»` overflow chevron that collapses
  entire groups rightmost-first when the window narrows.
- **File save & save-as** with dirty tracking (`●` title prefix), unsaved-
  changes guard on New / Open / Quit / drag-and-drop.
- **Find & Replace** panel (`Ctrl+H`) with case-insensitive substring
  matching, N of M counter, prev / next, and Escape to close.
- **DOCX export in two style variants** using the `docx` library:
  - _Markdown Style_ keeps HTML-rendering typography (bordered H1/H2).
  - _Word Style_ uses Calibri Light headings, accent-blue H1/H2, italic H4.
  - Both support tables, nested lists (9 levels), blockquotes, code blocks,
    inline images, mermaid (SVG → PNG + fenced source), and hyperlinks.
- **Right-click context menu** on editable surfaces (formatting, headings,
  insert submenu, cut / copy / paste).
- **New Window** menu action — opens an independent Tauri window sharing
  the same backend state.
- **CLI argument opening** — `Markview.exe file.md` opens the file on launch.
- **Reading Width presets** in the status bar: Optimal (65ch), Fit to Width,
  Default (860 px). Persisted per user.
- **Zoom controls** (50–300 %) in the status bar: slider, `−` / `+`,
  editable percentage, `Ctrl+=`/`Ctrl+-`/`Ctrl+0`, `Ctrl+MouseWheel`.
- **Preference persistence** for dark mode, sidebar state, and view mode
  (stored in `app_local_data_dir` via Rust) plus zoom and reading width
  (in `localStorage`).

### Changed

- Menu bar expanded from three menus to six: File, Edit, Paragraph, Format,
  View, Help.
- Sidebar toggle rebound to **`Ctrl+\` (backslash)** so `Ctrl+B` can be Bold.
- HTML export now inlines every stylesheet and bundles the mermaid runtime,
  so exported pages stay interactive offline.
- Print CSS scoped to `#rendered-view` only — menu, toolbar, sidebar, and
  status bar are hidden during PDF export.

### Fixed

- File watcher no longer causes a re-render loop after Save — the frontend
  now skips `file-changed` events whose content already matches
  `currentRawContent`.
- Switching from Rendered → Code / Split flushes any in-progress fenced-block
  editors before populating textareas, so fenced blocks are no longer
  corrupted by a Turndown round-trip.

### Known gaps

- Rust exposes `get_last_file` but the frontend never calls it — last-file
  restore is not wired up.
- `lib/html-docx.js` is bundled but unused (superseded by `lib/docx.umd.js`).

---

## [0.1.0]

Initial release. Read-only Markdown viewer.

### Added

- Tauri 2 shell with a vanilla HTML/CSS/JS frontend (no framework).
- Single portable `.exe` build via `cargo tauri build` (NSIS bundle target).
- Markdown rendering via `marked` (GFM on) with `highlight.js` syntax
  highlighting and locally bundled `mermaid` 11.x diagrams.
- File → Open dialog filtered to `.md`, drag-and-drop `.md` support.
- File watcher via the Rust `notify` crate — external edits re-render
  silently.
- Document outline sidebar (H1–H6) with click-to-scroll and active-heading
  highlighting.
- Three view modes: Rendered, Code (read-only textarea), Split.
- Exports to HTML and PDF (via `window.print()`).
- Dark mode with `Ctrl+Shift+D` toggle and Mermaid theme swap.

---

[Unreleased]: https://github.com/agunawijaya/markview/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/agunawijaya/markview/releases/tag/v0.2.0
[0.1.0]: https://github.com/agunawijaya/markview/releases/tag/v0.1.0
