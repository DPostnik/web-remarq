import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, parse, relative } from 'node:path'
import { readJson } from './fs-utils'
import type { CheckResult, Detection } from './types'

/** How many parent directories to walk before giving up - defense in depth, real trees never get close. */
const PACKAGE_JSON_WALK_LIMIT = 25

/**
 * Walk up from `startFile` looking for the package.json that declares `name`.
 * Needed because `require.resolve(name)` only lands on the package's main entry
 * file (e.g. `dist/index.cjs`) - the package.json controlling that entry is some
 * number of parent directories above it, and the exact number varies by package
 * layout (`dist/index.js` vs `dist/esm/index.js`, etc).
 *
 * Matching on the `name` field (not just "first package.json found") matters:
 * a naive walk could stop at a nested package.json belonging to a dependency
 * bundled alongside the entry file, which would report the wrong version - or
 * none at all, if that nested file has no `version` field.
 */
function findOwningPackageJson(startFile: string, name: string): { version: string } | null {
  let dir = dirname(startFile)
  const { root } = parse(dir)

  for (let i = 0; i < PACKAGE_JSON_WALK_LIMIT; i++) {
    const pkg = readJson<{ name?: string; version: string }>(join(dir, 'package.json'))
    if (pkg && pkg.name === name) return { version: pkg.version }
    if (dir === root) return null
    dir = dirname(dir)
  }
  return null
}

/**
 * Resolve a package as the user's app would resolve it, then read its own
 * package.json for the version. Deliberately does NOT resolve `${name}/package.json`
 * directly - that subpath only exists if the package's `exports` map explicitly lists
 * "./package.json", which most packages (including our own `web-remarq`, `@web-remarq/unplugin`,
 * `@web-remarq/next`) do not do. Resolving the main entry point instead works against
 * any correctly-installed package, published or not, because "." is always exposed.
 */
function resolveInstalled(appDir: string, name: string): { version: string } | null {
  try {
    const require = createRequire(join(appDir, 'noop.js'))
    const entryFile = require.resolve(name)
    return findOwningPackageJson(entryFile, name)
  } catch {
    return null
  }
}

export function checkPackages(d: Detection): CheckResult {
  const wanted = d.plugin ? ['web-remarq', d.plugin] : ['web-remarq']
  const found: string[] = []
  const missing: string[] = []

  for (const name of wanted) {
    const pkg = resolveInstalled(d.appDir, name)
    if (pkg) found.push(`${name}@${pkg.version}`)
    else missing.push(name)
  }

  if (missing.length > 0) {
    return {
      id: 'packages',
      status: 'fail',
      detail: `missing: ${missing.join(', ')}`,
      hint: 'Run `npx @web-remarq/cli init` again to install them.',
    }
  }
  return { id: 'packages', status: 'ok', detail: found.join(', ') }
}

/** Depth-bounded walk of the usual source roots (src/, app/, components/), returning the first file matching `predicate`. */
function walkSourceTree(
  d: Detection,
  exts: string[],
  predicate: (path: string) => boolean = () => true,
): string | null {
  const roots = [join(d.appDir, 'src'), join(d.appDir, 'app'), join(d.appDir, 'components')]

  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4 || !existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = walk(path, depth + 1)
        if (nested) return nested
      } else if (exts.some((ext) => entry.name.endsWith(ext)) && predicate(path)) {
        return path
      }
    }
    return null
  }

  for (const root of roots) {
    const hit = walk(root, 0)
    if (hit) return hit
  }
  return null
}

/** First source file matching the stack, used as the sample for the transform check. */
function sampleSourceFile(d: Detection): string | null {
  const exts = d.framework === 'vue' ? ['.vue'] : ['.tsx', '.jsx']
  return walkSourceTree(d, exts)
}

/** Extensions a glob pattern's final segment plausibly matches, e.g. `src/foo/*.{jsx,tsx}` -> ['jsx', 'tsx']. */
function globFileExtensions(glob: string): string[] {
  const brace = glob.match(/\{([^}]+)\}/)
  if (brace) return brace[1].split(',').map((ext) => ext.trim())
  const single = glob.match(/\.([A-Za-z0-9]+)$/)
  return single ? [single[1]] : []
}

/**
 * Simple extension-level check: does any pattern in `globs` plausibly match `filePath`?
 * Not a general glob engine - just enough to catch a mistyped include option
 * (e.g. `src/**\/*.tsx` configured while the app only has `.vue` files).
 */
function includeGlobMatchesSample(globs: string[], filePath: string): boolean {
  const ext = extname(filePath).replace(/^\./, '')
  if (!ext) return true
  return globs.some((glob) => globFileExtensions(glob).includes(ext))
}

export type ResolvedTransformModule =
  | { ok: true; transformJSX: unknown; transformVueSFC: unknown }
  | { ok: false; result: CheckResult }

/**
 * Resolves and imports @web-remarq/unplugin's transform entry point exactly as the
 * user's app would (same require.resolve base as checkPackages). Distinguishes the
 * three ways this can fail so the reported message is never false:
 * - genuinely not installed
 * - installed but never built (dist/transform.* missing)
 * - installed at a version too old to export ./transform
 */
export async function resolveTransformModule(appDir: string): Promise<ResolvedTransformModule> {
  const require = createRequire(join(appDir, 'noop.js'))

  try {
    require.resolve('@web-remarq/unplugin')
  } catch {
    return {
      ok: false,
      result: {
        id: 'build-plugin',
        status: 'fail',
        detail: '@web-remarq/unplugin is not installed',
        hint: 'Run `npx @web-remarq/cli init` again.',
      },
    }
  }

  let resolvedPath: string
  try {
    resolvedPath = require.resolve('@web-remarq/unplugin/transform')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
      return {
        ok: false,
        result: {
          id: 'build-plugin',
          status: 'fail',
          detail: '@web-remarq/unplugin is installed but is too old to expose the ./transform entry point',
          hint: 'Upgrade @web-remarq/unplugin to a version that ships the transform API (`npm install @web-remarq/unplugin@latest`).',
        },
      }
    }
    return {
      ok: false,
      result: {
        id: 'build-plugin',
        status: 'fail',
        detail: '@web-remarq/unplugin is installed but not built - dist/transform is missing',
        hint: 'Run `npm run build --workspace=packages/unplugin`, or reinstall the package.',
      },
    }
  }

  let mod: Record<string, unknown>
  try {
    mod = await import(resolvedPath)
  } catch (err) {
    return {
      ok: false,
      result: {
        id: 'build-plugin',
        status: 'fail',
        detail: `@web-remarq/unplugin failed to load: ${err instanceof Error ? err.message : String(err)}`,
        hint: 'Reinstall @web-remarq/unplugin and rebuild it.',
      },
    }
  }

  return { ok: true, transformJSX: mod.transformJSX, transformVueSFC: mod.transformVueSFC }
}

/**
 * The most valuable check: run the user's installed transform over one of the
 * user's own files and confirm data-remarq-source appears. Catches the silent
 * failure where the plugin is wired up but the include glob misses the files -
 * annotations are created, file:line:col is empty, and the agent searches blind.
 *
 * For Vite-based stacks this also confirms the plugin is registered in the build
 * config and that the configured include glob could match the sample file, before
 * ever probing the transform - a forgotten `plugins: [remarq()]` or a mistyped
 * include option must not report the same result as a correct setup.
 */
export async function checkBuildPlugin(
  d: Detection,
  loadTransform: (appDir: string) => Promise<ResolvedTransformModule> = resolveTransformModule,
): Promise<CheckResult> {
  if (d.framework === 'plain-html') {
    return {
      id: 'build-plugin',
      status: 'skipped',
      detail: 'no bundler - source mapping unavailable, annotations will have no file:line:col',
    }
  }

  if (d.framework === 'next') {
    const wrapped =
      d.configFile !== null &&
      readFileSync(join(d.appDir, d.configFile), 'utf8').includes('withRemarq')
    return wrapped
      ? { id: 'build-plugin', status: 'ok', detail: `withRemarq() found in ${d.configFile}` }
      : {
          id: 'build-plugin',
          status: 'fail',
          detail: `withRemarq() not found in ${d.configFile ?? 'next.config.*'}`,
          hint: "Wrap the exported config: export default withRemarq({ ... })",
        }
  }

  // Vite-based stacks (vue, react, vanilla-vite).
  if (d.configFile === null) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: 'no Vite config file found',
      hint: "Create vite.config.ts and register the plugin: import remarq from '@web-remarq/unplugin/vite'",
    }
  }
  const configContent = readFileSync(join(d.appDir, d.configFile), 'utf8')
  // Case-insensitive on "remarq" rather than the exact package specifier, so an
  // aliased import (`import remarq from '@web-remarq/unplugin/vite'`), a renamed
  // helper (`remarqPreset()`), or any other literal mention of the plugin still
  // matches. This still cannot see a plugin registered through a config imported
  // from elsewhere - this file only reads d.configFile - so the hint on failure
  // says so explicitly instead of asserting a negative it cannot actually prove.
  if (!/remarq/i.test(configContent)) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: `@web-remarq/unplugin is not registered in ${d.configFile}`,
      hint:
        `Add remarq() to the plugins array in ${d.configFile}: import remarq from '@web-remarq/unplugin/vite', then include remarq() alongside your other plugins. ` +
        `If the plugin is registered via an imported or shared build config, this check cannot see it - verify manually ` +
        `(e.g. build once and check the output for data-remarq-source) and tell the user.`,
    }
  }

  const sample = sampleSourceFile(d)
  if (!sample) {
    // A vanilla-vite app legitimately may have no JSX/Vue at all - there is nothing
    // for the build plugin to stamp, which is not an error. vue/react stacks are
    // expected to have a sample file, so a missing one there stays a real failure.
    if (d.framework === 'vanilla-vite') {
      return {
        id: 'build-plugin',
        status: 'skipped',
        detail: 'no .jsx/.tsx/.vue file found - source stamping only applies to JSX/Vue files, and this app has none',
      }
    }
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: 'no source file found to test the transform against',
      hint: 'Add a component under src/ and run doctor again.',
    }
  }

  if (d.includeGlob && !includeGlobMatchesSample(d.includeGlob, sample)) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: `configured include glob (${d.includeGlob.join(', ')}) does not match ${sample}`,
      hint: `Update the include option in ${d.configFile} so it matches this file type.`,
    }
  }

  const loaded = await loadTransform(d.appDir)
  if (!loaded.ok) return loaded.result

  const transformFn = sample.endsWith('.vue') ? loaded.transformVueSFC : loaded.transformJSX
  if (typeof transformFn !== 'function') {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: '@web-remarq/unplugin does not export the expected transform function',
      hint: 'Upgrade @web-remarq/unplugin - the transform API may have changed.',
    }
  }

  const code = readFileSync(sample, 'utf8')
  const out = (transformFn as (code: string, path: string) => { code: string } | null)(code, sample)

  if (!out || !out.code.includes('data-remarq-source')) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: `${sample} produced no data-remarq-source`,
      hint: `Check the include glob in ${d.configFile} - it must match this file type.`,
    }
  }

  return { id: 'build-plugin', status: 'ok', detail: `${sample} -> data-remarq-source stamped` }
}

export function checkWidgetInit(d: Detection): CheckResult {
  if (d.framework === 'plain-html') {
    const html = join(d.appDir, 'index.html')
    const present = existsSync(html) && readFileSync(html, 'utf8').includes('web-remarq.global.js')
    return present
      ? { id: 'widget-init', status: 'ok', detail: 'script tag found in index.html' }
      : {
          id: 'widget-init',
          status: 'fail',
          detail: 'no web-remarq script tag in index.html',
          hint: 'Run `npx @web-remarq/cli init` again.',
        }
  }

  // Next apps wire the widget across two files: a standalone 'use client' component
  // (RemarqDevTools) that calls WebRemarq.init, and the root layout, which renders it.
  // The init call therefore does not have to appear in the entry file at all - a
  // correctly-wired app has it in the component file instead. Search the app source
  // tree for either file rather than grepping only d.entry.
  if (d.framework === 'next') {
    const initFile = walkSourceTree(d, ['.tsx', '.jsx', '.ts', '.js'], (path) =>
      readFileSync(path, 'utf8').includes('WebRemarq.init'),
    )
    if (initFile) {
      return {
        id: 'widget-init',
        status: 'ok',
        detail: `WebRemarq.init() found in ${relative(d.appDir, initFile)}`,
      }
    }

    // Fallback: the component that owns WebRemarq.init may live outside src/app/components
    // (or be re-exported from elsewhere) - if the layout renders it, that is still correct.
    const entryRendersComponent =
      d.entry !== null &&
      existsSync(join(d.appDir, d.entry)) &&
      readFileSync(join(d.appDir, d.entry), 'utf8').includes('RemarqDevTools')
    if (entryRendersComponent) {
      return {
        id: 'widget-init',
        status: 'ok',
        detail: `<RemarqDevTools /> rendered in ${d.entry}`,
      }
    }

    return {
      id: 'widget-init',
      status: 'fail',
      detail: 'no WebRemarq.init() call found, and the root layout does not render <RemarqDevTools />',
      hint:
        'Create a RemarqDevTools client component that calls WebRemarq.init(...) (see the entry edit from `init`), ' +
        'then render <RemarqDevTools /> inside the root layout body.',
    }
  }

  if (!d.entry) {
    return {
      id: 'widget-init',
      status: 'fail',
      detail: 'entry point not found',
      hint: 'Add WebRemarq.init(...) to your app entry point, guarded to dev only.',
    }
  }

  const path = join(d.appDir, d.entry)
  const found = existsSync(path) && readFileSync(path, 'utf8').includes('WebRemarq.init')
  return found
    ? { id: 'widget-init', status: 'ok', detail: `WebRemarq.init() found in ${d.entry}` }
    : {
        id: 'widget-init',
        status: 'fail',
        detail: `WebRemarq.init() not found in ${d.entry}`,
        hint: 'Add the widget bootstrap from `npx @web-remarq/cli init` to your entry point.',
      }
}

export function checkMcpConfig(d: Detection): CheckResult {
  const config = readJson<{ mcpServers?: Record<string, unknown> }>(join(d.repoRoot, '.mcp.json'))
  if (config?.mcpServers?.['web-remarq']) {
    return { id: 'mcp-config', status: 'ok', detail: '.mcp.json -> web-remarq' }
  }
  return {
    id: 'mcp-config',
    status: 'fail',
    detail: 'no web-remarq entry in .mcp.json at the repository root',
    hint: 'Run `npx @web-remarq/cli init` again.',
  }
}

export async function checkMcpServer(
  port: number,
  probe: (port: number) => Promise<boolean>,
): Promise<CheckResult> {
  const up = await probe(port)
  if (up) return { id: 'mcp-server', status: 'ok', detail: `responding on 127.0.0.1:${port}` }
  // Not a failure: the server boots with the agent's MCP client, so this is
  // always red right after setup, even when everything is configured correctly.
  return {
    id: 'mcp-server',
    status: 'blocked',
    detail: `no response on 127.0.0.1:${port}`,
    hint: 'The server starts with your agent - restart Claude Code (or your MCP client) to pick it up.',
  }
}
