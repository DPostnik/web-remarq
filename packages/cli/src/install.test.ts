import { describe, it, expect } from 'vitest'
import { buildInstallCommand } from './install'
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
      'npm install -D -w "packages/web" web-remarq @web-remarq/unplugin',
    )
  })

  it('targets the workspace with pnpm --filter by directory', () => {
    const d = { ...base, packageManager: 'pnpm' as const, appDir: '/repo/apps/web' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      'pnpm add -D --filter "./apps/web" web-remarq @web-remarq/unplugin',
    )
  })

  it('uses yarn workspace syntax with the package name when it is known', () => {
    const d = {
      ...base,
      packageManager: 'yarn' as const,
      appDir: '/repo/apps/web',
      appPackageName: 'web',
    }
    expect(buildInstallCommand(d, pkgs)).toBe('yarn workspace web add -D web-remarq @web-remarq/unplugin')
  })

  it('falls back to yarn --cwd when the package name is unknown', () => {
    const d = {
      ...base,
      packageManager: 'yarn' as const,
      appDir: '/repo/apps/web',
      appPackageName: null,
    }
    expect(buildInstallCommand(d, pkgs)).toBe(
      'yarn --cwd "./apps/web" add -D web-remarq @web-remarq/unplugin',
    )
  })

  it('uses bun add', () => {
    const d = { ...base, packageManager: 'bun' as const }
    expect(buildInstallCommand(d, pkgs)).toBe('bun add -d web-remarq @web-remarq/unplugin')
  })

  it('targets the workspace with bun --cwd', () => {
    const d = { ...base, packageManager: 'bun' as const, appDir: '/repo/apps/web' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      'bun add -d --cwd "apps/web" web-remarq @web-remarq/unplugin',
    )
  })

  it('quotes a workspace path that contains a space', () => {
    const d = { ...base, appDir: '/repo/packages/my app' }
    expect(buildInstallCommand(d, pkgs)).toBe(
      'npm install -D -w "packages/my app" web-remarq @web-remarq/unplugin',
    )
  })
})
