# Security Policy

We take security of MarkView seriously. This document explains which
versions receive security updates and how to report a vulnerability
responsibly.

---

## Supported versions

MarkView is a young project. We support security fixes for the **latest
released minor version only**.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | ✅ Supported       |
| 0.1.x   | ❌ End of life     |

If you are running an unsupported version, please upgrade before reporting.

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately using **one** of the following channels:

1. **GitHub Security Advisories (preferred).** Open a private advisory at:
   [github.com/agunawijaya/markview/security/advisories/new](https://github.com/agunawijaya/markview/security/advisories/new)

2. **Email.** Send a report to **agunawijaya@gmail.com** with the subject
   line `MarkView security report`.

Please include, if possible:

- A clear description of the issue and its impact.
- Steps to reproduce (a minimal `.md` file that triggers the issue, if
  applicable).
- The MarkView version and Windows build you tested on.
- Any suggested mitigation.

---

## What to expect

- **Acknowledgement** within **72 hours** of receiving your report.
- **Initial assessment** within **7 days**, including a severity rating.
- **Fix + coordinated disclosure** timeline agreed with the reporter,
  typically **≤ 90 days** for medium/high severity issues.

We will credit you in the release notes for the fix (or keep you anonymous
if you prefer).

---

## Scope

In scope:

- Local privilege escalation via the MarkView binary or its bundled
  libraries.
- Arbitrary file read / write / execution triggered by opening a crafted
  `.md` file or dropping a crafted file onto the window.
- Cross-site scripting (XSS) inside the WebView triggered by rendered
  Markdown content (e.g., escaping the sandbox via `mermaid` or fenced
  code blocks).
- Vulnerabilities in the Rust `notify` watcher, Tauri commands, or
  preference persistence layer.

Out of scope (please do not report these):

- Attacks that require the user to already have local write access to the
  MarkView data directory.
- Denial of service from opening enormous (`> 100 MB`) Markdown files —
  this is expected behavior.
- Issues in Windows itself, WebView2, or the user's system browser.
- Social-engineering attacks that convince a user to run an unrelated
  malicious executable.

---

## Known security properties

MarkView is designed to be **network-silent** at runtime:

- No telemetry.
- No analytics.
- No auto-update pings.
- No CDN references — every dependency ships bundled in `src/lib/`.

The only network calls MarkView _can_ make are triggered by explicit user
action (clicking an external `http(s)` link opens the system browser via
`shell.open`).

The Tauri CSP is:

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src  'self' 'unsafe-inline';
img-src    'self' asset: https: http: data:;
font-src   'self' data:;
```

The `unsafe-inline` / `unsafe-eval` allowances are required by the bundled
Mermaid and DOCX runtimes; we are open to PRs that eliminate them.

---

## Thanks

Thank you for helping keep MarkView and its users safe.
