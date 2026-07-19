import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { findRepoRoot, firstExisting, readJson } from './fs-utils'
import type { Bundler, Detection, DetectResult, Framework, PackageManager, PluginName } from './types'

interface PackageJson {
  name?: string
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
  const appPackageName = pkg?.name ?? null

  if (hasDep(pkg, 'next')) {
    return {
      framework: 'next' as Framework,
      bundler: 'next' as Bundler,
      appPackageName,
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
        appPackageName,
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
        appPackageName,
        configFile,
        entry: firstExisting(appDir, REACT_ENTRIES),
        plugin: '@web-remarq/unplugin',
        includeGlob: ['src/**/*.{jsx,tsx}'],
      }
    }
    return {
      framework: 'vanilla-vite',
      bundler: 'vite',
      appPackageName,
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
      appPackageName,
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

  // Minimal parse: collect `- 'glob'` list items, scoped to the `packages:` top-level
  // key only. Avoids a YAML dependency. Other top-level keys (catalog, overrides,
  // onlyBuiltDependencies, ...) also carry lists and must not leak into this result.
  const globs: string[] = []
  let inPackages = false
  for (const rawLine of readFileSync(yamlPath, 'utf8').split('\n')) {
    if (rawLine.trim() === '') continue
    const isTopLevelKey = /^\S/.test(rawLine) && rawLine.trimEnd().endsWith(':')
    if (isTopLevelKey) {
      inPackages = rawLine.trim() === 'packages:'
      continue
    }
    if (!inPackages) continue
    const line = rawLine.trim()
    if (!line.startsWith('- ')) continue
    const value = line.slice(2).trim().replace(/^['"]|['"]$/g, '')
    if (value) globs.push(value)
  }
  return globs
}

/** List immediate subdirectories of `parent` (repoRoot-relative), one level deep. */
function listSubdirs(repoRoot: string, parent: string): string[] {
  const parentPath = join(repoRoot, parent)
  if (!existsSync(parentPath)) return []
  return readdirSync(parentPath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${parent}/${e.name}`)
}

// Expand one workspace glob entry one level deep. Handles the trailing "dir star"
// form, a trailing slash after it, and a double-star form (treated the same -
// only one level deep is supported). Negations ("not glob") are skipped silently,
// as that is what a negation means. A plain path with no wildcard is checked
// for existence. Anything else is a glob form we do not understand, and is
// reported back via `unsupported` instead of silently contributing nothing.
function expandGlob(repoRoot: string, glob: string): { paths: string[]; unsupported: boolean } {
  if (glob.startsWith('!')) return { paths: [], unsupported: false }

  const normalized = glob.endsWith('/') ? glob.slice(0, -1) : glob

  if (normalized.endsWith('/**')) {
    return { paths: listSubdirs(repoRoot, normalized.slice(0, -3)), unsupported: false }
  }
  if (normalized.endsWith('/*')) {
    return { paths: listSubdirs(repoRoot, normalized.slice(0, -2)), unsupported: false }
  }
  if (!normalized.includes('*')) {
    return { paths: existsSync(join(repoRoot, normalized)) ? [normalized] : [], unsupported: false }
  }
  return { paths: [], unsupported: true }
}

/**
 * Workspace packages that carry a bundler dependency, as repoRoot-relative paths, sorted.
 * `unsupportedGlobs` lists workspace entries whose form could not be parsed, so callers
 * can tell "no app here" apart from "could not understand your workspace config".
 */
export function findAppCandidates(repoRoot: string): { candidates: string[]; unsupportedGlobs: string[] } {
  const unsupportedGlobs: string[] = []
  const candidates = readWorkspaceGlobs(repoRoot)
    .flatMap((glob) => {
      const { paths, unsupported } = expandGlob(repoRoot, glob)
      if (unsupported) unsupportedGlobs.push(glob)
      return paths
    })
    .filter((rel) => hasBundler(readJson<PackageJson>(join(repoRoot, rel, 'package.json'))))
    .sort()
  return { candidates, unsupportedGlobs }
}

export function detect(cwd: string, opts?: { app?: string }): DetectResult {
  const dir = resolve(cwd)
  const repoRoot = findRepoRoot(dir)
  const packageManager = detectPackageManager(repoRoot)

  const explicit = opts?.app ? resolve(repoRoot, opts.app) : null
  const appDir = explicit ?? dir

  let classified = classify(appDir)
  let unsupportedGlobs: string[] = []

  // Nothing here, and we were not pointed at a specific app: look through the workspace.
  if (!classified && !explicit) {
    const found = findAppCandidates(repoRoot)
    unsupportedGlobs = found.unsupportedGlobs
    if (found.candidates.length === 1) {
      const resolved = join(repoRoot, found.candidates[0])
      const fromWorkspace = classify(resolved)
      if (fromWorkspace) {
        return {
          ok: true,
          detection: { ...fromWorkspace, repoRoot, appDir: resolved, packageManager },
        }
      }
    }
    if (found.candidates.length > 1) {
      return {
        ok: false,
        reason: `Found ${found.candidates.length} apps in this workspace`,
        hint: `Pick one with --app, for example: npx @web-remarq/cli init --app ${found.candidates[0]}`,
        candidates: found.candidates,
      }
    }
  }

  if (!classified) {
    const hint =
      unsupportedGlobs.length > 0
        ? `web-remarq did not understand these workspace patterns: ${unsupportedGlobs.join(', ')}. Pass --app <dir> to point at your app directly.`
        : 'web-remarq supports Next.js, Vite (Vue/React/vanilla) and plain HTML pages. Run this from your app directory, or follow the manual setup: https://github.com/DPostnik/web-remarq#quick-start'
    return {
      ok: false,
      reason: `No supported stack found in ${relative(repoRoot, appDir) || appDir}`,
      hint,
      ...(unsupportedGlobs.length > 0 ? { unsupportedGlobs } : {}),
    }
  }

  return {
    ok: true,
    detection: { ...classified, repoRoot, appDir, packageManager },
  }
}
