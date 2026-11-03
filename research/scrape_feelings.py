"""Second corpus: developers talking about their own skills in the AI era (imposter feelings, atrophy, dependence).
Arctic Shift title search (single words) across dev subs + HN comment search. Writes raw/feelings.jsonl."""
import json, sys, time, urllib.parse, os
from scrape_common import get

AFTER = "2025-01-01"
SUBS = ["cscareerquestions", "ExperiencedDevs", "learnprogramming", "csMajors", "webdev", "programming",
        "developersIndia", "ClaudeAI", "ChatGPTCoding", "cursor", "vibecoding", "SoftwareEngineering", "cscareerquestionsEU"]
TERMS = ["imposter", "impostor", "atrophy", "rusty", "dependent", "dependence", "forgot", "forgetting", "deskilling",
         "dumber", "fraud", "confidence", "skills", "relying", "reliant", "crutch", "vibe"]
HN = ["imposter syndrome AI", "impostor syndrome", "skill atrophy", "forgot how to code", "deskilling", "can't code without",
      "dependent on copilot", "dependent on claude", "I feel like a fraud", "my skills are atrophying", "vibe coding skills",
      "losing my ability to code", "cognitive offloading"]

out_path = "raw/feelings.jsonl" if len(sys.argv) < 2 or sys.argv[1] != "hn" else "raw/feelings_hn.jsonl"
seen = set()
if os.path.exists(out_path):
    for line in open(out_path): seen.add(json.loads(line)["id"])
out = open(out_path, "a")
def keep(p):
    if p["id"] in seen or len(p["text"]) < 250: return
    seen.add(p["id"]); out.write(json.dumps(p) + "\n"); out.flush()

ONLY = sys.argv[1] if len(sys.argv) > 1 else "all"
for sub in (SUBS if ONLY in ("all", "reddit") else []):
    for term in TERMS:
        before, got = None, 0
        while got < 300:
            q = {"subreddit": sub, "title": term, "after": AFTER, "limit": 100,
                 "fields": "id,title,selftext,created_utc,score,num_comments,link_flair_text"}
            if before: q["before"] = before
            d = get("https://arctic-shift.photon-reddit.com/api/posts/search?" + urllib.parse.urlencode(q))
            time.sleep(2)
            rows = (d or {}).get("data") or []
            if not rows: break
            for r in rows:
                body = (r.get("selftext") or "").strip()
                if body in ("[removed]", "[deleted]"): continue
                keep({"id": "r_" + r["id"], "source": "reddit/" + sub, "title": r["title"], "text": body,
                      "created": r["created_utc"], "score": r.get("score"), "comments": r.get("num_comments"),
                      "url": f"https://reddit.com/r/{sub}/comments/{r['id']}"})
            got += len(rows); before = min(r["created_utc"] for r in rows)
            if len(rows) < 25: break
    print(f"{sub}: {len(seen)} kept total", file=sys.stderr)

since = 1735689600
for query in (HN if ONLY in ("all", "hn") else []):
    for page in range(5):
        q = {"query": query, "tags": "comment", "numericFilters": f"created_at_i>{since}", "hitsPerPage": 100, "page": page}
        d = get("https://hn.algolia.com/api/v1/search?" + urllib.parse.urlencode(q)); time.sleep(1)
        hits = (d or {}).get("hits") or []
        if not hits: break
        for h in hits:
            keep({"id": "hn_" + h["objectID"], "source": "hackernews", "title": h.get("story_title") or "",
                  "text": h.get("comment_text") or "", "created": h["created_at_i"], "score": h.get("points"),
                  "comments": None, "url": f"https://news.ycombinator.com/item?id={h['objectID']}"})
    print(f"hn / {query}: {len(seen)} kept total", file=sys.stderr)
print(len(seen), "posts in", out_path, file=sys.stderr)
