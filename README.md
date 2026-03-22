# web-remarq

Visual annotation tool for design review workflows. Framework-agnostic, zero dependencies.

Designer annotates UI elements on staging/dev, exports a report. Developer imports the report and sees markers on the exact elements. Copy annotations as agent-friendly markdown with search hints for AI coding agents.

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

### `WebRemarq.copy()`

Copy annotations as agent-friendly markdown to clipboard. Includes ranked search hints (CSS selectors, class names, text content, DOM path) so AI coding agents can grep and locate the source code.

### `WebRemarq.export(format)`

- `'md'` — downloads `.md` file with search hints (same content as `copy()`)
- `'json'` — downloads `.json` file with full annotation data

### `WebRemarq.import(file)`

Import annotations from a JSON file. Returns `Promise<{ total, matched, otherBreakpoint, detached }>`.

```ts
const input = document.querySelector('input[type="file"]')
const result = await WebRemarq.import(input.files[0])
// { total: 12, matched: 10, otherBreakpoint: 1, detached: 1 }
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
- **Structure** — stable CSS classes (hashes stripped), DOM path with parent classes, sibling index
- **Parent context** — nearest ancestor's `data-annotate` value
- **Agent export** — raw classes, CSS Module decomposition (module hint + local class name)

### Matching

When loading annotations, elements are found via a fallback chain:

1. Exact match by `data-annotate` or `data-testid`
2. Exact match by `id`
3. Fuzzy match using weighted scoring (text similarity, ARIA, classes, DOM path)
4. Unmatched annotations sorted into "other viewport" or "detached" panels

### Viewport Breakpoints

Annotations are tagged with a viewport bucket (width rounded to 100px). When resizing:

- **Attached** — element found in current viewport
- **Other viewport** — element not found, but annotation belongs to a different breakpoint (not an error)
- **Detached** — element not found even in its native breakpoint (real problem)

Automatic reconnection when returning to the annotation's native viewport.

### Agent-Friendly Copy

The Copy button produces markdown with ranked search hints:

```markdown
### 1. [pending] "Button too small on mobile"
Element: <button> "Submit"
Viewport: 300px

Search hints:
- `data-testid="submit-btn"` — in template files
- `"Submit"` — text content in templates
- `.submitButton` — in CSS Module file (likely `form.module.*`)
- DOM: div.form-wrapper > form > button.submit
- Classes: form__submitButton__cEqts flex items-center
```

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

- **Toolbar** — fixed bottom-right panel with inspect, copy, export, import, clear, theme, minimize
- **Inspect mode** — hover to highlight, click to annotate
- **Markers** — numbered circles (orange = pending, green = resolved)
- **Popup** — comment input for new annotations, detail view with Resolve/Delete for existing
- **Other viewport panel** — annotations from different breakpoints, click to see required viewport
- **Detached panel** — annotations whose elements can't be found in their native viewport

## Build Outputs

| Format | File | Use |
|--------|------|-----|
| ESM | `dist/index.js` | Bundlers |
| CJS | `dist/index.cjs` | `require()` |
| IIFE | `dist/web-remarq.global.global.js` | `<script>` tag |
| Types | `dist/index.d.ts` | TypeScript |

## License

MIT
