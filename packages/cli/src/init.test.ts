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
  it('installs, writes .mcp.json and returns two edits for vue + vite', () => {
    copy('vue-vite')
    const result = runInit(dir, {}, deps)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toEqual(['npm install -D web-remarq @web-remarq/unplugin'])
    expect(result.wroteMcpConfig).toBe(true)
    expect(existsSync(join(dir, '.mcp.json'))).toBe(true)
    expect(result.edits).toHaveLength(2)
    expect(result.next).toBe('doctor')
  })

  it('is idempotent - a second run does not rewrite .mcp.json or .remarq/config.json', () => {
    copy('vue-vite')
    const first = runInit(dir, {}, deps)
    expect(first.ok && first.wroteLocalConfig).toBe(true)
    const configBefore = readFileSync(join(dir, '.remarq', 'config.json'), 'utf8')
    const second = runInit(dir, {}, deps)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.wroteMcpConfig).toBe(false)
    expect(second.wroteLocalConfig).toBe(false)
    expect(readFileSync(join(dir, '.remarq', 'config.json'), 'utf8')).toBe(configBefore)
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
