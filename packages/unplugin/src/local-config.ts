import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

export const CONFIG_ENDPOINT = '/__web-remarq/config.json'

export interface LocalConfigPayload {
  projectId: string
  token: string
  /** Port of the local MCP server, so the widget does not assume 1817. */
  port?: number
}

const hasConfig = (dir: string): boolean => existsSync(join(dir, '.remarq', 'config.json'))

/**
 * Locate the directory holding `.remarq/config.json` (written by
 * `@web-remarq/mcp` / `@web-remarq/cli`) and the git root above `from`.
 * The walk goes up to the nearest directory with `.git` and never above it, so
 * an app package in a monorepo finds the config at the repository root, while
 * a project without its own `.remarq/` never picks up an unrelated project's
 * token from a parent directory. Outside a git repository only `from` counts.
 */
export function locateRemarq(from: string): { configDir: string | null; gitRoot: string | null } {
  const start = resolve(from)
  let configDir: string | null = null
  for (let dir = start; ; ) {
    if (configDir === null && hasConfig(dir)) configDir = dir
    if (existsSync(join(dir, '.git'))) return { configDir, gitRoot: dir }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { configDir: hasConfig(start) ? start : null, gitRoot: null }
}

/**
 * Directory that `file:line` locations are relative to: where the agent works,
 * i.e. next to `.remarq/`, else the git root, else the current directory.
 */
export function resolveAgentRoot(from: string): string {
  const { configDir, gitRoot } = locateRemarq(from)
  return configDir ?? gitRoot ?? process.cwd()
}

const isPort = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function readLocalConfig(from: string): LocalConfigPayload | null {
  const { configDir } = locateRemarq(from)
  if (configDir === null) return null
  const remarq = join(configDir, '.remarq')
  // malformed: treat as absent, the MCP server reports the details
  const config = readJson(join(remarq, 'config.json'))
  if (typeof config?.projectId !== 'string' || typeof config.token !== 'string') return null
  // The lock holds the port the running server actually bound (REMARQ_PORT included).
  const lockPort = readJson(join(remarq, 'server.lock'))?.port
  const port = isPort(lockPort) ? lockPort : isPort(config.port) ? config.port : undefined
  return { projectId: config.projectId, token: config.token, ...(port !== undefined ? { port } : {}) }
}
