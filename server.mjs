// Slop Academy: the local server. Listens on 127.0.0.1 only; `slop-academy` (bin/) starts it.
//
//   GET  /api/sessions             every generated or hand-written session
//   GET  /api/session/:id        session script + the live source file from the repo
//   POST /api/run                { session, code, only? } → runs the repo's real test file against `code`
//   POST /api/grade              { session, questionId, answer, followUpOf? } → headless Claude grades it
//   /api/home, /api/talk/*, …    the conversation app (lib/talk.mjs); the old exercise player is /lab.html
//
// Sessions point at files in your own repos; nothing is copied, so a lesson
// always teaches the code as it stands today.

import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { run, runTests as runRepoTests } from "./lib/tests.mjs";
import * as talk from "./lib/talk.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8795);
const CLAUDE_MODEL = process.env.SLOP_MODEL ?? "sonnet";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function loadSession(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw httpError(404, "no such session");
  const file = path.join(ROOT, "sessions", id, "session.json");
  const session = JSON.parse(await readFile(file, "utf8"));
  const source = await readFile(session.repo.sourcePath, "utf8");
  return { session, source };
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function listSessions() {
  const ids = await readdir(path.join(ROOT, "sessions")).catch(() => []);
  const sessions = [];
  for (const id of ids) {
    try {
      const { session } = await loadSession(id);
      sessions.push({ id, course: session.course, title: session.title, file: session.file, next: session.next ?? [], createdAt: session.createdAt ?? null });
    } catch { /* a half-written or broken session just doesn't show up */ }
  }
  return sessions;
}

async function runTests({ session: id, code, only }) {
  const { session } = await loadSession(id);
  if (typeof code !== "string" || code.length > 200_000) throw httpError(400, "code required");
  if (!session.repo.testPath) throw httpError(400, "this session has no tests");
  return runRepoTests(session.repo, code, only);
}

// ---------------------------------------------------------------- grading

const GRADER_SYSTEM = `You are the examiner in Slop Academy, which drills engineers on code they shipped
(often with AI help) until they can defend it in an interview. You get the engineer's real source
code, a question, a rubric written by someone who knows the code, and the engineer's spoken answer
(transcribed — ignore filler words and transcription noise).

Grade like a fair senior interviewer: credit the idea even in casual words; do not reward
buzzwords that are not tied to this code. Second person, plain words.

BE TERSE. The engineer is mid-exercise and must still recall the rest themselves, so NEVER
state the missing facts. Point toward the biggest gap the way a good interviewer nudges
("What happened to the seller's row?"), not the way a textbook explains.

Reply with ONLY a JSON object, no prose, no code fence:
{"score": 0-3, "verdict": "max 12 words", "nailed": "the single best thing they said, max 10 words, or null", "gap": "a nudge toward the biggest missing point, max 15 words, without revealing it, or null if score is 3", "followUp": "one short interviewer follow-up, max 20 words"}
followUp: if score < 3, push on the gap. If score is 3, shift one constraint the way interviewers
do ("Now the RPC is ten blocks behind." / "Now it's a hundred times the tokens.") to test whether
the reasoning holds. Systems thinking only, never syntax or API trivia.
score: 0 = wrong or empty, 1 = vague, 2 = solid but missing a key point, 3 = would impress an interviewer.`;

async function grade({ session: id, questionId, answer, followUpOf }) {
  const { session, source } = await loadSession(id);
  const question = session.questions[questionId];
  if (!question) throw httpError(400, "unknown question");
  if (typeof answer !== "string" || !answer.trim()) {
    return { score: 0, verdict: "No answer given.", nailed: null, gap: null, followUp: null };
  }
  const extra = (session.repo.contextPaths ?? []).length
    ? await Promise.all(session.repo.contextPaths.map(async (c) => {
      const text = await readFile(c.path, "utf8");
      const lines = text.split("\n").slice(c.from - 1, c.to).join("\n");
      return `--- ${path.basename(c.path)} lines ${c.from}-${c.to} ---\n${lines}`;
    }))
    : [];
  const prompt = [
    `SOURCE (${path.basename(session.repo.sourcePath)}):\n${source}`,
    ...extra,
    `BACKGROUND: ${session.background}`,
    followUpOf
      ? `QUESTION (a follow-up after: "${question.prompt}"):\n${followUpOf}`
      : `QUESTION:\n${question.prompt}`,
    `RUBRIC (what a strong answer covers):\n- ${question.rubric.join("\n- ")}`,
    `ENGINEER'S ANSWER:\n${answer.slice(0, 4000)}`,
  ].join("\n\n");

  const result = await run("claude", [
    "-p",
    "--model", CLAUDE_MODEL,
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--setting-sources", "",
    "--system-prompt", GRADER_SYSTEM,
    "--output-format", "json",
  ], { input: prompt, timeoutMs: 120_000, cwd: tmpdir() });

  try {
    const envelope = JSON.parse(result.stdout);
    const text = String(envelope.result ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { ...parsed, score: Math.max(0, Math.min(3, Number(parsed.score) || 0)) };
  } catch {
    return keywordFallback(question, answer, result.stderr || result.stdout);
  }
}

/** If headless Claude is unavailable, grade on the rubric's keywords so the session still works. */
function keywordFallback(question, answer, why) {
  const lower = answer.toLowerCase();
  const hits = (question.keywords ?? []).filter((group) => group.some((k) => lower.includes(k)));
  const ratio = hits.length / Math.max(1, (question.keywords ?? []).length);
  return {
    score: ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0,
    verdict: "Graded offline on keywords: the Claude grader didn't answer.",
    nailed: null,
    gap: null,
    followUp: null,
    offline: String(why).slice(0, 200),
  };
}

// ---------------------------------------------------------------- http

function readBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(httpError(413, "too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw httpError(413, "too large");
  }
  return JSON.parse(body || "{}");
}

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

// Only this page may talk to the server. Any website you visit could otherwise POST to localhost
// (CSRF), or point its own domain at 127.0.0.1 and read the answers (DNS rebinding).
function allowed(req, port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || hosts.some((h) => origin === `http://${h}`);
}

const handler = (port) => async (req, res) => {
  try {
    if (!allowed(req, port)) throw httpError(403, "forbidden");
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/sessions") return send(res, 200, await listSessions());
    if (req.method === "GET" && url.pathname.startsWith("/api/session/")) {
      return send(res, 200, await loadSession(url.pathname.split("/").pop()));
    }
    if (req.method === "POST" && url.pathname === "/api/run") return send(res, 200, await runTests(await readJson(req)));
    if (req.method === "POST" && url.pathname === "/api/grade") return send(res, 200, await grade(await readJson(req)));
    // The conversation (the app). Everything below runs on this machine.
    const post = req.method === "POST";
    if (!post && url.pathname === "/api/home") return send(res, 200, await talk.home());
    if (!post && url.pathname === "/api/repos") return send(res, 200, await talk.suggestRepos());
    if (!post && url.pathname === "/api/file") return send(res, 200, await talk.readRepoFile(url.searchParams.get("file") ?? ""));
    if (post && url.pathname === "/api/scan") return send(res, 200, await talk.scanRepo((await readJson(req)).repo));
    if (post && url.pathname === "/api/profile") return send(res, 200, await talk.setProfile(await readJson(req)));
    if (post && url.pathname === "/api/prepare") return send(res, 200, await talk.prepare((await readJson(req)).file));
    if (post && url.pathname === "/api/talk/start") return send(res, 200, await talk.start(await readJson(req)));
    if (post && url.pathname === "/api/talk/turn") return send(res, 200, await talk.turn(await readJson(req)));
    if (post && url.pathname === "/api/talk/finish") return send(res, 200, await talk.finish(await readJson(req)));
    if (post && url.pathname === "/api/goal") return send(res, 200, await talk.setDailyGoal(await readJson(req)));
    if (post && url.pathname === "/api/confidence") return send(res, 200, await talk.rateConfidence(await readJson(req)));
    if (post && url.pathname === "/api/speak") return send(res, 200, await talk.speak(await readJson(req)), "audio/wav");
    if (!post && url.pathname === "/api/speech") return send(res, 200, talk.speechStatus());
    if (!post && url.pathname === "/api/hello") return send(res, 200, { app: "slop-academy" });
    if (post && url.pathname === "/api/transcribe") return send(res, 200, await talk.transcribe(await readBody(req)));
    if (req.method !== "GET") throw httpError(405, "method not allowed");

    // The checkout has the marketing page at /; the installed app opens straight into the app.
    const home = existsSync(path.join(ROOT, "public", "index.html")) ? "index.html" : "app.html";
    const rel = url.pathname === "/" ? home : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(ROOT, "public", rel);
    if (!file.startsWith(path.join(ROOT, "public"))) throw httpError(403, "forbidden");
    await stat(file).catch(() => { throw httpError(404, "not found"); });
    send(res, 200, await readFile(file), MIME[path.extname(file)] ?? "application/octet-stream");
  } catch (error) {
    send(res, error.status ?? 500, { error: error.message });
  }
};

/** Starts listening on 127.0.0.1:port. Resolves to the server, or rejects (e.g. EADDRINUSE). */
export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler(port));
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      talk.warmSpeech();
      resolve(server);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startServer();
  console.log(`Slop Academy on http://localhost:${PORT}`);
}
