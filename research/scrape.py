"""Pull interview-experience posts from the Arctic Shift Reddit archive and HN Algolia.
Polite: one request at a time, 2s apart. Output: raw/posts.jsonl (deduped by id)."""
import json, sys, time, urllib.request, urllib.error, urllib.parse, os

# Archives ask scrapers for a contact. Set SLOP_RESEARCH_CONTACT to your own email when you re-run this.
UA = f"slop-academy-research/0.1 (contact: {os.environ.get('SLOP_RESEARCH_CONTACT', 'https://github.com/forever8896/slop-academy')})"
AFTER = "2025-01-01"
SUBS = ["cscareerquestions", "ExperiencedDevs", "leetcode", "csMajors", "cscareerquestionsEU",
        "cscareerquestionsCAD", "webdev", "programming", "recruitinghell", "developersIndia"]
TERMS = ["interview", "interviews", "interviewing", "onsite", "takehome", "leetcode", "cheating", "interviewer"]

def get(url, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                d = json.load(r)
            if isinstance(d, dict) and d.get("error"):
                raise RuntimeError(d["error"])
            return d
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500 and e.code not in (422, 429):
                print("  skip", e.code, url[:120], file=sys.stderr); return None
            print("  retry", attempt, e, file=sys.stderr); time.sleep(15 * (attempt + 1))
            if e.code == 422 and "limit=100" in url:
                url = url.replace("limit=100", "limit=25"); req = urllib.request.Request(url, headers={"User-Agent": UA})
        except Exception as e:
            print("  retry", attempt, e, file=sys.stderr); time.sleep(15 * (attempt + 1))
    return None

out_path = "raw/posts.jsonl"
seen = set()
if os.path.exists(out_path):
    for line in open(out_path): seen.add(json.loads(line)["id"])
out = open(out_path, "a")

def keep(p):
    if p["id"] in seen or len(p["text"]) < 300: return
    seen.add(p["id"]); out.write(json.dumps(p) + "\n"); out.flush()

# Reddit via Arctic Shift, paging backwards with `before`
for sub in SUBS:
    for term in TERMS:
        before, got = None, 0
        while got < 400:
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
                      "flair": r.get("link_flair_text"), "url": f"https://reddit.com/r/{sub}/comments/{r['id']}"})
            got += len(rows)
            before = min(r["created_utc"] for r in rows)
            if len(rows) < 25: break
        print(f"{sub} / {term}: {got} fetched, {len(seen)} kept total", file=sys.stderr)

# Hacker News comments (long ones) about interviews in the AI era
since = 1735689600  # 2025-01-01
for query in ["technical interview", "coding interview AI", "interview leetcode", "take-home assignment", "interviewing candidates AI", "system design interview"]:
    for page in range(10):
        q = {"query": query, "tags": "comment", "numericFilters": f"created_at_i>{since}", "hitsPerPage": 100, "page": page}
        d = get("https://hn.algolia.com/api/v1/search?" + urllib.parse.urlencode(q))
        time.sleep(1)
        hits = (d or {}).get("hits") or []
        if not hits: break
        for h in hits:
            keep({"id": "hn_" + h["objectID"], "source": "hackernews", "title": h.get("story_title") or "",
                  "text": h.get("comment_text") or "", "created": h["created_at_i"], "score": h.get("points"),
                  "comments": None, "flair": None, "url": f"https://news.ycombinator.com/item?id={h['objectID']}"})
    print(f"hn / {query}: {len(seen)} kept total", file=sys.stderr)
print(len(seen), "posts in", out_path)
