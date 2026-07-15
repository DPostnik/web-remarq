import type { QualityCheck, QualityCheckInput } from 'web-remarq/core'

export type { QualityCheck }

export interface PreflightInput {
  text: string
  fingerprint: string
  viewport: { width: number; height: number }
}

export interface PreflightConfig {
  apiKey: string
  provider: 'anthropic' | 'openai'
  model?: string
}

/**
 * Injectable LLM client. Tests pass a mock implementation so no network
 * request is ever made. The default client is built from `PreflightConfig`.
 */
export interface LLMClient {
  complete(prompt: string): Promise<string>
}

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'  // alias — tracks the latest Haiku 4.5 snapshot
export const DEFAULT_OPENAI_MODEL = 'gpt-5-nano'           // per spec; cheapest current OpenAI tier

function resolveModel(config: PreflightConfig): string {
  if (config.model) return config.model
  return config.provider === 'anthropic'
    ? DEFAULT_ANTHROPIC_MODEL
    : DEFAULT_OPENAI_MODEL
}

function buildPrompt(input: PreflightInput): string {
  return [
    'You are a review assistant that judges whether a design/QA comment is',
    'specific and actionable for a developer who has to implement the fix.',
    '',
    'Evaluate the comment below. Decide if it is:',
    '- "clear": specific and actionable, a developer can act on it directly.',
    '- "ambiguous": understandable but missing detail; needs clarification.',
    '- "unactionable": too vague or subjective to act on at all.',
    '',
    'Respond with ONLY a JSON object, no prose, no code fences, of the form:',
    '{',
    '  "score": "clear" | "ambiguous" | "unactionable",',
    '  "issues": string[],',
    '  "clarifyingQuestions": string[],',
    '  "suggestedRewrite": string (optional)',
    '}',
    '',
    `Comment: ${JSON.stringify(input.text)}`,
    `Element fingerprint: ${JSON.stringify(input.fingerprint)}`,
    `Viewport: ${input.viewport.width}x${input.viewport.height}`,
  ].join('\n')
}

const VALID_SCORES: ReadonlySet<QualityCheck['score']> = new Set([
  'clear',
  'ambiguous',
  'unactionable',
])

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function fallbackCheck(reason: string): QualityCheck {
  return {
    score: 'ambiguous',
    issues: [reason],
    clarifyingQuestions: [],
    refinedBy: 'auto',
    timestamp: Date.now(),
  }
}

/**
 * Models occasionally ignore the "no code fences, no prose" instruction and
 * wrap the JSON in ```json fences or surround it with text. Extract the JSON
 * object before parsing.
 */
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start !== -1 && end > start) return body.slice(start, end + 1)
  return body.trim()
}

/**
 * Parse a raw LLM response into a `QualityCheck`. Never throws: any malformed
 * or non-JSON response yields a safe `ambiguous` fallback with an explanatory
 * entry in `issues`.
 */
function parseResponse(raw: string): QualityCheck {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJSON(raw))
  } catch {
    return fallbackCheck('Could not parse LLM response as JSON.')
  }

  if (parsed === null || typeof parsed !== 'object') {
    return fallbackCheck('LLM response was not a JSON object.')
  }

  const obj = parsed as Record<string, unknown>
  const score = obj.score
  if (typeof score !== 'string' || !VALID_SCORES.has(score as QualityCheck['score'])) {
    return fallbackCheck('LLM response had an invalid or missing score.')
  }

  const check: QualityCheck = {
    score: score as QualityCheck['score'],
    issues: toStringArray(obj.issues),
    clarifyingQuestions: toStringArray(obj.clarifyingQuestions),
    refinedBy: 'auto',
    timestamp: Date.now(),
  }

  if (typeof obj.suggestedRewrite === 'string' && obj.suggestedRewrite.length > 0) {
    check.suggestedRewrite = obj.suggestedRewrite
  }

  return check
}

/**
 * Build a real BYOK client from the config. This is only used when no client
 * is injected; tests always inject a mock and never reach this path.
 */
function createDefaultClient(config: PreflightConfig): LLMClient {
  const model = resolveModel(config)

  return {
    async complete(prompt: string): Promise<string> {
      if (config.provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(
            `LLM provider error ${res.status}: ${body.slice(0, 200)}`,
          )
        }
        const data = (await res.json()) as {
          content?: Array<{ text?: string }>
        }
        return data.content?.[0]?.text ?? ''
      }

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(
          `LLM provider error ${res.status}: ${body.slice(0, 200)}`,
        )
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message?.content ?? ''
    },
  }
}

/**
 * Run a text-only pre-flight quality check on an annotation comment.
 *
 * Builds a prompt from `input`, asks the LLM to judge whether the comment is
 * specific/actionable, and parses the response into a core `QualityCheck`.
 * A malformed or non-JSON LLM response is handled without throwing and returns
 * a safe `ambiguous` fallback. No screenshot is sent or required.
 */
export async function preflightCheck(
  input: PreflightInput,
  config: PreflightConfig,
  client: LLMClient = createDefaultClient(config),
): Promise<QualityCheck> {
  const prompt = buildPrompt(input)
  let raw: string
  try {
    raw = await client.complete(prompt)
  } catch (err) {
    return {
      score: 'ambiguous',
      issues: ['pre-flight check failed: ' + String(err)],
      clarifyingQuestions: [],
      refinedBy: 'auto',
      timestamp: Date.now(),
    }
  }
  return parseResponse(raw)
}

/**
 * Adapts `preflightCheck` to core's `qualityGate.check` signature:
 *
 *   WebRemarq.init({
 *     qualityGate: { check: createPreflightChecker({ provider: 'openai', apiKey }) },
 *   })
 */
export function createPreflightChecker(
  config: PreflightConfig,
  client?: LLMClient,
): (input: QualityCheckInput) => Promise<QualityCheck> {
  return (input) =>
    preflightCheck(
      {
        text: input.comment,
        fingerprint: JSON.stringify(input.fingerprint),
        viewport: input.viewport,
      },
      config,
      client,
    )
}
