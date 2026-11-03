// Label the skills-and-feelings corpus (raw/feelings.jsonl) -> raw/feelings_labels.jsonl (resumable).
// Usage: node classify_feelings.mjs [--model haiku] [--concurrency 6] [--limit N]
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg("model", "haiku"), CONC = +arg("concurrency", 6), LIMIT = +arg("limit", 1e9);
const BATCH = 8, MAX_CHARS = 2500;

const label = {
  type: "object", additionalProperties: false,
  required: ["id", "relevant", "ai_link", "imposter", "atrophy", "dependence", "interview_fear", "level", "stance", "trigger", "wants"],
  properties: {
    id: { type: "string" },
    relevant: { type: "boolean", description: "the author talks about their OWN skills, confidence, learning or worth as a developer" },
    ai_link: { enum: ["ai_is_cause", "ai_mentioned_not_cause", "no_ai"], description: "does the author attribute the feeling to using AI tools?" },
    imposter: { type: "boolean", description: "feels like a fraud, not a real engineer, undeserving, or afraid of being found out" },
    atrophy: { type: "boolean", description: "feels their skills declining, forgot basics, or can't code/think without AI" },
    dependence: { type: "boolean", description: "describes relying on AI for work they used to do or should be able to do" },
    interview_fear: { type: "boolean", description: "fears live coding, interviews, or explaining their own code to others" },
    level: { enum: ["student", "junior", "mid", "senior", "staff_plus", "unclear"] },
    stance: { enum: ["distressed", "worried", "neutral", "positive_ai_helps", "dismissive_of_concern"] },
    trigger: { type: ["string", "null"], description: "the moment that made them notice, paraphrased, max 15 words; null if none" },
    wants: { type: "array", items: { enum: ["practice_without_ai", "understand_own_code", "fundamentals", "systems_design", "interview_prep", "mentorship", "slow_down_learning", "other"] },
      description: "what they say they want or are doing about it" },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["labels"],
  properties: { labels: { type: "array", items: label } } };

const SYSTEM = `You label posts and comments by software developers for a research dataset about how developers feel about their own skills.
Return one label per post, same ids. Paraphrase; never copy sentences. Judge only what the author says about THEMSELVES
(not general opinions about the industry or other people). If the author isn't talking about their own skills or confidence,
set relevant=false, ai_link=no_ai, all booleans false, stance=neutral, trigger=null, wants=[].`;

const posts = ["raw/feelings.jsonl", "raw/feelings_hn.jsonl"].filter(existsSync).flatMap((f) => readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
const done = new Set(existsSync("raw/feelings_labels.jsonl")
  ? readFileSync("raw/feelings_labels.jsonl", "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
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
      for (const l of r.labels) if (ids.has(l.id)) { appendFileSync("raw/feelings_labels.jsonl", JSON.stringify(l) + "\n"); n++; }
      cost += r.cost;
      process.stdout.write(`\r${n} labelled, $${cost.toFixed(3)}   `);
    } catch (e) { console.error("\nbatch failed:", e.message); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\ndone: ${n} labels, $${cost.toFixed(3)}`);
