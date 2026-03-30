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
