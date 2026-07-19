import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runDoctor, exitCode, probeMcpServer } from './doctor'
import { checkBuildPlugin, checkPackages } from './checks'
import type { ResolvedTransformModule } from './checks'
import type { CheckResult, Detection } from './types'

const fixture = (name: string) => resolve(__dirname, '../fixtures', name)

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'remarq-doctor-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const serverUp = { probeMcpServer: async () => true }
const serverDown = { probeMcpServer: async () => false }

const find = (checks: CheckResult[], id: CheckResult['id']) =>
  checks.find((c) => c.id === id)!

describe('runDoctor', () => {
  it('reports mcp-server as blocked, not failed, when nothing answers on the port', async () => {
    cpSync(fixture('vue-vite'), dir, { recursive: true })
    const report = await runDoctor(dir, {}, serverDown)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    const check = find(report.checks, 'mcp-server')
    expect(check.status).toBe('blocked')
    expect(check.hint).toContain('restart')
    // The `exitCode` describe block below is what proves blocked-alone never fails the run.
  })

  it('fails when packages are missing', async () => {
    cpSync(fixture('vue-vite'), dir, { recursive: true })
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(find(report.checks, 'packages').status).toBe('fail')
    expect(exitCode(report.checks)).toBe(1)
  })

  it('fails when .mcp.json has no web-remarq entry', async () => {
    cpSync(fixture('vue-vite'), dir, { recursive: true })
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: {} } }))
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(find(report.checks, 'mcp-config').status).toBe('fail')
  })

  it('passes widget-init when the entry calls WebRemarq.init', async () => {
    cpSync(fixture('vue-vite'), dir, { recursive: true })
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'src/main.ts'),
      "import { WebRemarq } from 'web-remarq'\nif (import.meta.env.DEV) { WebRemarq.init({}) }\n",
    )
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(find(report.checks, 'widget-init').status).toBe('ok')
  })

  it('skips the build-plugin check in plain-html mode instead of failing it', async () => {
    cpSync(fixture('plain-html'), dir, { recursive: true })
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    const check = find(report.checks, 'build-plugin')
    expect(check.status).toBe('skipped')
    expect(check.detail).toContain('source mapping')
  })
})

describe('exitCode', () => {
  it('is 0 when only blocked and skipped are present', () => {
    expect(
      exitCode([
        { id: 'mcp-server', status: 'blocked', detail: '' },
        { id: 'build-plugin', status: 'skipped', detail: '' },
        { id: 'packages', status: 'ok', detail: '' },
      ]),
    ).toBe(0)
  })

  it('is 1 when any check failed', () => {
    expect(
      exitCode([
        { id: 'packages', status: 'ok', detail: '' },
        { id: 'mcp-config', status: 'fail', detail: '' },
      ]),
    ).toBe(1)
  })
})

/** Starts a throwaway http server on an ephemeral port. Caller must close it. */
function listenEphemeral(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler)
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolvePromise({ server, port: (server.address() as AddressInfo).port })
    })
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolvePromise) => server.close(() => resolvePromise()))
}

describe('probeMcpServer (real network, no fake)', () => {
  // This deliberately exercises the REAL probeMcpServer against a REAL server,
  // rather than the `{ probeMcpServer: async () => true/false }` fakes used
  // everywhere else in this file. Those fakes are exactly why a wrong route
  // (probing /annotations when the server only serves /store) shipped unnoticed:
  // every test replaced the network call before it could be wrong.
  it('returns true when the real /store route answers 200', async () => {
    const { server, port } = await listenEphemeral((req, res) => {
      if (req.url === '/store') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ rev: 0, store: { version: 1, annotations: [] } }))
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    try {
      expect(await probeMcpServer(port)).toBe(true)
    } finally {
      await closeServer(server)
    }
  })

  it('returns false when the server 404s every route', async () => {
    const { server, port } = await listenEphemeral((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    try {
      expect(await probeMcpServer(port)).toBe(false)
    } finally {
      await closeServer(server)
    }
  })
})

describe('checkBuildPlugin', () => {
  const vueViteDir = fixture('vue-vite')
  const wiredDir = fixture('vue-vite-wired')

  function detectionFor(overrides: Partial<Detection> = {}): Detection {
    return {
      framework: 'vue',
      bundler: 'vite',
      packageManager: 'npm',
      repoRoot: vueViteDir,
      appDir: vueViteDir,
      appPackageName: 'vue-app',
      configFile: 'vite.config.ts',
      entry: 'src/main.ts',
      plugin: '@web-remarq/unplugin',
      includeGlob: ['src/**/*.vue'],
      ...overrides,
    }
  }

  it('fails with a hint naming the config file when the Vite plugin is not registered', async () => {
    // vue-vite's vite.config.ts has plugins: [vue()] only - no remarq().
    const result = await checkBuildPlugin(detectionFor())
    expect(result.status).toBe('fail')
    expect(result.hint).toContain('vite.config.ts')
    // The check only reads this one file - it cannot see a plugin registered via an
    // imported or shared config, and the hint must say so, not just assert the negative.
    expect(result.hint).toContain('shared')
  })

  it('does not report a false failure when the plugin is registered via an aliased, non-literal import', async () => {
    // vite.config.ts here only says `import { remarqPreset } from './shared/build-config'`
    // and `remarqPreset()` - the literal string '@web-remarq/unplugin' never appears in
    // the config file itself, only in the shared preset file it imports.
    const sharedPresetDir = fixture('vue-vite-wired-shared-preset')
    const result = await checkBuildPlugin(
      detectionFor({ repoRoot: sharedPresetDir, appDir: sharedPresetDir }),
    )
    expect(result.detail).not.toContain('not registered')
  })

  it('fails with an accurate message when configFile is null', async () => {
    const result = await checkBuildPlugin(detectionFor({ configFile: null }))
    expect(result.status).toBe('fail')
    expect(result.detail.toLowerCase()).toContain('no vite config')
  })

  it('proceeds past the registration check when the plugin is registered, and fails on a mismatched include glob', async () => {
    const result = await checkBuildPlugin(
      detectionFor({ repoRoot: wiredDir, appDir: wiredDir, includeGlob: ['src/**/*.tsx'] }),
    )
    expect(result.status).toBe('fail')
    // Not the registration failure - the config here does register the plugin.
    expect(result.detail).not.toContain('not registered')
    expect(result.detail).toContain('App.vue')
  })

  it('returns a clean fail, not a throw, when the resolved module lacks the expected exports', async () => {
    const brokenLoad = async (): Promise<ResolvedTransformModule> => ({
      ok: true,
      transformJSX: undefined,
      transformVueSFC: undefined,
    })
    await expect(
      checkBuildPlugin(detectionFor({ repoRoot: wiredDir, appDir: wiredDir }), brokenLoad),
    ).resolves.toMatchObject({ status: 'fail' })
  })

  // The default `loadTransform` resolves @web-remarq/unplugin/transform exactly as
  // the user's app would (npm workspaces symlink packages/unplugin into the repo
  // root node_modules), which requires packages/unplugin to have been built first.
  // dist/ is gitignored - packages/cli/vitest.global-setup.ts builds it before this
  // project's tests run, so this genuinely executes on a plain `npm test` instead
  // of silently skipping.
  it('reaches ok and stamps data-remarq-source when the plugin is registered and the transform succeeds', async () => {
    const result = await checkBuildPlugin(detectionFor({ repoRoot: wiredDir, appDir: wiredDir }))
    expect(result.status).toBe('ok')
    expect(result.detail).toContain('data-remarq-source')
  })
})

describe('checkPackages', () => {
  // The monorepo root itself, not a copied fixture: npm workspaces symlink
  // `web-remarq` (packages/core) into this repo's own node_modules, so an
  // appDir pointing here is a package that is genuinely, correctly installed -
  // not a fixture standing in for one. web-remarq's package.json exports map
  // only lists "." and "./core", not "./package.json", so this is the exact
  // shape of a real, correctly-installed user project.
  const repoRoot = resolve(__dirname, '../../..')

  it('reports ok with the real resolved version for a genuinely installed package', async () => {
    const detection: Detection = {
      framework: 'vanilla-vite',
      bundler: 'vite',
      packageManager: 'npm',
      repoRoot,
      appDir: repoRoot,
      appPackageName: null,
      configFile: null,
      entry: null,
      plugin: null,
      includeGlob: null,
    }

    const result = checkPackages(detection)

    expect(result.status).toBe('ok')
    expect(result.detail).toMatch(/^web-remarq@\d+\.\d+\.\d+/)
  })
})
