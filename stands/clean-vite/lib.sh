# Sourced by the stand scripts: paths and small helpers. Never prints the token.
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$D/../.." && pwd)"
W="$D/work"
APP="$W/app"
DEV_PORT=5173

# true when the pid stored in file $1 is a live process
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# MCP port: `port` from app/.remarq/config.json, else 1817 (reads only that key)
mcp_port() {
  node -e 'try { const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).port; console.log(Number.isInteger(p) ? p : 1817) } catch { console.log(1817) }' "$APP/.remarq/config.json"
}
