// Turn questions.txt / signals.txt into counted themes.
// Step 1: Sonnet proposes themes from a sample. Step 2: Haiku assigns every line to a theme, so counts are real.
// Usage: node themes.mjs questions|signals
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const which = process.argv[2] || "questions";
const lines = readFileSync(`${which}.txt`, "utf8").trim().split("\n").map(l => l.split("\t")[1]).filter(Boolean);
const WHAT = {
  questions: "interview questions and tasks candidates report being given (behavioral excluded)",
  signals: "statements by interviewers and candidates about what actually separates good candidates",
  triggers: "moments when developers noticed AI tools were eroding their own skills or confidence",
}[which];

function claude(model, system, prompt, schema) {
  return new Promise((resolve, reject) => {
    const p = spawn("claude", ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--no-session-persistence",
      "--setting-sources", "", "--system-prompt", system, "--output-format", "json", "--json-schema", JSON.stringify(schema)],
      { stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; p.stdout.on("data", d => out += d);
    p.on("close", () => { try { const e = JSON.parse(out); resolve({ data: e.structured_output, cost: e.total_cost_usd }); } catch (e) { reject(e); } });
    p.stdin.end(prompt);
  });
}

const sample = [...lines].sort(() => Math.random() - 0.5).slice(0, 900);
const t = await claude("sonnet",
  `You build a taxonomy for a research dataset of ${WHAT}. Propose 14-22 mutually exclusive themes that cover the sample well. Specific beats generic ("explain a past project's design trade-offs" beats "projects"). Include a catch-all "other".`,
  sample.map((l, i) => `${i}. ${l}`).join("\n"),
  { type: "object", additionalProperties: false, required: ["themes"], properties: { themes: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["id", "name", "definition"],
    properties: { id: { type: "string", description: "short snake_case" }, name: { type: "string" }, definition: { type: "string" } } } } } });
const themes = t.data.themes;
let cost = t.cost;
console.log(`${themes.length} themes, $${cost.toFixed(3)}`);

const ids = themes.map(x => x.id);
const counts = Object.fromEntries(ids.map(i => [i, 0])), examples = Object.fromEntries(ids.map(i => [i, []]));
const BATCH = 120, batches = [];
for (let i = 0; i < lines.length; i += BATCH) batches.push(lines.slice(i, i + BATCH));
const sys = `Assign each numbered line to exactly one theme id.\nThemes:\n${themes.map(x => `- ${x.id}: ${x.definition}`).join("\n")}`;
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < batches.length) {
    const b = batches[next++];
    try {
      const r = await claude("haiku", sys, b.map((l, i) => `${i}. ${l}`).join("\n"),
        { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "array", items: {
          type: "object", additionalProperties: false, required: ["i", "t"], properties: { i: { type: "integer" }, t: { enum: ids } } } } } });
      cost += r.cost;
      for (const { i, t } of r.data.a) if (b[i] != null) { counts[t]++; if (examples[t].length < 6) examples[t].push(b[i]); }
    } catch (e) { console.error("batch failed", e.message); }
  }
}));
const total = Object.values(counts).reduce((a, b) => a + b, 0);
const result = themes.map(x => ({ ...x, n: counts[x.id], pct: +(100 * counts[x.id] / total).toFixed(1), examples: examples[x.id] }))
  .sort((a, b) => b.n - a.n);
writeFileSync(`themes_${which}.json`, JSON.stringify({ total, cost, themes: result }, null, 1));
for (const r of result) console.log(`${String(r.pct).padStart(5)}%  ${r.n.toString().padStart(4)}  ${r.name}`);
console.log(`assigned ${total}/${lines.length}, $${cost.toFixed(3)}`);
