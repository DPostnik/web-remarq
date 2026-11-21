# Sourced by the stand scripts: paths and small helpers. Never prints the token.
D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$D/../.." && pwd)"
W="$D/work"
APP="$W/app"
DEV_PORT=5173

# true when the pid stored in file $1 is a live process
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

# version of package $1 in work/app/node_modules, or "-"
installed_version() {
  node -p 'try { JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version } catch { "-" }' "$APP/node_modules/$1/package.json"
}

# `dist-tags.latest` of package $1 straight from the registry (`npm view` can serve stale metadata), or "-"
registry_latest() {
  node -e '
    fetch("https://registry.npmjs.org/" + process.argv[1].replace("/", "%2F"), { cache: "no-store" })
      .then((r) => r.json()).then((j) => console.log(j["dist-tags"].latest)).catch(() => console.log("-"))
  ' "$1"
}

# version of package $1 (bin $2) that `npx -y <package>` run in work/app resolves: the local
# node_modules copy when the app lists it, else the npx cache / registry; "-" on failure
npx_version() {
  (cd "$APP" && BIN="$2" npx -y -p "$1" -c 'node -e "
    const fs = require(\"fs\"), path = require(\"path\");
    let d = path.dirname(fs.realpathSync(process.argv[1]));
    while (!fs.existsSync(path.join(d, \"package.json\"))) d = path.dirname(d);
    console.log(JSON.parse(fs.readFileSync(path.join(d, \"package.json\"), \"utf8\")).version);
  " "$(command -v "$BIN")"') 2>/dev/null || echo "-"
}

# MCP port:`port` from app/.remarq/config.json, else 1817 (reads only that key)
mcp_port() {
  node -e 'try { const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).port; console.log(Number.isInteger(p) ? p : 1817) } catch { console.log(1817) }' "$APP/.remarq/config.json"
}
