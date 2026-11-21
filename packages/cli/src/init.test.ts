import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
    if (!result.ok) return
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
    if (!second.ok) return
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

  it('keeps the manual Next.js edits', () => {
    copy('next-app')
    const result = runInit(dir, {}, deps)
    expect(result.ok && result.edits.map((e) => e.kind)).toEqual(['build-config', 'entry'])
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
