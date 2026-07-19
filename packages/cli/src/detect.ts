import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { findRepoRoot, firstExisting, readJson } from './fs-utils'
import type { Bundler, Detection, DetectResult, Framework, PackageManager, PluginName } from './types'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']
const NEXT_CONFIGS = ['next.config.ts', 'next.config.mjs', 'next.config.js']
const VUE_ENTRIES = ['src/main.ts', 'src/main.js', 'src/main.mts']
const REACT_ENTRIES = ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx']
const VANILLA_ENTRIES = ['src/main.ts', 'src/main.js']

function hasDep(pkg: PackageJson | null, name: string): boolean {
  if (!pkg) return false
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name])
}

export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun'
  return 'npm'
}

/** True when this directory looks like an app we can install into. */
export function hasBundler(pkg: PackageJson | null): boolean {
  return hasDep(pkg, 'next') || hasDep(pkg, 'vite')
}

function classify(appDir: string): Omit<Detection, 'repoRoot' | 'appDir' | 'packageManager'> | null {
  const pkg = readJson<PackageJson>(join(appDir, 'package.json'))

  if (hasDep(pkg, 'next')) {
    return {
      framework: 'next' as Framework,
      bundler: 'next' as Bundler,
      configFile: firstExisting(appDir, NEXT_CONFIGS),
      entry: firstExisting(appDir, ['app/layout.tsx', 'app/layout.jsx', 'pages/_app.tsx', 'pages/_app.jsx']),
      plugin: '@web-remarq/next' as PluginName,
      includeGlob: null,
    }
  }

  if (hasDep(pkg, 'vite')) {
    const configFile = firstExisting(appDir, VITE_CONFIGS)
    if (hasDep(pkg, 'vue')) {
      return {
        framework: 'vue',
        bundler: 'vite',
        configFile,
        entry: firstExisting(appDir, VUE_ENTRIES),
        plugin: '@web-remarq/unplugin',
        includeGlob: ['src/**/*.vue'],
      }
    }
    if (hasDep(pkg, 'react')) {
      return {
        framework: 'react',
        bundler: 'vite',
        configFile,
        entry: firstExisting(appDir, REACT_ENTRIES),
        plugin: '@web-remarq/unplugin',
        includeGlob: ['src/**/*.{jsx,tsx}'],
      }
    }
    return {
      framework: 'vanilla-vite',
      bundler: 'vite',
      configFile,
      entry: firstExisting(appDir, VANILLA_ENTRIES),
      plugin: '@web-remarq/unplugin',
      includeGlob: ['**/*.{jsx,tsx,vue}'],
    }
  }

  if (existsSync(join(appDir, 'index.html'))) {
    return {
      framework: 'plain-html',
      bundler: null,
      configFile: null,
      entry: 'index.html',
      plugin: null,
      includeGlob: null,
    }
  }

  return null
}

export function detect(cwd: string, _opts?: { app?: string }): DetectResult {
  const dir = resolve(cwd)
  const repoRoot = findRepoRoot(dir)
  const classified = classify(dir)

  if (!classified) {
    return {
      ok: false,
      reason: `No supported stack found in ${dir}`,
      hint: 'web-remarq supports Next.js, Vite (Vue/React/vanilla) and plain HTML pages. Run this from your app directory, or follow the manual setup: https://github.com/DPostnik/web-remarq#quick-start',
    }
  }

  return {
    ok: true,
    detection: {
      ...classified,
      repoRoot,
      appDir: dir,
      packageManager: detectPackageManager(repoRoot),
    },
  }
}
