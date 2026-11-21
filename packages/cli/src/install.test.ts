import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildInstallCommand, missingPackages } from './install'
import type { Detection } from './types'

const base: Detection = {
  framework: 'vue',
  bundler: 'vite',
  packageManager: 'npm',
  repoRoot: '/repo',
  appDir: '/repo',
  appPackageName: 'app',
  configFile: 'vite.config.ts',
  entry: 'src/main.ts',
  plugin: '@web-remarq/unplugin',
  includeGlob: ['src/**/*.vue'],
}

const pkgs = ['web-remarq', '@web-remarq/unplugin']

describe('buildInstallCommand', () => {
  it('uses a plain install outside a workspace', () => {
    expect(buildInstallCommand(base, pkgs)).toBe('npm install -D web-remarq @web-remarq/unplugin')
  })

  it('targets the workspace with npm -w', () => {
    const d = { ...base, appDir: '/repo/packages/web' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "npm install -D -w 'packages/web' web-remarq @web-remarq/unplugin",
    )
  })

  it('targets the workspace with pnpm --filter by directory', () => {
    const d = { ...base, packageManager: 'pnpm' as const, appDir: '/repo/apps/web' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "pnpm add -D --filter './apps/web' web-remarq @web-remarq/unplugin",
    )
  })

  it('uses yarn workspace syntax with the package name when it is known', () => {
    const d = {
      ...base,
      packageManager: 'yarn' as const,
      appDir: '/repo/apps/web',
      appPackageName: 'web',
    }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "yarn workspace 'web' add -D web-remarq @web-remarq/unplugin",
    )
  })

  it('falls back to yarn --cwd when the package name is unknown', () => {
    const d = {
      ...base,
      packageManager: 'yarn' as const,
      appDir: '/repo/apps/web',
      appPackageName: null,
    }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "yarn --cwd './apps/web' add -D web-remarq @web-remarq/unplugin",
    )
  })

  it('uses bun add', () => {
    const d = { ...base, packageManager: 'bun' as const }
    expect(buildInstallCommand(d, pkgs)).toBe('bun add -d web-remarq @web-remarq/unplugin')
  })

  it('targets the workspace with bun --cwd', () => {
    const d = { ...base, packageManager: 'bun' as const, appDir: '/repo/apps/web' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "bun add -d --cwd 'apps/web' web-remarq @web-remarq/unplugin",
    )
  })

  it('quotes a workspace path that contains a space', () => {
    const d = { ...base, appDir: '/repo/packages/my app' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "npm install -D -w 'packages/my app' web-remarq @web-remarq/unplugin",
    )
  })

  it('escapes a workspace path containing a literal single quote', () => {
    const d = { ...base, appDir: "/repo/packages/o'brien" }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "npm install -D -w 'packages/o'\\''brien' web-remarq @web-remarq/unplugin",
    )
  })

  it('escapes an appPackageName containing a literal single quote in the yarn branch', () => {
    const d = {
      ...base,
      packageManager: 'yarn' as const,
      appDir: '/repo/apps/web',
      appPackageName: "o'brien",
    }
    expect(buildInstallCommand(d, pkgs)).toBe(
      "yarn workspace 'o'\\''brien' add -D web-remarq @web-remarq/unplugin",
    )
  })
})

describe('missingPackages', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-install-'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { 'web-remarq': '^0.9.0', '@web-remarq/unplugin': '^0.2.0' } }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function fakeInstall(name: string, version: string) {
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version, main: 'index.js' }))
    writeFileSync(join(pkgDir, 'index.js'), '')
  }

  const vite = () => ({ ...base, repoRoot: dir, appDir: dir })

  it('reinstalls a listed package whose installed version is below the widget minimum', () => {
    fakeInstall('web-remarq', '0.9.0')
    fakeInstall('@web-remarq/unplugin', '0.2.5')
    expect(missingPackages(vite())).toEqual(['web-remarq', '@web-remarq/unplugin'])
  })

  it('skips listed packages at or above the minimum', () => {
    fakeInstall('web-remarq', '0.10.0')
    fakeInstall('@web-remarq/unplugin', '1.0.0')
    expect(missingPackages(vite())).toEqual([])
  })

  it('skips a listed package whose installed version cannot be read', () => {
    fakeInstall('@web-remarq/unplugin', '0.2.0')
    expect(missingPackages(vite())).toEqual(['@web-remarq/unplugin'])
  })

  it('applies no minimum outside Vite', () => {
    fakeInstall('web-remarq', '0.9.0')
    expect(missingPackages({ ...vite(), framework: 'next', bundler: 'next', plugin: '@web-remarq/next' })).toEqual([
      '@web-remarq/next',
    ])
  })
})
