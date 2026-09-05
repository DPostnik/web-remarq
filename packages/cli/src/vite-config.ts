/**
 * Static reading of the remarq plugin registration in a Vite config file.
 *
 * The config is never executed - doctor must not run arbitrary user code - so
 * this reads the source text and trusts only what it can read literally. Anything
 * it cannot read literally is reported as `unreadable`, never as "fine".
 */

export type IncludeReading =
  /** The plugin is not mentioned in this file at all (comments do not count). */
  | { kind: 'not-registered' }
  /** `remarq()` is called with no include option: the plugin's default include applies. */
  | { kind: 'default' }
  /** `remarq({ include: ['...'] })` with an inline array of string literals. */
  | { kind: 'explicit'; include: string[] }
  /** The plugin is mentioned, but the include option cannot be read from this file alone. */
  | { kind: 'unreadable'; reason: string }

/** Strip `//` and `/* *\/` comments while leaving string literals (which may contain `//`) intact. */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i]
          i++
        }
        if (i < src.length) {
          out += src[i]
          i++
        }
      }
      if (i < src.length) {
        out += src[i]
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

const PKG = String.raw`@web-remarq\/unplugin(?:\/[\w-]+)?`
const DEFAULT_IMPORT_RE = new RegExp(String.raw`import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]${PKG}['"]`)
const NAMED_IMPORT_RE = new RegExp(String.raw`import\s*\{[^}]*\bvitePlugin\s+as\s+([A-Za-z_$][\w$]*)[^}]*\}\s*from\s*['"]${PKG}['"]`)
const REQUIRE_RE = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]${PKG}['"]\s*\)`)

/** The local identifier the plugin factory is bound to in this file, or null when it is not imported here. */
function pluginBinding(src: string): string | null {
  for (const re of [DEFAULT_IMPORT_RE, NAMED_IMPORT_RE, REQUIRE_RE]) {
    const m = src.match(re)
    if (m) return m[1]
  }
  return null
}

/** Return the text between the bracket at `open` and its matching close, respecting string literals. Null when unbalanced. */
function balanced(src: string, open: number, openChar: string, closeChar: string): string | null {
  let depth = 0
  let quote: string | null = null
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === openChar) depth++
    else if (ch === closeChar) {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** Split on commas outside string literals. */
function splitTopLevel(list: string): string[] {
  const items: string[] = []
  let current = ''
  let quote: string | null = null
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]
    if (quote) {
      current += ch
      if (ch === '\\' && i + 1 < list.length) current += list[++i]
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    if (ch === ',') {
      items.push(current)
      current = ''
      continue
    }
    current += ch
  }
  items.push(current)
  return items.map((s) => s.trim()).filter((s) => s !== '')
}

function readIncludeOption(name: string, args: string): IncludeReading {
  const body = args.trim()
  if (body === '') return { kind: 'default' }
  if (!body.startsWith('{')) {
    return { kind: 'unreadable', reason: `${name}() is called with options that are not an inline object literal` }
  }

  const key = body.match(/\binclude\s*:/)
  if (!key || key.index === undefined) {
    if (/\binclude\b/.test(body)) {
      return { kind: 'unreadable', reason: 'the include option is not an inline array literal' }
    }
    return { kind: 'default' }
  }

  const afterKey = body.slice(key.index + key[0].length)
  const arrayStart = afterKey.search(/\S/)
  if (arrayStart === -1 || afterKey[arrayStart] !== '[') {
    return { kind: 'unreadable', reason: 'the include option is not an inline array literal' }
  }
  const inner = balanced(afterKey, arrayStart, '[', ']')
  if (inner === null) {
    return { kind: 'unreadable', reason: 'the include array literal is unbalanced' }
  }

  const include: string[] = []
  for (const item of splitTopLevel(inner)) {
    const literal = item.match(/^(['"])(.*)\1$/)
    if (!literal) {
      return { kind: 'unreadable', reason: 'the include option is not an array of string literals' }
    }
    include.push(literal[2])
  }
  return { kind: 'explicit', include }
}

/**
 * Read how the remarq plugin is registered in `configSource`, without executing it.
 *
 * - No mention of the plugin (outside comments) -> `not-registered`.
 * - Mentioned but not imported directly in this file (a shared preset, a re-export,
 *   a wrapper) -> `unreadable`: the include option lives somewhere this file does
 *   not show.
 * - Imported and called with no options, or with options lacking `include` -> `default`.
 * - Imported and called with an inline `include: ['...']` array -> `explicit`.
 * - Anything else (a variable, a spread, a template string) -> `unreadable`.
 */
export function readRemarqInclude(configSource: string): IncludeReading {
  const src = stripComments(configSource)
  if (!/remarq/i.test(src)) return { kind: 'not-registered' }

  const name = pluginBinding(src)
  if (!name) {
    return {
      kind: 'unreadable',
      reason: '@web-remarq/unplugin is not imported directly in this file, so the plugin call (and its include option) lives in an imported or shared config',
    }
  }

  const call = src.match(new RegExp(String.raw`\b${name.replace(/\$/g, '\\$')}\s*\(`))
  if (!call || call.index === undefined) {
    return { kind: 'unreadable', reason: `@web-remarq/unplugin is imported as ${name} but ${name}() is never called in this file` }
  }
  const open = call.index + call[0].length - 1
  const args = balanced(src, open, '(', ')')
  if (args === null) {
    return { kind: 'unreadable', reason: `${name}() call is unbalanced` }
  }
  return readIncludeOption(name, args)
}
