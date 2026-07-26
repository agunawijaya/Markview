#!/usr/bin/env node
// Copies the portable Tauri build output to the project root as MarkView.exe
// so it can be shared or downloaded as a single self-contained executable.
//
// Runs automatically after `npm run build` (see package.json).

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");

const sourceCandidates = [
  join(projectRoot, "src-tauri", "target", "release", "markview.exe"),
  join(projectRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "markview.exe"),
];

const source = sourceCandidates.find((p) => existsSync(p));

if (!source) {
  console.error("[copy-portable] Could not find a built markview.exe. Looked in:");
  for (const p of sourceCandidates) console.error("  - " + p);
  process.exit(1);
}

const destination = join(projectRoot, "MarkView.exe");

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);

const sizeMb = (statSync(destination).size / (1024 * 1024)).toFixed(2);
console.log(`[copy-portable] MarkView.exe copied to project root (${sizeMb} MB).`);
console.log(`[copy-portable] Source:      ${source}`);
console.log(`[copy-portable] Destination: ${destination}`);
