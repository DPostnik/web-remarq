import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Personal (not shared with the team) Claude Code settings for this repository. */
export const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json'

// Channels for a project MCP server load only with this flag; permissions and
// the edit mode come from CLAUDE_SETTINGS_PATH, so the command stays short.
export const SESSION_COMMAND = 'claude --dangerously-load-development-channels server:web-remarq'

/** The tools the verified hands-free session needed: the web-remarq loop plus read-only code search. */
export const ALLOWED_TOOLS = [
  'mcp__web-remarq__claim_fix',
  'mcp__web-remarq__dismiss',
  'mcp__web-remarq__get_annotation',
  'mcp__web-remarq__list_annotations',
  'mcp__web-remarq__acknowledge',
  'Read',
  'Glob',
  'Grep',
]

const DEFAULT_MODE = 'acceptEdits'

interface ClaudeSettings {
  permissions?: { allow?: unknown[]; defaultMode?: unknown; [key: string]: unknown }
  enabledMcpjsonServers?: unknown[]
  [key: string]: unknown
}

export interface SettingsMerge {
  content: string
  changed: boolean
  /** The permission mode sessions start in after the merge. */
  defaultMode: string
  /** False when the user already had a defaultMode, which is never overwritten. */
  defaultModeSet: boolean
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Merge the web-remarq permissions into existing settings: append missing
 * entries only, set defaultMode only when absent, keep every other key.
 * Throws on a file it cannot understand rather than overwriting it.
 */
export function mergeClaudeSettings(existing: string | null): SettingsMerge {
  const unreadable = new Error(`${CLAUDE_SETTINGS_PATH} could not be parsed - fix or remove it, then run init again`)
  let settings: ClaudeSettings = {}
  if (existing !== null && existing.trim() !== '') {
    try {
      settings = JSON.parse(existing) as ClaudeSettings
    } catch {
      throw unreadable
    }
  }
  if (!isObject(settings)) throw unreadable
  const permissions = settings.permissions ?? {}
  if (
    !isObject(permissions) ||
    !Array.isArray(permissions.allow ?? []) ||
    !Array.isArray(settings.enabledMcpjsonServers ?? [])
  ) {
    throw unreadable
  }

  const allow = permissions.allow ?? []
  const servers = settings.enabledMcpjsonServers ?? []
  const missingTools = ALLOWED_TOOLS.filter((tool) => !allow.includes(tool))
  const defaultModeSet = permissions.defaultMode === undefined
  const defaultMode = defaultModeSet ? DEFAULT_MODE : String(permissions.defaultMode)
  const changed = missingTools.length > 0 || defaultModeSet || !servers.includes('web-remarq')
  if (!changed) return { content: existing ?? '', changed, defaultMode, defaultModeSet }

  const next: ClaudeSettings = {
    ...settings,
    permissions: { ...permissions, allow: [...allow, ...missingTools], defaultMode },
    enabledMcpjsonServers: servers.includes('web-remarq') ? servers : [...servers, 'web-remarq'],
  }
  return { content: `${JSON.stringify(next, null, 2)}\n`, changed, defaultMode, defaultModeSet }
}

/** Write CLAUDE_SETTINGS_PATH at the repository root, creating `.claude/` when absent. */
export function writeClaudeSettings(repoRoot: string): Omit<SettingsMerge, 'content'> {
  const path = join(repoRoot, CLAUDE_SETTINGS_PATH)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const { content, ...merge } = mergeClaudeSettings(existing)
  if (merge.changed) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, 'utf8')
  }
  return merge
}
