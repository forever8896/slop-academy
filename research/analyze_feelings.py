"""Aggregate the skills-and-feelings corpus. Writes feelings_findings.json and triggers.txt."""
import json, collections, datetime, os
P = {}
for f in ["raw/feelings.jsonl", "raw/feelings_hn.jsonl"]:
    if os.path.exists(f):
        for l in open(f): p = json.loads(l); P[p["id"]] = p
L = [l for l in map(json.loads, open("raw/feelings_labels.jsonl")) if l["id"] in P]
rel = [l for l in L if l["relevant"]]
pct = lambda n, d: round(100 * n / d, 1) if d else 0
C = collections.Counter
ai = [l for l in rel if l["ai_link"] == "ai_is_cause"]
def share(group, key): return pct(sum(l[key] for l in group), len(group))
def half(l):
    t = datetime.datetime.fromtimestamp(P[l["id"]]["created"], datetime.UTC); return f"{t.year}-H{1 if t.month <= 6 else 2}"
by_half = collections.defaultdict(list)
for l in rel: by_half[half(l)].append(l)
out = {
    "labelled": len(L), "relevant": len(rel),
    "sources": C(P[l["id"]]["source"] for l in rel).most_common(),
    "ai_link": C(l["ai_link"] for l in rel).most_common(),
    "among_relevant": {k: share(rel, k) for k in ["imposter", "atrophy", "dependence", "interview_fear"]},
    "among_ai_caused": {"n": len(ai), **{k: share(ai, k) for k in ["imposter", "atrophy", "dependence", "interview_fear"]}},
    "imposter_with_ai_cause": pct(sum(l["imposter"] and l["ai_link"] == "ai_is_cause" for l in rel), sum(l["imposter"] for l in rel)),
    "stance": C(l["stance"] for l in rel).most_common(),
    "stance_ai_caused": C(l["stance"] for l in ai).most_common(),
    "level": C(l["level"] for l in rel).most_common(),
    "level_ai_caused": C(l["level"] for l in ai).most_common(),
    "wants": C(w for l in rel for w in l["wants"]).most_common(),
    "trend": {h: {"n": len(ls), "ai_is_cause": pct(sum(l["ai_link"] == "ai_is_cause" for l in ls), len(ls)),
                  "atrophy": share(ls, "atrophy"), "imposter": share(ls, "imposter")} for h, ls in sorted(by_half.items())},
}
json.dump(out, open("feelings_findings.json", "w"), indent=1)
with open("triggers.txt", "w") as f:
    for l in ai:
        if l["trigger"]: f.write(f'ai\t{l["trigger"]}\n')
for k, v in out.items(): print(k, ":", json.dumps(v))
