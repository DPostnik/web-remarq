# web-remarq

Visual annotation tool for design review workflows. Framework-agnostic, zero dependencies.

Designer annotates UI elements on staging/dev, exports a report. Developer imports the report and sees markers on the exact elements. Export as agent-friendly JSON with source locations and search hints for AI coding agents.

## Install

```bash
npm install web-remarq
```

### Build plugins (optional)

For precise source location injection (`file:line:col` on every element):

```bash
# Babel (React, Preact, Solid)
npm install -D @web-remarq/babel-plugin

# Vite / webpack / Rollup / esbuild / Rspack
npm install -D @web-remarq/unplugin
```

## Quick Start

```ts
import { WebRemarq } from 'web-remarq'

WebRemarq.init({ theme: 'light' })
```

### Script tag

```html
<script src="https://unpkg.com/web-remarq/dist/web-remarq.global.global.js"></script>
<script>WebRemarq.init({ theme: 'dark' })</script>
```

## API

### `WebRemarq.init(options?)`

Initialize the tool. Idempotent — safe to call multiple times.

```ts
WebRemarq.init({
  theme: 'light',                    // 'light' | 'dark'
  classFilter: (name) => boolean,    // custom class filter for fingerprinting
  dataAttribute: 'data-annotate',    // which data-attr to use as stable anchor
})
```

### `WebRemarq.destroy()`

Remove all DOM nodes, event listeners, and observers. Full cleanup.

### `WebRemarq.setTheme(theme)`

Switch between `'light'` and `'dark'` themes.

### `WebRemarq.copy(format?)`

Copy annotations to clipboard.

- `'md'` (default) — agent-friendly markdown with search hints
- `'agent'` — structured JSON with source locations and grep queries

### `WebRemarq.export(format)`

- `'md'` — downloads `.md` file with search hints
- `'json'` — downloads `.json` file with full annotation data (for import)
- `'agent'` — downloads `.json` with source locations, grep queries, and confidence levels

### `WebRemarq.import(file)`

Import annotations from a JSON file. Returns `Promise<{ total, matched, otherBreakpoint, detached }>`.

```ts
const input = document.querySelector('input[type="file"]')
const result = await WebRemarq.import(input.files[0])
// { total: 12, matched: 10, otherBreakpoint: 1, detached: 1 }
```

### `WebRemarq.getAnnotations(route?)`

Get all annotations, or filter by route.

### `WebRemarq.clearAll()`

Remove all annotations.

## Agent Export Format

The `export('agent')` format is optimized for AI coding agents:

```jsonc
{
  "version": 1,
  "format": "agent",
  "viewportBucket": 1200,
  "annotations": [{
    "id": "a1b2c3d4",
    "route": "/dashboard",
    "comment": "Increase button padding",
    "status": "pending",
    "source": {
      "file": "src/components/ActionBar.tsx",
      "line": 24,
      "column": 6,
      "component": "ActionBar"
    },
    "searchHints": {
      "grepQueries": [
        { "query": "data-testid=\"save-btn\"", "glob": "*.{tsx,jsx,vue}", "confidence": "high" },
        { "query": "\"Save changes\"", "glob": "*.{tsx,jsx,vue}", "confidence": "medium" }
      ],
      "domContext": "div.action-bar > button",
      "tagName": "button",
      "classes": ["action-button"]
    }
  }]
}
```

Source detection uses a 3-level fallback:

1. **Build plugin** — exact `file:line:col` from [`@web-remarq/babel-plugin`](https://www.npmjs.com/package/@web-remarq/babel-plugin) or [`@web-remarq/unplugin`](https://www.npmjs.com/package/@web-remarq/unplugin)
2. **Runtime detection** — `data-source` attrs (locator.js), React fiber `_debugSource` (dev mode)
3. **Heuristic** — grep queries ranked by confidence (`high` / `medium` / `low`)

## Core-only usage

For programmatic access without UI:

```ts
import { createFingerprint, matchElement, AnnotationStorage } from 'web-remarq/core'
```

## How It Works

### Fingerprinting

When a user clicks an element, a multi-signal fingerprint is captured:

- **Stable anchors** — `data-annotate`, `data-testid`, `id`
- **Semantics** — tag name, text content, ARIA role/label
- **Structure** — stable CSS classes (hashes stripped), DOM path, sibling index
- **Source location** — from build plugin or runtime detection

### Matching

Elements are found via a fallback chain:

1. Exact match by `data-annotate` or `data-testid`
2. Exact match by `id`
3. Fuzzy match using weighted scoring (text similarity, ARIA, classes, DOM path)
4. Unmatched annotations go to "other viewport" or "detached" panels

### Viewport Breakpoints

Annotations are tagged with a viewport bucket (width rounded to 100px). Automatic reconnection when returning to the annotation's native viewport.

### SPA Support

Intercepts `history.pushState`/`replaceState` and listens for `popstate`/`hashchange`. Annotations are scoped per route.

## Stable Selectors

Works without any markup changes, but for guaranteed stable matching add `data-annotate`:

```html
<CasinoTabs data-annotate="casino-tabs" />
<SearchBar data-annotate="search-bar" />
```

## UI Components

- **Toolbar** — fixed bottom-right panel with inspect, spacing, copy, export, import, clear, theme, minimize
- **Inspect mode** — hover to highlight, click to annotate
- **Spacing inspector** — visualizes margin, padding, content, flex gap on hover
- **Markers** — numbered circles (orange = pending, green = resolved)
- **Popup** — comment input / detail view with Resolve/Delete

## License

MIT
