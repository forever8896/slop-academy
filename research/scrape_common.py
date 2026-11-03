import json, os, sys, time, urllib.request, urllib.error
# Archives ask scrapers for a contact. Set SLOP_RESEARCH_CONTACT to your own email when you re-run this.
UA = f"slop-academy-research/0.1 (contact: {os.environ.get('SLOP_RESEARCH_CONTACT', 'https://github.com/forever8896/slop-academy')})"

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

