# web-remarq

Visual annotation tool for design review workflows. Framework-agnostic, zero dependencies.

Designer annotates UI elements on staging/dev, exports a report. Developer imports the report and sees markers on the exact elements.

## Install

```bash
npm install web-remarq
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

### `WebRemarq.export(format)`

- `'md'` — copies markdown report to clipboard
- `'json'` — downloads `.json` file with full annotation data

### `WebRemarq.import(file)`

Import annotations from a JSON file. Returns `Promise<{ total, matched, detached }>`.

```ts
const input = document.querySelector('input[type="file"]')
const result = await WebRemarq.import(input.files[0])
// { total: 12, matched: 10, detached: 2 }
```

### `WebRemarq.getAnnotations(route?)`

Get all annotations, or filter by route.

```ts
WebRemarq.getAnnotations()          // all
WebRemarq.getAnnotations('/casino') // by route
```

### `WebRemarq.clearAll()`

Remove all annotations.

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
- **Parent context** — nearest ancestor's `data-annotate` value

### Matching

When loading annotations, elements are found via a fallback chain:

1. Exact match by `data-annotate` or `data-testid`
2. Exact match by `id`
3. Fuzzy match using weighted scoring (text similarity, ARIA, classes, DOM path)
4. Unmatched annotations go to a "detached" panel

### Hash Detection

Automatically strips hashed classes from CSS Modules, styled-components, Emotion, and pure hash patterns.

### SPA Support

Listens for `popstate`, `hashchange`, and intercepts `history.pushState`/`replaceState`. Annotations are scoped per route (`pathname + hash`).

## Stable Selectors

Works without any markup changes, but for guaranteed stable matching add `data-annotate` to key components:

```html
<CasinoTabs data-annotate="casino-tabs" />
<SearchBar data-annotate="search-bar" />
```

## UI Components

- **Toolbar** — fixed bottom-right panel with inspect, export, import, clear, theme, minimize
- **Inspect mode** — hover to highlight, click to annotate
- **Markers** — numbered circles (orange = pending, green = resolved)
- **Popup** — comment input for new annotations, detail view with Resolve/Delete for existing
- **Detached panel** — shows annotations whose elements can't be found

## Build Outputs

| Format | File | Use |
|--------|------|-----|
| ESM | `dist/index.js` | Bundlers |
| CJS | `dist/index.cjs` | `require()` |
| IIFE | `dist/web-remarq.global.global.js` | `<script>` tag |
| Types | `dist/index.d.ts` | TypeScript |

## License

MIT
