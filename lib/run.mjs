// Runs a program and collects its output, with a hard timeout. The interviewer (your claude CLI) and git go through here.

import { spawn } from "node:child_process";
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
