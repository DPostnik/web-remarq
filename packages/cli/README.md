# @web-remarq/cli

Installer and doctor for [web-remarq](https://github.com/DPostnik/web-remarq) -
detects your stack, installs the right packages, prints the manual edits an
agent (or you) still need to apply, and verifies the result.

## Commands

```bash
npx @web-remarq/cli init [--app <dir>] [--json]
npx @web-remarq/cli doctor [--app <dir>] [--json]
```

- `init` - installs packages, writes `.mcp.json` and `.remarq/config.json`
  (project id + local token, gitignored) at the repo root, and prints the
  remaining edits (build config + entry point) for your stack.
- `doctor` - checks the setup and explains what is wrong. Its `mcp-server`
  check authenticates with the token from `.remarq/config.json`: `ok` means
  the server answered AND accepted the token; a refused token, an older
  server (protocol 1) or a missing token are `fail` with a hint; nothing
  listening is `blocked` (the server starts with your agent).

`--app <dir>` points at the app package inside a monorepo, relative to the
repository root - use it when more than one app is detected, or when the
command is not run from the app directory. `--json` prints machine-readable
output instead of the human-readable report.

Supported stacks: Next.js, Vite (Vue/React/vanilla), and plain HTML pages.

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
   `src/**/*.{jsx,tsx}` need `@web-remarq/unplugin` >= 0.2.0; `init` prints
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
