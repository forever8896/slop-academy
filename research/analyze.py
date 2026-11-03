"""Aggregate raw/labels.jsonl + raw/posts.jsonl into findings.json and a printed summary."""
import json, collections, datetime
posts = {p["id"]: p for p in map(json.loads, open("raw/posts.jsonl"))}
labels = [l for l in map(json.loads, open("raw/labels.jsonl")) if l["id"] in posts]
rel = [l for l in labels if l["relevant"]]
C = collections.Counter
def pct(n, d): return round(100 * n / d, 1) if d else 0
rounds = C(r["type"] for l in rel for r in l["rounds"])
posts_with = C(t for l in rel for t in {r["type"] for r in l["rounds"]})
def half(l):
    d = datetime.datetime.fromtimestamp(posts[l["id"]]["created"], datetime.UTC)
    return f"{d.year}-H{1 if d.month <= 6 else 2}"
by_half = collections.defaultdict(list)
for l in rel: by_half[half(l)].append(l)
trend = {h: {"n": len(ls),
             "ai_allowed_or_required": pct(sum(l["ai_policy"] in ("allowed", "required") for l in ls), len(ls)),
             "ai_banned": pct(sum(l["ai_policy"] == "banned" for l in ls), len(ls)),
             "cheating": pct(sum(l["cheating"] for l in ls), len(ls)),
             "own_work_probed": pct(sum(l["own_work_probed"] for l in ls), len(ls)),
             "ai_assisted_round": pct(sum(any(r["type"] == "ai_assisted_coding" for r in l["rounds"]) for l in ls), len(ls)),
             "project_deep_dive": pct(sum(any(r["type"] == "project_deep_dive" for r in l["rounds"]) for l in ls), len(ls))}
         for h, ls in sorted(by_half.items())}
def details(t, k=12):
    return [{"detail": r["detail"], "url": posts[l["id"]]["url"]} for l in rel for r in l["rounds"] if r["type"] == t][:k]
out = {
    "generated": datetime.date.today().isoformat(),
    "posts": len(posts), "labelled": len(labels), "relevant": len(rel),
    "sources": C(posts[l["id"]]["source"].split(" ")[0] for l in rel).most_common(),
    "perspective": C(l["perspective"] for l in rel).most_common(),
    "level": C(l["level"] for l in rel).most_common(),
    "round_share": {t: pct(n, len(rel)) for t, n in posts_with.most_common()},
    "ai_policy": C(l["ai_policy"] for l in rel).most_common(),
    "cheating_pct": pct(sum(l["cheating"] for l in rel), len(rel)),
    "own_work_probed_pct": pct(sum(l["own_work_probed"] for l in rel), len(rel)),
    "anxiety_pct": pct(sum(l["anxiety"] for l in rel), len(rel)),
    "outcome": C(l["outcome"] for l in rel).most_common(),
    "companies": C(l["company"].strip() for l in rel if l["company"]).most_common(30),
    "trend": trend,
    "pains": [l["pain"] for l in rel if l["pain"]],
    "takeaways": [l["takeaway"] for l in rel],
    "examples": {t: details(t) for t in ["ai_assisted_coding", "project_deep_dive", "code_review", "debugging", "practical_build"]},
}
json.dump(out, open("findings.json", "w"), indent=1)
for k in ["posts", "labelled", "relevant", "sources", "perspective", "level", "round_share", "ai_policy",
          "cheating_pct", "own_work_probed_pct", "anxiety_pct", "outcome", "trend"]:
    print(k, ":", json.dumps(out[k]))
print("companies:", out["companies"][:20])
