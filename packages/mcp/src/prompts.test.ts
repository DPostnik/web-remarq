import { describe, expect, it } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DUTY_PROMPT, registerPrompts } from './prompts'

describe('DUTY_PROMPT', () => {
  it('carries the dispatcher recipe: watch loop, ack-first, subagent claim_fix, dismiss on ambiguity', () => {
    expect(DUTY_PROMPT).toContain('watch_annotations')
    expect(DUTY_PROMPT).toContain('acknowledge with its id first')
    expect(DUTY_PROMPT).toContain('background subagents')
    expect(DUTY_PROMPT).toContain('claim_fix')
    expect(DUTY_PROMPT).toContain('dismiss')
  })

  it('contains no em dashes', () => {
    expect(DUTY_PROMPT).not.toContain('—')
  })
})

describe('registerPrompts', () => {
  it('registers the watch prompt whose callback returns DUTY_PROMPT as a user message', () => {
    const calls: Array<{ name: string; config: { title?: string; description?: string }; cb: () => unknown }> = []
    const server = {
      registerPrompt: (name: string, config: { title?: string; description?: string }, cb: () => unknown) => {
        calls.push({ name, config, cb })
      },
    } as unknown as McpServer

    registerPrompts(server)

    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('watch')
    expect(calls[0].config.description).toContain('annotation duty')
    const result = calls[0].cb() as { messages: Array<{ role: string; content: { type: string; text: string } }> }
    expect(result.messages).toEqual([
      { role: 'user', content: { type: 'text', text: DUTY_PROMPT } },
    ])
  })
})
