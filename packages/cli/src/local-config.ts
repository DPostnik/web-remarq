import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from './fs-utils'
import type { Agent } from './types'

/**
 * `.remarq/config.json` at the repository root: the local project identity and
 * the bearer token the widget and doctor use to talk to `@web-remarq/mcp`.
 * The MCP server creates the same file on first start; the installer creates
 * it up front so pairing needs no extra step and `doctor` can authenticate its
 * probe. The format is owned by `@web-remarq/mcp` (see its local-config.ts).
 */
export const LOCAL_CONFIG_PATH = '.remarq/config.json'
/** The port @web-remarq/mcp listens on when neither REMARQ_PORT nor `port` in the config is set. */
export const DEFAULT_PORT = 1817
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']

export interface LocalConfig {
  projectId: string
  token: string
  allowedOrigins: string[]
  agent?: Agent
}

/** Create the config (and `.remarq/.gitignore`) when absent. Returns true when a file was written. */
export function ensureLocalConfig(repoRoot: string, agent?: Agent): boolean {
  const dir = join(repoRoot, '.remarq')
  const path = join(dir, 'config.json')
  if (existsSync(path)) {
    if (agent === undefined) return false
    let config: unknown
    try {
      config = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      throw new Error(`${LOCAL_CONFIG_PATH} could not be read as JSON`)
    }
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      throw new Error(`${LOCAL_CONFIG_PATH} must contain a JSON object`)
    }
    if ('agent' in config && config.agent === agent) return false
    writeFileSync(path, `${JSON.stringify({ ...config, agent }, null, 2)}\n`)
    return true
  }
  mkdirSync(dir, { recursive: true })
  const gitignore = join(dir, '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n')
  const config: LocalConfig = {
    projectId: `prj_${randomBytes(8).toString('hex')}`,
    token: randomBytes(24).toString('hex'),
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
    ...(agent === undefined ? {} : { agent }),
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return true
}

export function readLocalAgent(repoRoot: string): Agent | undefined {
  const agent = readJson<{ agent?: unknown }>(join(repoRoot, LOCAL_CONFIG_PATH))?.agent
  return agent === 'codex' || agent === 'claude' ? agent : undefined
}

/** The token from the repo-root config, or null when the file is absent or unreadable. */
export function readLocalToken(repoRoot: string): string | null {
  const token = readJson<{ token?: unknown }>(join(repoRoot, LOCAL_CONFIG_PATH))?.token
  return typeof token === 'string' && token.length > 0 ? token : null
}

/** The MCP server port: `port` from the repo-root config when it is a valid port, else the server's default. */
export function readLocalPort(repoRoot: string): number {
  const port = readJson<{ port?: unknown }>(join(repoRoot, LOCAL_CONFIG_PATH))?.port
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT
}
