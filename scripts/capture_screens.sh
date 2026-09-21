#!/bin/bash
# Capture the product screenshots from a running demo (make demo) with headless Chrome.
#   scripts/capture_screens.sh [output dir] [base url]
# It resets the demo first and again at the end, so the shots are reproducible.
set -euo pipefail
OUT="${1:-docs/screens}"
BASE="${2:-http://localhost:8101}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
mkdir -p "$OUT"

shot() {  # shot <file> <path> [height]
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size=1600,"${3:-1200}" --virtual-time-budget=6000 --screenshot="$OUT/$1" "$BASE$2" >/dev/null 2>&1
  echo "  $OUT/$1"
}

curl -fsS -X POST "$BASE/api/reset" >/dev/null
HERO=$(curl -fsS "$BASE/api/quotes" | python3 -c 'import json,sys; print(next(q["id"] for q in json.load(sys.stdin)["quotes"] if q["status"]=="needs_approval"))')
echo "hero quote: $HERO"

shot 01-inbox.png "/inbox"
shot 02-quote-review.png "/quotes/$HERO"
shot 03-edit-quote-live-reprice.png "/quotes/$HERO?edit=1&lines=PMP-100*3*10,VLV-050*200*10,VLV-075*5&drop_unpriced=1"
shot 07-new-request.png "/inbox?new=1&sample=2"
shot 06-pricing-rules.png "/rules"
shot 08-overview.png "/overview"

# approve the hero quote through the API, exactly what the Approve and send button calls
curl -fsS -X POST "$BASE/api/quotes/$HERO/approve" -H 'content-type: application/json' -d '{"note":"Dana is a long standing account, 15% agreed. Valves to follow when stock lands."}' >/dev/null
shot 04-approved-and-sent.png "/quotes/$HERO"
shot 05-activity-log-decision-record.png "/activity?record=$HERO"

curl -fsS -X POST "$BASE/api/reset" >/dev/null
echo "done, demo reset"
