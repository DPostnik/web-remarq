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

/**
 * Blank `//` and `/* *\/` comments with spaces, keeping string literals (which may
 * contain `//`) intact. Line breaks and length are kept, so an index found in the
 * result is the same index in the original text - the config editor relies on it.
 */
export function stripComments(src: string): string {
  return mask(src, false)
}

/** Like stripComments, but also blanks the contents of string literals (quotes stay). */
export function codeOnly(src: string): string {
  return mask(src, true)
}

function mask(src: string, blankStrings: boolean): string {
  const blank = (ch: string) => (ch === '\n' || ch === '\r' ? ch : ' ')
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') out += blank(src[i++])
      continue
    }
    if (ch === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2)
      const end = close === -1 ? src.length : close + 2
      while (i < end) out += blank(src[i++])
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const keep = (c: string) => (blankStrings ? blank(c) : c)
      out += ch
      i++
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\' && i + 1 < src.length) out += keep(src[i++])
        out += keep(src[i++])
      }
      if (i < src.length) out += src[i++]
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

type CallReading =
  | { kind: 'not-registered' }
  | { kind: 'unreadable'; reason: string }
  /** `open` is the index of the call's `(` in the source; `args` the text between the parentheses. */
  | { kind: 'call'; name: string; open: number; args: string }

/**
 * Locate the remarq plugin call in `configSource`. `stripped` keeps string
 * literals (the import path must be read); `code` also blanks them, so a string
 * that merely contains "remarq" or "name(" is never taken for code.
 */
function readRemarqCall(configSource: string): CallReading {
  const stripped = stripComments(configSource)
  const code = codeOnly(configSource)
  const name = pluginBinding(stripped)
  if (!name) {
    if (!/remarq/i.test(code)) return { kind: 'not-registered' }
    return {
      kind: 'unreadable',
      reason: '@web-remarq/unplugin is not imported directly in this file, so the plugin call (and its include option) lives in an imported or shared config',
    }
  }

  const calls = [...code.matchAll(new RegExp(String.raw`(?<![\w$.])${name.replace(/\$/g, '\\$')}\s*\(`, 'g'))]
  if (calls.length === 0) {
    return { kind: 'unreadable', reason: `@web-remarq/unplugin is imported as ${name} but ${name}() is never called in this file` }
  }
  if (calls.length > 1) {
    return { kind: 'unreadable', reason: `${name}() is called more than once in this file` }
  }
  const open = calls[0].index! + calls[0][0].length - 1
  const args = balanced(stripped, open, '(', ')')
  if (args === null) {
    return { kind: 'unreadable', reason: `${name}() call is unbalanced` }
  }
  return { kind: 'call', name, open, args }
}

/**
 * Read how the remarq plugin is registered in `configSource`, without executing it.
 *
 * - No mention of the plugin (outside comments and strings) -> `not-registered`.
 * - Mentioned but not imported directly in this file (a shared preset, a re-export,
 *   a wrapper) -> `unreadable`: the include option lives somewhere this file does
 *   not show.
 * - Imported and called with no options, or with options lacking `include` -> `default`.
 * - Imported and called with an inline `include: ['...']` array -> `explicit`.
 * - Anything else (a variable, a spread, a template string) -> `unreadable`.
 */
export function readRemarqInclude(configSource: string): IncludeReading {
  const call = readRemarqCall(configSource)
  if (call.kind !== 'call') return call
  return readIncludeOption(call.name, call.args)
}

/**
 * Whether the readable remarq() call turns on the dev widget: `enabled` for
 * `widget: true` or an inline options object, `absent` when the key is missing,
 * `other` for anything else (`widget: false`, a variable, unreadable options).
 */
export function readRemarqWidget(configSource: string): 'enabled' | 'absent' | 'other' {
  const call = readRemarqCall(configSource)
  if (call.kind !== 'call') return 'other'
  const body = codeOnly(call.args).trim()
  if (body === '') return 'absent'
  if (!body.startsWith('{')) return 'other'
  if (!/\bwidget\b/.test(body)) return 'absent'
  return /\bwidget\s*:\s*(?:true\b|\{)/.test(body) ? 'enabled' : 'other'
}

const UNPLUGIN_VITE = '@web-remarq/unplugin/vite'

export type ConfigEdit =
  | { kind: 'edited'; content: string; change: 'registered' | 'widget-added' }
  | { kind: 'unchanged' }
  | { kind: 'manual'; reason: string }

interface Insertion {
  at: number
  text: string
}

/**
 * Text to append after the last item of the list or object whose opening bracket
 * is at `open` and closing bracket at `close`, following its layout: one item per
 * line keeps the line style and indentation, a one-line list stays on one line.
 */
function appendItem(src: string, stripped: string, open: number, close: number, item: string, eol: string): Insertion {
  const inner = stripped.slice(open + 1, close)
  const lastIdx = inner.trimEnd().length - 1
  if (lastIdx < 0) return { at: open + 1, text: stripped[open] === '{' ? ` ${item} ` : item }

  const at = open + 1 + lastIdx + 1
  const trailingComma = inner[lastIdx] === ','
  if (!inner.includes('\n')) return { at, text: `${trailingComma ? ' ' : ', '}${item}` }

  const lineStart = src.lastIndexOf('\n', at - 1) + 1
  const indent = src.slice(lineStart).match(/^[ \t]*/)![0]
  return { at, text: `${trailingComma ? '' : ','}${eol}${indent}${item}${trailingComma ? ',' : ''}` }
}

/**
 * True when the object containing index `at` is itself the value of a property
 * (`build: { rollupOptions: { plugins: [...] } }`), so a `plugins` key there is
 * not Vite's own top-level plugins list. `code` must have strings blanked.
 */
function inNestedObject(code: string, at: number): boolean {
  let depth = 0
  for (let i = at - 1; i >= 0; i--) {
    const ch = code[i]
    if (ch === '}' || ch === ']' || ch === ')') depth++
    else if (ch === '[' || ch === '(') depth--
    else if (ch === '{') {
      if (depth === 0) return /[\w$'"\]]\s*:\s*$/.test(code.slice(0, i))
      depth--
    }
  }
  return false
}

/** Where to put the import (or require) of the plugin, matching the file's module style, quotes and semicolons. */
function importInsertion(src: string, code: string, eol: string): { insertion: Insertion; quote: string } {
  const esm = /^\s*(?:import|export)\b/m.test(code) || !/\brequire\s*\(/.test(code)
  const statement = esm
    ? /^import\b[\s\S]*?(['"])[^'"\n]*\1[ \t]*;?/gm
    : /^(?:const|let|var)\b[^=\n]*=\s*require\(\s*(['"])[^'"\n]*\1\s*\)[\w.]*[ \t]*;?/gm
  const last = [...code.matchAll(statement)].pop()
  const quote = last?.[1] ?? "'"
  const semi = last?.[0].endsWith(';') ? ';' : ''
  const line = esm
    ? `import remarq from ${quote}${UNPLUGIN_VITE}${quote}${semi}`
    : `const remarq = require(${quote}${UNPLUGIN_VITE}${quote}).default${semi}`
  if (!last) return { insertion: { at: 0, text: `${line}${eol}` }, quote }
  return { insertion: { at: last.index! + last[0].length, text: `${eol}${line}` }, quote }
}

/** The remarq() call init writes, e.g. `remarq({ widget: true, include: ['src/**\/*.vue'] })`. */
export function remarqCall(include: string[], widget: boolean, quote = "'"): string {
  const globs = include.map((glob) => `${quote}${glob}${quote}`).join(', ')
  return `remarq({ ${widget ? 'widget: true, ' : ''}include: [${globs}] })`
}

/**
 * Register the remarq plugin in a Vite config by inserting text, never executing
 * the config and never rewriting what is already there. Anything this cannot
 * read with certainty is `manual`, with the reason; the result is re-read with
 * the same static reader doctor uses before it is returned as `edited`.
 *
 * `widget` is false when the app already starts the widget itself (entry calls
 * WebRemarq.init): `widget: true` would start a second one.
 */
export function editViteConfig(source: string, include: string[], widget: boolean): ConfigEdit {
  const stripped = stripComments(source)
  const code = codeOnly(source)
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const call = readRemarqCall(source)
  let insertions: Insertion[]
  let change: 'registered' | 'widget-added'

  if (call.kind === 'unreadable') return { kind: 'manual', reason: call.reason }
  if (call.kind === 'call') {
    if (!widget) return { kind: 'unchanged' }
    const notInline = { kind: 'manual', reason: `${call.name}() is called with options that are not a single inline object literal` } as const
    const objOpen = call.open + 1 + call.args.length - call.args.trimStart().length
    if (call.args.trim() !== '' && stripped[objOpen] !== '{') return notInline
    if (readRemarqWidget(source) !== 'absent') return { kind: 'unchanged' }
    if (call.args.trim() === '') {
      insertions = [{ at: call.open + 1, text: '{ widget: true }' }]
    } else {
      const obj = balanced(stripped, objOpen, '{', '}')
      const objClose = obj === null ? -1 : objOpen + obj.length + 1
      if (obj === null || !/^\s*,?\s*$/.test(stripped.slice(objClose + 1, call.open + 1 + call.args.length))) return notInline
      insertions = [appendItem(source, stripped, objOpen, objClose, 'widget: true', eol)]
    }
    change = 'widget-added'
  } else {
    const arrays = [...code.matchAll(/(?<![\w$.])plugins\s*:\s*\[/g)].filter((m) => !inNestedObject(code, m.index!))
    if (arrays.length !== 1) {
      return {
        kind: 'manual',
        reason: arrays.length === 0 ? 'no inline `plugins: [...]` array found' : 'more than one `plugins: [...]` array found',
      }
    }
    const open = arrays[0].index! + arrays[0][0].length - 1
    const inner = balanced(stripped, open, '[', ']')
    if (inner === null) return { kind: 'manual', reason: 'the plugins array is unbalanced' }
    const { insertion, quote } = importInsertion(source, code, eol)
    insertions = [insertion, appendItem(source, stripped, open, open + inner.length + 1, remarqCall(include, widget, quote), eol)]
    change = 'registered'
  }

  let content = source
  for (const { at, text } of [...insertions].sort((a, b) => b.at - a.at)) {
    content = content.slice(0, at) + text + content.slice(at)
  }

  const reread = readRemarqInclude(content)
  const rereadOk =
    reread.kind !== 'not-registered' &&
    reread.kind !== 'unreadable' &&
    (change === 'widget-added' || (reread.kind === 'explicit' && reread.include.join('\n') === include.join('\n'))) &&
    readRemarqWidget(content) === (widget ? 'enabled' : 'absent')
  if (!rereadOk) return { kind: 'manual', reason: 'the edited config did not read back as expected' }
  return { kind: 'edited', content, change }
}
