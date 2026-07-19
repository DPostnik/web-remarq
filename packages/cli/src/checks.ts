import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './fs-utils'
import type { CheckResult, Detection } from './types'

/** Resolve a package as the user's app would resolve it. */
function resolveInstalled(appDir: string, name: string): { version: string } | null {
  try {
    const require = createRequire(join(appDir, 'noop.js'))
    const pkgPath = require.resolve(`${name}/package.json`)
    return readJson<{ version: string }>(pkgPath)
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

/** First source file matching the stack, used as the sample for the transform check. */
function sampleSourceFile(d: Detection): string | null {
  const exts = d.framework === 'vue' ? ['.vue'] : ['.tsx', '.jsx']
  const roots = [join(d.appDir, 'src'), join(d.appDir, 'app'), join(d.appDir, 'components')]

  const walk = (dir: string, depth: number): string | null => {
    if (depth > 4 || !existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = walk(path, depth + 1)
        if (nested) return nested
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
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

/**
 * The most valuable check: run the user's installed transform over one of the
 * user's own files and confirm data-remarq-source appears. Catches the silent
 * failure where the plugin is wired up but the include glob misses the files -
 * annotations are created, file:line:col is empty, and the agent searches blind.
 */
export async function checkBuildPlugin(d: Detection): Promise<CheckResult> {
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

  const sample = sampleSourceFile(d)
  if (!sample) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: 'no source file found to test the transform against',
      hint: 'Add a component under src/ and run doctor again.',
    }
  }

  let transformJSX: (code: string, path: string) => { code: string } | null
  let transformVueSFC: (code: string, path: string) => { code: string } | null
  try {
    const require = createRequire(join(d.appDir, 'noop.js'))
    const mod = await import(require.resolve('@web-remarq/unplugin/transform'))
    transformJSX = mod.transformJSX
    transformVueSFC = mod.transformVueSFC
  } catch {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: '@web-remarq/unplugin is not installed',
      hint: 'Run `npx @web-remarq/cli init` again.',
    }
  }

  const code = readFileSync(sample, 'utf8')
  const out = sample.endsWith('.vue') ? transformVueSFC(code, sample) : transformJSX(code, sample)

  if (!out || !out.code.includes('data-remarq-source')) {
    return {
      id: 'build-plugin',
      status: 'fail',
      detail: `${sample} produced no data-remarq-source`,
      hint: `Check the include glob in ${d.configFile ?? 'your build config'} - it must match this file type.`,
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
