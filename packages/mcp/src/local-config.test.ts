import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  acquireStoreLock,
  LocalConfigError,
  readOrCreateLocalConfig,
  StoreLockedError,
} from './local-config'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remarq-cfg-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readOrCreateLocalConfig', () => {
  it('creates a config with a random project id and token, owner-only mode, self-ignored in .remarq', () => {
    const remarq = join(dir, '.remarq')
    const config = readOrCreateLocalConfig(remarq)
    expect(config.projectId).toMatch(/^prj_[0-9a-f]{16}$/)
    expect(config.token).toMatch(/^[0-9a-f]{48}$/)
    expect(config.allowedOrigins).toContain('http://localhost:*')
    expect(readFileSync(join(remarq, '.gitignore'), 'utf8')).toBe('*\n')
    if (process.platform !== 'win32') {
      expect(statSync(join(remarq, 'config.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('is stable across reads: the same identity and token come back', () => {
    const first = readOrCreateLocalConfig(dir)
    const second = readOrCreateLocalConfig(dir)
    expect(second).toEqual(first)
  })

  it('keeps a rotated token from disk and never regenerates the identity', () => {
    const first = readOrCreateLocalConfig(dir)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ ...first, token: 'rotated-token-0123456789' }))
    const after = readOrCreateLocalConfig(dir)
    expect(after.projectId).toBe(first.projectId)
    expect(after.token).toBe('rotated-token-0123456789')
  })

  it('refuses a malformed file instead of silently replacing it', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'config.json'), '{ nope')
    expect(() => readOrCreateLocalConfig(dir)).toThrow(LocalConfigError)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ projectId: 'p', token: 'x'.repeat(20) }))
    expect(() => readOrCreateLocalConfig(dir)).toThrow(/projectId/)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ projectId: 'ok_project', token: 'short' }))
    expect(() => readOrCreateLocalConfig(dir)).toThrow(/token/)
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ projectId: 'ok_project', token: 'x'.repeat(20), allowedOrigins: 'nope' }))
    expect(() => readOrCreateLocalConfig(dir)).toThrow(/allowedOrigins/)
  })

  it('does not write a wildcard .gitignore outside a .remarq directory', () => {
    readOrCreateLocalConfig(join(dir, 'data'))
    expect(existsSync(join(dir, 'data', '.gitignore'))).toBe(false)
  })
})

describe('acquireStoreLock', () => {
  it('writes a lock naming this process and releases it', () => {
    const release = acquireStoreLock(dir, 1817)
    const lock = JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8'))
    expect(lock.pid).toBe(process.pid)
    expect(lock.port).toBe(1817)
    release()
    expect(existsSync(join(dir, 'server.lock'))).toBe(false)
  })

  it('refuses when a live process owns the lock, and names it', () => {
    // The current process is alive by definition, so a lock claiming a different
    // live pid is simulated with the parent pid (alive for the test's lifetime).
    writeFileSync(join(dir, 'server.lock'), JSON.stringify({ pid: process.ppid, port: 4242 }))
    expect(() => acquireStoreLock(dir, 1817)).toThrow(StoreLockedError)
    expect(() => acquireStoreLock(dir, 1817)).toThrow(/4242/)
  })

  it('takes over a stale lock whose owner is gone or unreadable', () => {
    writeFileSync(join(dir, 'server.lock'), JSON.stringify({ pid: 2 ** 31 - 2, port: 1 }))
    const release = acquireStoreLock(dir, 1817)
    expect(JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8')).pid).toBe(process.pid)
    release()

    writeFileSync(join(dir, 'server.lock'), 'garbage')
    const release2 = acquireStoreLock(dir, 1817)
    expect(JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8')).pid).toBe(process.pid)
    release2()
  })
})
