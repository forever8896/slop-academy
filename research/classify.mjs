// Classify scraped posts with a headless Claude (Haiku by default), 8 posts per call.
// Usage: node classify.mjs [--model haiku] [--concurrency 4] [--limit N]
// Reads raw/posts.jsonl, appends to raw/labels.jsonl (resumable).
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg("model", "haiku"), CONC = +arg("concurrency", 4), LIMIT = +arg("limit", 1e9);
const BATCH = 8, MAX_CHARS = 2500;

const ROUND_TYPES = ["leetcode_dsa", "take_home", "pair_programming", "system_design", "project_deep_dive",
  "code_review", "debugging", "ai_assisted_coding", "behavioral", "language_trivia", "practical_build", "other"];

const label = {
  type: "object", additionalProperties: false,
  required: ["id", "relevant", "perspective", "level", "company", "rounds", "ai_policy", "cheating", "own_work_probed",
    "outcome", "pain", "anxiety", "takeaway"],
  properties: {
    id: { type: "string" },
    relevant: { type: "boolean", description: "describes a real SWE interview process, round, or hiring practice (not just job-market venting)" },
    perspective: { enum: ["candidate", "interviewer", "both", "unclear"] },
    level: { enum: ["intern", "new_grad", "junior", "mid", "senior", "staff_plus", "unclear"] },
    company: { type: ["string", "null"], description: "named company or null" },
    rounds: { type: "array", items: { type: "object", additionalProperties: false, required: ["type", "detail"],
      properties: { type: { enum: ROUND_TYPES }, detail: { type: "string", description: "max 15 words, paraphrase" } } } },
    ai_policy: { enum: ["banned", "allowed", "required", "not_mentioned"] },
    cheating: { type: "boolean", description: "mentions AI cheating tools, cheating candidates, or anti-cheat measures" },
    own_work_probed: { type: "boolean", description: "interviewer dug into the candidate's own past projects/code/decisions" },
    outcome: { enum: ["offer", "rejected", "pending", "not_applicable"] },
    pain: { type: ["string", "null"], description: "main difficulty or failure reason, max 15 words, paraphrase" },
    anxiety: { type: "boolean", description: "expresses anxiety, freezing, imposter feelings, or skill atrophy from AI use" },
    takeaway: { type: "string", description: "what a candidate should prepare for, based on this post, max 20 words" },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["labels"],
  properties: { labels: { type: "array", items: label } } };

const SYSTEM = `You label posts about software-engineering job interviews for a research dataset.
Return one label per post, same ids. Paraphrase; never copy sentences. If a post isn't about a real interview
process or hiring practice, set relevant=false and keep other fields minimal (rounds=[], nulls, not_mentioned).
Rounds: list only rounds the post actually describes.`;

const posts = readFileSync("raw/posts.jsonl", "utf8").trim().split("\n").map(JSON.parse);
const done = new Set(existsSync("raw/labels.jsonl")
  ? readFileSync("raw/labels.jsonl", "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
const todo = posts.filter(p => !done.has(p.id)).slice(0, LIMIT);
const batches = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
console.log(`${posts.length} posts, ${done.size} labelled, ${todo.length} to do in ${batches.length} batches`);

function claude(prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
      "--setting-sources", "", "--system-prompt", SYSTEM, "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA)],
      { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", d => out += d); p.stderr.on("data", d => err += d);
    p.on("close", code => {
      try { const env = JSON.parse(out); resolve({ labels: env.structured_output?.labels || [], cost: env.total_cost_usd || 0 }); }
      catch { reject(new Error(`exit ${code}: ${err.slice(0, 200)}`)); }
    });
    p.stdin.end(prompt);
  });
}

let cost = 0, n = 0, next = 0;
async function worker() {
  while (next < batches.length) {
    const b = batches[next++];
    const prompt = b.map(p => `<post id="${p.id}" source="${p.source}">\n# ${p.title}\n${p.text.replace(/<[^>]+>/g, " ").slice(0, MAX_CHARS)}\n</post>`).join("\n\n");
    try {
      const r = await claude(prompt);
      const ids = new Set(b.map(p => p.id));
      for (const l of r.labels) if (ids.has(l.id)) { appendFileSync("raw/labels.jsonl", JSON.stringify(l) + "\n"); n++; }
      cost += r.cost;
      process.stdout.write(`\r${n} labelled, $${cost.toFixed(3)}   `);
    } catch (e) { console.error("\nbatch failed:", e.message); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\ndone: ${n} labels, $${cost.toFixed(3)}`);
