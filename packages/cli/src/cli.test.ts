import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { main } from './cli'

const fixture = (name: string) => resolve(__dirname, '../fixtures', name)

let dir: string
let originalCwd: string
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  originalCwd = process.cwd()
  dir = mkdtempSync(join(tmpdir(), 'remarq-cli-'))
  cpSync(fixture('vue-vite'), dir, { recursive: true })
  process.chdir(dir)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(dir, { recursive: true, force: true })
  logSpy.mockRestore()
})

describe('main - init install failure', () => {
  // Simulates a real `deps.exec` throw: network failure, registry 404, or a
  // nonzero exit from the package manager. `runInit` has no try/catch of its
  // own around this call, so the exception reaches `main` - this is exactly
  // the path `main` must catch instead of letting it become an unhandled
  // stack trace.
  const throwingDeps = { exec: () => { throw new Error('Command failed with exit code 1') } }

  it('does not let the exception escape, exits non-zero, and names the attempted command plus the partial-modification warning', async () => {
    const code = await main(['init'], throwingDeps)
    expect(code).toBe(1)

    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('Install failed')
    expect(output).toContain('npm install -D web-remarq @web-remarq/unplugin')
    expect(output).toContain('package.json')
  })

  it('emits a structured json payload instead of the human text', async () => {
    const code = await main(['init', '--json'], throwingDeps)
    expect(code).toBe(1)

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(parsed.ok).toBe(false)
    expect(parsed.reason).toBe('Install failed')
    expect(parsed.command).toContain('web-remarq')
  })
})
