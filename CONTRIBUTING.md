# Contributing to Markview

Thanks for your interest in improving Markview! This document explains how
to set up a development environment, the code conventions we follow, and
what a good pull request looks like.

Please also read the [Code of Conduct](CODE_OF_CONDUCT.md) — it applies to
all interactions in issues, pull requests, and discussions.

---

## 1. Before you open a PR

Please **open an issue first** for any change that is not a small bug fix or
typo. A short conversation up front saves time on both sides and ensures the
change aligns with the project's [product spec](PRODUCT_SPEC.md).

Changes that are explicitly out of scope will be closed — see
[PRODUCT_SPEC.md § 7](PRODUCT_SPEC.md#7-what-we-deliberately-do-not-build).
If you disagree with a non-goal, open a discussion, not a PR.

---

## 2. Development environment

### Prerequisites

- **Rust** stable (`rustc >= 1.77.2`) — install via [rustup](https://www.rust-lang.org/tools/install)
- **Node.js** 18+ — for the Tauri CLI and JS deps
- **Visual Studio Build Tools** with the "Desktop development with C++" workload
- **WebView2 Runtime** — preinstalled on Windows 11; install manually on
  Windows 10 from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/)

### First-time setup

```powershell
git clone https://github.com/agunawijaya/markview.git
cd markview
npm install
```

### Common commands

```powershell
npm run dev          # dev mode with hot reload for the Rust side
npm run build        # release build + copies Markview.exe to project root
npm run build:tauri  # release build only (skip the portable copy step)
```

The release build produces:

- **NSIS installer** — `src-tauri/target/release/bundle/nsis/Markview_*.exe`
- **Portable exe** — `src-tauri/target/release/markview.exe`, also copied to
  `Markview.exe` at the project root by `scripts/copy-portable.mjs`.

The root `Markview.exe` is gitignored — it exists so you can hand-share the
current build without hunting through `target/`.

---

## 3. Project layout

```
markview/
├── src/                    Frontend — HTML/CSS/JS, no framework
│   ├── index.html          single-page shell
│   ├── style.css           theme + layout + dark palette + print CSS
│   ├── main.js             all frontend behavior
│   └── lib/                bundled 3rd-party libs (marked, hljs, mermaid, turndown, docx)
├── src-tauri/              Rust backend
│   ├── src/lib.rs          Tauri commands + file watcher + preferences
│   ├── src/main.rs         thin entry
│   ├── tauri.conf.json     bundle + window config
│   └── Cargo.toml
├── scripts/copy-portable.mjs   post-build helper (copies exe to root)
├── ARCHITECTURE.md         how the app is built
├── PRODUCT_SPEC.md         what the app does
├── CHANGELOG.md            release history
└── README.md
```

For a full walkthrough of the architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 4. Coding conventions

### JavaScript (`src/main.js`)

- **No framework, no build step.** Do not introduce React, Vue, Svelte,
  bundlers, transpilers, or TypeScript. Libraries are `<script>`-loaded
  from `src/lib/` and attached to `window`.
- **No CDN references.** Anything the frontend needs at runtime ships in
  `src/lib/`.
- Prefer plain functions organized by concern (see the logical modules in
  [ARCHITECTURE.md § 4.1](ARCHITECTURE.md#41-logical-modules-inside-mainjs)).
- Debounce anything that fires on every keystroke.

### CSS (`src/style.css`)

- Theme variables (`--bg`, `--text`, `--accent`, etc.) are the interface —
  reference them instead of hard-coded colors so dark mode works.
- Print CSS lives in the same file under `@media print`.

### Rust (`src-tauri/src/lib.rs`)

- Keep the Rust side thin: file I/O, file watching, preferences, base64.
  Rendering, editing, and export logic belong in the frontend.
- Every Tauri command must return `Result<T, String>` (or `Option<T>` for
  optional lookups). Never `panic!` inside a command — surface the error.
- `cargo fmt` before committing.

### Commit messages

- Present tense, imperative mood: **"Add DOCX table striping"**, not
  "Added DOCX table striping".
- One logical change per commit. Squash noise before pushing.
- Reference issues with `#123` in the body when relevant.

---

## 5. Testing your change

Markview does not currently ship with an automated test suite (the surface
is largely UI). Please **manually verify** the following before opening a PR:

- [ ] `npm run dev` launches without console errors.
- [ ] The specific feature you touched still works in **all three view modes**
      (Rendered, Code, Split).
- [ ] Dark mode still looks right (`Ctrl+Shift+D`).
- [ ] File watcher does not loop after Save (edit → save → confirm no re-render flash).
- [ ] For toolbar / menu changes: overflow chevron still collapses groups
      correctly when you narrow the window.
- [ ] For export changes: exercise HTML, PDF, and _both_ DOCX modes.
- [ ] `npm run build` completes and the portable `Markview.exe` at the project
      root launches and opens a `.md` file.

If you add a new preference or persisted setting, verify it survives a
close-and-reopen.

---

## 6. Pull request checklist

Before requesting review:

- [ ] Branch is up to date with `main`.
- [ ] Code follows the conventions in § 4.
- [ ] `cargo fmt` was run on any Rust changes.
- [ ] Manual test checklist in § 5 passes for the areas you touched.
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]` describing the change.
- [ ] Screenshots or a short screen recording are attached for UI changes.
- [ ] The PR description explains _why_ the change is needed, not just what
      it does.

---

## 7. Reporting bugs / suggesting features

Use the GitHub issue templates:

- **Bug report** — include reproduction steps, the `.md` snippet that
  triggers the issue (if reasonable), and your Windows version.
- **Feature request** — describe the user problem before the proposed
  solution. Ideas without a concrete user pain rarely land.

Security issues follow a different flow — see [SECURITY.md](SECURITY.md).

---

## 8. License

By contributing you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers the project.
