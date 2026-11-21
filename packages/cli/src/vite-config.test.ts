import { describe, expect, it } from 'vitest'
import { editViteConfig, readRemarqInclude, readRemarqWidget, stripComments } from './vite-config'

const header = `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n`

describe('stripComments', () => {
  it('blanks line and block comments, keeping // inside strings, line breaks and every index', () => {
    const src = `const a = 'http://x' // trailing\n/* block\n */ const b = "//not a comment"`
    const out = stripComments(src)
    expect(out).toBe(`const a = 'http://x'            \n        \n    const b = "//not a comment"`)
    expect(out).toHaveLength(src.length)
  })
})

describe('readRemarqInclude', () => {
  it('reports not-registered when the plugin is absent', () => {
    expect(readRemarqInclude(`${header}export default defineConfig({ plugins: [vue()] })`)).toEqual({ kind: 'not-registered' })
  })

  it('does not count a comment as a registration', () => {
    const src = `${header}// TODO: add remarq() here\n/* import remarq from '@web-remarq/unplugin/vite' */\nexport default defineConfig({ plugins: [vue()] })`
    expect(readRemarqInclude(src)).toEqual({ kind: 'not-registered' })
  })

  it('reports default when remarq() takes no options', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nexport default defineConfig({ plugins: [vue(), remarq()] })`
    expect(readRemarqInclude(src)).toEqual({ kind: 'default' })
  })

  it('reports default when the options object has no include key', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nexport default defineConfig({ plugins: [vue(), remarq({ production: true })] })`
    expect(readRemarqInclude(src)).toEqual({ kind: 'default' })
  })

  it('reads an inline include array, single or double quoted, multi-line, trailing comma', () => {
    const src =
      `${header}import remarq from '@web-remarq/unplugin/vite'\n` +
      `export default defineConfig({\n  plugins: [\n    vue(),\n    remarq({\n      include: [\n        'src/**/*.jsx',\n        "src/**/*.tsx",\n      ],\n    }),\n  ],\n})`
    expect(readRemarqInclude(src)).toEqual({ kind: 'explicit', include: ['src/**/*.jsx', 'src/**/*.tsx'] })
  })

  it('reads the brace form the CLI used to generate', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nexport default defineConfig({ plugins: [vue(), remarq({ include: ['src/**/*.{jsx,tsx}'] })] })`
    expect(readRemarqInclude(src)).toEqual({ kind: 'explicit', include: ['src/**/*.{jsx,tsx}'] })
  })

  it('is not confused by a // inside a string elsewhere in the config', () => {
    const src =
      `${header}import remarq from '@web-remarq/unplugin/vite'\n` +
      `export default defineConfig({ server: { proxy: { '/api': 'http://localhost:3000' } }, plugins: [vue(), remarq({ include: ['src/**/*.vue'] })] })`
    expect(readRemarqInclude(src)).toEqual({ kind: 'explicit', include: ['src/**/*.vue'] })
  })

  it('supports an aliased default import and the require form', () => {
    const aliased = `${header}import stamp from '@web-remarq/unplugin/vite'\nexport default defineConfig({ plugins: [stamp({ include: ['src/**/*.vue'] })] })`
    expect(readRemarqInclude(aliased)).toEqual({ kind: 'explicit', include: ['src/**/*.vue'] })

    const required = `const { defineConfig } = require('vite')\nconst remarq = require('@web-remarq/unplugin/vite')\nmodule.exports = defineConfig({ plugins: [remarq({ include: ['src/**/*.vue'] })] })`
    expect(readRemarqInclude(required)).toEqual({ kind: 'explicit', include: ['src/**/*.vue'] })
  })

  it('reports unreadable when include is a variable, not a literal', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nconst patterns = ['src/**/*.vue']\nexport default defineConfig({ plugins: [vue(), remarq({ include: patterns })] })`
    const r = readRemarqInclude(src)
    expect(r.kind).toBe('unreadable')
  })

  it('reports unreadable for the property shorthand { include }', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nconst include = ['src/**/*.vue']\nexport default defineConfig({ plugins: [vue(), remarq({ include })] })`
    expect(readRemarqInclude(src).kind).toBe('unreadable')
  })

  it('reports unreadable when the options are passed as a variable', () => {
    const src = `${header}import remarq from '@web-remarq/unplugin/vite'\nconst opts = {}\nexport default defineConfig({ plugins: [vue(), remarq(opts)] })`
    expect(readRemarqInclude(src).kind).toBe('unreadable')
  })

  it('reports unreadable when the plugin comes from a shared preset (not imported here)', () => {
    const src = `${header}import { remarqPreset } from './shared/build-config'\nexport default defineConfig({ plugins: [vue(), remarqPreset()] })`
    const r = readRemarqInclude(src)
    expect(r.kind).toBe('unreadable')
    if (r.kind !== 'unreadable') return
    expect(r.reason).toContain('shared')
  })
})

describe('readRemarqWidget', () => {
  const imp = `${header}import remarq from '@web-remarq/unplugin/vite'\n`
  it('reads enabled, absent and other', () => {
    expect(readRemarqWidget(`${imp}export default defineConfig({ plugins: [remarq({ widget: true })] })`)).toBe('enabled')
    expect(readRemarqWidget(`${imp}export default defineConfig({ plugins: [remarq({ widget: { position: 'left' } })] })`)).toBe('enabled')
    expect(readRemarqWidget(`${imp}export default defineConfig({ plugins: [remarq()] })`)).toBe('absent')
    expect(readRemarqWidget(`${imp}export default defineConfig({ plugins: [remarq({ include: ['widget'] })] })`)).toBe('absent')
    expect(readRemarqWidget(`${imp}export default defineConfig({ plugins: [remarq({ widget: false })] })`)).toBe('other')
    expect(readRemarqWidget(`${header}export default defineConfig({ plugins: [vue()] })`)).toBe('other')
  })
})

describe('editViteConfig', () => {
  const vueInclude = ['src/**/*.vue']
  const edited = (src: string, widget = true) => {
    const r = editViteConfig(src, vueInclude, widget)
    if (r.kind !== 'edited') throw new Error(`expected an edit, got ${JSON.stringify(r)}`)
    return r.content
  }

  it('registers the plugin in an empty one-line plugins array (ESM .ts)', () => {
    const src = `import { defineConfig } from 'vite'\nexport default defineConfig({ plugins: [] })\n`
    expect(edited(src)).toBe(
      `import { defineConfig } from 'vite'\nimport remarq from '@web-remarq/unplugin/vite'\n` +
        `export default defineConfig({ plugins: [remarq({ widget: true, include: ['src/**/*.vue'] })] })\n`,
    )
  })

  it('appends after the framework plugin in a multi-line array with a trailing comma, matching quotes and semicolons', () => {
    const src =
      `import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\n\n` +
      `export default defineConfig({\n  plugins: [\n    vue(),\n  ],\n});\n`
    expect(edited(src)).toBe(
      `import { defineConfig } from "vite";\nimport vue from "@vitejs/plugin-vue";\nimport remarq from "@web-remarq/unplugin/vite";\n\n` +
        `export default defineConfig({\n  plugins: [\n    vue(),\n    remarq({ widget: true, include: ["src/**/*.vue"] }),\n  ],\n});\n`,
    )
  })

  it('adds the missing comma in a multi-line array without a trailing comma and keeps CRLF line endings', () => {
    const src = `import vue from '@vitejs/plugin-vue'\r\nexport default {\r\n\tplugins: [\r\n\t\tvue()\r\n\t]\r\n}\r\n`
    expect(edited(src)).toBe(
      `import vue from '@vitejs/plugin-vue'\r\nimport remarq from '@web-remarq/unplugin/vite'\r\nexport default {\r\n` +
        `\tplugins: [\r\n\t\tvue(),\r\n\t\tremarq({ widget: true, include: ['src/**/*.vue'] })\r\n\t]\r\n}\r\n`,
    )
  })

  it('uses require(...).default in a CommonJS config', () => {
    const src = `const { defineConfig } = require('vite')\nconst vue = require('@vitejs/plugin-vue')\nmodule.exports = defineConfig({ plugins: [vue()] })\n`
    expect(edited(src)).toBe(
      `const { defineConfig } = require('vite')\nconst vue = require('@vitejs/plugin-vue')\n` +
        `const remarq = require('@web-remarq/unplugin/vite').default\n` +
        `module.exports = defineConfig({ plugins: [vue(), remarq({ widget: true, include: ['src/**/*.vue'] })] })\n`,
    )
  })

  it('is not confused by plugins: and remarq inside comments and strings, or by a nested rollup plugins array', () => {
    const src =
      `import { defineConfig } from 'vite'\n// plugins: [remarq()]\n/* plugins: [ */\n` +
      `export default defineConfig({\n  define: { T: 'plugins: [remarq(' },\n  plugins: [vue()],\n  build: { rollupOptions: { plugins: [] } },\n})\n`
    const out = edited(src)
    expect(out).toContain(`  plugins: [vue(), remarq({ widget: true, include: ['src/**/*.vue'] })],\n`)
    expect(out).toContain(`define: { T: 'plugins: [remarq(' }`)
    expect(out).toContain('rollupOptions: { plugins: [] }')
  })

  it('adds widget: true to a bare remarq() and to an inline options object, leaving the rest byte-for-byte', () => {
    const imp = `import remarq from '@web-remarq/unplugin/vite'\n`
    expect(edited(`${imp}export default { plugins: [remarq()] }\n`)).toBe(`${imp}export default { plugins: [remarq({ widget: true })] }\n`)
    expect(edited(`${imp}export default { plugins: [remarq({ include: ['a/**/*.vue'] })] }\n`)).toBe(
      `${imp}export default { plugins: [remarq({ include: ['a/**/*.vue'], widget: true })] }\n`,
    )
    expect(edited(`${imp}export default {\n  plugins: [\n    remarq({\n      include: ['a/**/*.vue'],\n    }),\n  ],\n}\n`)).toBe(
      `${imp}export default {\n  plugins: [\n    remarq({\n      include: ['a/**/*.vue'],\n      widget: true,\n    }),\n  ],\n}\n`,
    )
  })

  it('changes nothing when widget is already set, and is idempotent', () => {
    const imp = `import remarq from '@web-remarq/unplugin/vite'\n`
    expect(editViteConfig(`${imp}export default { plugins: [remarq({ widget: false })] }`, vueInclude, true)).toEqual({ kind: 'unchanged' })
    const once = edited(`import vue from '@vitejs/plugin-vue'\nexport default { plugins: [vue()] }\n`)
    expect(editViteConfig(once, vueInclude, true)).toEqual({ kind: 'unchanged' })
  })

  it('registers without widget when the app starts the widget itself, and never adds it later', () => {
    const out = edited(`export default { plugins: [] }\n`, false)
    expect(out).toBe(`import remarq from '@web-remarq/unplugin/vite'\nexport default { plugins: [remarq({ include: ['src/**/*.vue'] })] }\n`)
    expect(editViteConfig(out, vueInclude, false)).toEqual({ kind: 'unchanged' })
  })

  it.each([
    ['no plugins array', `export default { server: {} }`, 'no inline'],
    ['plugins from a variable', `const plugins = []\nexport default { plugins }`, 'no inline'],
    ['two candidate arrays', `export default [{ plugins: [] }, { plugins: [] }]`, 'more than one'],
    ['a shared preset', `import { remarqPreset } from './preset'\nexport default { plugins: [remarqPreset()] }`, 'shared'],
    ['an unbalanced array', `export default { plugins: [vue( }`, 'unbalanced'],
    ['options in a variable', `import remarq from '@web-remarq/unplugin/vite'\nexport default { plugins: [remarq(opts)] }`, 'inline object'],
    ['an options object followed by more arguments', `import remarq from '@web-remarq/unplugin/vite'\nexport default { plugins: [remarq({}, extra)] }`, 'inline object'],
    ['two remarq() calls', `import remarq from '@web-remarq/unplugin/vite'\nexport default { plugins: [remarq(), remarq()] }`, 'more than once'],
  ])('falls back to manual for %s', (_name, src, reason) => {
    const r = editViteConfig(src, vueInclude, true)
    expect(r.kind).toBe('manual')
    if (r.kind === 'manual') expect(r.reason).toContain(reason)
  })
})
