import { describe, it, expect } from 'vitest'
import { ALLOWED_TOOLS, mergeClaudeSettings } from './claude-settings'

describe('mergeClaudeSettings', () => {
  it('creates the settings when none exist', () => {
    const merge = mergeClaudeSettings(null)
    expect(merge.changed).toBe(true)
    expect(merge.defaultModeSet).toBe(true)
    expect(JSON.parse(merge.content)).toEqual({
      permissions: { allow: ALLOWED_TOOLS, defaultMode: 'acceptEdits' },
      enabledMcpjsonServers: ['web-remarq'],
    })
  })

  it('appends only missing entries and keeps every other key and order', () => {
    const existing = JSON.stringify({
      model: 'opus',
      permissions: { allow: ['Bash(npm test)', 'Read'], deny: ['WebFetch'] },
      enabledMcpjsonServers: ['other'],
    })
    const parsed = JSON.parse(mergeClaudeSettings(existing).content)
    expect(parsed.model).toBe('opus')
    expect(parsed.permissions.deny).toEqual(['WebFetch'])
    expect(parsed.permissions.allow).toEqual(['Bash(npm test)', 'Read', ...ALLOWED_TOOLS.filter((t) => t !== 'Read')])
    expect(parsed.enabledMcpjsonServers).toEqual(['other', 'web-remarq'])
  })

  it('never overwrites an existing defaultMode', () => {
    const merge = mergeClaudeSettings(JSON.stringify({ permissions: { defaultMode: 'plan' } }))
    expect(merge.defaultModeSet).toBe(false)
    expect(merge.defaultMode).toBe('plan')
    expect(JSON.parse(merge.content).permissions.defaultMode).toBe('plan')
  })

  it('is idempotent', () => {
    const first = mergeClaudeSettings(null)
    const second = mergeClaudeSettings(first.content)
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
  })

  it.each(['{ not json', '[]', 'null', '{"permissions":{"allow":"Read"}}', '{"enabledMcpjsonServers":{}}'])(
    'does not clobber a file it cannot understand: %s',
    (content) => {
      expect(() => mergeClaudeSettings(content)).toThrow(/could not be parsed/i)
    },
  )
})
