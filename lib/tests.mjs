// Runs a repo's own node:test file against a candidate version of one module,
// in a scratch directory, so lessons and the generator's validator can ask
// "do your tests still pass if the code looked like this?"

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { command } from "./paths.mjs";

export function run(cmd, args, { input, timeoutMs, cwd, env } = {}) {
  return new Promise((resolve) => {
    const [bin, ...pre] = command(cmd);
    const child = spawn(bin, [...pre, ...args], { cwd, env: env ? { ...process.env, ...env } : undefined, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.on("error", (error) => resolve({ code: -1, signal: null, stdout: "", stderr: `${cmd}: ${error.message}` }));
    child.stdin.on("error", () => {});
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}

/** Reads `key: value` or a `key:` followed by a YAML list from a TAP diagnostic block. */
function yamlValue(block, key) {
  const index = block.findIndex((line) => line.trim().startsWith(`${key}:`));
  if (index < 0) return undefined;
  const inline = block[index].trim().slice(key.length + 1).trim();
  if (inline) return inline;
  // node prints arrays as `0: 'a'` (or `- a`) lines indented under the key.
  const indent = block[index].search(/\S/);
  const items = [];
  for (const line of block.slice(index + 1)) {
    const item = /^(\s+)(?:- |\d+: )(.+)$/.exec(line);
    if (!item || item[1].length <= indent) break;
    items.push(item[2].replace(/^'|'$/g, ""));
  }
  return `[${items.join(", ")}]`;
}

/** Parses node:test's TAP into [{ name, ok, detail }]. */
function parseTap(tap) {
  const results = [];
  const lines = tap.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /^(not ok|ok) \d+ - (.+)$/.exec(lines[i]);
    if (!match) continue;
    const ok = match[1] === "ok";
    let detail = "";
    if (!ok) {
      const block = [];
      for (let j = i + 1; j < lines.length && !/^(not ok|ok) \d+ /.test(lines[j]) && !/^# /.test(lines[j]); j++) {
        block.push(lines[j]);
      }
      const text = block.join("\n");
      const expected = yamlValue(block, "expected");
      const actual = yamlValue(block, "actual");
      const error = /error: \|?-?\s*\n?\s*(.+)/.exec(text)?.[1] ?? /error: '(.+)'/.exec(text)?.[1];
      detail = expected !== undefined ? `expected ${expected}, got ${actual}` : (error ?? "failed").replace(/^'|'$/g, "");
    }
    results.push({ name: match[2], ok, detail });
  }
  return results;
}

/** The specifier the test file uses to import `sourcePath`, e.g. "../src/lib/foo.ts". */
export function findTestImport(testSource, sourcePath) {
  const base = path.basename(sourcePath);
  const specifiers = [...testSource.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  return specifiers.find((s) => path.basename(s) === base) ?? null;
}

/**
 * @param repo {{ sourcePath: string, testPath: string, testImport: string }}
 * @param code the candidate contents of sourcePath
 * @param only optional test-name pattern
 */
export async function runTests(repo, code, only) {
  const dir = await mkdtemp(path.join(tmpdir(), "slop-run-"));
  try {
    const moduleName = path.basename(repo.sourcePath);
    await writeFile(path.join(dir, moduleName), code);
    const testSource = (await readFile(repo.testPath, "utf8")).replace(repo.testImport, `./${moduleName}`);
    await writeFile(path.join(dir, "lesson.test.mjs"), testSource);
    const args = ["--test", "--test-reporter=tap"];
    if (only) args.push(`--test-name-pattern=${only}`);
    args.push("lesson.test.mjs");
    const result = await run(process.execPath, args, { cwd: dir, timeoutMs: 20_000 });
    let tests = parseTap(result.stdout);
    // A module that fails to load shows up as one failed "test" named after the
    // file, with the real error only in TAP comments. Report it as a compile error.
    let compileError = null;
    if (tests.length <= 1 && !tests[0]?.ok) {
      const comments = result.stdout.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2));
      const errorLine = comments.find((l) => /^\w*Error\b/.test(l));
      const where = comments.find((l) => l.includes(moduleName))?.match(/:(\d+)$/)?.[1];
      if (errorLine || tests.length === 0) {
        compileError = `${errorLine ?? "tests did not run"}${where ? ` (near line ${where})` : ""}`
          .replace(/ \[ERR_[A-Z_]+\]/, "");
        tests = [];
      }
    }
    return { tests, passed: tests.filter((t) => t.ok).length, total: tests.length, compileError, timedOut: result.signal === "SIGKILL" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
