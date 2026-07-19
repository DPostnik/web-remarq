import { describe, it, expect } from 'vitest'
import { mergeMcpConfig } from './mcp-config'

describe('mergeMcpConfig', () => {
  it('creates the file when none exists', () => {
    const { content, changed } = mergeMcpConfig(null)
    expect(changed).toBe(true)
    expect(JSON.parse(content).mcpServers['web-remarq']).toEqual({
      command: 'npx',
      args: ['-y', '@web-remarq/mcp'],
    })
  })

  it('keeps other servers untouched', () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: 'foo', args: [] } } })
    const { content, changed } = mergeMcpConfig(existing)
    expect(changed).toBe(true)
    const parsed = JSON.parse(content)
    expect(parsed.mcpServers.other).toEqual({ command: 'foo', args: [] })
    expect(parsed.mcpServers['web-remarq']).toBeDefined()
  })

  it('is idempotent when the entry is already present', () => {
    const first = mergeMcpConfig(null)
    const second = mergeMcpConfig(first.content)
    expect(second.changed).toBe(false)
    expect(second.content).toBe(first.content)
  })

  it('does not clobber a malformed file', () => {
    expect(() => mergeMcpConfig('{ not json')).toThrow(/could not be parsed/i)
  })
})
