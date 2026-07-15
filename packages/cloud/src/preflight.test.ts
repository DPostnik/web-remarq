import { describe, it, expect, vi, afterEach } from 'vitest'
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

    const result = await preflightCheck(input, config, client)
    expect(result.score).toBe('ambiguous')
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.refinedBy).toBe('auto')
    expect(typeof result.timestamp).toBe('number')
  })

  it('parses a response wrapped in markdown code fences', async () => {
    const client = mockClient(
      '```json\n{"score": "clear", "issues": [], "clarifyingQuestions": []}\n```',
    )

    const result = await preflightCheck(input, config, client)
    expect(result.score).toBe('clear')
  })

  it('parses a response surrounded by prose', async () => {
    const client = mockClient(
      'Here is my assessment:\n{"score": "unactionable", "issues": ["Too vague."], "clarifyingQuestions": []}\nLet me know if you need more.',
    )

    const result = await preflightCheck(input, config, client)
    expect(result.score).toBe('unactionable')
    expect(result.issues).toContain('Too vague.')
  })
})

describe('preflightCheck default client (network path)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the Anthropic endpoint with x-api-key and extracts content text', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify({ score: 'clear', issues: [] }) }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await preflightCheck(input, {
      apiKey: 'anthropic-secret',
      provider: 'anthropic',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('anthropic-secret')
    expect(headers.authorization).toBeUndefined()
    expect(init.body as string).toContain('The submit button is off.')
    expect(result.score).toBe('clear')
  })

  it('calls the OpenAI endpoint with a Bearer token and extracts message content', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ score: 'unactionable', issues: [] }),
            },
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await preflightCheck(input, {
      apiKey: 'openai-secret',
      provider: 'openai',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer openai-secret')
    expect(headers['x-api-key']).toBeUndefined()
    expect(init.body as string).toContain('The submit button is off.')
    expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' })
    expect(result.score).toBe('unactionable')
  })

  it('surfaces a non-ok provider response as a distinguishable fallback', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'invalid api key',
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await preflightCheck(input, {
      apiKey: 'bad-key',
      provider: 'anthropic',
    })

    expect(result.score).toBe('ambiguous')
    expect(result.refinedBy).toBe('auto')
    expect(result.issues.join(' ')).toContain('401')
    expect(result.issues.join(' ')).toContain('pre-flight check failed')
    expect(result.issues.join(' ')).not.toContain('bad-key')
  })
})
