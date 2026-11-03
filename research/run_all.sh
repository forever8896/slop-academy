#!/usr/bin/env bash
# Finish the slow Reddit passes, backfill the interview corpus (archive timeouts used to be skipped), then relabel + reanalyse.
set -u
cd "$(dirname "$0")"
while pgrep -f "^python3 scrape_feelings.py" >/dev/null; do sleep 30; done
python3 scrape.py >> scrape.log 2>&1          # resumable: only adds posts it doesn't have
python3 scrape_threads.py >> scrape.log 2>&1
node classify.mjs > classify.log 2>&1
node deep.mjs > deep.log 2>&1
node classify_feelings.mjs > feelings_classify.log 2>&1
python3 analyze.py > analyze.out 2>&1; python3 analyze_deep.py > analyze_deep.out 2>&1; python3 analyze_feelings.py > analyze_feelings.out 2>&1
echo "finished $(date -Is)" > run_all.done
