# clean-vite stand

A manual live check of the zero-config flow on a clean project: one command (`web-remarq init`), `npm run dev`,
a mark in the browser, and Claude Code fixes the code with nobody typing.

`setup.sh` builds the working copy in `work/`: a fresh `npm create vite@latest` React app with its own git
repository, `web-remarq`, `@web-remarq/unplugin` and `@web-remarq/mcp` installed from tarballs packed from this
checkout, then `init` run in it. `work/` is disposable and ignored by git; `./setup.sh --fresh` recreates it.

## Prerequisites

- `npm install` and `npm run build` in the repo root (`setup.sh` builds nothing, it only checks the `dist/`
  folders of core, unplugin, mcp and cli).
- Network: `npm create vite@latest` and `npm install` fetch from the registry.
- `expect`, `lsof`, `curl`, `node`, and Claude Code (`~/.local/bin/claude` or `claude` on PATH), logged in.

## Order

1. `./setup.sh [--fresh] [--port <n>]` - packs the tarballs, scaffolds `work/app`, runs `init` and prints
   PASS/FAIL: `widget: true` in the Vite config, `.mcp.json`, `.claude/settings.local.json` and
   `.remarq/config.json` in `work/app`, no `.mcp.json` in the repo root, a second `init` changes nothing.
   `--port <n>` then writes `"port": n` to `work/app/.remarq/config.json` to check a custom MCP port.
2. `./start-dev.sh` - `npm run dev` on port 5173 in the background (`work/dev.log`); reports the injected widget
   script and the keys of `/__web-remarq/config.json`.
3. `./start-agent.sh` - one Claude Code session in `work/app` through `agent.exp` with exactly the command `init`
   prints: `claude --dangerously-load-development-channels server:web-remarq` (`work/agent.log`, ready when
   `work/agent.ready` exists, idle limit 15 minutes). Every start is a live session on the subscription.
4. Open http://localhost:5173/, enter annotation mode, click an element (for example the counter button), write a
   comment (for example "Rename 'count is' to 'Clicks:'"), submit.
5. `./status.sh` - dev server, MCP `/health`, session, annotations, `delivery.json`, `git diff --stat` of
   `work/app/src`.
6. `./stop.sh` - stops the session, its MCP server and the dev server; safe to run twice.

No script prints the local token or the contents of `.remarq/config.json`.

## The first `claude` start

Started by hand, the session shows two screens: "trust this folder" (it warns that
`.claude/settings.local.json` pre-approves tool permissions; the cursor starts on "No, exit" - select "Yes, I
trust this folder" and press Enter), then the development channels warning (Enter on "I am using this for local
development"). `agent.exp` answers both, and "No" to the external CLAUDE.md imports dialog when it appears.

## Expected result

The mark reaches the session through the channel, the agent edits the source file the mark points at
(`work/app/src/App.jsx`), calls `claim_fix`, and the mark becomes `fixed_unverified`. The change stays
uncommitted in `work/app` (see `./status.sh`).

## Run of 2026-11-21

Done on the earlier copy of this stand (Vite 8, `@vitejs/plugin-react`):

1. `init` in the app edited `vite.config.js` and wrote `.mcp.json`, `.remarq/config.json`,
   `.claude/settings.local.json`.
2. `port: 1829` was added to `.remarq/config.json` by hand to check the custom port.
3. `npm run dev` on 5173: widget injected, the mark saved through the MCP server on 1829.
4. The mark reached the Claude Code session through the channel. The first session (18:53) was not logged in.
5. The second session (19:58, logged in, Claude Max): the pending mark was redelivered, the agent changed
   "Count is" to "Clicks:" in `src/App.jsx` and called `claim_fix` (the turn took 9 s). Mark status:
   `fixed_unverified`.
