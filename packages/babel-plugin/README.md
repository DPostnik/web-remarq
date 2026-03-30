# @web-remarq/babel-plugin

Babel plugin that injects source location attributes into JSX elements for [web-remarq](https://www.npmjs.com/package/web-remarq).

Every JSX element gets `data-remarq-source="file:line:col"` and `data-remarq-component="ComponentName"` attributes at build time, so AI agents can find the exact source code for annotated elements.

## Install

```bash
npm install -D @web-remarq/babel-plugin
```

## Setup

```js
// babel.config.js
module.exports = {
  plugins: ['@web-remarq/babel-plugin']
}
```

With options:

```js
module.exports = {
  plugins: [['@web-remarq/babel-plugin', { production: false }]]
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

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `production` | `boolean` | `false` | Enable in production builds. By default attributes are only injected in development. |

**Security note:** `production: true` exposes source file paths in the DOM. Use only for internal/staging environments.

## Component name detection

The plugin finds the nearest named component by walking up the AST:

- `function MyComponent() {}` — `MyComponent`
- `const MyComponent = () => {}` — `MyComponent`
- `const MyComponent = memo(() => {})` — `MyComponent`
- `class MyComponent extends Component {}` — `MyComponent`
- `export default () => {}` — `null` (anonymous)

## Skipped elements

- JSX fragments (`<>`, `<React.Fragment>`)
- Elements that already have `data-remarq-source`

## Works with

- React
- Preact
- Solid
- Any JSX-based framework using Babel

For Vite, webpack, Rollup, esbuild, or Rspack without Babel, use [`@web-remarq/unplugin`](https://www.npmjs.com/package/@web-remarq/unplugin) instead.

## License

MIT
