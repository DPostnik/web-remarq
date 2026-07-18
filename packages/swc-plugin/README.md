# @web-remarq/swc-plugin

SWC plugin (Rust, compiled to WASM) that injects source location attributes into JSX elements for [web-remarq](https://www.npmjs.com/package/web-remarq). Same transform as [`@web-remarq/babel-plugin`](https://www.npmjs.com/package/@web-remarq/babel-plugin), for SWC-based toolchains.

Every JSX element gets `data-remarq-source="file:line:col"` and `data-remarq-component="ComponentName"` attributes at build time, so AI agents can find the exact source code for annotated elements.

## For Next.js: use the wrapper instead

If you are on Next.js, don't wire this plugin manually - use
[`@web-remarq/next`](https://www.npmjs.com/package/@web-remarq/next), which
ships this WASM plugin inside a custom `@swc/core` loader. That sidesteps the
SWC plugin ABI mismatches that `experimental.swcPlugins` runs into across
Next versions:

```ts
// next.config.ts
import withRemarq from '@web-remarq/next'
export default withRemarq({})
```

## Manual usage (advanced)

The package's entry point **is** the `.wasm` binary - point any SWC plugin
slot at it:

```js
// with @swc/core
const { transform } = require('@swc/core')

await transform(code, {
  filename: 'src/components/LoginForm.tsx',
  jsc: {
    parser: { syntax: 'typescript', tsx: true },
    experimental: {
      plugins: [[require.resolve('@web-remarq/swc-plugin'), {}]],
    },
  },
})
```

SWC's plugin ABI is version-sensitive: the shipped `.wasm` is built against
the `swc_core` version pinned in this package's `Cargo.toml`. If your SWC
runtime rejects it, prefer the `@web-remarq/next` wrapper (which brings a
compatible `@swc/core` with it) or rebuild from source.

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
| `production` | `boolean` | - | Accepted for config-shape compatibility but currently unused: dev/prod gating is handled by the wrapper (`@web-remarq/next`) or by whatever config layer decides to load the plugin. |

## Component name detection

The plugin maintains a parent-context stack (SWC's visitor has no Babel-style
`parentPath`) and picks the nearest named scope:

- `function MyComponent() {}` - `MyComponent`
- `const MyComponent = () => {}` - `MyComponent`
- `class MyComponent extends Component {}` - `MyComponent`
- anonymous default exports - `null`

## Skipped elements

- JSX fragments (`<>`, `<React.Fragment>`)
- Elements that already have `data-remarq-source`

## Building from source

Requires a Rust toolchain:

```bash
cd packages/swc-plugin
./build.sh   # adds the wasm32-wasip1 target, cargo build --release, copies the .wasm here
```

## License

MIT
