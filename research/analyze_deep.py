"""Aggregate raw/deep.jsonl joined with labels/posts. Writes deep_findings.json and questions.txt / signals.txt."""
import json, collections, datetime
P = {p["id"]: p for p in map(json.loads, open("raw/posts.jsonl"))}
L = {l["id"]: l for l in map(json.loads, open("raw/labels.jsonl"))}
D = [d for d in map(json.loads, open("raw/deep.jsonl")) if d["id"] in P]
pct = lambda n, d: round(100 * n / d, 1) if d else 0
cand = [d for d in D if L[d["id"]]["perspective"] in ("candidate", "both") and d["rounds"]]
inter = [d for d in D if L[d["id"]]["perspective"] in ("interviewer", "both")]
def year_half(d):
    t = datetime.datetime.fromtimestamp(P[d["id"]]["created"], datetime.UTC); return f"{t.year}-H{1 if t.month <= 6 else 2}"
rs = collections.Counter(r for d in cand for r in set(d["rounds"]))
trend = collections.defaultdict(collections.Counter); n_half = collections.Counter()
for d in cand:
    h = year_half(d); n_half[h] += 1
    for r in set(d["rounds"]): trend[h][r] += 1
    if d["follow_up_probing"]: trend[h]["_follow_up"] += 1
qs = [q for d in D for q in d["questions"]]
fails = collections.Counter(d["failure"] for d in cand if d["failure"] != "none_or_unclear")
out = {
    "extracted": len(D), "candidate_reports": len(cand), "interviewer_posts": len(inter),
    "round_share_candidate": {k: pct(v, len(cand)) for k, v in rs.most_common()},
    "follow_up_probing_pct": pct(sum(d["follow_up_probing"] for d in cand), len(cand)),
    "failure_share": {k: pct(v, sum(fails.values())) for k, v in fails.most_common()},
    "failures_n": sum(fails.values()),
    "question_kinds": collections.Counter(q["kind"] for q in qs).most_common(), "questions_n": len(qs),
    "trend": {h: {"n": n_half[h], **{k: pct(v, n_half[h]) for k, v in trend[h].most_common()
               if k in ("ai_assisted_coding", "ai_interviewer", "project_deep_dive", "online_assessment", "leetcode_live", "take_home", "verbal_technical", "_follow_up")}}
              for h in sorted(n_half)},
    "signals_n": sum(1 for d in inter if d["interviewer_signal"]),
}
json.dump(out, open("deep_findings.json", "w"), indent=1)
with open("questions.txt", "w") as f:
    for q in qs:
        if q["kind"] != "behavioral": f.write(f'{q["kind"]}\t{q["q"]}\n')
with open("signals.txt", "w") as f:
    for d in D:
        if d["interviewer_signal"]: f.write(f'{L[d["id"]]["perspective"]}\t{d["interviewer_signal"]}\n')
for k, v in out.items(): print(k, ":", json.dumps(v))
