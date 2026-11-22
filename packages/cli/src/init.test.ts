import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkWidgetInit } from './checks'
import { runInit } from './init'

const fixture = (name: string) => resolve(__dirname, '../fixtures', name)

let dir: string
const calls: string[] = []
const deps = { exec: (cmd: string) => { calls.push(cmd) } }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remarq-init-'))
  calls.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function copy(name: string) {
  cpSync(fixture(name), dir, { recursive: true })
}

describe('runInit', () => {
  it('installs, writes .mcp.json and the Claude settings, and registers the plugin in the Vite config itself', () => {
    copy('vue-vite')
    const result = runInit(dir, {}, deps)

    expect(result.ok).toBe(true)
    if (!result.ok || result.agent !== 'claude') throw new Error('Expected Claude setup')
    expect(calls).toEqual(['npm install -D web-remarq @web-remarq/unplugin'])
    expect(result.wroteMcpConfig).toBe(true)
    expect(existsSync(join(dir, '.mcp.json'))).toBe(true)
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(
      "import { defineConfig } from 'vite'\nimport vue from '@vitejs/plugin-vue'\nimport remarq from '@web-remarq/unplugin/vite'\n" +
        "export default defineConfig({ plugins: [vue(), remarq({ widget: true, include: ['src/**/*.vue'] })] })\n",
    )
    expect(result.edited).toEqual([{ file: 'vite.config.ts', change: 'registered remarq({ widget: true }) at the end of plugins' }])
    expect(result.edits).toEqual([])
    expect(result.claudeSettings).toEqual({ changed: true, defaultMode: 'acceptEdits', defaultModeSet: true })
    expect(JSON.parse(readFileSync(join(dir, '.claude', 'settings.local.json'), 'utf8')).enabledMcpjsonServers).toEqual(['web-remarq'])
    expect(result.sessionCommand).toBe('claude --dangerously-load-development-channels server:web-remarq')
  })

  it('is idempotent - a second run changes no file and installs nothing once the packages are listed', () => {
    copy('vue-vite')
    const first = runInit(dir, {}, deps)
    expect(first.ok && first.wroteLocalConfig).toBe(true)
    // The injected exec installs nothing, so list the packages the way the package manager would.
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.devDependencies = { ...pkg.devDependencies, 'web-remarq': '^1.0.0', '@web-remarq/unplugin': '^1.0.0' }
    writeFileSync(pkgPath, JSON.stringify(pkg))
    const files = ['vite.config.ts', '.mcp.json', '.remarq/config.json', '.claude/settings.local.json', 'package.json']
    const before = files.map((f) => readFileSync(join(dir, f), 'utf8'))
    calls.length = 0

    const second = runInit(dir, {}, deps)
    expect(second.ok).toBe(true)
    if (!second.ok || second.agent !== 'claude') throw new Error('Expected Claude setup')
    expect(calls).toEqual([])
    expect(second.installed).toEqual([])
    expect(second.wroteMcpConfig).toBe(false)
    expect(second.wroteLocalConfig).toBe(false)
    expect(second.claudeSettings.changed).toBe(false)
    expect(second.edited).toEqual([])
    expect(second.edits).toEqual([])
    expect(files.map((f) => readFileSync(join(dir, f), 'utf8'))).toEqual(before)
  })

  it('installs only the packages package.json does not list yet', () => {
    copy('react-vite-wired')
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.installed).toEqual(['web-remarq'])
    expect(calls).toEqual(['npm install -D web-remarq'])
  })

  it('switches an existing setup to Codex without changing its Claude files or local credentials', () => {
    copy('plain-html')
    runInit(dir, {}, deps)
    const settings = join(dir, '.claude', 'settings.local.json')
    const mcp = join(dir, '.mcp.json')
    const config = join(dir, '.remarq', 'config.json')
    const claudeBefore = [settings, mcp].map((path) => readFileSync(path, 'utf8'))
    const original = { ...JSON.parse(readFileSync(config, 'utf8')), port: 3817, custom: 'keep' }
    writeFileSync(config, JSON.stringify(original))

    const codex = runInit(dir, { agent: 'codex' }, deps)
    expect(codex).toMatchObject({ ok: true, agent: 'codex', sessionCommand: 'npx @web-remarq/cli start --agent codex' })
    expect(codex).not.toHaveProperty('claudeSettings')
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('WebRemarq.init({ simple: true')
    expect([settings, mcp].map((path) => readFileSync(path, 'utf8'))).toEqual(claudeBefore)
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual({ ...original, agent: 'codex' })
    expect(runInit(dir, {}, deps)).toMatchObject({ agent: 'codex', edited: [], wroteLocalConfig: false })

    expect(runInit(dir, { agent: 'claude' }, deps)).toMatchObject({ agent: 'claude' })
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('WebRemarq.init({ submitFlow: true')
  })

  it('adds widget: true to an existing remarq() registration', () => {
    copy('vue-vite-wired')
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edited[0].change).toBe('added widget: true to the remarq() call')
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toContain('plugins: [vue(), remarq({ widget: true })]')
  })

  it('registers the plugin without widget: true when the entry already calls WebRemarq.init', () => {
    copy('react-vite')
    writeFileSync(join(dir, 'src/main.tsx'), "import { WebRemarq } from 'web-remarq'\nWebRemarq.init({})\n")
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edited[0].change).toContain('without widget: true because src/main.tsx already calls WebRemarq.init')
    const config = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
    expect(config).toContain("plugins: [remarq({ include: ['src/**/*.jsx', 'src/**/*.tsx'] })]")
  })

  it('leaves a config it cannot read untouched and returns the manual edit with the reason', () => {
    copy('vue-vite-wired-shared-preset')
    const before = readFileSync(join(dir, 'vite.config.ts'), 'utf8')
    const result = runInit(dir, {}, deps)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readFileSync(join(dir, 'vite.config.ts'), 'utf8')).toBe(before)
    expect(result.edited).toEqual([])
    expect(result.edits).toHaveLength(1)
    expect(result.edits[0].note).toContain('shared')
  })

  it('wires Next.js without changing the layout or the existing instrumentation', () => {
    copy('next-app')
    const layout = readFileSync(join(dir, 'app/layout.tsx'), 'utf8')
    const clientPath = join(dir, 'instrumentation-client.ts')
    const existing = "export const onRouterTransitionStart = () => {}\n"
    writeFileSync(clientPath, existing)
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edits).toEqual([])
    expect(result.ok && result.edited.map((e) => e.file)).toEqual([
      'next.config.ts', 'app/api/web-remarq/config.json/route.js', 'instrumentation-client.ts',
    ])
    expect(readFileSync(join(dir, 'next.config.ts'), 'utf8')).toContain("withRemarq(webRemarqConfig, { pairing: 'route' })")
    expect(readFileSync(clientPath, 'utf8')).toContain(existing + "\n// web-remarq dev widget")
    expect(readFileSync(join(dir, 'app/layout.tsx'), 'utf8')).toBe(layout)
    expect(result.ok && checkWidgetInit(result.detected).status).toBe('ok')
    const second = runInit(dir, {}, deps)
    expect(second.ok && second.edited).toEqual([])
    expect(second.ok && second.edits).toEqual([])
  })

  it('preserves a custom route with the same path and reports the manual Next entry edit', () => {
    copy('next-app')
    const route = join(dir, 'app/api/web-remarq/config.json')
    mkdirSync(route, { recursive: true })
    writeFileSync(join(route, 'route.ts'), 'export const GET = customHandler')
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edits[0].note).toContain('already exists')
    expect(readFileSync(join(route, 'route.ts'), 'utf8')).toBe('export const GET = customHandler')
    expect(existsSync(join(dir, 'instrumentation-client.ts'))).toBe(false)
  })

  it('keeps a manual entry fallback for older Next.js', () => {
    copy('next-app')
    const pkgPath = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    pkg.dependencies.next = '^14.0.0'
    writeFileSync(pkgPath, JSON.stringify(pkg))
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edits.map((e) => e.kind)).toEqual(['entry'])

    pkg.dependencies.next = '^16.0.0'
    writeFileSync(pkgPath, JSON.stringify(pkg))
    const upgraded = runInit(dir, {}, deps)
    expect(upgraded.ok && upgraded.edits).toEqual([])
    expect(readFileSync(join(dir, 'next.config.ts'), 'utf8')).toContain("withRemarq(webRemarqConfig, { pairing: 'route' })")
  })

  it('creates a gitignored .remarq/config.json with a project id and a token that never appears in the result', () => {
    copy('vue-vite')
    const result = runInit(dir, {}, deps)
    expect(result.ok).toBe(true)
    const config = JSON.parse(readFileSync(join(dir, '.remarq', 'config.json'), 'utf8'))
    expect(config.projectId).toMatch(/^prj_[0-9a-f]{16}$/)
    expect(config.token).toMatch(/^[0-9a-f]{48}$/)
    expect(readFileSync(join(dir, '.remarq', '.gitignore'), 'utf8')).toBe('*\n')
    expect(JSON.stringify(result)).not.toContain(config.token)
  })

  it('preserves an unrelated MCP server already configured', () => {
    copy('vue-vite')
    writeFileSync(
      join(dir, '.mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'foo', args: [] } } }, null, 2),
    )
    runInit(dir, {}, deps)
    const parsed = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'))
    expect(parsed.mcpServers.other).toEqual({ command: 'foo', args: [] })
    expect(parsed.mcpServers['web-remarq']).toBeDefined()
  })

  it('returns the detection failure verbatim on an unknown stack', () => {
    copy('unknown')
    const result = runInit(dir, {}, deps)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('No supported stack')
    expect(calls).toEqual([])
  })
})
