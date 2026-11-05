#!/usr/bin/env node
// `npx slop-academy`: checks what the app needs, installs the speech engine on first run, starts
// the app on 127.0.0.1 and opens your browser. In a terminal it shows a live screen (the logo
// turning, the checklist, then your progress) for as long as the app runs.
//
//   slop-academy [--port 8795] [--no-open] [--about]
//   env: SLOP_DATA (default ~/.slop-academy), SLOP_MODEL (sonnet | haiku | opus), SLOP_STT_MODEL (base.en | small.en)

import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(`Slop Academy: talk through code you shipped with an interviewer who has read it.

  slop-academy [--port <n>] [--no-open]
  slop-academy --about      what this is, how it works, and where your data goes

Everything runs on this computer. The interviewer is your own Claude Code (\`claude\`), voices and
speech recognition run locally, and your profile and recaps stay in ~/.slop-academy (SLOP_DATA).`);
  process.exit(0);
}
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const wantPort = Number(flag("--port") ?? process.env.PORT ?? 8795);
const open = !args.includes("--no-open");

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`\n  Slop Academy needs Node 20 or newer; this is ${process.version}.\n  Get it at https://nodejs.org\n`);
  process.exit(1);
}

const ui = await import("../lib/ui.mjs");
const { command, DATA } = await import("../lib/paths.mjs");
const { run } = await import("../lib/run.mjs");
const runtime = await import("../lib/runtime.mjs");
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

const TIPS = [
  "Just talk: pause for a moment and your answer is sent",
  "Talk over the interviewer to cut in",
  "Three strong answers in a row start a combo: +5 XP each",
  "Space sends your answer now · T opens the transcript",
  "Hit your daily goal to keep your streak alive",
  "Your voice is transcribed on this computer and never uploaded",
];
const tip = (since) => ui.dim(`${ui.pen("›")} ${TIPS[Math.floor((Date.now() - since) / 4500) % TIPS.length]}`);

let lastCard = null;
process.on("SIGINT", () => {
  const was = ui.leaveStage();
  if (was) ui.printSummary(was, { data: DATA, card: lastCard });
  ui.showCursor();
  console.log(`\n  ${ui.dim(`Stopped. Your profile and recaps stay in ${ui.tilde(DATA)}`)}\n`);
  process.exit(0);
});

// First run (no profile yet) or --about: say what this is and where everything runs.
const firstRun = !(await readFile(join(DATA, "profile.json")).catch(() => null));
if (args.includes("--about")) {
  ui.staticBanner(version);
  ui.explainer(DATA);
  process.exit(0);
}

// In a terminal: the live screen. Anywhere else (piped, CI): the still logo and plain lines.
if (!ui.startStage({ version, firstRun })) {
  ui.staticBanner(version);
  if (firstRun) ui.explainer(DATA);
  else ui.note(`${ui.dim("How it works and where your data goes:")} slop-academy --about\n`);
  ui.note(`${ui.bold(ui.pen("▍"))}${ui.bold("Getting ready")}`);
}

try {
  await ui.step("Node", async () => process.version.slice(1));
  await ui.step("Claude Code", async () => {
    const r = await run("claude", ["--version"], { timeoutMs: 20_000 });
    if (r.code !== 0) throw new Error("not found");
    return `${r.stdout.trim().replace(/\s*\(Claude Code\)/, "")} ${ui.dim(`· interviewer model ${process.env.SLOP_MODEL ?? "sonnet"}`)}`;
  }).catch((e) => {
    ui.problem("Slop Academy's interviewer is your own Claude Code.", `Install it from ${ui.bold("https://claude.com/claude-code")}, run ${ui.bold("claude")} once to log in,\nthen run this again.`);
    throw e;
  });
  await ui.step("git", async () => {
    const r = await run("git", ["--version"], { timeoutMs: 10_000 });
    if (r.code !== 0) throw new Error("not found");
    return r.stdout.trim().replace(/^git version /, "");
  }).catch((e) => {
    ui.problem("Slop Academy reads your repo's history with git.", `Install it from ${ui.bold("https://git-scm.com")}, then run this again.`);
    throw e;
  });
  await ui.step("Speech engine", installEngine).catch((e) => {
    ui.problem("Couldn't install the speech engine.", `${e.message}\nCheck your internet connection and run this again.`);
    throw e;
  });
} catch {
  process.exit(1);
}

await mkdir(DATA, { recursive: true });
const url = (port) => `http://localhost:${port}/`;

// Already running? Just open it.
if (await isOurs(wantPort)) {
  ui.row("App").info(`already running at ${url(wantPort)}`);
  if (open) openBrowser(url(wantPort));
  const was = ui.leaveStage();
  if (was) ui.printSummary(was, { data: DATA });
  ui.note();
  process.exit(0);
}

const { startServer } = await import("../server.mjs");
const speech = await import("../lib/speech.mjs");
let port = wantPort;
await ui.step("App", async () => {
  for (;;) {
    try {
      await startServer(port);
      return ui.bold(url(port));
    } catch (error) {
      if (error.code !== "EADDRINUSE" || port > wantPort + 20) throw error;
      port++;
    }
  }
}).catch((error) => {
  ui.problem("Couldn't start the app.", error.message);
  process.exit(1);
});
await watchModels();
// Only now: a page opened earlier would meet a half-ready app.
if (open) openBrowser(url(port));

// Ready. In a terminal the logo keeps turning with your progress under it, refreshed as you practise.
const footer = ui.dim(`Your data ${ui.tilde(DATA)} · your voice stays on this computer · Ctrl+C to stop`);
if (!ui.stageRunning(async () => ({ card: (lastCard = await readyLines()), footer }))) {
  ui.note();
  ui.card(await readyLines());
  ui.note();
  ui.note(footer);
  ui.note();
}

/** The speech engine: already there, or installed now with a progress line (first run only). */
async function installEngine(r) {
  if (runtime.engineReady()) return `ready ${ui.dim("· transformers.js, Kokoro and Whisper")}`;
  const started = Date.now();
  // A rough size so the bar moves sensibly; Linux x64 carries onnxruntime's GPU libraries too.
  const expect = process.platform === "linux" && process.arch === "x64" ? 740e6 : 430e6;
  r.update(ui.dim("installing, first run only"));
  await runtime.installEngine((bytes) => {
    const secs = (Date.now() - started) / 1000;
    r.update(`${ui.bar(Math.min(0.99, bytes / expect))} ${ui.dim(`${ui.mb(bytes)} · ${ui.duration(secs)} · first run only`)}`);
    r.tip(tip(started));
  });
  return `installed in ${ui.duration((Date.now() - started) / 1000)} ${ui.dim(`· ${ui.tilde(runtime.RUNTIME)}`)}`;
}

/** The voice models: a progress bar with speed and time left while they download (first run only). */
async function watchModels() {
  const r = ui.row("Voice models", ui.dim("loading"));
  const started = Date.now();
  let rate = 0;
  let lastLoaded = 0;
  let lastAt = Date.now();
  for (;;) {
    const { tts, stt } = speech.status();
    const parts = [tts, stt];
    const failed = parts.find((p) => p.state === "error");
    if (failed) return r.fail(`${failed.error} ${ui.dim("· you can type your answers")}`);
    if (parts.every((p) => p.state === "ready")) {
      const size = parts.reduce((a, p) => a + (p.total ?? 0), 0);
      const fresh = parts.some((p) => p.downloaded) && size > 50e6; // small files are re-fetched every start
      return r.ok(`${fresh ? `downloaded ${ui.mb(size)} in ${ui.duration((Date.now() - started) / 1000)}, ` : ""}ready ${ui.dim("· Kokoro voice, Whisper ears, on this CPU")}`);
    }
    const loaded = parts.reduce((a, p) => a + (p.loaded ?? (p.state === "ready" ? p.total ?? 0 : 0)), 0);
    const total = parts.reduce((a, p) => a + (p.total ?? 0), 0);
    const downloading = parts.some((p) => p.state === "downloading");
    // Small config files arrive first; wait for the real weights before showing a percentage.
    if (downloading && total > 50e6) {
      const now = Date.now();
      if (now - lastAt >= 500) {
        const instant = ((loaded - lastLoaded) / (now - lastAt)) * 1000;
        rate = rate ? rate * 0.7 + instant * 0.3 : instant;
        lastLoaded = loaded;
        lastAt = now;
      }
      const eta = rate > 0 ? ui.duration((total - loaded) / rate) : "…";
      r.update(`${ui.bar(loaded / total)} ${ui.bold(`${String(Math.round((loaded / total) * 100)).padStart(3)}%`)}  ${ui.dim(`${ui.mb(loaded)} / ${ui.mb(total)} · ${rate ? `${(rate / 1e6).toFixed(1)} MB/s · ${eta} left` : "starting"}`)}`);
      r.tip(tip(started));
    } else {
      r.update(ui.dim(downloading ? "downloading, first run only" : "loading"));
    }
    await new Promise((res) => setTimeout(res, 100));
  }
}

/** Where to go, and where you stand: streak, XP, level, today's goal. Read fresh each time. */
async function readyLines() {
  const where = open ? `Opened ${ui.bold(url(port))} in your browser` : `Open ${ui.bold(url(port))} in your browser`;
  let profile = null;
  try { profile = JSON.parse(await readFile(join(DATA, "profile.json"), "utf8")); } catch { /* first run */ }
  const lines = [`${ui.pass("●")} ${where}`, ""];
  if (profile) {
    const { summary } = await import("../lib/progress.mjs");
    const p = summary(profile);
    const streak = p.streak.count
      ? ui.flameColor(ui.bold(`${p.streak.count}-day streak`))
      : ui.dim("no streak yet");
    lines.push(`${streak}   ${ui.gold(ui.bold(`${p.xp} XP`))}   ${ui.dim(`level ${p.level.n}`)} ${p.level.title}`);
    lines.push(`${ui.dim("Today")}  ${ui.bar(p.today.xp / p.today.goal, 18)} ${p.today.xp}/${p.today.goal} XP`);
    lines.push(ui.dim(p.streak.doneToday
      ? p.today.xp >= p.today.goal ? "Daily goal met. Anything more is bonus XP" : "Streak safe for today. Finish your daily goal?"
      : p.streak.count ? `One conversation today keeps your ${p.streak.count}-day streak alive` : "One conversation today starts your streak"));
  } else {
    lines.push("First time here: pick a project in the browser and");
    lines.push("your first conversation starts your streak.");
  }
  return lines;
}

async function isOurs(p) {
  try {
    const res = await fetch(`http://localhost:${p}/api/hello`, { signal: AbortSignal.timeout(800) });
    return (await res.json()).app === "slop-academy";
  } catch {
    return false;
  }
}

function openBrowser(target) {
  const [cmd, ...rest] = process.platform === "darwin" ? ["open", target]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", target]
      : ["xdg-open", target];
  const child = spawn(command(cmd)[0], rest, { stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", () => {});
  child.unref();
}
