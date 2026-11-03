// Where Slop Academy keeps things, and how it finds the programs it shells out to.

import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/** Your profile, briefs, recaps, voice cache and models. Override with SLOP_DATA. */
export const DATA = path.resolve(process.env.SLOP_DATA ?? path.join(homedir(), ".slop-academy"));

/** "~/code/x" and "~\code\x" to an absolute path. */
export const expandHome = (p) => p.replace(/^~(?=$|[\\/])/, homedir());

const resolved = new Map();

/**
 * The command and leading args that run `name`. On Windows a CLI installed with npm is a .cmd shim,
 * which spawn() can't start without a shell (and a shell would mangle our JSON arguments), so for
 * `claude` we run its JavaScript entry point with this Node instead.
 */
export function command(name) {
  if (process.platform !== "win32") return [name];
  if (resolved.has(name)) return resolved.get(name);
  let found = [name];
  try {
    const hits = execFileSync("where", [name], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
    const exe = hits.find((h) => h.toLowerCase().endsWith(".exe"));
    const cmd = hits.find((h) => h.toLowerCase().endsWith(".cmd"));
    if (exe) found = [exe];
    else if (cmd && name === "claude") {
      const cli = path.join(path.dirname(cmd), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
      if (existsSync(cli)) found = [process.execPath, cli];
    }
  } catch { /* not installed: spawn will report it */ }
  resolved.set(name, found);
  return found;
}
