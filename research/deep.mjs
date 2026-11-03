// Second pass over relevant first-hand/interviewer posts: refined round types, questions asked, failure modes.
// Usage: node deep.mjs [--model haiku] [--concurrency 6] [--limit N]
// Reads raw/posts.jsonl + raw/labels.jsonl, appends to raw/deep.jsonl (resumable).
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg("model", "haiku"), CONC = +arg("concurrency", 6), LIMIT = +arg("limit", 1e9);
const BATCH = 8, MAX_CHARS = 2500;

const ROUND_TYPES = ["online_assessment", "leetcode_live", "verbal_technical", "system_design", "take_home",
  "practical_build", "ai_assisted_coding", "ai_interviewer", "project_deep_dive", "code_review", "debugging",
  "pair_programming", "behavioral", "hiring_manager", "other"];
const FAILURES = ["couldnt_solve", "ran_out_of_time", "froze_or_nerves", "couldnt_explain_reasoning", "weak_fundamentals",
  "communication", "accused_or_suspected_of_ai", "process_or_ghosted", "none_or_unclear"];

const label = {
  type: "object", additionalProperties: false,
  required: ["id", "rounds", "questions", "follow_up_probing", "failure", "interviewer_signal"],
  properties: {
    id: { type: "string" },
    rounds: { type: "array", items: { enum: ROUND_TYPES },
      description: "online_assessment=automated test (HackerRank/CodeSignal OA); verbal_technical=spoken conceptual/fundamentals Q&A; ai_interviewer=the interview itself is run by an AI bot or AI-scored recording; hiring_manager=HM/culture chat" },
    questions: { type: "array", maxItems: 6, items: { type: "object", additionalProperties: false, required: ["q", "kind"],
      properties: { q: { type: "string", description: "a concrete question or task the interviewer gave, paraphrased, max 20 words" },
        kind: { enum: ["dsa", "system_design", "fundamentals", "own_project", "debug_or_review", "behavioral", "domain", "other"] } } },
      description: "only questions actually asked in a described interview; empty if none are described" },
    follow_up_probing: { type: "boolean", description: "interviewer drilled in with why/what-if follow-ups or asked to justify decisions" },
    failure: { enum: FAILURES, description: "main reason the candidate struggled or was rejected" },
    interviewer_signal: { type: ["string", "null"], description: "what the interviewer/poster says actually separates good candidates, max 20 words; null if not stated" },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["labels"],
  properties: { labels: { type: "array", items: label } } };

const SYSTEM = `You extract structured detail from posts about software-engineering interviews for a research dataset.
Return one label per post, same ids. Paraphrase; never copy sentences. Only record what the post actually says.`;

const rel = new Set(readFileSync("raw/labels.jsonl", "utf8").trim().split("\n").map(JSON.parse)
  .filter(l => l.relevant && l.perspective !== "unclear").map(l => l.id));
const posts = readFileSync("raw/posts.jsonl", "utf8").trim().split("\n").map(JSON.parse).filter(p => rel.has(p.id));
const done = new Set(existsSync("raw/deep.jsonl")
  ? readFileSync("raw/deep.jsonl", "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
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
      for (const l of r.labels) if (ids.has(l.id)) { appendFileSync("raw/deep.jsonl", JSON.stringify(l) + "\n"); n++; }
      cost += r.cost;
      process.stdout.write(`\r${n} labelled, $${cost.toFixed(3)}   `);
    } catch (e) { console.error("\nbatch failed:", e.message); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\ndone: ${n} labels, $${cost.toFixed(3)}`);
