# web-remarq

Visual annotation tool for design review workflows. Framework-agnostic, zero dependencies.

Designer annotates UI elements on staging/dev, exports a report. Developer imports the report and sees markers on the exact elements. Export as agent-friendly JSON with source locations and search hints for AI coding agents.

## Packages

| Package | Description | |
|---------|-------------|---|
| [`web-remarq`](./packages/core) | Core library — browser annotation tool | [![npm](https://img.shields.io/npm/v/web-remarq)](https://www.npmjs.com/package/web-remarq) |
| [`@web-remarq/babel-plugin`](./packages/babel-plugin) | Babel plugin for JSX source injection (React, Preact, Solid) | [![npm](https://img.shields.io/npm/v/@web-remarq/babel-plugin)](https://www.npmjs.com/package/@web-remarq/babel-plugin) |
| [`@web-remarq/unplugin`](./packages/unplugin) | Universal plugin for Vite/webpack/Rollup/esbuild/Rspack (JSX + Vue SFC) | [![npm](https://img.shields.io/npm/v/@web-remarq/unplugin)](https://www.npmjs.com/package/@web-remarq/unplugin) |

## Quick Start

```bash
npm install web-remarq
```

```ts
import { WebRemarq } from 'web-remarq'
WebRemarq.init({ theme: 'light' })
```

See each package's README for detailed docs.

## License

MIT
