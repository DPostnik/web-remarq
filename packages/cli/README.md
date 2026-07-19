# @web-remarq/cli

Installer and doctor for [web-remarq](https://github.com/DPostnik/web-remarq) -
detects your stack, installs the right packages, prints the manual edits an
agent (or you) still need to apply, and verifies the result.

## Commands

```bash
npx @web-remarq/cli init [--app <dir>] [--json]
npx @web-remarq/cli doctor [--app <dir>] [--json]
```

- `init` - installs packages, writes `.mcp.json` at the repo root, and prints
  the remaining edits (build config + entry point) for your stack.
- `doctor` - checks the setup and explains what is wrong.

`--app <dir>` points at the app package inside a monorepo, relative to the
repository root - use it when more than one app is detected, or when the
command is not run from the app directory. `--json` prints machine-readable
output instead of the human-readable report.

Supported stacks: Next.js, Vite (Vue/React/vanilla), and plain HTML pages.

## Doctor statuses

- `ok` - nothing to do.
- `fail` - your problem: something is missing or misconfigured, fix it with
  the given `hint` and run doctor again.
- `blocked` - not your problem: the setup is correct but needs a human action
  (restarting the agent or the dev server).
- `skipped` - not applicable to this stack.

## More

See the [repository root README](../../README.md) for the full product
overview, and [SKILL.md](../../SKILL.md) for the step-by-step flow a coding
agent follows to install and verify web-remarq end to end.
