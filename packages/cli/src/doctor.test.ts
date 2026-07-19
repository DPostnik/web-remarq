import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runDoctor, exitCode } from './doctor'
import type { CheckResult } from './types'

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
    // The bare vue-vite fixture also fails packages/build-plugin/widget-init/mcp-config
    // (nothing is installed or wired up yet - see the next test), so the aggregate
    // exit code here is 1 because of those real failures, not because of the block.
    // The `exitCode` describe block below is what proves blocked-alone never fails the run.
    expect(exitCode(report.checks)).toBe(1)
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
