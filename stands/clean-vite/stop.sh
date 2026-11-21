#!/bin/bash
# Stop the session, its MCP server and the dev server of this stand. Safe to run twice.
set -u
. "$(dirname "$0")/lib.sh"
PORT="$(mcp_port)"
killpid() { [ -f "$1" ] && p="$(cat "$1")" && [ -n "$p" ] && kill "$p" 2>/dev/null; rm -f "$1"; }
killpid "$W/agent.pid"
killpid "$W/claude.pid"
sleep 2
# MCP server: the pid recorded in the store lock, plus any server started from this stand's app or by npx
if [ -f "$APP/.remarq/server.lock" ]; then
  p="$(node -e 'try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid) } catch {}' "$APP/.remarq/server.lock")"
  [ -n "$p" ] && kill "$p" 2>/dev/null
fi
pkill -f "$APP/node_modules/(\.bin/web-remarq-mcp|@web-remarq/mcp/)" 2>/dev/null
# npx runs the server from its cache (~/.npm/_npx/...), not from $APP: stop the listener on this stand's MCP
# port when its command line is the web-remarq MCP server
for p in $(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  ps -o command= -p "$p" 2>/dev/null | grep -qE 'web-remarq-mcp|@web-remarq/mcp' && kill "$p" 2>/dev/null
done
killpid "$W/dev.pid"
pkill -f "$APP/node_modules/(\.bin/vite|vite/bin/vite\.js)" 2>/dev/null
sleep 1
rm -f "$W/agent.ready"
for port in "$PORT" "$DEV_PORT"; do
  if lsof -ti :"$port" >/dev/null; then echo "port $port STILL BUSY: $(lsof -ti :"$port" | tr '\n' ' ')"; else echo "port $port free"; fi
done
[ -e "$ROOT/.mcp.json" ] && echo "repo root .mcp.json PRESENT (not created by this stand's scripts; check it)" || echo "repo root has no .mcp.json"
exit 0
