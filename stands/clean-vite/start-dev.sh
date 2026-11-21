#!/bin/bash
# Start `npm run dev` of work/app in the background on port 5173 (strict), then show
# whether the widget is injected and the keys of the dev-server config endpoint.
set -u
. "$(dirname "$0")/lib.sh"
[ -d "$APP" ] || { echo "$APP missing: run ./setup.sh first"; exit 1; }
if alive "$W/dev.pid"; then echo "dev server already running (pid $(cat "$W/dev.pid"))"; exit 1; fi
if lsof -ti :$DEV_PORT >/dev/null; then echo "port $DEV_PORT is busy"; exit 1; fi

cd "$APP"
nohup npm run dev -- --port $DEV_PORT --strictPort > "$W/dev.log" 2>&1 &
echo $! > "$W/dev.pid"
URL="http://localhost:$DEV_PORT"
for i in $(seq 1 60); do
  curl -fsS -o /dev/null "$URL/" 2>/dev/null && break
  if [ "$i" = 60 ]; then echo "dev server did not answer within 60s, see $W/dev.log"; exit 1; fi
  sleep 1
done
echo "dev server up: $URL/ (pid $(cat "$W/dev.pid"), log $W/dev.log)"

if curl -fsS "$URL/" | grep -q 'virtual:web-remarq/widget'; then echo "widget script: injected"; else echo "widget script: MISSING"; fi
# keys only (plus port): the response carries the local token
curl -sS "$URL/__web-remarq/config.json" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try { const j = JSON.parse(s); console.log("config.json keys: " + Object.keys(j).join(", ") + (j.port !== undefined ? "; port: " + j.port : "")) }
    catch { console.log("config.json: no JSON answer") }
  })'
