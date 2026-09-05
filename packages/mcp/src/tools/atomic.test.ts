import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Annotation } from 'web-remarq'
import { FileStorageAdapter } from '../file-storage-adapter'
import { handleAcknowledge } from './acknowledge'
import { handleClaimFix } from './claim-fix'
import { handleDismiss } from './dismiss'

function ann(id: string, status: Annotation['status'] = 'pending'): Annotation {
  return {
    id, comment: `c-${id}`, route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
  }
}

const payload = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text)

/**
 * Races against the REAL file adapter: every caller is launched in the same
 * tick, before any of them has loaded the store, so without the adapter's
 * critical section all of them would read `pending` and all would "win".
 */
describe('atomic transitions (local file store)', () => {
  let dir: string
  let storage: FileStorageAdapter

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-atomic-'))
    storage = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    await storage.save(ann('t'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('of five concurrent acknowledges exactly one wins and exactly one event is recorded', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => handleAcknowledge({ id: 't', operationId: `op-${i}` }, storage)),
    )
    const winners = results.filter((r) => !r.isError)
    const losers = results.filter((r) => r.isError)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(4)
    expect(payload(winners[0])).toMatchObject({ ok: true, status: 'in_progress', rev: 2 })
    for (const loser of losers) {
      const p = payload(loser)
      expect(p.code).toBe('invalid_transition')
      expect(p.details).toMatchObject({ conflict: true, currentStatus: 'in_progress', currentRev: 2, requestedTransition: 'acknowledge' })
      expect(p.details.lastEvent.type).toBe('acknowledged')
    }
    const stored = (await storage.load())!.annotations[0]
    expect(stored.lifecycle.map((e) => e.type)).toEqual(['created', 'acknowledged'])
    expect(stored.rev).toBe(2)
  })

  it('a retry with the same operationId is a replay: success, no second event, no rev bump', async () => {
    const first = payload(await handleAcknowledge({ id: 't', operationId: 'op-A' }, storage))
    expect(first).toMatchObject({ ok: true, status: 'in_progress', rev: 2 })

    const retry = payload(await handleAcknowledge({ id: 't', operationId: 'op-A' }, storage))
    expect(retry).toMatchObject({ ok: true, status: 'in_progress', rev: 2, replayed: true })

    const stored = (await storage.load())!.annotations[0]
    expect(stored.lifecycle).toHaveLength(2)
    expect(stored.lifecycle[1].opId).toBe('op-A')
    expect(stored.rev).toBe(2)
  })

  it('a different operationId does not impersonate the winner', async () => {
    await handleAcknowledge({ id: 't', operationId: 'op-A' }, storage)
    const other = await handleAcknowledge({ id: 't', operationId: 'op-B' }, storage)
    expect(other.isError).toBe(true)
    expect(payload(other).details.conflict).toBe(true)
  })

  it('acknowledge vs dismiss race resolves to one allowed sequence with full history', async () => {
    const [ack, dis] = await Promise.all([
      handleAcknowledge({ id: 't', operationId: 'ack' }, storage),
      handleDismiss({ id: 't', reason: 'dup', operationId: 'dis' }, storage),
    ])
    const stored = (await storage.load())!.annotations[0]
    // dismiss is allowed from pending AND from in_progress, so both orders are
    // legal: either ack wins then dismiss follows (both ok, 3 events), or dismiss
    // wins and ack conflicts (2 events). Never a truncated or interleaved history.
    if (!ack.isError && !dis.isError) {
      expect(stored.status).toBe('dismissed')
      expect(stored.lifecycle.map((e) => e.type)).toEqual(['created', 'acknowledged', 'dismissed'])
      expect(stored.rev).toBe(3)
    } else {
      expect(dis.isError).toBeFalsy()
      expect(ack.isError).toBe(true)
      expect(stored.status).toBe('dismissed')
      expect(stored.lifecycle.map((e) => e.type)).toEqual(['created', 'dismissed'])
      expect(stored.rev).toBe(2)
    }
  })

  it('claim_fix vs a user edit through saveIfMatch: the stale edit conflicts, the claim is kept', async () => {
    const [claim, edit] = await Promise.all([
      handleClaimFix({ id: 't', operationId: 'fix' }, storage),
      storage.saveIfMatch({ ...ann('t'), comment: 'edited by designer' }, 1),
    ])
    const stored = (await storage.load())!.annotations[0]
    if (edit.ok) {
      // Edit landed first (rev 2); the claim then applied on top of the edited copy.
      expect(claim.isError).toBeFalsy()
      expect(stored.comment).toBe('edited by designer')
      expect(stored.status).toBe('fixed_unverified')
      expect(stored.rev).toBe(3)
    } else {
      expect(edit.reason).toBe('conflict')
      expect(stored.status).toBe('fixed_unverified')
      expect(stored.comment).toBe('c-t')
    }
    expect(stored.lifecycle.map((e) => e.type)).toEqual(['created', 'fix_claimed'])
  })

  it('independent annotations proceed and a failing operation does not poison the queue', async () => {
    await storage.save(ann('u'))
    const results = await Promise.all([
      handleAcknowledge({ id: 'missing' }, storage),
      handleAcknowledge({ id: 't' }, storage),
      handleClaimFix({ id: 'u' }, storage),
    ])
    expect(payload(results[0]).code).toBe('annotation_not_found')
    expect(payload(results[1])).toMatchObject({ ok: true, status: 'in_progress' })
    expect(payload(results[2])).toMatchObject({ ok: true, status: 'fixed_unverified' })
  })

  it('a losing call publishes no change: watchers are not woken by a conflict', async () => {
    await handleAcknowledge({ id: 't' }, storage)
    let changes = 0
    storage.onChange(() => changes++)
    const loser = await handleAcknowledge({ id: 't' }, storage)
    expect(loser.isError).toBe(true)
    const replay = await handleAcknowledge({ id: 't', operationId: 'none-such' }, storage)
    expect(replay.isError).toBe(true)
    expect(changes).toBe(0)
    expect(await storage.waitForChange(20)).toBe(false)
  })
})
