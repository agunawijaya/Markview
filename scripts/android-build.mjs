// Builds the Android APK and copies it to the project root as Markview.apk.
//
// Plain `tauri android build` works on macOS/Linux and on Windows with
// Developer Mode on. Without Developer Mode, Windows refuses the symlink the
// Tauri CLI makes from each compiled Rust library into gen/android's jniLibs/,
// and the build dies after compiling. In that case this script lets the CLI
// compile each target anyway (it sets up the NDK toolchain and generates the
// Kotlin glue), copies the .so files into jniLibs/ itself, and runs Gradle
// with its own Rust build tasks skipped.
//
// Usage: node scripts/android-build.mjs [--debug] [--target aarch64 armv7 x86_64]

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(root, "src-tauri");
const androidDir = join(tauriDir, "gen", "android");

const TARGETS = {
  aarch64: { triple: "aarch64-linux-android", abi: "arm64-v8a", arch: "arm64" },
  armv7: { triple: "armv7-linux-androideabi", abi: "armeabi-v7a", arch: "arm" },
  i686: { triple: "i686-linux-android", abi: "x86", arch: "x86" },
  x86_64: { triple: "x86_64-linux-android", abi: "x86_64", arch: "x86_64" },
};

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const targetFlag = args.indexOf("--target");
const targets = targetFlag >= 0
  ? args.slice(targetFlag + 1).filter((a) => !a.startsWith("--"))
  : ["aarch64", "armv7", "x86_64"];
for (const t of targets) {
  if (!TARGETS[t]) fail(`Unknown target "${t}". Use: ${Object.keys(TARGETS).join(", ")}`);
}
const profile = debug ? "debug" : "release";
const Profile = debug ? "Debug" : "Release";

function fail(msg) {
  console.error(`\n[android-build] ${msg}`);
  process.exit(1);
}

// Run a command, streaming its output, and resolve with { code, output }.
function run(cmd, cmdArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd, shell: true });
    let output = "";
    child.stdout.on("data", (d) => { output += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { output += d; process.stderr.write(d); });
    child.on("close", (code) => resolve({ code, output }));
  });
}

const tauriBuild = (ts) =>
  run("npx", ["tauri", "android", "build", "--apk", "--ci", "--target", ...ts, ...(debug ? ["--debug"] : [])], root);
const symlinkRefused = (output) => /symbolic link/i.test(output);

const first = await tauriBuild(targets);
if (first.code !== 0) {
  if (!symlinkRefused(first.output)) fail("tauri android build failed (see above).");

  console.log("\n[android-build] Windows refused the jniLibs symlink (Developer Mode is off) — copying libraries instead.\n");
  for (const t of targets) {
    const { triple, abi } = TARGETS[t];
    // The CLI only reaches the symlink step after a successful compile.
    const res = await tauriBuild([t]);
    if (res.code !== 0 && !symlinkRefused(res.output)) fail(`Rust build for ${t} failed (see above).`);

    const lib = join(tauriDir, "target", triple, profile, "libapp_lib.so");
    if (!existsSync(lib)) fail(`Expected ${lib} after building ${t}.`);
    const destDir = join(androidDir, "app", "src", "main", "jniLibs", abi);
    const dest = join(destDir, "libapp_lib.so");
    mkdirSync(destDir, { recursive: true });
    // Drop a symlink left by an earlier Developer Mode build rather than writing through it.
    try { if (lstatSync(dest)) unlinkSync(dest); } catch {}
    copyFileSync(lib, dest);
    console.log(`[android-build] ${t}: copied ${lib} -> ${dest}`);
  }

  // Absolute path: cmd.exe may be told not to search the current directory.
  const gradlew = `"${join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")}"`;
  const gradle = await run(gradlew, [
    `assembleUniversal${Profile}`,
    "-x", `rustBuildUniversal${Profile}`,
    `-PabiList=${targets.map((t) => TARGETS[t].abi).join(",")}`,
    `-ParchList=${targets.map((t) => TARGETS[t].arch).join(",")}`,
    `-PtargetList=${targets.join(",")}`,
  ], androidDir);
  if (gradle.code !== 0) fail("Gradle build failed (see above).");
}

const apkDir = join(androidDir, "app", "build", "outputs", "apk", "universal", profile);
const apk = [`app-universal-${profile}.apk`, `app-universal-${profile}-unsigned.apk`]
  .map((name) => join(apkDir, name))
  .find(existsSync);
if (!apk) fail(`No APK found in ${apkDir}.`);

const out = join(root, debug ? "Markview-debug.apk" : "Markview.apk");
copyFileSync(apk, out);
const { version } = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
console.log(`\n[android-build] Markview ${version} (${targets.join(", ")}, ${profile}) -> ${out}`);
if (apk.endsWith("-unsigned.apk")) {
  console.log("[android-build] NOTE: unsigned — add src-tauri/gen/android/keystore.properties to sign release builds.");
}
