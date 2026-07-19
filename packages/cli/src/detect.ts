import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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

/** Read workspace globs from package.json workspaces or pnpm-workspace.yaml. */
export function readWorkspaceGlobs(repoRoot: string): string[] {
  const pkg = readJson<PackageJson>(join(repoRoot, 'package.json'))
  const ws = pkg?.workspaces
  if (Array.isArray(ws)) return ws
  if (ws && Array.isArray(ws.packages)) return ws.packages

  const yamlPath = join(repoRoot, 'pnpm-workspace.yaml')
  if (!existsSync(yamlPath)) return []
  // Minimal parse: collect `- 'glob'` list items. Avoids a YAML dependency.
  return readFileSync(yamlPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/** Expand `dir/*` style globs one level deep. Only the trailing `*` form is supported. */
function expandGlob(repoRoot: string, glob: string): string[] {
  if (!glob.endsWith('/*')) {
    return existsSync(join(repoRoot, glob)) ? [glob] : []
  }
  const parent = glob.slice(0, -2)
  const parentPath = join(repoRoot, parent)
  if (!existsSync(parentPath)) return []
  return readdirSync(parentPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${parent}/${e.name}`)
}

/** Workspace packages that carry a bundler dependency, as repoRoot-relative paths, sorted. */
export function findAppCandidates(repoRoot: string): string[] {
  return readWorkspaceGlobs(repoRoot)
    .flatMap((glob) => expandGlob(repoRoot, glob))
    .filter((rel) => hasBundler(readJson<PackageJson>(join(repoRoot, rel, 'package.json'))))
    .sort()
}

export function detect(cwd: string, opts?: { app?: string }): DetectResult {
  const dir = resolve(cwd)
  const repoRoot = findRepoRoot(dir)
  const packageManager = detectPackageManager(repoRoot)

  const explicit = opts?.app ? resolve(repoRoot, opts.app) : null
  const appDir = explicit ?? dir

  let classified = classify(appDir)

  // Nothing here, and we were not pointed at a specific app: look through the workspace.
  if (!classified && !explicit) {
    const candidates = findAppCandidates(repoRoot)
    if (candidates.length === 1) {
      const resolved = join(repoRoot, candidates[0])
      const fromWorkspace = classify(resolved)
      if (fromWorkspace) {
        return {
          ok: true,
          detection: { ...fromWorkspace, repoRoot, appDir: resolved, packageManager },
        }
      }
    }
    if (candidates.length > 1) {
      return {
        ok: false,
        reason: `Found ${candidates.length} apps in this workspace`,
        hint: `Pick one with --app, for example: npx @web-remarq/cli init --app ${candidates[0]}`,
        candidates,
      }
    }
  }

  if (!classified) {
    return {
      ok: false,
      reason: `No supported stack found in ${relative(repoRoot, appDir) || appDir}`,
      hint: 'web-remarq supports Next.js, Vite (Vue/React/vanilla) and plain HTML pages. Run this from your app directory, or follow the manual setup: https://github.com/DPostnik/web-remarq#quick-start',
    }
  }

  return {
    ok: true,
    detection: { ...classified, repoRoot, appDir, packageManager },
  }
}
