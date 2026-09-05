---
name: web-remarq-install
description: Use when the user wants to install, set up, or fix web-remarq in their project - the visual annotation tool that sends UI feedback to coding agents. Runs the installer, applies the remaining code edits, and verifies with doctor.
---

# Installing web-remarq

You are setting up web-remarq: the user points at broken UI in the browser, you fix it, and only they can verify the fix.

Work through these steps in order. Do not skip the verification step.

## 1. Run the installer

```bash
npx @web-remarq/cli init --json
```

Read the JSON. If `ok` is `false`, **stop**. Do not improvise a setup. Show the
user `reason` and `hint`.

- If `candidates` is present, ask which app they mean and re-run with
  `--app <dir>`, using one of the listed candidates as the directory (pass a
  real path - an empty or flag-shaped value is an argument error, not a stack
  detection failure).
- If `unsupportedGlobs` is present instead, the tool found a workspace but
  could not parse one or more of its glob patterns; `hint` already names the
  offending patterns and asks you to point at the app directly with `--app`.

## 2. Apply the edits

For each entry in `edits`, open `file` (path is relative to the repository root)
and integrate `snippet`.

**Use the snippet as given.** Versions, package subpaths, include globs and the
dev-only guard are already decided for this stack - changing them breaks the
setup. Your job is placement: where in the file it goes, and how it merges with
what is already there. Respect every `note`.

If `file` is `<entry point not found>`, `<vite config not found>`, or
`<next config not found>`, locate the right file yourself and apply the
snippet there.

If `edits` is an empty array, there is nothing to apply (plain HTML with no
bundler is fully set up by `init` itself) - continue straight to step 3. On
plain HTML there is no dev server to hand the widget its token: tell the user
to run `WebRemarq.pair('<token>')` once in the browser console, with the
token from `.remarq/config.json` (never paste the token into a committed file).

`init` also writes `.remarq/config.json` - the project id and the local
server token. It is gitignored; do not copy its contents anywhere.

## 3. Verify

```bash
npx @web-remarq/cli doctor --json
```

If the top-level `ok` is `false`, treat it exactly like step 1 (same
`reason`/`hint`/`candidates`/`unsupportedGlobs` shape) - fix the stack
detection problem first, then re-run doctor.

Otherwise, for each entry in `checks`:

- `ok` - nothing to do.
- `fail` - your problem. Fix it using `hint`, then run doctor again.
- `blocked` - **not your problem.** Either the setup is correct and needs a
  human action (restarting the agent or the dev server), or doctor could not
  verify it from the files alone - for example the build plugin is registered
  through a shared preset, so its `include` option is unreadable. Do not
  "fix" it. Tell the user what was not verified and relay the `hint`'s manual
  check.
- `skipped` - not applicable to this stack. Leave it alone.

Some `fail` hints state outright that the check cannot see the actual
configuration (for example, `not registered` when the plugin is added via an
imported build config). If you hit one of these and have independently verified
the configuration is genuinely correct, stop looping on that check - it is a
false positive - and surface it to the user instead of retrying or "fixing" it.

Loop steps 2-3 until no check is `fail`. If you are still failing after three
rounds, stop and show the user the doctor output rather than guessing further.

## 4. Hand back to the user

Finish with the concrete next actions, not with "done":

```
Setup complete. Two things left for you:

1. Restart the dev server: <their dev command>
2. Restart Claude Code so it picks up the web-remarq MCP server.

Then: open your app - the web-remarq toolbar appears in the bottom-right.
Hit Inspect, click a broken element, describe what's wrong, hit Submit.
Then tell me /mcp__web-remarq__watch and I'll start working through them.

Re-check the setup any time: npx @web-remarq/cli doctor
```
