# MarkView

A read-only, portable Markdown viewer for Windows 11. Open a `.md` file, read it
beautifully rendered, and export it to HTML, PDF, or DOCX. No editing, no
settings windows, no clutter — just a fast viewer that fits in a single `.exe`.

Built with [Tauri 2](https://tauri.app/) (Rust + system webview) and a vanilla
HTML/CSS/JavaScript frontend.

## Features

- **Drag-and-drop or File → Open** to load any `.md` file
- **Live reload** — edit the file in any editor; the viewer re-renders silently
- **Document outline sidebar** with click-to-scroll and active-heading highlight
- **Three view modes**: Rendered (`Ctrl+1`), Code (`Ctrl+2`), Split (`Ctrl+3`)
- **Mermaid diagrams** rendered as SVG; click to toggle to raw code
- **Syntax-highlighted** fenced code blocks (highlight.js)
- **Export** to HTML (self-contained), PDF (print dialog), or DOCX (`html-docx-js`)
- **Reading width** presets — Optimal (65ch), Fit to Width, Default (860px)
- **Zoom** 50–300% via slider, percentage input, `Ctrl+=`/`Ctrl+-`/`Ctrl+0`, or `Ctrl+MouseWheel`
- **Dark mode** with persistence (`Ctrl+Shift+D`)
- **Remembers** last opened file, sidebar state, view mode, zoom, and reading width across launches

## Build from source (Windows)

Prerequisites:

- [Rust](https://www.rust-lang.org/tools/install) (stable, `rustc >= 1.77.2`)
- [Node.js](https://nodejs.org/) 18+ (for the Tauri CLI and bundled JS deps)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the C++ workload
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11)

Then:

```powershell
git clone https://github.com/agunawijaya/markview.git
cd markview
npm install
npx tauri dev      # run in dev mode
npx tauri build    # produce portable .exe in src-tauri/target/release/
```

The portable installer (NSIS) lands in `src-tauri/target/release/bundle/nsis/`.

## Project layout

```
markview/
├── src/                    Frontend (HTML/CSS/JS), bundled libs in src/lib/
├── src-tauri/              Rust backend
│   ├── src/                Tauri commands: file read, watch, save dialog
│   ├── icons/              Desktop + Android + iOS icon sets
│   ├── capabilities/       Tauri 2 permission manifest
│   ├── tauri.conf.json
│   └── Cargo.toml
└── README.md
```

## Roadmap: Linux and Android ports

The Tauri 2 stack was chosen specifically because the same Rust + HTML/CSS/JS
codebase can target Linux desktops and Android with minimal changes. The
following sections list what is required for each port.

### Linux desktop

Tauri 2 supports Linux out of the box via the system WebKitGTK webview. Required
on a Linux dev machine:

- `webkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `build-essential`, `curl`, `wget`, `file`
- Rust toolchain (same as Windows)
- Node.js 18+

Build with:

```bash
npx tauri build
```

`tauri.conf.json > bundle.targets` will need `"deb"`, `"appimage"`, and/or
`"rpm"` added alongside the current `"nsis"`. The existing app code, menu, file
dialog, and watcher API are already cross-platform — no frontend changes
expected. Print-to-PDF via `window.print()` works on Linux WebKitGTK as well.

### Android

Tauri 2 has first-class mobile support. The `src-tauri/icons/android/` folder
is already populated.

Required on the dev machine (one-time setup):

- Android Studio (for the SDK + Platform Tools)
- Android NDK (installed via Android Studio SDK Manager)
- JDK 17
- Environment variables: `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`
- Rust targets: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`

Initialize and build:

```bash
npx tauri android init
npx tauri android dev          # run on connected device or emulator
npx tauri android build        # produce signed APK / AAB
```

Mobile considerations to plan for (these will need code changes when the port
starts — not before):

| Area | Desktop today | Mobile change required |
|---|---|---|
| File open | Tauri file dialog | Android Storage Access Framework picker |
| Drag-and-drop | Window-level event | Not applicable; rely on file picker / intent filters |
| File watcher (`notify` crate) | OS-level fs events | Android scoped storage limits this; may need polling fallback |
| Menu bar | Native menu | Hamburger / bottom sheet UI |
| `window.print()` for PDF | Print dialog | Android `PrintManager` integration |
| Keyboard shortcuts | Full set | Touch gestures + reduced set |
| Status bar zoom controls | Slider + input | Pinch-to-zoom replaces the slider |

The current `src-tauri/capabilities/default.json` permission set will also need
a mobile-specific capability file.

### iOS

Not currently planned, but the same Tauri mobile pipeline (`npx tauri ios init`
/ `build`) applies. Requires a Mac with Xcode. The `src-tauri/icons/ios/`
assets are already in place.

## Releases

Tagged commits (`v*.*.*`) trigger the GitHub Actions workflow in
`.github/workflows/release.yml`, which builds the portable Windows `.exe` and
attaches it to the release. Linux and Android builds will be added to the
matrix when those ports are ready.

## License

MIT. See [LICENSE](LICENSE).
