# @web-remarq/cli

Installer and doctor for [web-remarq](https://github.com/DPostnik/web-remarq) -
detects your stack, installs the right packages, wires the build plugin and
Claude Code, and verifies the result. For Vite apps one `init` is the whole
setup: start the dev server, run the printed `claude ...` command, and marks
you leave in the browser reach Claude Code and get fixed without typing.

## Commands

```bash
npx @web-remarq/cli init [--app <dir>] [--json]
npx @web-remarq/cli doctor [--app <dir>] [--json]
```

- `init` - in the repository root writes `.mcp.json`, `.remarq/config.json`
  (project id + local token, gitignored) and `.claude/settings.local.json`;
  in the app installs the packages its `package.json` does not list yet and,
  for Vite, registers the build plugin in the config file (see below). It
  then prints what it did and the next steps, including the command that
  starts the session:

  ```bash
  claude --dangerously-load-development-channels server:web-remarq
  ```

  The flag lets the web-remarq MCP server push marks into the open session.
  The first start shows two screens: "trust this folder", which warns that
  `.claude/settings.local.json` pre-approves tool permissions and starts with
  the cursor on "No, exit" - select "Yes, I trust this folder" and press
  Enter; then the development channels warning - press Enter on the default
  "I am using this for local development". There is no separate approval
  prompt for the MCP server. Run `init` again at any time: a run with nothing
  to do changes no file.
- `doctor` - checks the setup and explains what is wrong. Its `mcp-server`
  check authenticates with the token from `.remarq/config.json`: `ok` means
  the server answered AND accepted the token; a refused token, an older
  server (protocol 1) or a missing token are `fail` with a hint; nothing
  listening is `blocked` (the server starts with your agent).

  Its `widget-init` check is `ok` when the `remarq()` call in the Vite config
  has `widget: true` (or the entry calls `WebRemarq.init`) and the installed
  packages are new enough for it (`fail` names the minimum), and the probe uses
  `port` from `.remarq/config.json` when set (default 1817).

`--app <dir>` points at the app package inside a monorepo, relative to the
repository root - use it when more than one app is detected, or when the
command is not run from the app directory. `--json` prints machine-readable
output instead of the human-readable report.

Supported stacks: Next.js, Vite (Vue/React/vanilla), and plain HTML pages.

## What `init` changes

**Vite config** (Vue, React, vanilla). The config is edited as text and never
executed. `init` adds `import remarq from '@web-remarq/unplugin/vite'` after
the last import (`const remarq = require('@web-remarq/unplugin/vite').default`
in a CommonJS config) and appends `remarq({ widget: true, include: [...] })`
at the end of the `plugins` array; in dev the plugin then injects the widget
into `index.html`, so the entry file is not touched. When `remarq()` is already
registered with no options or an inline options object, only `widget: true` is
added. When `widget` is already set, nothing changes. When the entry already
calls `WebRemarq.init`, the plugin is registered without `widget: true`, so the
widget does not start twice.

Packages the app's `package.json` already lists are not reinstalled, except on
Vite when the installed `web-remarq` is below 0.10.0 or `@web-remarq/unplugin`
below 0.3.0: older versions ignore `widget: true`, so `init` installs the
latest ones.

Nothing is written, and the edit is printed for you (with the reason) instead,
when the file is not clear enough to edit safely: no config file, no inline
`plugins: [...]` array or more than one, the plugin coming from a shared
preset, options passed as a variable, unbalanced brackets, or an edited text
that does not read back as expected. Only the inserted text is new; line
endings, quotes, semicolons and indentation follow the file.

**`.claude/settings.local.json`** (personal, not committed). `permissions.allow`
gains the web-remarq tools (`claim_fix`, `dismiss`, `get_annotation`,
`list_annotations`, `acknowledge`) plus `Read`, `Glob` and `Grep`;
`enabledMcpjsonServers` gains `web-remarq`; `permissions.defaultMode` is set to
`acceptEdits`, so the session applies fixes without asking, only when you have
not set a mode yourself. Existing entries and keys are kept. A file that is
not valid JSON is never overwritten: `init` stops and says so.

Next.js and plain HTML pages work as before: Next.js gets two printed edits
(wrap the config, render a client component); plain HTML gets a script tag.

## Doctor statuses

- `ok` - nothing to do.
- `fail` - your problem: something is missing or misconfigured, fix it with
  the given `hint` and run doctor again.
- `blocked` - not your problem: either the setup is correct but needs a human
  action (restarting the agent or the dev server), or doctor could not verify
  it from the files alone and the `hint` says how to verify it manually.
- `skipped` - not applicable to this stack.

## What `build-plugin` actually verifies

For Vite stacks doctor reads the build config **without executing it** and
checks, in order:

1. The plugin is registered (a mention inside a comment does not count).
2. The `include` option written in the config admits one of your own source
   files - evaluated by the *installed* `@web-remarq/unplugin`'s own filter,
   not by a guess about what the option "should" match. Brace groups such as
   `src/**/*.{jsx,tsx}` need `@web-remarq/unplugin` >= 0.2.0; `init` writes
   one plain pattern per extension so either version works.
3. The installed transform stamps that file with `data-remarq-source`.

Only an inline `remarq({ include: ['...'] })` (or a bare `remarq()`) is
readable. A plugin registered through a shared preset, a variable, or a spread
is reported as `blocked` with the transform result and a manual verification
step - never as `ok`. A vanilla Vite app with no JSX/Vue files is `skipped`.

## Verifying a checkout vs. a release

`npm run e2e:install` (repo root) scaffolds real Vue, React and Next apps,
runs `init`, applies the edits it printed, and asserts through doctor and a
real Vite dev server that a specific element is stamped `file:line:col`.
Without flags it installs this checkout's packed tarballs and proves nothing
about npm. `npm run e2e:install -- --registry` installs the published packages
instead - run it after publishing.

## More

See the [repository root README](../../README.md) for the full product
overview, and [SKILL.md](../../SKILL.md) for the step-by-step flow a coding
agent follows to install and verify web-remarq end to end.
