// The conversation: an interviewer who has read your code, asks one question at a time,
// adapts to how you answer, and wraps up with what you defended and your own story.
//
// Everything runs on the user's machine: their own `claude` CLI reads the repo, and speech runs
// in this process (lib/speech.mjs). State lives in ~/.slop-academy (or SLOP_DATA).

import { readFile, writeFile, mkdir, stat, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { run } from "./run.mjs";
import { DATA, command, expandHome } from "./paths.mjs";
import * as speech from "./speech.mjs";
import * as progress from "./progress.mjs";
const MODEL = process.env.SLOP_MODEL ?? "sonnet";

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// ---------------------------------------------------------------- claude

async function claudeJson({ system, prompt, schema, tools = false, cwd = tmpdir(), timeoutMs = 120_000 }) {
  const result = await run("claude", [
    "-p",
    "--model", MODEL,
    "--tools", tools ? "Read,Grep,Glob" : "",
    "--permission-mode", "dontAsk",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--setting-sources", "",
    "--system-prompt", system,
    "--json-schema", JSON.stringify(schema),
    "--output-format", "json",
  ], { input: prompt, timeoutMs, cwd });
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw httpError(502, `your claude CLI didn't answer: ${(result.stderr || result.stdout || "timeout").slice(0, 200)}`);
  }
  if (!envelope.structured_output) throw httpError(502, "claude returned no structured answer");
  return { data: envelope.structured_output, cost: envelope.total_cost_usd ?? 0 };
}

// ---------------------------------------------------------------- profile

const PROFILE = path.join(DATA, "profile.json");

export async function getProfile() {
  try {
    return JSON.parse(await readFile(PROFILE, "utf8"));
  } catch {
    return null;
  }
}

async function saveProfile(profile) {
  await mkdir(DATA, { recursive: true });
  await writeFile(PROFILE, `${JSON.stringify(profile, null, 2)}\n`);
  return profile;
}

const GOALS = new Set(["interview", "sharp", "own"]);

export async function setProfile({ repo, goal, role, interviewDate, confidence, dailyGoal }) {
  if (!GOALS.has(goal)) throw httpError(400, "goal must be interview, sharp or own");
  const scan = await scanRepo(repo);
  const old = await getProfile();
  return saveProfile({
    repo: scan.root,
    goal,
    role: typeof role === "string" ? role.slice(0, 80) : "",
    interviewDate: typeof interviewDate === "string" ? interviewDate.slice(0, 10) : "",
    confidence: [...(old?.repo === scan.root ? old.confidence ?? [] : []), { at: new Date().toISOString(), value: clampInt(confidence, 1, 5), when: "start" }],
    history: old?.repo === scan.root ? old.history ?? [] : [],
    // XP, streak and achievements are yours, not the repo's: they carry over when you switch projects.
    progress: old?.progress,
    dailyGoal: progress.DAILY_GOALS[dailyGoal] ? Number(dailyGoal) : old?.dailyGoal ?? 60,
    createdAt: old?.createdAt ?? new Date().toISOString(),
  });
}

export async function setDailyGoal({ dailyGoal }) {
  const profile = await getProfile();
  if (!profile) throw httpError(400, "no profile yet");
  if (!progress.DAILY_GOALS[dailyGoal]) throw httpError(400, "daily goal must be 30, 60 or 120");
  profile.dailyGoal = Number(dailyGoal);
  await saveProfile(profile);
  return progress.summary(profile);
}

const clampInt = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(n) || lo)));

// ---------------------------------------------------------------- repos

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|sol|java|kt|rb|php|cs|swift|c|cc|cpp|h|hpp|scala|ex|exs|vue|svelte)$/;
const SKIP = /(^|\/)(node_modules|dist|build|out|vendor|\.next|coverage|generated|migrations|__generated__|\.git)\/|(\.d\.ts|\.min\.js|\.config\.(js|ts|mjs)|\.test\.|\.spec\.|_test\.|test_)|(^|\/)(tests?|__tests__|spec)\//;

/**
 * Files in a project, relative to its root. In a git repo: tracked plus untracked-but-not-ignored.
 * Anywhere else: a walk that skips hidden folders, dependencies and build output.
 */
async function listSourceFiles(root, isGit) {
  if (isGit) {
    const ls = await run("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard"], { timeoutMs: 10_000 });
    return [...new Set(ls.stdout.split("\n").filter(Boolean))];
  }
  const out = [];
  const walk = async (dir, rel, depth) => {
    if (depth > 8 || out.length > 5000) return;
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith(".") || NOT_REPOS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r, depth + 1);
      else if (e.isFile()) out.push(r);
    }
  };
  await walk(root, "", 0);
  return out;
}

// Folders under home that hold apps, media or dependencies, never your own repos.
const NOT_REPOS = new Set(["node_modules", "Library", "Applications", "AppData", "Downloads", "Music", "Pictures", "Movies", "Videos", "Public", "snap", "go", "venv", "vendor", "dist", "build", "target", "site-packages"]);

/**
 * Git repos under the home directory (three levels, so ~/code/work/api counts), most recently
 * worked on first. "Worked on" is the newer of the last commit and the newest uncommitted change,
 * so a repo you've been editing all day without committing still comes first.
 */
export async function suggestRepos() {
  const home = homedir();
  const candidates = [];
  let visited = 0;
  const level = async (dir, depth) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || NOT_REPOS.has(e.name) || ++visited > 5000) continue;
      const full = path.join(dir, e.name);
      if (await stat(path.join(full, ".git")).catch(() => null)) candidates.push(full);
      else if (depth < 3) await level(full, depth + 1);
    }
  };
  await level(home, 1);
  const withDates = await Promise.all(candidates.map(async (dir) => {
    const [log, tracked, status] = await Promise.all([
      run("git", ["-C", dir, "log", "-1", "--format=%ct"], { timeoutMs: 5000 }),
      run("git", ["-C", dir, "ls-files", "--cached", "--others", "--exclude-standard"], { timeoutMs: 5000 }),
      // GIT_OPTIONAL_LOCKS=0: read-only, so looking doesn't rewrite .git/index (which would make
      // every repo look freshly touched).
      run("git", ["-C", dir, "status", "--porcelain", "-z", "--untracked-files=normal"], { timeoutMs: 5000, env: { GIT_OPTIONAL_LOCKS: "0" } }),
    ]);
    const lastCommit = Number(log.stdout.trim()) || 0;
    const changed = status.stdout.split("\0").filter((x) => x.length > 3).slice(0, 300).map((x) => x.slice(3));
    const times = await Promise.all(changed.map((f) => stat(path.join(dir, f)).then((st) => st.mtimeMs / 1000, () => 0)));
    const lastEdit = Math.floor(Math.max(0, ...times));
    // Only repos there's something to talk about in (committed or not): source files of the size scanRepo accepts
    // (30 to 1500 lines, roughly 600 bytes to 100 KB). A notes or docs repo would offer nothing.
    const sources = tracked.stdout.split("\n").filter((f) => SOURCE.test(f) && !SKIP.test(f)).slice(0, 200);
    const sizes = await Promise.all(sources.map((f) => stat(path.join(dir, f)).then((st) => st.size, () => 0)));
    const files = sizes.filter((b) => b >= 600 && b <= 100_000).length;
    return { path: dir, name: path.basename(dir), lastCommit, lastEdit, lastActive: Math.max(lastCommit, lastEdit), files };
  }));
  return withDates.filter((r) => r.lastActive && r.files >= 2).sort((a, b) => b.lastActive - a.lastActive).slice(0, 8);
}

/** The parts of a repo worth talking about: source files people actually change. */
export async function scanRepo(repo) {
  if (typeof repo !== "string" || !repo.trim()) throw httpError(400, "pick a repo");
  const root = path.resolve(expandHome(repo.trim()));
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw httpError(400, `${root} is not a folder`);

  const top = await run("git", ["-C", root, "rev-parse", "--show-toplevel"], { timeoutMs: 5000 });
  const gitRoot = top.code === 0 ? top.stdout.trim() : null;
  const churn = new Map();
  let commits = 0;
  let aiCommits = 0;
  if (gitRoot) {
    const log = await run("git", ["-C", gitRoot, "log", "--since=18.months", "--name-only", "--format=@@%B"], { timeoutMs: 20_000 });
    for (const block of log.stdout.split("@@").slice(1)) {
      commits++;
      if (/co-authored-by:.*(claude|copilot|cursor|codex|gemini|devin|aider)|generated with \[?claude/i.test(block)) aiCommits++;
      for (const line of block.split("\n")) {
        const f = line.trim();
        if (SOURCE.test(f) && !SKIP.test(f)) churn.set(f, (churn.get(f) ?? 0) + 1);
      }
    }
  }
  const base = gitRoot ?? root;
  // Every source file that's here now: committed, staged, or written but never added to git (a
  // lot of AI-assisted code lives there). .gitignore still applies, so dependencies and build
  // output stay out. Files git has seen change come first; the rest follow.
  const present = (await listSourceFiles(base, Boolean(gitRoot))).filter((f) => SOURCE.test(f) && !SKIP.test(f));
  const presentSet = new Set(present);
  const files = [...[...churn.keys()].filter((f) => presentSet.has(f)), ...present.filter((f) => !churn.has(f))].slice(0, 600);
  const areas = [];
  for (const file of files) {
    const text = await readFile(path.join(base, file), "utf8").catch(() => null);
    if (text == null) continue;
    const lines = text.split("\n").length;
    if (lines < 30 || lines > 1500) continue;
    const changes = churn.get(file) ?? 0;
    // Systems questions live in logic, not markup: lean toward server, lib and data code.
    const weight = /\.(tsx|jsx|vue|svelte)$/.test(file) || /(^|\/)(pages|components|views|ui)\//.test(file) ? 0.35
      : /(^|\/)(lib|server|api|services?|core|db|domain|workers?|jobs|contracts?)\//.test(file) ? 1.4 : 1;
    areas.push({ file, lines, changes, score: (Math.sqrt(changes) + 1) * Math.log(lines) * weight });
  }
  areas.sort((a, b) => b.score - a.score);
  const languages = {};
  for (const a of areas) {
    const ext = path.extname(a.file).slice(1);
    languages[ext] = (languages[ext] ?? 0) + 1;
  }
  return {
    root: base,
    name: path.basename(base),
    commits,
    aiCommits,
    languages: Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([ext]) => ext),
    areas: areas.slice(0, 12).map(({ score, ...a }) => a),
  };
}

function resolveInRepo(repo, file) {
  const full = path.resolve(repo, file);
  if (!full.startsWith(path.resolve(repo) + path.sep)) throw httpError(403, "outside the repo");
  return full;
}

export async function readRepoFile(file) {
  const profile = await getProfile();
  if (!profile) throw httpError(400, "no profile yet");
  return { file, source: await readFile(resolveInRepo(profile.repo, file), "utf8") };
}

// ---------------------------------------------------------------- what to talk about next

const LENS_NAMES = {
  purpose: "what it's for", failure: "failure handling", scale: "scale", tradeoff: "trade-offs",
  data_flow: "data flow", change: "changing requirements", operations: "operations", honesty: "gaps",
};

export async function home() {
  const profile = await getProfile();
  if (!profile) return { profile: null };
  const scan = await scanRepo(profile.repo);
  const talked = new Map();
  for (const h of profile.history) talked.set(h.file, h);
  const areas = scan.areas.map((a) => {
    const last = talked.get(a.file);
    const scores = last ? Object.values(last.lensScores ?? {}) : [];
    return { ...a, talks: profile.history.filter((h) => h.file === a.file).length, level: scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null, mastery: progress.mastery(profile.history, a.file), last };
  });
  // New ground first, in order of how much the file changes; then revisit the weakest one.
  let next = areas.find((a) => !a.talks);
  let reason;
  if (next) {
    reason = next.changes > 1
      ? `Changed ${next.changes} times recently, and you haven't talked it through yet`
      : "One of the core files in this repo, and you haven't talked it through yet";
  } else {
    next = [...areas].sort((a, b) => (a.level ?? 3) - (b.level ?? 3))[0];
    const weakest = Object.entries(next?.last?.lensScores ?? {}).sort((a, b) => a[1] - b[1])[0];
    reason = weakest ? `Last time ${LENS_NAMES[weakest[0]] ?? weakest[0]} was your weakest spot (${weakest[1]} of 3)` : "Worth another pass";
  }
  if (next) prepare(next.file).catch(() => {}); // warm the brief so starting feels instant
  return { profile, scan: { ...scan, areas }, next: next && { file: next.file, reason }, progress: progress.summary(profile), catalog: { achievements: progress.ACHIEVEMENTS, goals: progress.DAILY_GOALS } };
}

// ---------------------------------------------------------------- the brief

const LENSES = ["purpose", "failure", "scale", "tradeoff", "data_flow", "change", "operations", "honesty"];

const BRIEF_SYSTEM = `You prepare a spoken technical conversation about ONE file from an engineer's own repo.
They shipped it, often with an AI agent, and want to be able to explain and defend it. You have read-only
tools in their repo: use Grep/Read to check who calls the code and what it depends on before you claim it.

Write the brief the interviewer will use:
- title: what this code is, in 2-5 plain words (not the file name).
- summary: one plain sentence on what it does and for whom.
- opening: the first spoken question (lens purpose): what is this for and why does it exist. Max 30 words.
- angles: 5 questions a sharp senior engineer would ask about THIS code, each a different lens, at least
  3 of them from failure, scale, tradeoff, data_flow, change, operations. SYSTEMS THINKING, never syntax:
  never ask what a keyword, operator or library call does. Anchor each in this code (the function, the
  dependency, the number). Each question is spoken aloud: max 30 words, no code, no symbols.
  "lines" is [first, last] (1-based, inclusive) of the code the question is about.
  "strong" lists 2-4 points a strong answer covers, specific to this code, verified against it.
Facts only from the code and the repo. Never invent incidents.`;

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "opening", "angles"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    opening: { type: "string" },
    angles: {
      type: "array", minItems: 4, maxItems: 6,
      items: {
        type: "object", additionalProperties: false, required: ["lens", "question", "lines", "strong"],
        properties: {
          lens: { enum: LENSES },
          question: { type: "string" },
          lines: { type: "array", items: { type: "integer" }, minItems: 2, maxItems: 2 },
          strong: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
        },
      },
    },
  },
};

const numbered = (source) => source.split("\n").map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join("\n");
const pending = new Map();

/** Reads the file once with the user's agent; cached until the file changes. */
export async function prepare(file) {
  const profile = await getProfile();
  if (!profile) throw httpError(400, "no profile yet");
  const full = resolveInRepo(profile.repo, file);
  const source = await readFile(full, "utf8");
  const key = createHash("sha1").update(`${full}\n${source}`).digest("hex").slice(0, 16);
  const cache = path.join(DATA, "briefs", `${key}.json`);
  const cached = await readFile(cache, "utf8").catch(() => null);
  if (cached) return JSON.parse(cached);
  if (pending.has(key)) return pending.get(key);

  const job = (async () => {
    const history = await run("git", ["-C", profile.repo, "log", "-12", "--format=%ad %s", "--date=short", "--", file], { timeoutMs: 10_000 });
    const { data } = await claudeJson({
      system: BRIEF_SYSTEM,
      schema: BRIEF_SCHEMA,
      tools: true,
      cwd: profile.repo,
      timeoutMs: 6 * 60_000,
      prompt: [
        `FILE ${file} (${source.split("\n").length} lines):\n${numbered(source)}`,
        history.stdout.trim() && `RECENT COMMITS TOUCHING IT:\n${history.stdout.trim()}`,
        `THE ENGINEER: goal ${profile.goal}${profile.role ? `, role ${profile.role}` : ""}.`,
        "Check callers with Grep first, then return the brief.",
      ].filter(Boolean).join("\n\n====\n\n"),
    });
    const n = source.split("\n").length;
    const clamp = ([a, b]) => [Math.max(1, Math.min(n, a)), Math.max(1, Math.min(n, Math.max(a, b)))];
    const brief = { file, ...data, angles: data.angles.map((a) => ({ ...a, lines: clamp(a.lines) })), createdAt: new Date().toISOString() };
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache, `${JSON.stringify(brief, null, 2)}\n`);
    return brief;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

// ---------------------------------------------------------------- a turn

const PERSONAS = {
  interview: "a senior engineer interviewing them for a role. Warm but exacting, like a good real interview",
  sharp: "a senior colleague doing a friendly deep-dive, keeping their skills sharp",
  own: "a new teammate's lead making sure they truly own this code before others depend on it",
};

const TURN_SYSTEM = (profile, brief) => `You are ${PERSONAS[profile.goal]}. You are talking out loud with the engineer
about code THEY shipped: ${brief.title}. ${brief.summary}${profile.role ? ` They are aiming for: ${profile.role}.` : ""}

Your plan, in order (adapt it, don't recite it):
${brief.angles.map((a, i) => `${i + 1}. [${a.lens}] ${a.question} (lines ${a.lines[0]}-${a.lines[1]}; strong answer: ${a.strong.join("; ")})`).join("\n")}

How you behave:
- One question at a time. Spoken aloud: max 40 words, plain conversational words, no code, no symbols, no lists.
- First assess their last answer against the strong points for the question you asked (score 0-3:
  0 wrong or empty, 1 vague, 2 solid but missing a key point, 3 would impress an interviewer).
- Score 3: acknowledge in a few words, then once per topic throw a curveball that shifts one constraint
  ("now the API is ten times slower"), else move to the next topic.
- Score 2: follow up on the gap without giving the answer away.
- Score 0-1 the first time: give a hint and point at the lines. The second time on the same topic: explain it
  in at most three sentences (move "explain"), then ask them to put it in their own words (move "teach_back").
- "I'm stuck" or "I don't know" is fine: credit honesty, give a hint. Never shame, never lecture.
- Systems thinking only: failure, scale, trade-offs, data flow, change, operations, honesty about gaps. Never syntax.
- Whenever you refer to code, set "lines" so the editor highlights it.
- After about ${brief.angles.length + 2} answers, or when the plan is covered, close warmly in one or two sentences
  with move "wrap" and done true.`;

const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["say", "move", "lens", "lines", "assessment", "done"],
  properties: {
    say: { type: "string" },
    move: { enum: ["ask", "follow_up", "curveball", "hint", "explain", "teach_back", "wrap"] },
    lens: { enum: LENSES },
    lines: { type: ["array", "null"], items: { type: "integer" }, minItems: 2, maxItems: 2 },
    assessment: {
      type: ["object", "null"], additionalProperties: false, required: ["lens", "score", "note"],
      properties: { lens: { enum: LENSES }, score: { type: "integer", minimum: 0, maximum: 3 }, note: { type: "string", description: "max 10 words, about their last answer" } },
    },
    done: { type: "boolean" },
  },
};

// A one-shot `claude -p` pays ~4s of startup before the first word. A conversation keeps one
// process warm instead (stream-json in and out), which answers in ~2s and remembers the talk itself.

const LIVE_FORMAT = `
Reply in exactly this format, nothing else:
<what you say out loud>
###
{"move": "ask|follow_up|curveball|hint|explain|teach_back|wrap", "lens": "<lens>", "lines": [first, last] or null, "assessment": {"lens": "<lens>", "score": 0-3, "note": "max 10 words about their last answer"} or null, "done": false}`;

class LiveInterviewer {
  constructor(system) {
    const [bin, ...pre] = command("claude");
    this.child = spawn(bin, [...pre,
      "-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence", "--setting-sources", "",
      "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--system-prompt", system,
    ], { cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    this.child.on("error", () => { this.alive = false; this.waiter?.(new Error("couldn't start your claude CLI")); });
    this.alive = true;
    this.seen = 0; // transcript entries this process already knows about
    this.waiter = null;
    this.queue = Promise.resolve();
    this.touched = Date.now();
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === "result") this.waiter?.(msg.is_error ? new Error(String(msg.result ?? "error")) : String(msg.result ?? ""));
      }
    });
    this.child.on("exit", () => {
      this.alive = false;
      this.waiter?.(new Error("interviewer process stopped"));
    });
    this.child.stdin.on("error", () => {});
  }

  ask(text, timeoutMs = 60_000) {
    const job = this.queue.then(() => new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error("interviewer timed out")), timeoutMs);
      const done = (value) => {
        clearTimeout(timer);
        this.waiter = null;
        value instanceof Error ? reject(value) : resolve(value);
      };
      this.waiter = done;
      this.touched = Date.now();
      this.child.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`);
    }));
    this.queue = job.catch(() => {});
    return job;
  }

  close() {
    this.alive = false;
    this.child.stdin.end();
    setTimeout(() => this.child.kill(), 2000).unref();
  }
}

const live = new Map();
setInterval(() => {
  for (const [id, s] of live) if (!s.alive || Date.now() - s.touched > 20 * 60_000) { s.close(); live.delete(id); }
}, 60_000).unref();

const MOVES = new Set(["ask", "follow_up", "curveball", "hint", "explain", "teach_back", "wrap"]);

function parseTurn(text, fallbackLens, lineCount) {
  const cut = text.lastIndexOf("###");
  const say = (cut >= 0 ? text.slice(0, cut) : text).trim().replace(/^["']|["']$/g, "");
  let meta = {};
  if (cut >= 0) {
    const raw = text.slice(cut + 3);
    try { meta = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { /* keep the words, lose the metadata */ }
  }
  const lines = Array.isArray(meta.lines) && meta.lines.length === 2 && meta.lines.every(Number.isInteger)
    ? [Math.max(1, Math.min(lineCount, meta.lines[0])), Math.max(1, Math.min(lineCount, Math.max(meta.lines[0], meta.lines[1])))]
    : null;
  const a = meta.assessment;
  return {
    say,
    move: MOVES.has(meta.move) ? meta.move : "ask",
    lens: LENSES.includes(meta.lens) ? meta.lens : fallbackLens,
    lines,
    assessment: a && Number.isInteger(a.score) ? { lens: LENSES.includes(a.lens) ? a.lens : fallbackLens, score: Math.max(0, Math.min(3, a.score)), note: String(a.note ?? "").slice(0, 120) } : null,
    done: meta.done === true || meta.move === "wrap",
  };
}

const speaker = (t) => (t.role === "you" ? "ENGINEER" : "YOU");

export async function start({ file }) {
  const profile = await getProfile();
  const brief = await prepare(file);
  const { source } = await readRepoFile(file);
  const id = createHash("sha1").update(`${file}${Date.now()}${Math.random()}`).digest("hex").slice(0, 12);
  live.set(id, new LiveInterviewer(`${TURN_SYSTEM(profile, brief)}\n${LIVE_FORMAT}\n\nTHE CODE, ${file}:\n${numbered(source)}`));
  return { id, brief, turn: { say: brief.opening, move: "ask", lens: "purpose", lines: null, assessment: null, done: false } };
}

export async function turn({ id, file, transcript }) {
  if (!Array.isArray(transcript) || !transcript.length) throw httpError(400, "transcript required");
  const session = live.get(id);
  const lens = [...transcript].reverse().find((t) => t.lens)?.lens ?? "purpose";
  if (session?.alive) {
    try {
      const fresh = transcript.slice(session.seen);
      const message = session.seen === 0
        ? `${fresh.map((t) => `${speaker(t)}: ${String(t.text).slice(0, 3000)}`).join("\n")}\n\nYour next turn.`
        : `ENGINEER: ${fresh.filter((t) => t.role === "you").map((t) => String(t.text).slice(0, 3000)).join("\n")}`;
      const asked = Date.now();
      const text = await session.ask(message);
      if (process.env.SLOP_DEBUG) console.error(`live turn ${Date.now() - asked}ms`);
      session.seen = transcript.length + 1; // plus the reply it just gave
      const { source } = await readRepoFile(file);
      const result = parseTurn(text, lens, source.split("\n").length);
      if (result.say) return result;
    } catch (error) {
      console.error(`live interviewer ${id} failed, falling back: ${error.message}`);
      session.close();
      live.delete(id);
    }
  }
  // Cold path: a one-shot call with the whole conversation so far (slower, but always works).
  const profile = await getProfile();
  const brief = await prepare(file);
  const { source } = await readRepoFile(file);
  const convo = transcript.slice(-24).map((t) => `${speaker(t)}: ${String(t.text).slice(0, 3000)}`).join("\n");
  const { data } = await claudeJson({
    system: TURN_SYSTEM(profile, brief),
    schema: TURN_SCHEMA,
    timeoutMs: 90_000,
    prompt: `CODE ${file}:\n${numbered(source)}\n\n====\n\nCONVERSATION SO FAR:\n${convo}\n\nYour next turn.`,
  });
  return data;
}

export function endLive(id) {
  live.get(id)?.close();
  live.delete(id);
}

// ---------------------------------------------------------------- wrap-up

const RECAP_SYSTEM = `You close a spoken conversation in which an engineer explained and defended their own code.
Be specific and brief. Second person, plain words.
- headline: max 8 words, how it went.
- defended: up to 3 things they explained well, max 12 words each.
- gap: the single most useful thing to work on, max 20 words, with the code lines it concerns.
- story: THEIR one-minute interview story about this code, first person, max 110 words, built from what
  THEY said in the conversation (corrected only where the code proves them wrong). Problem, decision,
  trade-off, result. No buzzwords, nothing they didn't say or the code doesn't show.
- lensScores: one entry for each lens actually discussed, scored 0-3 on how well they handled it.`;

const RECAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "defended", "gap", "story", "lensScores"],
  properties: {
    headline: { type: "string" },
    defended: { type: "array", items: { type: "string" }, maxItems: 3 },
    gap: { type: "object", additionalProperties: false, required: ["text", "lines"], properties: { text: { type: "string" }, lines: { type: ["array", "null"], items: { type: "integer" }, minItems: 2, maxItems: 2 } } },
    story: { type: "string" },
    lensScores: {
      type: "array", minItems: 1,
      items: { type: "object", additionalProperties: false, required: ["lens", "score"], properties: { lens: { enum: LENSES }, score: { type: "integer", minimum: 0, maximum: 3 } } },
    },
  },
};

export async function finish({ id, file, transcript, metrics }) {
  if (id) endLive(id);
  const profile = await getProfile();
  const brief = await prepare(file);
  const { source } = await readRepoFile(file);
  const convo = (transcript ?? []).map((t) => `${t.role === "you" ? "ENGINEER" : "INTERVIEWER"}: ${String(t.text).slice(0, 3000)}`).join("\n");
  const { data } = await claudeJson({
    system: RECAP_SYSTEM,
    schema: RECAP_SCHEMA,
    timeoutMs: 120_000,
    prompt: `CODE ${file} (${brief.title}):\n${numbered(source)}\n\n====\n\nCONVERSATION:\n${convo}`,
  });
  const lensScores = Object.fromEntries((data.lensScores ?? []).filter((x) => LENSES.includes(x.lens)).map((x) => [x.lens, x.score]));
  const entry = { file, title: brief.title, at: new Date().toISOString(), lensScores, metrics: metrics ?? null, headline: data.headline };
  profile.history.push(entry);
  const gained = progress.apply(profile, { transcript, at: new Date(entry.at) });
  entry.xp = gained.earned;
  await saveProfile(profile);
  await mkdir(path.join(DATA, "conversations"), { recursive: true });
  await writeFile(path.join(DATA, "conversations", `${entry.at.replace(/[:.]/g, "-")}.json`), `${JSON.stringify({ ...entry, transcript, recap: data }, null, 2)}\n`);
  return { ...data, lensScores, progress: gained };
}

export async function rateConfidence({ value }) {
  const profile = await getProfile();
  if (!profile) throw httpError(400, "no profile yet");
  profile.confidence.push({ at: new Date().toISOString(), value: clampInt(value, 1, 5), when: "after" });
  return saveProfile(profile);
}

// ---------------------------------------------------------------- local speech: whisper in, kokoro out

export const warmSpeech = speech.warm;
export const speechStatus = speech.status;

/** Your answer as 16 kHz mono float32 samples (the page decodes and resamples it). */
export async function transcribe(audio) {
  if (!audio?.length) throw httpError(400, "no audio");
  if (audio.length % 4) throw httpError(400, "expected 16 kHz float32 samples");
  const samples = new Float32Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.length));
  try {
    return await speech.transcribe(samples);
  } catch (e) {
    throw httpError(500, `speech model: ${e.message}`);
  }
}

export const VOICES = { af_heart: "Heart", am_michael: "Michael", bf_emma: "Emma", bm_george: "George" };

/** One sentence of the interviewer's voice as WAV. Cached, since openings get replayed. */
export async function speak({ text, voice }) {
  if (typeof text !== "string" || !text.trim()) throw httpError(400, "text required");
  const v = VOICES[voice] ? voice : "af_heart";
  const clean = text.trim().slice(0, 600);
  const out = path.join(DATA, "voice", `${createHash("sha1").update(`${v}\n${clean}`).digest("hex").slice(0, 20)}.wav`);
  const cached = await readFile(out).catch(() => null);
  if (cached) return cached;
  // Still downloading on first run: say so at once, and the page uses the browser's voice meanwhile.
  if (!speech.ttsReady()) throw httpError(503, "voice model still loading");
  const wav = await speech.synthesize(clean, v);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, wav);
  return wav;
}
