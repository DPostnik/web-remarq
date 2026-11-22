import { describe, it, expect } from 'vitest'
import { nextConfigEdit, nextEntryEdit, viteConfigEdit } from './snippets'
import type { Detection } from './types'

const vueDetection: Detection = {
  framework: 'vue',
  bundler: 'vite',
  packageManager: 'pnpm',
  repoRoot: '/repo',
  appDir: '/repo/packages/web',
  appPackageName: 'web',
  configFile: 'vite.config.ts',
  entry: 'src/main.ts',
  plugin: '@web-remarq/unplugin',
  includeGlob: ['src/**/*.vue'],
}

describe('viteConfigEdit', () => {
  it('prints a repo-relative manual edit with widget: true, the include globs and the reason', () => {
    const edit = viteConfigEdit(vueDetection, true, 'no inline `plugins: [...]` array found')
    expect(edit.file).toBe('packages/web/vite.config.ts')
    expect(edit.kind).toBe('build-config')
    expect(edit.snippet).toContain("remarq({ widget: true, include: ['src/**/*.vue'] })")
    expect(edit.note).toContain('no inline `plugins: [...]` array found')
    expect(edit.note).toContain('after')
  })

  it('prints one plain include pattern per extension for react (no brace groups), and no widget for manual wiring', () => {
    const edit = viteConfigEdit({ ...vueDetection, framework: 'react', includeGlob: ['src/**/*.jsx', 'src/**/*.tsx'] }, false, 'x')
    expect(edit.snippet).toContain("remarq({ include: ['src/**/*.jsx', 'src/**/*.tsx'] })")
    expect(edit.snippet).not.toContain('{jsx,tsx}')
  })

  it('says so when there is no config file', () => {
    expect(viteConfigEdit({ ...vueDetection, configFile: null }, true, 'no Vite config file found').file).toBe('<vite config not found>')
  })
})

describe('Next.js fallback edits', () => {
  const next: Detection = {
    ...vueDetection,
    framework: 'next',
    bundler: 'next',
    appDir: '/repo',
    configFile: 'next.config.ts',
    entry: 'app/layout.tsx',
    plugin: '@web-remarq/next',
    includeGlob: null,
  }

  it('emits the withRemarq wrapper and the client component', () => {
    const config = nextConfigEdit(next, 'unsupported configuration')
    const entry = nextEntryEdit(next, 'older Next.js')
    expect(config.snippet).toContain('withRemarq')
    expect(entry.snippet).toContain("'use client'")
    expect(entry.file).toBe('app/layout.tsx')
  })

  it('says so when the entry point was not found', () => {
    const entry = nextEntryEdit({ ...next, entry: null }, 'older Next.js')
    expect(entry.file).toBe('<entry point not found>')
    expect(entry.note).toContain('Locate the entry')
  })
})
