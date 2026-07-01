import { describe, it, expect, vi } from 'vitest'
import {
  preflightCheck,
  type LLMClient,
  type PreflightConfig,
  type PreflightInput,
} from './preflight'

const input: PreflightInput = {
  text: 'The submit button is off.',
  fingerprint: 'button#submit',
  viewport: { width: 1920, height: 1080 },
}

const config: PreflightConfig = {
  apiKey: 'test-key',
  provider: 'anthropic',
}

function mockClient(response: string): LLMClient {
  return { complete: vi.fn(async () => response) }
}

describe('preflightCheck', () => {
  it('returns a "clear" verdict for a specific comment', async () => {
    const client = mockClient(
      JSON.stringify({
        score: 'clear',
        issues: [],
        clarifyingQuestions: [],
      }),
    )

    const result = await preflightCheck(input, config, client)

    expect(result.score).toBe('clear')
    expect(result.issues).toEqual([])
    expect(result.clarifyingQuestions).toEqual([])
    expect(result.refinedBy).toBe('auto')
    expect(typeof result.timestamp).toBe('number')
    expect(client.complete).toHaveBeenCalledOnce()
  })

  it('returns an "ambiguous" verdict carrying clarifyingQuestions', async () => {
    const client = mockClient(
      JSON.stringify({
        score: 'ambiguous',
        issues: ['Unclear what "off" means.'],
        clarifyingQuestions: [
          'Do you mean the color, the position, or the copy?',
        ],
        suggestedRewrite: 'Move the submit button 8px to the right.',
      }),
    )

    const result = await preflightCheck(input, config, client)

    expect(result.score).toBe('ambiguous')
    expect(result.clarifyingQuestions).toContain(
      'Do you mean the color, the position, or the copy?',
    )
    expect(result.suggestedRewrite).toBe(
      'Move the submit button 8px to the right.',
    )
    expect(result.refinedBy).toBe('auto')
  })

  it('returns an "unactionable" verdict', async () => {
    const client = mockClient(
      JSON.stringify({
        score: 'unactionable',
        issues: ['Comment is too subjective to act on.'],
        clarifyingQuestions: [],
      }),
    )

    const result = await preflightCheck(input, config, client)

    expect(result.score).toBe('unactionable')
    expect(result.issues).toContain('Comment is too subjective to act on.')
    expect(result.refinedBy).toBe('auto')
  })

  it('returns a safe fallback without throwing on a malformed response', async () => {
    const client = mockClient('this is not JSON at all }{')

    let result: Awaited<ReturnType<typeof preflightCheck>>
    await expect(
      (async () => {
        result = await preflightCheck(input, config, client)
      })(),
    ).resolves.not.toThrow()

    result = await preflightCheck(input, config, client)
    expect(result.score).toBe('ambiguous')
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.refinedBy).toBe('auto')
    expect(typeof result.timestamp).toBe('number')
  })
})
