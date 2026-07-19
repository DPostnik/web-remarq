# web-remarq

Visual annotation tool for design review workflows. Framework-agnostic, zero dependencies.

![web-remarq demo](.github/assets/demo.gif)

Click any element on your running app and leave a comment - web-remarq fingerprints the element and (with a build plugin) resolves it to `file:line:column` in your source. From there, three ways to close the loop: hand the task to an AI coding agent over MCP, export a report for a developer, or sync it to your team via Supabase. Agents fix; humans verify - the verification gate is built into the annotation lifecycle.

## Packages

| Package | Description | |
|---------|-------------|---|
| [`web-remarq`](./packages/core) | Core library — browser annotation tool | [![npm](https://img.shields.io/npm/v/web-remarq)](https://www.npmjs.com/package/web-remarq) |
| [`@web-remarq/mcp`](./packages/mcp) | MCP server — gives AI agents (Claude Code, Cursor, ...) access to annotations; zero-config local mode | [![npm](https://img.shields.io/npm/v/@web-remarq/mcp)](https://www.npmjs.com/package/@web-remarq/mcp) |
| [`@web-remarq/unplugin`](./packages/unplugin) | Universal plugin for Vite/webpack/Rollup/esbuild/Rspack (JSX + Vue SFC) | [![npm](https://img.shields.io/npm/v/@web-remarq/unplugin)](https://www.npmjs.com/package/@web-remarq/unplugin) |
| [`@web-remarq/babel-plugin`](./packages/babel-plugin) | Babel plugin for JSX source injection (React, Preact, Solid) | [![npm](https://img.shields.io/npm/v/@web-remarq/babel-plugin)](https://www.npmjs.com/package/@web-remarq/babel-plugin) |
| [`@web-remarq/swc-plugin`](./packages/swc-plugin) | SWC/WASM plugin for source injection (Turbopack) | [![npm](https://img.shields.io/npm/v/@web-remarq/swc-plugin)](https://www.npmjs.com/package/@web-remarq/swc-plugin) |
| [`@web-remarq/next`](./packages/next) | Next.js config wrapper — `withRemarq()` for webpack and Turbopack | [![npm](https://img.shields.io/npm/v/@web-remarq/next)](https://www.npmjs.com/package/@web-remarq/next) |
| [`@web-remarq/cloud`](./packages/cloud) | Cloud storage adapter — sync annotations across team via Supabase | [![npm](https://img.shields.io/npm/v/@web-remarq/cloud)](https://www.npmjs.com/package/@web-remarq/cloud) |

## Quick Start

Let your coding agent do it:

```bash
npx skills add DPostnik/web-remarq
```

Then tell it: **"set up web-remarq"**. It runs the installer, wires up your build
config and entry point, and verifies the result with `doctor`.

Prefer to drive yourself:

```bash
npx @web-remarq/cli init      # installs packages, writes .mcp.json, prints the remaining edits
npx @web-remarq/cli doctor    # checks the setup and explains what is wrong
```

On a plain HTML page with no bundler, `init` completes the whole setup on its own.

See each package's README for detailed docs.

## Usage scenarios

### 1. You + an AI agent (local, zero-config)

The flagship flow: you point at what's wrong on the page, your agent fixes it, you verify with one click. No account, no cloud, no env vars.

One-time setup (a Vue + Vite project as the example; React/Next work the same via the matching plugin):

```bash
npm i -D web-remarq @web-remarq/unplugin
```

```ts
// vite.config.ts — stamps data-remarq-source="src/components/Card.vue:24:6" (dev-only)
import remarq from '@web-remarq/unplugin/vite'
export default defineConfig({ plugins: [vue(), remarq({ include: ['src/**/*.vue'] })] })
```

```ts
// main.ts
import { WebRemarq, HttpStorageAdapter } from 'web-remarq'
if (import.meta.env.DEV) {
  WebRemarq.init({ submitFlow: true, storage: new HttpStorageAdapter() })
}
```

```json
// .mcp.json
{ "mcpServers": { "web-remarq": { "command": "npx", "args": ["-y", "@web-remarq/mcp"] } } }
```

The MCP server starts in local mode automatically: annotations live in `.remarq/annotations.json` (self-gitignored), served to the widget over `127.0.0.1`.

The daily loop:

1. **Annotate.** Run the dev server, hit Inspect in the toolbar, click the broken element, type what's wrong. Drafts collect quietly; press Submit to release them.
2. **Put the agent on duty.** In Claude Code, type `/mcp__web-remarq__watch`. The agent long-polls for feedback, acknowledges each annotation (marker turns yellow), hands the fix to a background subagent, and goes straight back to watching - fixes run in parallel, new feedback never waits.
3. **Or don't.** With no agent running, every actionable annotation is mirrored as a ticket file in `.remarq/tasks/<id>.md` - comment, source location, grep hints, and reporting instructions included. Later, tell any agent: "work through the tickets in `.remarq/tasks/`".
4. **Verify.** A blue marker means the agent claims a fix. Look at it: Verify (green, ticket disappears) or Reject with a reason (back to pending - the agent on duty picks it up again). Agents cannot verify their own work; that button is human-only.

The widget is offline-safe: it caches and buffers in localStorage while the server is down and syncs back on reconnect.

### 2. Designer → developer handoff (no server)

Nothing to run beyond the widget - annotations live in localStorage.

1. A designer annotates on staging, then exports JSON or copies the report as Markdown from the toolbar.
2. A developer imports the JSON - markers appear on the exact elements, viewport-aware; anything that no longer matches lands in a side panel instead of getting lost.
3. Or skip the human: `WebRemarq.copy('agent')` produces an agent-optimized export - source locations, prioritized grep queries with confidence levels, DOM context - ready to paste into any AI coding agent.

### 3. Team sync via Supabase

Same widget and MCP server, shared storage:

```bash
npx @web-remarq/cloud gen-key --name "my-project"   # prints pk_... and a SQL snippet
```

```ts
import { createCloudStorage } from '@web-remarq/cloud'
WebRemarq.init({
  storage: createCloudStorage({ supabaseUrl, supabaseAnonKey, projectKey: 'pk_...' }),
})
```

Everyone with the project key sees the same annotations (row-level security keyed by a hashed project key - the DB never stores the plaintext). The MCP server joins in cloud mode via `REMARQ_PROJECT_KEY` / `REMARQ_SUPABASE_URL` / `REMARQ_SUPABASE_ANON_KEY`. Details: [`@web-remarq/cloud`](./packages/cloud), [`@web-remarq/mcp`](./packages/mcp).

## Storage

`WebRemarq.init({ storage })` accepts any `StorageAdapter` implementation. Default is localStorage. See the [core package README](./packages/core/README.md#storage) for the interface and custom adapter examples. A Supabase-backed adapter for team collaboration ships separately as [`@web-remarq/cloud`](./packages/cloud).

## License

MIT
