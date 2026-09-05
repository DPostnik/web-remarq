import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `.remarq/config.json` at the repository root: the local project identity and
 * the bearer token the widget and doctor use to talk to `@web-remarq/mcp`.
 * The MCP server creates the same file on first start; the installer creates
 * it up front so pairing needs no extra step and `doctor` can authenticate its
 * probe. The format is owned by `@web-remarq/mcp` (see its local-config.ts).
 */
export const LOCAL_CONFIG_PATH = '.remarq/config.json'
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*']

export interface LocalConfig {
  projectId: string
  token: string
  allowedOrigins: string[]
}

/** Create the config (and `.remarq/.gitignore`) when absent. Returns true when a file was written. */
export function ensureLocalConfig(repoRoot: string): boolean {
  const dir = join(repoRoot, '.remarq')
  const path = join(dir, 'config.json')
  if (existsSync(path)) return false
  mkdirSync(dir, { recursive: true })
  const gitignore = join(dir, '.gitignore')
  if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n')
  const config: LocalConfig = {
    projectId: `prj_${randomBytes(8).toString('hex')}`,
    token: randomBytes(24).toString('hex'),
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  return true
}

/** The token from the repo-root config, or null when the file is absent or unreadable. */
export function readLocalToken(repoRoot: string): string | null {
  const path = join(repoRoot, LOCAL_CONFIG_PATH)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { token?: unknown }
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null
  } catch {
    return null
  }
}
