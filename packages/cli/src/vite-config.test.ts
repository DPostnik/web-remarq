import { describe, expect, it } from 'vitest'
import { readRemarqInclude, stripComments } from './vite-config'

const header = `import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n`

describe('stripComments', () => {
  it('removes line and block comments but keeps // inside strings', () => {
    const src = `const a = 'http://x' // trailing\n/* block\n */ const b = "//not a comment"`
    expect(stripComments(src)).toBe(`const a = 'http://x' \n const b = "//not a comment"`)
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
