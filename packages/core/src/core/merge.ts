import type { Annotation, AnnotationEvent, AnnotationStatus } from './types'
import { replayEvent } from './lifecycle'

export interface MergeResult {
  /** The copy to write back (server copy plus every local change that still applies). */
  annotation: Annotation
  /** True when `annotation` differs from the server copy, i.e. something local survived. */
  changed: boolean
  /** Fields or events from the local copy that could not be kept. */
  dropped: string[]
}

const MERGEABLE_FIELDS = ['comment', 'qualityCheck', 'fingerprint', 'route', 'viewport', 'viewportBucket', 'timestamp'] as const

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function eventsAfter(prefix: AnnotationEvent[], full: AnnotationEvent[]): AnnotationEvent[] {
  let i = 0
  while (i < prefix.length && i < full.length && same(prefix[i], full[i])) i++
  return full.slice(i)
}

/**
 * Three-way merge of a stale local copy onto the server's newer copy.
 *
 * - `base` is the server copy the local edit started from. A field changed
 *   locally and untouched on the server keeps the local value; changed on both
 *   sides keeps the server value and is reported in `dropped`.
 * - Without a `base` (null) there is no way to tell who changed a field, so
 *   every field that differs is treated as changed on both sides: the server
 *   value stands and the local one is reported. A local edit is then never
 *   silently lost (it lands in `dropped`) and a server edit is never silently
 *   overwritten.
 * - Lifecycle: the server history is authoritative and is never truncated.
 *   Local events recorded after `base` (after the common prefix when there is
 *   no base) are replayed on top of the server status one by one; an event
 *   that is no longer a valid transition (the server already moved on) is
 *   dropped and reported. A stale local copy can therefore never roll
 *   `verified` or `in_progress` back to `pending`.
 */
export function mergeAnnotation(base: Annotation | null, local: Annotation, server: Annotation): MergeResult {
  const origin = base ?? server
  const dropped: string[] = []
  const merged: Annotation = { ...server }

  for (const field of MERGEABLE_FIELDS) {
    const localChanged = !same(local[field], origin[field])
    if (!localChanged) continue
    // No base: any difference counts as changed on both sides.
    const serverChanged = base === null || !same(server[field], origin[field])
    if (serverChanged && !same(local[field], server[field])) {
      dropped.push(field)
      continue
    }
    ;(merged as unknown as Record<string, unknown>)[field] = local[field]
  }

  let status: AnnotationStatus = server.status
  const lifecycle = [...server.lifecycle]
  const serverExtra = eventsAfter(origin.lifecycle, server.lifecycle)
  for (const event of eventsAfter(origin.lifecycle, local.lifecycle)) {
    // Identical event already recorded server-side (e.g. our own retried write).
    if (serverExtra.some((e) => same(e, event))) continue
    const next = replayEvent(status, event.type)
    if (next === null) {
      dropped.push(`lifecycle:${event.type}`)
      continue
    }
    status = next
    lifecycle.push(event)
  }
  merged.status = status
  merged.lifecycle = lifecycle
  merged.rev = server.rev

  const changed = !same({ ...merged, rev: 0 }, { ...server, rev: 0 })
  return { annotation: merged, changed, dropped }
}
