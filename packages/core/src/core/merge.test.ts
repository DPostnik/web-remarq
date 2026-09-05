import { describe, expect, it } from 'vitest'
import { mergeAnnotation } from './merge'
import type { Annotation, AnnotationEvent } from './types'

const created: AnnotationEvent = { type: 'created', actor: 'designer', timestamp: 1 }

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1', comment: 'original', route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status: 'pending', lifecycle: [created], rev: 1,
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
    ...overrides,
  }
}

const acknowledged: AnnotationEvent = { type: 'acknowledged', actor: 'agent', timestamp: 2 }
const verified: AnnotationEvent = { type: 'verified', actor: 'developer', timestamp: 3 }

describe('mergeAnnotation', () => {
  it('keeps a local comment edit when the server only moved the status', () => {
    const base = ann()
    const local = ann({ comment: 'edited offline' })
    const server = ann({ status: 'in_progress', lifecycle: [created, acknowledged], rev: 2 })
    const r = mergeAnnotation(base, local, server)
    expect(r.changed).toBe(true)
    expect(r.dropped).toEqual([])
    expect(r.annotation).toMatchObject({ comment: 'edited offline', status: 'in_progress', rev: 2 })
    expect(r.annotation.lifecycle).toEqual([created, acknowledged])
  })

  it('a stale local copy never rolls verified back to pending or truncates history', () => {
    const base = ann()
    const local = ann({ comment: 'edited offline' }) // still pending, 1 event
    const server = ann({ status: 'verified', lifecycle: [created, acknowledged, verified], rev: 3 })
    const r = mergeAnnotation(base, local, server)
    expect(r.annotation.status).toBe('verified')
    expect(r.annotation.lifecycle).toHaveLength(3)
    expect(r.annotation.comment).toBe('edited offline')
  })

  it('replays a local transition that is still valid on top of the server status', () => {
    const base = ann()
    const dismissed: AnnotationEvent = { type: 'dismissed', actor: 'designer', timestamp: 5, reason: 'dup' }
    const local = ann({ status: 'dismissed', lifecycle: [created, dismissed] })
    const server = ann({ status: 'in_progress', lifecycle: [created, acknowledged], rev: 2 })
    const r = mergeAnnotation(base, local, server)
    expect(r.annotation.status).toBe('dismissed')
    expect(r.annotation.lifecycle).toEqual([created, acknowledged, dismissed])
    expect(r.dropped).toEqual([])
  })

  it('drops a local transition that is no longer valid and reports it', () => {
    const base = ann()
    const localVerify: AnnotationEvent = { type: 'verified', actor: 'developer', timestamp: 5 }
    const local = ann({ status: 'verified', lifecycle: [created, localVerify] }) // verify from pending is invalid anyway on server's path
    const dismissedSrv: AnnotationEvent = { type: 'dismissed', actor: 'agent', timestamp: 4 }
    const server = ann({ status: 'dismissed', lifecycle: [created, dismissedSrv], rev: 2 })
    const r = mergeAnnotation(base, local, server)
    expect(r.annotation.status).toBe('dismissed')
    expect(r.annotation.lifecycle).toEqual([created, dismissedSrv])
    expect(r.dropped).toEqual(['lifecycle:verified'])
    expect(r.changed).toBe(false)
  })

  it('server wins a field changed on both sides, and reports the drop', () => {
    const base = ann()
    const local = ann({ comment: 'mine' })
    const server = ann({ comment: 'theirs', rev: 2 })
    const r = mergeAnnotation(base, local, server)
    expect(r.annotation.comment).toBe('theirs')
    expect(r.dropped).toEqual(['comment'])
    expect(r.changed).toBe(false)
  })

  it('does not duplicate an event the server already recorded (retried write)', () => {
    const base = ann()
    const local = ann({ status: 'in_progress', lifecycle: [created, acknowledged] })
    const server = ann({ status: 'in_progress', lifecycle: [created, acknowledged], rev: 2 })
    const r = mergeAnnotation(base, local, server)
    expect(r.annotation.lifecycle).toHaveLength(2)
    expect(r.changed).toBe(false)
  })

  it('with no base, a field that differs is a conflict (server wins, reported); extra local events still replay', () => {
    const local = ann({ comment: 'offline text', status: 'in_progress', lifecycle: [created, acknowledged] })
    const server = ann({ comment: 'server text', rev: 4 })
    const r = mergeAnnotation(null, local, server)
    expect(r.annotation.comment).toBe('server text')
    expect(r.dropped).toEqual(['comment'])
    expect(r.annotation.status).toBe('in_progress')
    expect(r.annotation.lifecycle).toEqual([created, acknowledged])
    expect(r.annotation.rev).toBe(4)
    expect(r.changed).toBe(true)
  })

  it('with no base, fields equal on both sides are not reported', () => {
    const local = ann({ status: 'in_progress', lifecycle: [created, acknowledged] })
    const server = ann({ rev: 2 })
    const r = mergeAnnotation(null, local, server)
    expect(r.dropped).toEqual([])
    expect(r.annotation.status).toBe('in_progress')
  })
})
