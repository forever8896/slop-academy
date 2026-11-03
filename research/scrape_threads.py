"""Pull top-level comments from r/cscareerquestions 'Interview Discussion' daily threads via Arctic Shift.
Appends substantive comments (>=250 chars, not bots) to raw/posts.jsonl as their own records."""
import json, sys, time, urllib.request, urllib.parse
from scrape_common import get

posts = [json.loads(l) for l in open("raw/posts.jsonl")]
seen = {p["id"] for p in posts}
threads = [p for p in posts if p["text"].startswith("Please use this thread") or "Interview Discussion" in p["title"]]
print(len(threads), "discussion threads", file=sys.stderr)
out = open("raw/posts.jsonl", "a")
kept = 0
for t in threads:
    tid = t["id"][2:]
    d = get("https://arctic-shift.photon-reddit.com/api/comments/search?" + urllib.parse.urlencode(
        {"link_id": tid, "limit": 100, "fields": "id,body,created_utc,score,parent_id,author"}))
    time.sleep(2)
    for c in (d or {}).get("data") or []:
        body = (c.get("body") or "").strip()
        if not c.get("parent_id", "").startswith("t3_") or len(body) < 250: continue
        if "I am a bot" in body or body in ("[removed]", "[deleted]") or c.get("author") == "AutoModerator": continue
        cid = "rc_" + c["id"]
        if cid in seen: continue
        seen.add(cid); kept += 1
        out.write(json.dumps({"id": cid, "source": t["source"] + " (discussion thread)", "title": t["title"], "text": body,
            "created": c["created_utc"], "score": c.get("score"), "comments": None, "flair": None,
            "url": f"https://reddit.com/r/cscareerquestions/comments/{tid}/_/{c['id']}"}) + "\n")
    out.flush()
print(kept, "comments kept", file=sys.stderr)
