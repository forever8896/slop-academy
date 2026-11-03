// The speech engine (transformers.js + kokoro-js + onnxruntime, ~400-740 MB depending on the
// platform) is not a dependency of the npm package. `npx slop-academy` would otherwise sit on a
// silent npm spinner for minutes, printing other packages' deprecation warnings. Instead the
// package is tiny and the launcher installs the engine itself, once, into ~/.slop-academy/runtime,
// while its own screen shows progress. Later versions of the app reuse it.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DATA, command } from "./paths.mjs";

export const RUNTIME = process.env.SLOP_RUNTIME ?? path.join(DATA, "runtime");
export const ENGINE = { "@huggingface/transformers": "3.8.1", "kokoro-js": "1.2.1" };

/** Where a package of the engine resolves from: this checkout's own node_modules, else the runtime. */
export function resolveEngine(name) {
  for (const base of [import.meta.url, path.join(RUNTIME, "package.json")]) {
    try { return createRequire(base).resolve(name); } catch { /* try the next place */ }
  }
  return null;
}

/** True when every engine package resolves at the version we pin. */
export function engineReady() {
  return Object.entries(ENGINE).every(([name, version]) => {
    const entry = resolveEngine(name);
    if (!entry) return false;
    let dir = path.dirname(entry);
    while (dir !== path.dirname(dir) && !existsSync(path.join(dir, "package.json"))) dir = path.dirname(dir);
    try { return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version === version; } catch { return false; }
  });
}

/** npm, the one that ran us when we were started by npx or npm, so it works on every platform. */
function npm() {
  const cli = process.env.npm_execpath;
  if (cli && /npm-cli\.js$/.test(cli)) return [process.execPath, cli];
  if (cli && /npx-cli\.js$/.test(cli)) {
    const sibling = path.join(path.dirname(cli), "npm-cli.js");
    if (existsSync(sibling)) return [process.execPath, sibling];
  }
  return command("npm");
}

async function folderSize(dir) {
  let total = 0;
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) total += (await stat(full).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(dir);
  return total;
}

/**
 * Installs the engine into RUNTIME. onProgress gets the bytes on disk so far, about twice a second.
 * Resolves when done; rejects with npm's own last words if it fails.
 */
export function installEngine(onProgress) {
  mkdirSync(RUNTIME, { recursive: true });
  writeFileSync(path.join(RUNTIME, "package.json"), `${JSON.stringify({ name: "slop-academy-runtime", private: true, description: "Speech engine for Slop Academy. Safe to delete; it reinstalls on the next start.", dependencies: ENGINE }, null, 2)}\n`);
  const [bin, ...pre] = npm();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...pre, "install", "--no-audit", "--no-fund", "--loglevel=error", "--omit=dev"], { cwd: RUNTIME, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const nm = path.join(RUNTIME, "node_modules");
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      onProgress?.(await folderSize(nm));
      busy = false;
    }, 500);
    child.on("error", (e) => { clearInterval(timer); reject(new Error(`couldn't run npm: ${e.message}`)); });
    child.on("close", (code) => {
      clearInterval(timer);
      if (code === 0 && engineReady()) resolve();
      else reject(new Error(log.trim().split("\n").filter((l) => !/deprecated/i.test(l)).slice(-3).join(" ") || `npm exited with ${code}`));
    });
  });
}
