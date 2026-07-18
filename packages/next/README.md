# @web-remarq/next

Next.js integration for [web-remarq](https://www.npmjs.com/package/web-remarq) source location injection. One wrapper, works on Next.js 13-16+ with both webpack and Turbopack.

Every JSX element gets `data-remarq-source="file:line:col"` and `data-remarq-component="ComponentName"` attributes at build time, so AI agents can find the exact source code for annotated elements.

## Install

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
