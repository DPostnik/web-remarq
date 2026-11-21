#!/bin/bash
# Start ONE live Claude Code session in work/app through expect (agent.exp), in the background.
set -u
. "$(dirname "$0")/lib.sh"
[ -d "$APP" ] || { echo "$APP missing: run ./setup.sh first"; exit 1; }
if alive "$W/agent.pid" || alive "$W/claude.pid"; then
  echo "a session already runs (expect pid $(cat "$W/agent.pid" 2>/dev/null)); ./stop.sh first"; exit 1
fi
command -v expect >/dev/null || { echo "expect not found"; exit 1; }
[ -x "$HOME/.local/bin/claude" ] || command -v claude >/dev/null || { echo "claude not found"; exit 1; }

rm -f "$W/agent.ready" "$W/claude.pid"
nohup expect "$D/agent.exp" > "$W/agent.expect.out" 2>&1 &
echo $! > "$W/agent.pid"
echo "session starting (expect pid $(cat "$W/agent.pid")); log: $W/agent.log"
echo "wait for $W/agent.ready and: curl http://127.0.0.1:$(mcp_port)/health"
