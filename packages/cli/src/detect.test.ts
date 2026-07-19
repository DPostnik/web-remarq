import { describe, it, expect, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { detect } from './detect'

const source = (name: string) => resolve(__dirname, '../fixtures', name)

const temps: string[] = []
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

/**
 * Copy a fixture out of the repository before detecting.
 * Fixtures live inside web-remarq, which has a .git directory - detecting them
 * in place would make findRepoRoot walk up to our own repo root and read our
 * lockfile instead of the fixture's.
 */
function fixture(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'remarq-fx-'))
  temps.push(dir)
  cpSync(source(name), dir, { recursive: true })
  return dir
}

describe('detect - single repo', () => {
  it('detects vue + vite with npm', () => {
    const r = detect(fixture('vue-vite'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('vue')
    expect(r.detection.bundler).toBe('vite')
    expect(r.detection.packageManager).toBe('npm')
    expect(r.detection.configFile).toBe('vite.config.ts')
    expect(r.detection.entry).toBe('src/main.ts')
    expect(r.detection.plugin).toBe('@web-remarq/unplugin')
    expect(r.detection.includeGlob).toEqual(['src/**/*.vue'])
  })

  it('detects react + vite with pnpm', () => {
    const r = detect(fixture('react-vite'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('react')
    expect(r.detection.packageManager).toBe('pnpm')
    expect(r.detection.entry).toBe('src/main.tsx')
    expect(r.detection.includeGlob).toEqual(['src/**/*.{jsx,tsx}'])
  })

  it('detects next with yarn', () => {
    const r = detect(fixture('next-app'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('next')
    expect(r.detection.bundler).toBe('next')
    expect(r.detection.packageManager).toBe('yarn')
    expect(r.detection.configFile).toBe('next.config.ts')
    expect(r.detection.plugin).toBe('@web-remarq/next')
  })

  it('detects plain html with no bundler', () => {
    const r = detect(fixture('plain-html'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('plain-html')
    expect(r.detection.bundler).toBe(null)
    expect(r.detection.plugin).toBe(null)
    expect(r.detection.entry).toBe('index.html')
  })

  it('stops on an unknown stack instead of guessing', () => {
    const r = detect(fixture('unknown'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('No supported stack')
    expect(r.hint.length).toBeGreaterThan(0)
  })
})

describe('detect - monorepo', () => {
  it('picks the only app silently and keeps repoRoot separate from appDir', () => {
    // One fixture() call - each call creates its own temp copy.
    const root = fixture('mono-npm-single')
    const r = detect(root)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('vue')
    expect(r.detection.appDir).toBe(join(root, 'packages/web'))
    expect(r.detection.repoRoot).toBe(root)
    expect(r.detection.packageManager).toBe('npm')
  })

  it('refuses to guess between several apps and lists candidates', () => {
    const r = detect(fixture('mono-pnpm-multi'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.candidates).toEqual(['apps/admin', 'apps/web'])
    expect(r.hint).toContain('--app')
  })

  it('honours --app to disambiguate', () => {
    const r = detect(fixture('mono-pnpm-multi'), { app: 'apps/admin' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('react')
    expect(r.detection.packageManager).toBe('pnpm')
  })

  it('stops when no workspace package has a bundler', () => {
    const r = detect(fixture('mono-no-app'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toContain('No supported stack')
  })

  it('resolves an app through a packages/** glob', () => {
    const r = detect(fixture('mono-npm-doublestar'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('vue')
    expect(r.detection.appDir).toContain('packages/web')
  })

  it('resolves an app through a trailing-slash apps/*/ glob', () => {
    const r = detect(fixture('mono-pnpm-trailing-slash'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('react')
    expect(r.detection.appDir).toContain('apps/web')
  })

  it('reports unparseable workspace globs instead of pretending no app exists', () => {
    const r = detect(fixture('mono-unsupported-glob'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.unsupportedGlobs).toEqual(['packages/*/src'])
    expect(r.hint).toContain('--app')
  })

  it('scopes pnpm-workspace.yaml parsing to the packages key', () => {
    const r = detect(fixture('mono-pnpm-yaml-scoped'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.appDir).toContain('apps/web')
    expect(r.detection.appDir).not.toContain('decoy')
  })

  it('resolves an app nested two levels deep through a packages/** glob', () => {
    const r = detect(fixture('mono-npm-doublestar-nested'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('vue')
    expect(r.detection.appDir).toContain(join('packages', 'scope', 'web'))
  })

  it('reports a recognized-but-empty glob as unsupported instead of vanishing', () => {
    const r = detect(fixture('mono-empty-glob'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.unsupportedGlobs).toEqual(['packages/*'])
    expect(r.hint).toContain('--app')
  })

  it('resolves an inline-array pnpm-workspace.yaml (packages: [\'apps/*\'])', () => {
    const r = detect(fixture('mono-pnpm-inline-array'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detection.framework).toBe('react')
    expect(r.detection.appDir).toContain(join('apps', 'web'))
  })
})
