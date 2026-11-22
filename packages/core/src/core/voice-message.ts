import type { Annotation, AnnotationTarget } from './types'
import { generateAgentExport } from './agent-export'

export interface VoiceMark {
  annotation: Annotation
  elapsedMs: number
  transcript: string
}

export interface ReviewTarget {
  route: string
  viewport: string
  fingerprint?: AnnotationTarget['fingerprint']
  legacy?: { tag: string; path: string }
}

const VOICE_HEADER = 'Voice feedback\n\n'

function voiceFooterStart(comment: string): number {
  if (!comment.startsWith(VOICE_HEADER)) return -1
  const start = comment.lastIndexOf('\n\n') + 2
  return start > VOICE_HEADER.length && /^\[1\] \d+\.\ds · /.test(comment.slice(start)) ? start : -1
}

export function voiceTranscript(comment: string): string | undefined {
  if (!comment.startsWith(VOICE_HEADER)) return undefined
  const footer = voiceFooterStart(comment)
  return comment.slice(VOICE_HEADER.length, footer < 0 ? undefined : footer - 2)
}

export function reviewTargets(annotation: Annotation): ReviewTarget[] {
  const { comment, fingerprint, route, viewport } = annotation
  if (Array.isArray(fingerprint.brushTargets) && fingerprint.brushTargets.length) return fingerprint.brushTargets
  if (Array.isArray(fingerprint.voiceTargets) && fingerprint.voiceTargets.length) return fingerprint.voiceTargets

  // Old recordings stored a numbered footer and only the first fingerprint.
  // Read the generated footer as hints, never as selectors.
  const footerStart = voiceFooterStart(comment)
  if (footerStart !== -1) {
    const footer = comment.slice(footerStart)
    const targets: ReviewTarget[] = []
    for (const match of footer.matchAll(/^\[(\d+)\] \d+\.\ds · (\/[^\n]*) · (\d{1,5}x\d{1,5})\n(?:  Source: [^\n]*\n)?  Element: <([a-z][\w-]*)> ([^\n]*)/gm)) {
      if (Number(match[1]) !== targets.length + 1) break
      targets.push({
        route: match[2],
        viewport: match[3],
        legacy: { tag: match[4], path: match[5] },
        ...(targets.length === 0 ? { fingerprint } : {}),
      })
    }
    if (targets[0]?.route === route && targets[0].viewport === viewport &&
        targets[0].legacy?.tag === fingerprint.tagName && targets[0].legacy.path === fingerprint.domPath) return targets
  }
  return [{ fingerprint, route, viewport }]
}

export function reviewClaim(annotation: Annotation): string {
  const index = annotation.lifecycle.map((event) => event.type).lastIndexOf('fix_claimed')
  const event = annotation.lifecycle[index]
  return JSON.stringify([index, event?.timestamp, event?.opId])
}

export function checkedVoiceTargets(annotation: Annotation): number[] {
  const review = annotation.fingerprint.voiceReview
  return review?.claim === reviewClaim(annotation) && Array.isArray(review.checked) ? review.checked : []
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/^\p{P}+|\p{P}+$/gu, '')
}

export function formatVoiceMessage(transcript: string, marks: VoiceMark[]): string {
  const words = transcript.trim().split(/\s+/).filter(Boolean)
  const normalized = words.map(normalizeWord)
  const annotated: string[] = []
  const details: string[] = []
  let cursor = 0

  for (const [index, mark] of marks.entries()) {
    const heard = mark.transcript.trim().split(/\s+/).filter(Boolean).map(normalizeWord)
    let offset = 0
    // The browser may revise interim text and does not expose word timestamps.
    while (offset < heard.length && heard[offset] === normalized[offset]) offset++
    offset = Math.max(offset, cursor)
    const label = `[${index + 1}]`
    annotated.push(...words.slice(cursor, offset), label)
    cursor = offset

    const { annotation } = mark
    const [agent] = generateAgentExport([annotation], annotation.viewportBucket).annotations
    const elapsed = (mark.elapsedMs / 1000).toFixed(1)
    details.push(`${label} ${elapsed}s · ${agent.route} · ${annotation.viewport}`)
    if (agent.source) {
      const { file, line, column, component } = agent.source
      details.push(`  Source: ${file}:${line}:${column}${component ? ` (${component})` : ''}`)
    }
    details.push(`  Element: <${agent.searchHints.tagName}> ${agent.searchHints.domContext}`)
    const queries = agent.searchHints.grepQueries.slice(0, 3)
    if (queries.length) details.push(`  Search: ${queries.map(({ query }) => query).join(', ')}`)
  }
  annotated.push(...words.slice(cursor))
  return [VOICE_HEADER + annotated.join(' '), ...(details.length ? [details.join('\n')] : [])].join('\n\n')
}
