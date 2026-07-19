import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const MCP_ENTRY = { command: 'npx', args: ['-y', '@web-remarq/mcp'] } as const

interface McpConfig {
  mcpServers?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Merge our server entry into an existing .mcp.json without touching other servers.
 * Throws on malformed JSON rather than overwriting a file we cannot understand.
 */
export function mergeMcpConfig(existing: string | null): { content: string; changed: boolean } {
  let config: McpConfig = {}
  if (existing !== null && existing.trim() !== '') {
    try {
      config = JSON.parse(existing) as McpConfig
    } catch {
      throw new Error('.mcp.json could not be parsed - fix or remove it, then run init again')
    }
  }

  const servers = config.mcpServers ?? {}
  const current = servers['web-remarq']
  if (current && JSON.stringify(current) === JSON.stringify(MCP_ENTRY)) {
    return { content: existing ?? '', changed: false }
  }

  const next: McpConfig = {
    ...config,
    mcpServers: { ...servers, 'web-remarq': MCP_ENTRY },
  }
  return { content: `${JSON.stringify(next, null, 2)}\n`, changed: true }
}

/** Write .mcp.json at the repository root. Returns true when the file changed. */
export function writeMcpConfig(repoRoot: string): boolean {
  const path = join(repoRoot, '.mcp.json')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const { content, changed } = mergeMcpConfig(existing)
  if (changed) writeFileSync(path, content, 'utf8')
  return changed
}
