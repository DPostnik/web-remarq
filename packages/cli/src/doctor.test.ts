import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runDoctor, exitCode, probeMcpServer } from './doctor'
import { checkBuildPlugin, checkPackages, resolveTransformModule } from './checks'
import type { ResolvedTransformModule } from './checks'
import type { CheckResult, Detection } from './types'

const fixture = (name: string) => resolve(__dirname, '../fixtures', name)

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'remarq-doctor-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const serverUp = { probeMcpServer: async () => 'ok' as const }
const serverDown = { probeMcpServer: async () => 'down' as const }

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

  it('passes widget-init for Next when WebRemarq.init lives in a component the layout renders', async () => {
    cpSync(fixture('next-app'), dir, { recursive: true })
    writeFileSync(
      join(dir, 'app/RemarqDevTools.tsx'),
      "'use client'\nimport { useEffect } from 'react'\n\n" +
        'export function RemarqDevTools() {\n' +
        "  useEffect(() => {\n    import('web-remarq').then(({ WebRemarq }) => { WebRemarq.init({}) })\n  }, [])\n" +
        '  return null\n}\n',
    )
    writeFileSync(
      join(dir, 'app/layout.tsx'),
      "import { RemarqDevTools } from './RemarqDevTools'\n\n" +
        'export default function RootLayout({ children }: { children: React.ReactNode }) {\n' +
        '  return <html><body><RemarqDevTools />{children}</body></html>\n}\n',
    )
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(find(report.checks, 'widget-init').status).toBe('ok')
  })

  it('fails widget-init for Next when neither WebRemarq.init nor RemarqDevTools is present, with a hint about the component setup', async () => {
    cpSync(fixture('next-app'), dir, { recursive: true })
    const report = await runDoctor(dir, {}, serverUp)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    const check = find(report.checks, 'widget-init')
    expect(check.status).toBe('fail')
    expect(check.hint?.toLowerCase()).toContain('remarqdevtools')
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
  // rather than the `{ probeMcpServer: async () => 'ok' }` fakes used
  // everywhere else in this file. Those fakes are exactly why a wrong route
  // once shipped unnoticed: every test replaced the network call before it
  // could be wrong. The fake server below mirrors packages/mcp/src/http-server.ts
  // (protocol 2): /health is public, /store needs the bearer token.
  const TOKEN = 'doctor-token-0123456789'
  function protocol2(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, protocol: 2 }))
      return
    }
    if (req.url === '/store') {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized', code: 'unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ rev: 0, protocol: 2, projectId: 'prj_x', store: { version: 1, annotations: [] } }))
      return
    }
    res.writeHead(404)
    res.end()
  }

  it('returns ok only when /health answers protocol 2 AND /store accepts the token', async () => {
    const { server, port } = await listenEphemeral(protocol2)
    try {
      expect(await probeMcpServer(port, TOKEN)).toBe('ok')
      expect(await probeMcpServer(port, 'wrong-token-000000000')).toBe('unauthorized')
      expect(await probeMcpServer(port, null)).toBe('no-token')
    } finally {
      await closeServer(server)
    }
  })

  it('reports an older server (no /health) as incompatible, and nothing listening as down', async () => {
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
      expect(await probeMcpServer(port, TOKEN)).toBe('incompatible')
    } finally {
      await closeServer(server)
    }
    expect(await probeMcpServer(port, TOKEN)).toBe('down')
  })

  it('doctor turns unauthorized into a fail with a restart hint, never a silent ok', async () => {
    cpSync(fixture('vue-vite'), dir, { recursive: true })
    const report = await runDoctor(dir, {}, { probeMcpServer: async () => 'unauthorized' })
    expect(report.ok).toBe(true)
    if (!report.ok) return
    const check = find(report.checks, 'mcp-server')
    expect(check.status).toBe('fail')
    expect(check.hint).toContain('config.json')
    expect(JSON.stringify(report)).not.toContain(TOKEN)
  })
})

describe('checkBuildPlugin', () => {
  const vueViteDir = fixture('vue-vite')
  const wiredDir = fixture('vue-vite-wired')

  // Fixtures copied into a temp dir sit outside this repo's node_modules, so the
  // default loader cannot resolve @web-remarq/unplugin from there. Resolve it from
  // the in-repo fixture instead - still the real built package, not a fake.
  const loadFromRepo = () => resolveTransformModule(wiredDir)

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

  it('reports blocked (not verified), not ok and not fail, when the plugin comes from a shared preset', async () => {
    // vite.config.ts here only says `import { remarqPreset } from './shared/build-config'`
    // and `remarqPreset()` - the include option lives in a file this check does not read.
    // The transform still runs (so a broken install is still a real fail), but the
    // include option is genuinely unverified and must be reported as such.
    const sharedPresetDir = fixture('vue-vite-wired-shared-preset')
    const result = await checkBuildPlugin(
      detectionFor({ repoRoot: sharedPresetDir, appDir: sharedPresetDir }),
    )
    expect(result.status).toBe('blocked')
    expect(result.detail).toContain('not verified')
    expect(result.detail).toContain('shared')
    expect(result.hint).toContain('Verify it yourself')
  })

  it('reports blocked when the include option is a variable rather than a literal', async () => {
    cpSync(wiredDir, dir, { recursive: true })
    writeFileSync(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\nimport remarq from '@web-remarq/unplugin/vite'\n" +
        "const patterns = ['src/**/*.vue']\nexport default defineConfig({ plugins: [vue(), remarq({ include: patterns })] })\n",
    )
    const result = await checkBuildPlugin(detectionFor({ repoRoot: dir, appDir: dir }), loadFromRepo)
    expect(result.status).toBe('blocked')
    expect(result.detail).toContain('not verified')
  })

  it('does not count a commented-out registration as registered', async () => {
    cpSync(wiredDir, dir, { recursive: true })
    writeFileSync(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\n" +
        "// import remarq from '@web-remarq/unplugin/vite'\n// TODO: add remarq() to plugins\n" +
        'export default defineConfig({ plugins: [vue()] })\n',
    )
    const result = await checkBuildPlugin(detectionFor({ repoRoot: dir, appDir: dir }))
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('not registered')
  })

  it('fails with an accurate message when configFile is null', async () => {
    const result = await checkBuildPlugin(detectionFor({ configFile: null }))
    expect(result.status).toBe('fail')
    expect(result.detail.toLowerCase()).toContain('no vite config')
  })

  it('fails on an include option in the config that the installed filter rejects for the sample file', async () => {
    cpSync(wiredDir, dir, { recursive: true })
    writeFileSync(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\nimport remarq from '@web-remarq/unplugin/vite'\n" +
        "export default defineConfig({ plugins: [vue(), remarq({ include: ['src/**/*.tsx'] })] })\n",
    )
    // `includeGlob` is what init would suggest - deliberately correct here, to prove the
    // check reads the include from the config file, not from the CLI's own suggestion.
    const result = await checkBuildPlugin(
      detectionFor({ repoRoot: dir, appDir: dir, includeGlob: ['src/**/*.vue'] }),
      loadFromRepo,
    )
    expect(result.status).toBe('fail')
    expect(result.detail).not.toContain('not registered')
    expect(result.detail).toContain('src/**/*.tsx')
    expect(result.detail).toContain('App.vue')
    expect(result.hint).toContain("include: ['src/**/*.vue']")
  })

  it('reaches ok for a React app configured with the brace include older CLI versions printed', async () => {
    // Regression: `src/**/*.{jsx,tsx}` used to be escaped literally by the plugin
    // filter, so App.tsx never matched. Doctor used to pass anyway because it called
    // the transform directly and bypassed the filter. Both halves are pinned here:
    // the installed filter accepts the brace form, and doctor actually consults it.
    const reactDir = fixture('react-vite-wired')
    const result = await checkBuildPlugin(
      detectionFor({
        framework: 'react',
        repoRoot: reactDir,
        appDir: reactDir,
        entry: 'src/main.tsx',
        includeGlob: ['src/**/*.jsx', 'src/**/*.tsx'],
      }),
    )
    expect(result.status).toBe('ok')
    expect(result.detail).toContain('data-remarq-source')
    expect(result.detail).toContain('src/**/*.{jsx,tsx}')
    expect(result.detail).toMatch(/@web-remarq\/unplugin@\d+\.\d+\.\d+/)
  })

  it('returns a clean fail, not a throw, when the resolved module lacks the expected exports', async () => {
    const brokenLoad = async (): Promise<ResolvedTransformModule> => ({
      ok: true,
      version: '0.0.9',
      transformJSX: undefined,
      transformVueSFC: undefined,
      createFilter: undefined,
    })
    await expect(
      checkBuildPlugin(detectionFor({ repoRoot: wiredDir, appDir: wiredDir }), brokenLoad),
    ).resolves.toMatchObject({ status: 'fail' })
  })

  it('fails, not ok, when the installed package has the transform but not the filter (stale build)', async () => {
    const staleLoad = async (): Promise<ResolvedTransformModule> => ({
      ok: true,
      version: '0.0.9',
      transformJSX: () => ({ code: 'data-remarq-source' }),
      transformVueSFC: () => ({ code: 'data-remarq-source' }),
      createFilter: undefined,
    })
    const result = await checkBuildPlugin(detectionFor({ repoRoot: wiredDir, appDir: wiredDir }), staleLoad)
    expect(result.status).toBe('fail')
    expect(result.hint).toContain('0.2.0')
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

  it('skips, not fails, a vanilla-vite app with no JSX/Vue source to stamp', async () => {
    const vanillaDir = fixture('vanilla-vite-wired')
    const result = await checkBuildPlugin(
      detectionFor({
        framework: 'vanilla-vite',
        repoRoot: vanillaDir,
        appDir: vanillaDir,
        plugin: '@web-remarq/unplugin',
        includeGlob: ['**/*.jsx', '**/*.tsx', '**/*.vue'],
      }),
    )
    expect(result.status).toBe('skipped')
    expect(result.detail).toContain('JSX')
    expect(result.detail).toContain('Vue')
  })

  it('fails, not skips, a vue app with the plugin registered but no sample source file', async () => {
    // Same fixture as the "reaches ok" test above, but with the one .vue file removed
    // before the check runs - the plugin is still registered in vite.config.ts, so the
    // check gets past registration and hits the missing-sample-file branch. Unlike
    // vanilla-vite, a vue app is expected to have JSX/Vue source, so this must stay
    // a real `fail`, not the vanilla-vite `skipped` outcome.
    cpSync(wiredDir, dir, { recursive: true })
    rmSync(join(dir, 'src/App.vue'))
    const result = await checkBuildPlugin(detectionFor({ repoRoot: dir, appDir: dir }))
    expect(result.status).toBe('fail')
    expect(result.detail).toContain('no source file found')
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
