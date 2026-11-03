// The terminal side of `slop-academy`: banner, checklist, download bar, the ready card. No dependencies.
// Falls back to plain lines when output isn't a terminal, and drops color for NO_COLOR.

import { homedir } from "node:os";
import * as logo from "./spin3d.mjs";

const out = process.stdout;
export const live = Boolean(out.isTTY) && process.env.TERM !== "dumb" && !process.env.CI;
const color = live && !("NO_COLOR" in process.env);
const truecolor = color && (/truecolor|24bit/i.test(process.env.COLORTERM ?? "") || process.platform === "win32" || process.env.TERM_PROGRAM === "iTerm.app");

const rgb = (r, g, b, n256) => (s) => (!color ? s : truecolor ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : `\x1b[38;5;${n256}m${s}\x1b[39m`);
// The app's red pen, a little brighter so it reads on dark terminals too.
export const pen = rgb(224, 83, 58, 167);
export const pass = rgb(34, 197, 94, 41);
export const gold = rgb(232, 170, 60, 179);
export const flameColor = rgb(240, 110, 44, 202);
const paper = rgb(239, 233, 222, 255);
const sgr = (on, off) => (s) => (color ? `\x1b[${on}m${s}\x1b[${off}m` : s);
export const bold = sgr(1, 22);
export const dim = sgr(2, 22);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const tilde = (p) => (p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p);
/** Printed width: without color codes. Everything we print is single-width. */
const width = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

// ---------------------------------------------------------------- the logo

/** One frame of the 3D logo as printable lines (colour where the terminal has it). */
function logoLines(t, cols, rows) {
  return logo.frame(t, cols, rows).map((cells) => {
    let line = "";
    let last = "";
    for (const c of cells) {
      if (!c) { line += " "; continue; }
      const [ch, [r, g, b]] = c;
      if (!color) { line += ch; continue; }
      // Quantised so neighbouring cells share one colour code: far less output per frame.
      const code = truecolor ? `\x1b[38;2;${r & ~7};${g & ~7};${b & ~7}m` : `\x1b[38;5;${r > g * 1.6 ? 167 : g > 150 ? 223 : 180}m`;
      if (code !== last) { line += code; last = code; }
      line += ch;
    }
    return `${line.trimEnd()}${color ? "\x1b[39m" : ""}`;
  });
}

const center = (s, cols) => `${" ".repeat(Math.max(0, Math.floor((cols - width(s)) / 2)))}${s}`;
const wordmark = (version) => `${bold(paper("a c a d e m y"))}   ${dim(`talk through the code you shipped · v${version}`)}`;

/** The still logo: printed once, for --about, for output that isn't a terminal, and after the live screen. */
export function staticBanner(version) {
  const cols = Math.min(out.columns ?? 80, 80);
  out.write("\n");
  if (cols < 44) {
    out.write(`  ${pen("◯")} ${bold("Slop Academy")}  ${dim(`v${version}`)}\n\n`);
    return;
  }
  const { cols: w, rows } = logo.fit(cols - 4, 18);
  for (const l of logoLines(0.12, w, rows)) out.write(`  ${l}\n`);
  out.write(`\n${center(wordmark(version), w + 4)}\n\n`);
}

// ---------------------------------------------------------------- the live install screen
//
// While the checks run and the voice models load, the terminal shows a small screen of its own:
// the logo turning at the top, the checklist under it. It uses the terminal's alternate screen, so
// nothing you had on screen is lost, and when it's done a still summary is printed in its place.

let stage = null;

// What we found researching this (the same findings, numbers and sources as the landing page),
// shown one at a time while things get ready: the number big, the sentence typing itself out.
const FACTS = [
  ["58%", "of developers who write about their own skills now name AI as the cause, and most describe dependence or fading skills. In early 2025 it was 31%.", "Our analysis of 736 developer posts, Jan 2025 to Oct 2026"],
  ["20%", "of 31,000 developers say AI has made them less confident in their own problem-solving.", "Stack Overflow Developer Survey 2025"],
  ["17 pts", "lower quiz scores for developers who learned a library with an AI assistant. Handing the work off scored 24 to 39%; using the AI to understand the code scored 65 to 86%. Same tool, different habit.", "Anthropic randomized study, January 2026"],
  ["17→2%", "of interview reports mention a take-home, early 2025 against late 2026. Interviewers say why: a model can finish one.", "Our analysis of 1,078 interview reports"],
  ["41%", "of what interviewers say separates candidates is explaining: reasoning out loud, trade-offs, depth on your own projects. LeetCode prep is 6%.", "Our analysis of 706 interviewer statements"],
  ["46%", "of the interview failures candidates could have prevented came from freezing or not being able to explain their reasoning. Not from what they didn't know.", "Our analysis of 360 reports that give a reason"],
];
const FACT_MS = 8000;

function wrap(text, w) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + word.length + 1 > w) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** The current finding as lines: big number, sentence typing out, source, and which one of six. */
function factLines(since, cols) {
  const elapsed = Date.now() - since;
  const n = Math.floor(elapsed / FACT_MS) % FACTS.length;
  const into = elapsed % FACT_MS;
  const [num, text, source] = FACTS[n];
  const shown = text.slice(0, Math.floor(into / 18)); // about 55 characters a second
  const w = Math.max(30, Math.min(72, cols - 16));
  const body = wrap(text, w).map((full, i, all) => {
    const before = all.slice(0, i).reduce((a, l) => a + l.length + 1, 0);
    return full.slice(0, Math.max(0, shown.length - before));
  });
  const dots = FACTS.map((_, i) => (i === n ? pen("●") : dim("·"))).join(" ");
  const numCol = (s) => `${s}${" ".repeat(Math.max(0, 8 - width(s)))}`;
  return [
    `  ${bold(pen("▍"))}${bold("Why this exists")}   ${dots}`,
    "",
    ...body.map((l, i) => `  ${numCol(i === 0 ? bold(gold(num)) : "")}${l}`),
    `  ${numCol("")}${shown.length >= text.length ? dim(source) : ""}`,
  ];
}

export function startStage({ version, firstRun }) {
  if (!live) return null;
  stage = { version, firstRun, tasks: [], t0: performance.now(), since: Date.now(), timer: null, card: null, footer: "" };
  out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  process.stdout.on("resize", () => out.write("\x1b[2J"));
  const draw = () => {
    if (!stage) return;
    const cols = out.columns ?? 80;
    const rowsAvail = out.rows ?? 30;
    const below = [center(wordmark(version), cols), ""];
    const intro = [
      `  ${bold(pen("▍"))}${bold("What you're installing")}`,
      `    ${dim("A practice interviewer for code you've shipped. It asks about your own files")}`,
      `    ${dim("out loud and scores how well you can explain them. Your voice stays here.")}`,
      "",
      ...flow(FLOW).map((l) => `    ${l}`),
      "",
    ];
    let body;
    if (stage.card) {
      // Running: everything checked collapses into one line, and the card is the point.
      const summary = stage.tasks.map((t) => t.short()).join(dim("  ·  "));
      body = [`  ${summary}`, "", ...boxLines(stage.card, cols), "", ...factLines(stage.since, cols), "", `  ${stage.footer}`];
    } else {
      body = [];
      for (const task of stage.tasks) {
        body.push(task.render());
        if (task.open && task.sub) body.push(`${" ".repeat(LABEL + 5)}${task.sub}`);
      }
      body.push("", ...factLines(stage.since, cols));
    }
    // The explainer stays on a first run when there's room for it next to a decent-sized logo.
    if (firstRun && rowsAvail - below.length - body.length - intro.length >= 14) below.push(...intro);
    below.push(...body);
    const room = rowsAvail - below.length - 2;
    const lines = [""];
    if (cols >= 44 && room >= 6) {
      const { cols: w, rows } = logo.fit(Math.min(cols - 2, 96), room);
      const pad = " ".repeat(Math.max(0, Math.floor((cols - w) / 2)));
      for (const l of logoLines((performance.now() - stage.t0) / 1000, w, rows)) lines.push(`${pad}${l}`);
    }
    lines.push(...below);
    out.write(`\x1b[H${lines.slice(0, rowsAvail).map((l) => `${l}\x1b[K`).join("\n")}\x1b[J`);
  };
  stage.draw = draw;
  stage.timer = setInterval(draw, 33);
  draw();
  return stage;
}

/**
 * Setup is done: keep the logo turning for as long as the app runs, with the card under it.
 * update() is called every few seconds to refresh the card (XP and streak move while you practise).
 */
export function stageRunning(update) {
  if (!stage) return false;
  const refresh = async () => {
    if (!stage) return;
    const { card: lines, footer } = await update();
    stage.card = lines;
    stage.footer = footer;
  };
  refresh();
  stage.refresher = setInterval(refresh, 3000);
  // A little slower once there's nothing to wait for: smooth, and lighter on the terminal.
  clearInterval(stage.timer);
  stage.timer = setInterval(stage.draw, 42);
  return true;
}

/** Leave the live screen at once (an error, Ctrl+C). Returns what it showed, for the summary. */
export function leaveStage() {
  if (!stage) return null;
  const was = stage;
  clearInterval(stage.timer);
  clearInterval(stage.refresher);
  out.write("\x1b[?1049l\x1b[?25h");
  stage = null;
  return was;
}

/** After the live screen: a still record of it in the scrollback. */
export function printSummary(was, { data, card: lines }) {
  staticBanner(was.version);
  if (was.firstRun) explainer(data);
  note(`${bold(pen("▍"))}${bold("Getting ready")}`);
  for (const task of was.tasks) out.write(`${task.render()}\n`);
  if (lines) { note(); card(lines); }
}

// ---------------------------------------------------------------- the checklist

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const LABEL = 14;
const line = (mark, label, detail = "") => `  ${mark} ${label.padEnd(LABEL)} ${detail}`.trimEnd();

let cursorHidden = false;
function hideCursor() {
  if (!live || cursorHidden) return;
  cursorHidden = true;
  out.write("\x1b[?25l");
}
export function showCursor() {
  if (cursorHidden) out.write("\x1b[?25h");
  cursorHidden = false;
}

/** One checklist row that redraws itself in place until it's settled, with an optional line under it. */
export function row(label, detail = "") {
  if (stage) return stageTask(label, detail);
  let frame = 0;
  let text = detail;
  let sub = "";
  let timer = null;
  const draw = () => {
    out.write(`\r\x1b[2K${line(pen(FRAMES[frame++ % FRAMES.length]), label, text)}`);
    // The line under the row (a tip): drawn, then the cursor goes back up to the row.
    out.write(`\n\x1b[2K${sub ? `${" ".repeat(LABEL + 5)}${sub}` : ""}\x1b[1A\r`);
  };
  if (live) {
    hideCursor();
    draw();
    timer = setInterval(draw, 80);
  }
  const settle = (mark, final) => {
    clearInterval(timer);
    out.write(`${live ? "\r\x1b[2K" : ""}${line(mark, label, final)}\n${live ? "\x1b[2K" : ""}`);
    showCursor();
  };
  return {
    update(next) { text = next; },
    tip(next) { sub = next; },
    ok(final = text) { settle(pass("✓"), final); },
    fail(final = text) { settle(pen("✗"), final); },
    info(final = text) { settle(dim("·"), dim(final)); },
  };
}

/** A checklist row on the live screen: drawn by the screen's own loop. */
function stageTask(label, detail) {
  const task = { open: true, text: detail, sub: "", mark: null };
  task.render = () => line(task.mark ?? pen(FRAMES[Math.floor(performance.now() / 80) % FRAMES.length]), label, task.text);
  task.short = () => `${task.mark ?? pen("…")} ${dim(label)}`;
  stage.tasks.push(task);
  const settle = (mark, final) => { task.mark = mark; task.text = final; task.open = false; };
  return {
    update(next) { task.text = next; },
    tip(next) { task.sub = next; },
    ok(final = task.text) { settle(pass("✓"), final); },
    fail(final = task.text) { settle(pen("✗"), final); },
    info(final = task.text) { settle(dim("·"), dim(final)); },
  };
}

/** Run a check with a spinner: fn returns the detail to show, or throws to fail the row. */
export async function step(label, fn) {
  const r = row(label);
  try {
    const detail = await fn(r);
    r.ok(detail);
    return detail;
  } catch (error) {
    r.fail(error.message);
    throw error;
  }
}

/** A smooth progress bar: whole cells plus an eighth-cell edge, pen red into gold. */
export function bar(fraction, cells = 24) {
  const f = Math.max(0, Math.min(1, fraction));
  if (!color) return `[${"#".repeat(Math.round(f * cells)).padEnd(cells, ".")}]`;
  const eighths = Math.round(f * cells * 8);
  const full = Math.floor(eighths / 8);
  const edge = eighths % 8 ? "▏▎▍▌▋▊▉"[(eighths % 8) - 1] : "";
  let s = "";
  for (let i = 0; i < full; i++) {
    const k = i / Math.max(1, cells - 1);
    s += truecolor ? `\x1b[38;2;${Math.round(214 + 26 * k)};${Math.round(64 + 106 * k)};${Math.round(42 + 18 * k)}m█` : pen("█");
  }
  if (edge) s += truecolor ? `\x1b[38;2;240;170;60m${edge}` : pen(edge);
  const rest = cells - full - (edge ? 1 : 0);
  return `${s}${truecolor ? "\x1b[39m" : ""}${dim("░".repeat(rest))}`;
}

export const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
export const duration = (sec) => (sec < 60 ? `${Math.max(1, Math.round(sec))}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, "0")}s`);

export function note(text = "") {
  out.write(text ? `  ${text}\n` : "\n");
}

/** A rounded frame around lines; on narrow terminals just the lines. */
/** A rounded frame around lines, as lines; on narrow terminals just the lines. */
export function boxLines(lines, cols = out.columns ?? 80) {
  const inner = Math.max(...lines.map(width)) + 2;
  if (cols < inner + 6 || !color) return lines.map((l) => `  ${l}`);
  return [
    `  ${dim(`╭${"─".repeat(inner + 2)}╮`)}`,
    ...lines.map((l) => `  ${dim("│")}  ${l}${" ".repeat(inner - width(l))}${dim("│")}`),
    `  ${dim(`╰${"─".repeat(inner + 2)}╯`)}`,
  ];
}

export function card(lines) {
  out.write(`${boxLines(lines).join("\n")}\n`);
}

/** A failure the user can fix: what's wrong, then how to fix it. */
export function problem(title, fix) {
  leaveStage();
  out.write(`\n  ${pen(bold(title))}\n${fix.split("\n").map((l) => `  ${l}`).join("\n")}\n\n`);
}

// ---------------------------------------------------------------- what this is (first run, and --about)

const FLOW = [["you", "talk", ""], ["Whisper", "local", "local"], ["your claude", "your plan", "yours"], ["Kokoro", "local", "local"]];

/** Boxes joined by arrows, with a line back to the start: how one answer travels. */
function flow(boxes) {
  const inner = boxes.map(([title, sub]) => Math.max(title.length, sub.length) + 2);
  const center = (s, w) => { const l = Math.floor((w - s.length) / 2); return " ".repeat(l) + s + " ".repeat(w - s.length - l); };
  const join = (parts, sep) => parts.join(sep);
  const top = join(inner.map((w) => dim(`╭${"─".repeat(w)}╮`)), "   ");
  const mid = join(boxes.map(([t], i) => `${dim("│")}${bold(center(t, inner[i]))}${dim("│")}`), pen("──▶")) + pen("──╮");
  const sub = join(boxes.map(([, s, tone], i) => `${dim("│")}${(tone === "local" ? pass : tone === "yours" ? gold : dim)(center(s, inner[i]))}${dim("│")}`), "   ") + "  " + pen("│");
  const bottom = join(inner.map((w) => dim(`╰${"─".repeat(w)}╯`)), "   ") + "  " + pen("│");
  const full = width(mid);
  const youMid = 1 + Math.floor(inner[0] / 2);
  const up = `${" ".repeat(youMid)}${pen("▲")}${" ".repeat(full - youMid - 2)}${pen("│")}`;
  const back = `${" ".repeat(youMid)}${pen(`╰${"─".repeat(full - youMid - 2)}╯`)}`;
  return [top, mid, sub, bottom, up, back];
}

export function explainer(data) {
  const h = (s) => `  ${bold(pen("▍"))}${bold(s)}`;
  const p = (s) => `    ${s}`;
  const lines = [
    h("What you're installing"),
    p("A practice interviewer for code you've shipped. It picks the files you change"),
    p("most, asks you about them out loud, and scores how well you can explain and"),
    p("defend them. A few minutes a day, with XP and a streak, like a language app."),
    "",
    h("How one answer travels"),
    "",
    ...flow(FLOW).map((l) => `    ${l}`),
    "",
    p(dim("Whisper turns your voice into text, on this computer. Your own Claude Code reads")),
    p(dim("the file, asks the next question and scores your answer, on your plan. Kokoro")),
    p(dim("reads the question out loud, on this computer.")),
    "",
    h("What runs where"),
    p(`${pass("This computer ")}  the app (on 127.0.0.1 only), the voice models, your profile`),
    p(`${" ".repeat(16)}${dim(`in ${tilde(data)}`)}`),
    p(`${gold("Anthropic     ")}  the code your claude reads, as in any Claude Code session`),
    p(`${dim("Hugging Face  ")}  a one-time download of the voice models (~460 MB)`),
    p(`${pen("Us            ")}  nothing. No account, no server, no analytics`),
    "",
  ];
  out.write(`${lines.join("\n")}\n`);
}
