import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

export const CONFIG_ENDPOINT = '/__web-remarq/config.json'
const MAX_WALK = 12

export interface LocalConfigPayload {
  projectId: string
  token: string
}

/**
 * Find `.remarq/config.json` (written by `@web-remarq/mcp` / `@web-remarq/cli`)
 * starting at `from` and walking up, so an app package inside a monorepo finds
 * the config kept at the repository root next to `.mcp.json`.
 */
export function readLocalConfig(from: string): LocalConfigPayload | null {
  let dir = from
  for (let i = 0; i < MAX_WALK; i++) {
    const path = join(dir, '.remarq', 'config.json')
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { projectId?: unknown; token?: unknown }
        if (typeof parsed.projectId === 'string' && typeof parsed.token === 'string') {
          return { projectId: parsed.projectId, token: parsed.token }
        }
      } catch {
        // malformed: treat as absent, the MCP server reports the details
      }
      return null
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
