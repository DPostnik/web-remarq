import { describe, it, expect } from 'vitest'
import { buildEdits } from './snippets'
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

describe('buildEdits', () => {
  it('emits two edits with repo-relative paths for vue + vite', () => {
    const edits = buildEdits(vueDetection)
    expect(edits).toHaveLength(2)
    expect(edits[0].file).toBe('packages/web/vite.config.ts')
    expect(edits[0].kind).toBe('build-config')
    expect(edits[0].snippet).toContain("include: ['src/**/*.vue']")
    expect(edits[0].note).toContain('after')
    expect(edits[1].file).toBe('packages/web/src/main.ts')
    expect(edits[1].snippet).toContain('import.meta.env.DEV')
    expect(edits[1].snippet).toContain('HttpStorageAdapter')
  })

  it('emits the withRemarq wrapper for next', () => {
    const edits = buildEdits({
      ...vueDetection,
      framework: 'next',
      bundler: 'next',
      appDir: '/repo',
      configFile: 'next.config.ts',
      entry: 'app/layout.tsx',
      plugin: '@web-remarq/next',
      includeGlob: null,
    })
    expect(edits[0].snippet).toContain('withRemarq')
    expect(edits[1].snippet).toContain("'use client'")
  })

  it('emits no edits in plain-html mode', () => {
    const edits = buildEdits({
      ...vueDetection,
      framework: 'plain-html',
      bundler: null,
      configFile: null,
      entry: 'index.html',
      plugin: null,
      includeGlob: null,
    })
    expect(edits).toEqual([])
  })

  it('says so when the entry point was not found', () => {
    const edits = buildEdits({ ...vueDetection, entry: null })
    expect(edits).toHaveLength(2)
    expect(edits[1].file).toBe('<entry point not found>')
    expect(edits[1].note).toContain('locate the entry')
  })
})
