import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * Local-mode project identity and HTTP credential, kept in `.remarq/config.json`
 * next to the store. `.remarq/` self-gitignores, so neither value ever lands in
 * source control, URLs, task files or diagnostics.
 *
 * - `projectId` is the stable identity of this store. The widget namespaces its
 *   offline cache/outbox by it, so a different project later served on the same
 *   port cannot receive another project's queued writes.
 * - `token` is the bearer credential every widget/CLI request must carry.
 *   Rotating it (edit the file, restart the server) does not change the identity
 *   and does not touch annotations.
 * - `allowedOrigins` is the exact list of browser origins the endpoint accepts.
 *   `http://host:*` means any port on that exact host. Remote/staging origins are
 *   never allowed unless listed here on purpose.
 */
export interface LocalProjectConfig {
  projectId: string
  token: string
  allowedOrigins: string[]
}

export const CONFIG_FILE = 'config.json'
export const LOCK_FILE = 'server.lock'
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']

export class LocalConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalConfigError'
  }
}

export function generateProjectId(): string {
  return `prj_${randomBytes(8).toString('hex')}`
}

export function generateToken(): string {
  return randomBytes(24).toString('hex')
}

/** Write `*` into `<dir>/.gitignore` when `dir` is the conventional `.remarq` folder - never elsewhere. */
export function ensureSelfIgnored(dir: string): void {
  if (basename(dir) !== '.remarq') return
  const gitignore = join(dir, '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n')
}

function validate(raw: unknown, path: string): LocalProjectConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new LocalConfigError(`${path} must contain a JSON object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.projectId !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(obj.projectId)) {
    throw new LocalConfigError(`${path}: projectId must be a 4-64 character id (letters, digits, _ -)`)
  }
  if (typeof obj.token !== 'string' || obj.token.length < 16 || /\s/.test(obj.token)) {
    throw new LocalConfigError(`${path}: token must be at least 16 characters with no whitespace`)
  }
  const origins = obj.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS
  if (!Array.isArray(origins) || !origins.every((o) => typeof o === 'string')) {
    throw new LocalConfigError(`${path}: allowedOrigins must be an array of origin strings`)
  }
  return { projectId: obj.projectId, token: obj.token, allowedOrigins: origins as string[] }
}

/**
 * Read `<dir>/config.json`, creating it with a fresh identity and token when
 * absent. A present-but-malformed file throws instead of being overwritten:
 * silently regenerating would orphan every widget outbox keyed by the old id.
 */
export function readOrCreateLocalConfig(dir: string): LocalProjectConfig {
  const path = join(dir, CONFIG_FILE)
  if (existsSync(path)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'))
    } catch (err) {
      throw new LocalConfigError(`${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
    return validate(parsed, path)
  }

  const config: LocalProjectConfig = {
    projectId: generateProjectId(),
    token: generateToken(),
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  }
  mkdirSync(dir, { recursive: true })
  ensureSelfIgnored(dir)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return config
}

export class StoreLockedError extends Error {
  constructor(public readonly pid: number, public readonly port: number, path: string) {
    super(
      `another web-remarq MCP server (pid ${pid}, port ${port}) already serves this store - ` +
        `two processes on one store cannot guarantee atomic transitions. Stop it first, or remove ${path} if that process is gone.`,
    )
    this.name = 'StoreLockedError'
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Single-process guard for the store: `<dir>/server.lock` names the pid that
 * owns it. A live owner refuses a second server (the in-process mutation queue
 * is the atomicity guarantee, and two queues are none); a dead owner's stale
 * lock is taken over. Returns a release function; the lock is also released
 * on normal exit and on SIGINT/SIGTERM.
 */
export function acquireStoreLock(dir: string, port: number): () => void {
  const path = join(dir, LOCK_FILE)
  mkdirSync(dir, { recursive: true })
  if (existsSync(path)) {
    let owner: { pid?: unknown; port?: unknown } = {}
    try {
      owner = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      // unreadable lock: treat as stale
    }
    const pid = typeof owner.pid === 'number' ? owner.pid : NaN
    if (Number.isInteger(pid) && pid !== process.pid && pidAlive(pid)) {
      throw new StoreLockedError(pid, typeof owner.port === 'number' ? owner.port : 0, path)
    }
  }
  writeFileSync(path, `${JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() })}\n`)

  let released = false
  const release = (): void => {
    if (released) return
    released = true
    try {
      const owner = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown }
      if (owner.pid === process.pid) unlinkSync(path)
    } catch {
      // already gone
    }
  }
  const onSignal = (signal: NodeJS.Signals): void => {
    release()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.once('exit', release)
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  return () => {
    process.off('exit', release)
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    release()
  }
}
