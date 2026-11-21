#!/bin/bash
# Dev server, MCP health, session, annotations, delivery ledger and the source diff of work/app.
set -u
. "$(dirname "$0")/lib.sh"
S="$APP/.remarq"
PORT="$(mcp_port)"
MODE="$(cat "$W/mode" 2>/dev/null || echo unknown)"
echo "mode: $MODE"
echo "installed: web-remarq $(installed_version web-remarq), @web-remarq/unplugin $(installed_version @web-remarq/unplugin), @web-remarq/mcp $(installed_version @web-remarq/mcp)"
# without a local copy, .mcp.json's `npx -y @web-remarq/mcp` runs the npx-resolved one
[ "$(installed_version @web-remarq/mcp)" = - ] && [ -d "$APP" ] && echo "MCP server via npx: @web-remarq/mcp $(npx_version @web-remarq/mcp web-remarq-mcp)"
if curl -fsS -o /dev/null "http://localhost:$DEV_PORT/" 2>/dev/null; then echo "dev server: UP (http://localhost:$DEV_PORT/)"; else echo "dev server: down"; fi
echo "MCP /health on $PORT: $(curl -sS -m 3 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo down)"
if alive "$W/agent.pid"; then echo "session: running (ready: $(cat "$W/agent.ready" 2>/dev/null || echo not yet))"; else echo "session: not running"; fi
echo "annotations:"
if [ -f "$S/annotations.json" ]; then
  node -e '
    const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const list = Object.values(s.annotations ?? {});
    if (!list.length) console.log("  (none)");
    for (const a of list) console.log("  " + a.id + "  " + a.status + "  " + (a.fingerprint?.sourceLocation ?? "-") + "  " + (a.comment || "").slice(0, 70));
  ' "$S/annotations.json"
else echo "  (no data file)"; fi
echo "delivery.json:"; cat "$S/delivery.json" 2>/dev/null || echo "  (none)"
echo "source diff (work/app/src):"
git -C "$APP" diff --stat -- src 2>/dev/null | cat
exit 0
