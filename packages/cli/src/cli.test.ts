import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

describe('main - init non-install failure', () => {
  // Plain HTML has no packages to install (`packagesFor` returns []), so
  // `deps.exec` is never invoked. A later step - here `writeMcpConfig`,
  // reading a pre-existing malformed .mcp.json - throws instead. `main` must
  // not blame this on the (never-run) install command.
  it('reports a generic setup failure, not an install failure, when a non-install step throws', async () => {
    const plainDir = mkdtempSync(join(tmpdir(), 'remarq-cli-plain-'))
    cpSync(fixture('plain-html'), plainDir, { recursive: true })
    writeFileSync(join(plainDir, '.mcp.json'), '{ not valid json', 'utf8')

    const prevCwd = process.cwd()
    process.chdir(plainDir)
    try {
      const neverExec = { exec: vi.fn(() => { throw new Error('exec must not run for plain-html') }) }
      const code = await main(['init'], neverExec)
      expect(code).toBe(1)
      expect(neverExec.exec).not.toHaveBeenCalled()

      const output = logSpy.mock.calls[0]?.[0] as string
      expect(output).not.toContain('Install failed')
      expect(output).not.toContain('package.json')
      expect(output).not.toContain('(install command)')
    } finally {
      process.chdir(prevCwd)
      rmSync(plainDir, { recursive: true, force: true })
    }
  })
})

describe('main - unknown command', () => {
  it('names the unrecognized command before printing usage', async () => {
    const code = await main(['bogus'])
    expect(code).toBe(1)
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('bogus')
  })

  it('prints only usage, unchanged, when no command is given', async () => {
    const code = await main([])
    expect(code).toBe(0)
    expect(logSpy.mock.calls[0]?.[0]).toContain('web-remarq installer')
  })
})

describe('main - malformed --app', () => {
  it('reports an argument error and exits non-zero for --app with no value', async () => {
    const code = await main(['init', '--app'])
    expect(code).toBe(1)
    const output = logSpy.mock.calls[0]?.[0] as string
    expect(output.toLowerCase()).toContain('app')
  })

  it('reports an argument error for --app --json instead of resolving app to "--json"', async () => {
    const code = await main(['doctor', '--app', '--json'])
    expect(code).toBe(1)
    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(parsed.ok).toBe(false)
  })
})
