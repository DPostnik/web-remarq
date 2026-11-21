# @web-remarq/unplugin

Universal build plugin that injects source location attributes into JSX and Vue template elements for [web-remarq](https://www.npmjs.com/package/web-remarq).

Works with Vite, webpack, Rollup, esbuild, and Rspack. Supports JSX/TSX and Vue SFC templates.

## Install

```bash
npm install -D @web-remarq/unplugin
```

## Setup

### Vite

```js
// vite.config.js
import remarq from '@web-remarq/unplugin/vite'

export default {
  plugins: [remarq()]
}
```

### webpack

```js
// webpack.config.js
const remarq = require('@web-remarq/unplugin/webpack').default

module.exports = {
  plugins: [remarq()]
}
```

### Rollup

```js
// rollup.config.js
import remarq from '@web-remarq/unplugin/rollup'

export default {
  plugins: [remarq()]
}
```

### esbuild

```js
import remarq from '@web-remarq/unplugin/esbuild'
import { build } from 'esbuild'

build({
  plugins: [remarq()]
})
```

### Rspack

```js
// rspack.config.js
const remarq = require('@web-remarq/unplugin/rspack').default

module.exports = {
  plugins: [remarq()]
}
```

### Widget auto-injection (Vite dev, optional)

```js
plugins: [remarq({ widget: true })]
```

Injects the widget into `index.html` in `vite dev`, in simple mode with `HttpStorageAdapter` (the plugin already serves the local MCP token), so no `WebRemarq.init` is needed. Marks go to the agent through the local MCP server (`npx @web-remarq/mcp`), disappear from the page once delivered, and the toolbar shows an "In work" counter. `web-remarq` must be installed in the project; if it cannot be resolved the plugin logs one warning and injects nothing. Pass an object to tune it: `widget: { simple: false, position: 'bottom-left', theme: 'dark' }`.

Never injected in production builds, and it does not apply to SSR frameworks (SPA `index.html` only, e.g. Vue and React Vite apps). Default is off, so an existing manual `init` keeps working.

The dev server serves `{ projectId, token, port? }` at `/__web-remarq/config.json` from `.remarq/config.json`. `port` is the running MCP server's port from `.remarq/server.lock` (else `port` from the config), so a server started with `REMARQ_PORT` is found without extra setup. The config is looked up from the Vite root up to the git root, never above it; outside a git repository only the Vite root itself is checked.

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

Paths are relative to the directory that holds `.remarq/config.json` (where the agent works), else the git root, else the current directory, so in a monorepo they match the agent's working directory rather than the app package.

Vue SFC templates are also transformed:

```vue
<template>
  <div class="wrapper">
    <button>Save</button>
  </div>
</template>
```

Becomes:

```vue
<template>
  <div class="wrapper"
    data-remarq-source="src/components/SavePanel.vue:2:4"
    data-remarq-component="SavePanel">
    <button
      data-remarq-source="src/components/SavePanel.vue:3:8"
      data-remarq-component="SavePanel">Save</button>
  </div>
</template>
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `include` | `string[]` | `['**/*.jsx', '**/*.tsx', '**/*.vue']` | Glob patterns for files to transform |
| `exclude` | `string[]` | `['node_modules/**']` | Glob patterns to skip |
| `production` | `boolean` | `false` | Enable in production builds |
| `widget` | `boolean \| { simple?, position?, theme? }` | `false` | Vite dev only: inject the widget (simple mode, local MCP server) |

```js
remarq({
  include: ['src/**/*.tsx', 'src/**/*.vue'],
  exclude: ['node_modules/**', '**/*.test.*'],
  production: false,
})
```

**Security note:** `production: true` exposes source file paths in the DOM. Use only for internal/staging environments.

## JSX/TSX

Uses `@babel/parser` for AST-based transformation. Handles TypeScript, decorators, and all JSX patterns. Component name is detected from the nearest function/class declaration.

## Vue SFC

Parses `<template>` blocks and injects attributes on HTML elements. Vue built-in tags (`template`, `slot`, `component`, `transition`, `keep-alive`, `teleport`, `suspense`) are skipped. Component name is derived from the filename.

## How it differs from `@web-remarq/babel-plugin`

| | `@web-remarq/babel-plugin` | `@web-remarq/unplugin` |
|-|---|---|
| **Use when** | Project uses Babel | Project uses Vite/SWC/esbuild without Babel |
| **Bundlers** | Babel only | Vite, webpack, Rollup, esbuild, Rspack |
| **JSX** | Yes | Yes |
| **Vue SFC** | No | Yes |
| **Parsing** | Babel AST (native) | `@babel/parser` (bundled) |

If your project already uses Babel, prefer `@web-remarq/babel-plugin` — it's lighter and integrates natively.

## License

MIT
