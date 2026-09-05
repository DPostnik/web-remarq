import { z } from 'zod'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { transition, InvalidTransitionError, AnnotationNotFoundError } from 'web-remarq/core'
import type { LifecycleAction } from 'web-remarq/core'
import { toolError, toolSuccess } from '../errors'

/**
 * Shared implementation of the three agent-side transitions (acknowledge,
 * claim_fix, dismiss).
 *
 * Atomicity: when the storage adapter offers `mutate` (local file store, cloud
 * adapter), the read-check-write happens inside the adapter's own critical
 * section, so concurrent callers on one annotation are serialised and exactly
 * one of them wins a given transition. Adapters without `mutate` fall back to
 * load()+save() and the response says so (`atomic: false`).
 *
 * Idempotency: a caller may pass `operationId`. The event written to the
 * lifecycle carries it as `opId`; a retry with the same id after a lost
 * response finds the event already there and returns success (`replayed:
 * true`) without appending a second one. A *different* id on an annotation
 * that has already moved on gets the normal conflict - it never impersonates
 * the earlier winner.
 *
 * Boundary of the guarantee: "one winner of the transition" is not "an
 * authenticated owner". Nothing here identifies *which* agent won; the
 * lifecycle records `actor: 'agent'` only.
 */

export const operationIdSchema = z.string().min(1).max(128).optional()

export interface TransitionInput {
  id: string
  operationId?: string
  reason?: string
}

export async function runTransition(
  input: TransitionInput,
  storage: StorageAdapter,
  action: LifecycleAction,
  requestedTransition: string,
) {
  let replayed = false
  let seen: Annotation | null = null

  const apply = (current: Annotation): Annotation => {
    seen = current
    if (input.operationId && current.lifecycle.some((e) => e.opId === input.operationId)) {
      replayed = true
      return current
    }
    const result = transition(current, action, { actor: 'agent', reason: input.reason })
    const event = input.operationId ? { ...result.event, opId: input.operationId } : result.event
    return { ...current, status: result.status, lifecycle: [...current.lifecycle, event] }
  }

  const conflict = (current: Annotation, err: InvalidTransitionError) => {
    const last = current.lifecycle[current.lifecycle.length - 1]
    return toolError('invalid_transition', `${err.message} - another actor moved this annotation first; do not start work on it, re-read it with get_annotation`, {
      conflict: true,
      currentStatus: current.status,
      currentRev: current.rev ?? null,
      lastEvent: last ? { type: last.type, actor: last.actor, timestamp: last.timestamp } : null,
      requestedTransition,
    })
  }

  if (typeof storage.mutate === 'function') {
    let saved: Annotation
    try {
      saved = await storage.mutate(input.id, apply)
    } catch (err) {
      if (err instanceof AnnotationNotFoundError) {
        return toolError('annotation_not_found', `Annotation ${input.id} not found in this project`)
      }
      if (err instanceof InvalidTransitionError && seen) return conflict(seen, err)
      return toolError('storage_error', err instanceof Error ? err.message : String(err))
    }
    return toolSuccess({ ok: true, status: saved.status, rev: saved.rev ?? null, ...(replayed ? { replayed: true } : {}) })
  }

  // Non-atomic fallback for adapters without mutate(). Documented as such.
  let store
  try {
    store = await storage.load()
  } catch (err) {
    return toolError('storage_error', err instanceof Error ? err.message : String(err))
  }
  const annotation = store?.annotations.find((a) => a.id === input.id)
  if (!annotation) {
    return toolError('annotation_not_found', `Annotation ${input.id} not found in this project`)
  }

  let updated: Annotation
  try {
    updated = apply(annotation)
  } catch (err) {
    if (err instanceof InvalidTransitionError) return conflict(annotation, err)
    throw err
  }

  if (!replayed) {
    try {
      await storage.save(updated)
    } catch (err) {
      return toolError('storage_error', err instanceof Error ? err.message : String(err))
    }
  }

  return toolSuccess({ ok: true, status: updated.status, atomic: false, ...(replayed ? { replayed: true } : {}) })
}
