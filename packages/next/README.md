# @web-remarq/next

Next.js integration for [web-remarq](https://www.npmjs.com/package/web-remarq) source location injection. One wrapper, works on Next.js 13-16+ with both webpack and Turbopack.

JSX elements in `.jsx` and `.tsx` files get `data-remarq-source="file:line:col"` and `data-remarq-component="ComponentName"` attributes at build time. The widget uses heuristic source matching for JSX in `.js` files.

## Automatic setup

Run `npx @web-remarq/cli init` in a Next.js 15.3+ App or Pages Router project
with standard route extensions and server output. It wraps the Next.js config,
adds client instrumentation and a development pairing route, and prints the
Claude Code session command. Start `next dev` and open the app on localhost.
The widget sends saved marks to the open agent session.

## Manual install

```bash
npm install -D @web-remarq/next
```

## Setup

```ts
// next.config.ts
import withRemarq from '@web-remarq/next'

export default withRemarq({
  // your existing Next.js config
})
```

With options:

```ts
export default withRemarq({ /* config */ }, { production: false })
```

`next.config.mjs`, `next.config.ts` and `next.config.js` (`require`) all work.
Versions before 0.3.1 crashed when imported from an ESM config and returned a
string source map that Next 15 under webpack rejected with a 500 on every page.

## What it does

Transforms this:

```jsx
function LoginForm() {
  return <button className="submit">Log in</button>
}
```

Into this:

```jsx
function LoginForm() {
  return <button className="submit"
    data-remarq-source="src/components/LoginForm.tsx:3:9"
    data-remarq-component="LoginForm">Log in</button>
}
```

## How it works

`withRemarq()` does **not** use `experimental.swcPlugins` - SWC plugin ABI
changes between Next versions make that fragile. Instead it injects a small
custom loader that runs `@swc/core`'s `transform()` per file with the WASM
plugin from [`@web-remarq/swc-plugin`](https://www.npmjs.com/package/@web-remarq/swc-plugin).
The loader is registered for both bundlers, with the strategy picked from your
installed Next.js major version:

| Next.js | webpack | Turbopack |
|---------|---------|-----------|
| 16+ | ✅ `module.rules` | ✅ top-level `turbopack.rules` (stable) |
| 14 - 15 | ✅ `module.rules` | ✅ `experimental.turbo.rules` |
| 13 | ✅ `module.rules` | ❌ not supported - webpack only |

The rule matches `*.jsx` / `*.tsx` and excludes `node_modules`. Your existing
`webpack` / `turbopack` config entries are preserved and composed, not replaced.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `production` | `boolean` | `false` | Enable in production builds. By default the wrapper is a no-op when `NODE_ENV=production`. |

**Security note:** `production: true` exposes source file paths in the DOM. Use only for internal/staging environments.

## Pairing with the local MCP server

The CLI adds a same-origin development endpoint at `/api/web-remarq/config.json`
under the application's base path. It reads the project token and active MCP
port on each request from the local `.remarq/` directory. The handler responds
only in development and accepts loopback hosts.

For manual widget setups the wrapper reads the token from `.remarq/config.json` (walking
up from the app directory, so a monorepo app finds the repo-root config) and
exposes it as `NEXT_PUBLIC_WEB_REMARQ_TOKEN`, which the widget snippet uses to
pair with `npx @web-remarq/mcp`. This happens only when `NODE_ENV` is not
`production` - never in a production build, even with `production: true` (that
option enables source instrumentation, not credential delivery). A value you
set yourself in `env.NEXT_PUBLIC_WEB_REMARQ_TOKEN` is preserved. Pass
`{ pairing: 'route' }` to disable legacy token inlining when using the route.

## Requirements

- Peer dependency: `next >= 13`
- `@swc/core` and `@web-remarq/swc-plugin` are regular dependencies - nothing extra to install

## Works with

- Next.js App Router and Pages Router
- `next dev` (webpack or `--turbopack`) and `next build`

For Vite, webpack (outside Next), Rollup, esbuild, or Rspack use
[`@web-remarq/unplugin`](https://www.npmjs.com/package/@web-remarq/unplugin);
for Babel-based setups use
[`@web-remarq/babel-plugin`](https://www.npmjs.com/package/@web-remarq/babel-plugin).

## License

MIT

### SWC runtime compatibility

This release pins `@swc/core` to `1.15.33`, the runtime tested with `@web-remarq/swc-plugin@0.1.0`. Update the runtime and WASM plugin together after verifying a real loader transform.
