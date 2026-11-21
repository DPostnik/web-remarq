#!/bin/bash
# Regenerate work/: a fresh Vite React app with its own git repo, this checkout's packed
# tarballs installed, then `web-remarq init` and PASS/FAIL checks.
# Usage: ./setup.sh [--fresh] [--port <n>]
set -euo pipefail
. "$(dirname "$0")/lib.sh"

FRESH=0
PORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fresh) FRESH=1 ;;
    --port) PORT="${2:-}"; shift ;;
    *) echo "unknown argument: $1 (usage: ./setup.sh [--fresh] [--port <n>])"; exit 2 ;;
  esac
  shift
done
if [ -n "$PORT" ] && ! [[ "$PORT" =~ ^[1-9][0-9]*$ && "$PORT" -le 65535 ]]; then
  echo "--port needs a number 1-65535"; exit 2
fi

CLI="$ROOT/packages/cli/bin/web-remarq-cli.mjs"
[ -f "$CLI" ] || { echo "not inside the web-remarq repo: $CLI missing"; exit 1; }
for p in core unplugin mcp cli; do
  [ -d "$ROOT/packages/$p/dist" ] || { echo "packages/$p/dist missing: run 'npm run build' in $ROOT first"; exit 1; }
done

if [ -e "$W" ]; then
  [ "$FRESH" = 1 ] || { echo "$W already exists; run with --fresh to recreate it"; exit 1; }
  if alive "$W/dev.pid" || alive "$W/agent.pid" || alive "$W/claude.pid"; then
    echo "the stand is running; run ./stop.sh first"; exit 1
  fi
  # delete only this stand's own work directory, never a symlink or anything else
  if [ "$(basename "$D")" != clean-vite ] || [ "$(basename "$(dirname "$D")")" != stands ] || [ -L "$W" ] || [ ! -d "$W" ]; then
    echo "refusing to delete $W"; exit 1
  fi
  rm -rf "$W"
fi

ROOT_MCP_BEFORE=0
[ -e "$ROOT/.mcp.json" ] && ROOT_MCP_BEFORE=1

g() { git -C "$APP" -c user.name="clean-vite stand" -c user.email=stand@example.invalid -c commit.gpgsign=false "$@"; }

mkdir -p "$W/tarballs"
echo "=== npm pack core, unplugin, mcp -> work/tarballs"
for p in core unplugin mcp; do
  (cd "$ROOT/packages/$p" && npm pack --pack-destination "$W/tarballs")
done

echo "=== npm create vite (react) -> work/app"
(cd "$W" && npm create --yes vite@latest app -- --template react --no-interactive)

echo "=== git init + first commit (init finds the repo root by .git)"
g init -q
g add -A
g commit -qm "vite scaffold"

echo "=== npm install + local tarballs"
(cd "$APP" && npm install && npm install -D "$W"/tarballs/*.tgz)
g add -A
g commit -qm "install web-remarq tarballs"

echo "=== web-remarq init"
(cd "$APP" && node "$CLI" init)

set +e
FAILS=0
check() { if [ "$1" = 0 ]; then echo "PASS $2"; else echo "FAIL $2"; FAILS=$((FAILS + 1)); fi; }

echo "=== checks"
grep -qs 'widget: true' "$APP"/vite.config.*; check $? "vite config contains 'widget: true'"
[ -f "$APP/.mcp.json" ]; check $? "work/app/.mcp.json exists"
[ -f "$APP/.claude/settings.local.json" ]; check $? "work/app/.claude/settings.local.json exists"
[ -f "$APP/.remarq/config.json" ]; check $? "work/app/.remarq/config.json exists"
[ "$ROOT_MCP_BEFORE" = 1 ] || [ ! -e "$ROOT/.mcp.json" ]; check $? "repo root has no .mcp.json from this run"
BEFORE="$(g status --porcelain)"
(cd "$APP" && node "$CLI" init > "$W/init-2.log" 2>&1); RC=$?
[ "$RC" = 0 ] && [ "$BEFORE" = "$(g status --porcelain)" ]; check $? "second init changes nothing (git status --porcelain; output in work/init-2.log)"

if [ -n "$PORT" ]; then
  node -e '
    const fs = require("fs"); const f = process.argv[1];
    const c = JSON.parse(fs.readFileSync(f, "utf8")); c.port = Number(process.argv[2]);
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  ' "$APP/.remarq/config.json" "$PORT"
  check $? "port $PORT written to work/app/.remarq/config.json"
fi

if [ "$FAILS" -gt 0 ]; then echo "$FAILS check(s) FAILED"; exit 1; fi
echo "all checks passed; next: ./start-dev.sh"
