import { describe, expect, it } from 'vitest'
import { isSafeAnnotationId, validateAnnotation, validateStore } from './validate'
import type { Annotation } from './types'

function ann(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ann-1',
    comment: 'Fix padding',
    route: '/home',
    viewport: '1280x720',
    viewportBucket: 1200,
    timestamp: 1_700_000_000_000,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: 'Click',
      role: null, ariaLabel: null, stableClasses: ['btn'], domPath: 'div > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
    ...overrides,
  }
}

describe('validateAnnotation', () => {
  it('accepts a well-formed annotation and returns a typed copy', () => {
    const result = validateAnnotation(ann())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.annotation.id).toBe('ann-1')
    expect(result.annotation.qualityCheck).toBeUndefined()
  })

  it('rejects an id-only body (the shape an older server used to persist)', () => {
    const result = validateAnnotation({ id: 'ann-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('\n')).toMatch(/comment: required/)
    expect(result.errors.join('\n')).toMatch(/fingerprint: required object/)
    expect(result.errors.join('\n')).toMatch(/lifecycle: required array/)
  })

  it('rejects an unknown status, a wrong actor, and a missing fingerprint tag', () => {
    expect(validateAnnotation(ann({ status: 'done' }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ lifecycle: [{ type: 'created', actor: 'robot', timestamp: 1 }] }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ fingerprint: { domPath: 'x', siblingIndex: 0, stableClasses: [] } }))).toMatchObject({ ok: false })
  })

  it('rejects unknown top-level fields so version skew is visible', () => {
    const result = validateAnnotation(ann({ owner: 'me' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]).toBe('owner: unknown field')
  })

  it('keeps unknown fingerprint fields (open bag of hints)', () => {
    const result = validateAnnotation(ann({ fingerprint: { ...(ann().fingerprint as object), futureHint: 'x' } }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.annotation.fingerprint as unknown as Record<string, unknown>).futureHint).toBe('x')
  })

  it('enforces size limits on comment, lifecycle length and class arrays', () => {
    expect(validateAnnotation(ann({ comment: 'x'.repeat(10_001) }))).toMatchObject({ ok: false })
    const longLifecycle = Array.from({ length: 501 }, () => ({ type: 'created', actor: 'designer', timestamp: 1 }))
    expect(validateAnnotation(ann({ lifecycle: longLifecycle }))).toMatchObject({ ok: false })
    const fp = { ...(ann().fingerprint as object), stableClasses: Array.from({ length: 201 }, () => 'c') }
    expect(validateAnnotation(ann({ fingerprint: fp }))).toMatchObject({ ok: false })
  })

  it('rejects unsafe ids and validates viewport/timestamp shapes', () => {
    expect(isSafeAnnotationId('../evil')).toBe(false)
    expect(isSafeAnnotationId('.hidden')).toBe(false)
    expect(isSafeAnnotationId('ann-1.2_3')).toBe(true)
    expect(validateAnnotation(ann({ id: '../evil' }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ viewport: 'wide' }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ timestamp: -1 }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ timestamp: 1.5 }))).toMatchObject({ ok: false })
  })

  it('validates an optional qualityCheck and an optional rev', () => {
    const qc = { score: 'clear', issues: [], clarifyingQuestions: [], refinedBy: 'auto', timestamp: 1 }
    expect(validateAnnotation(ann({ qualityCheck: qc, rev: 3 }))).toMatchObject({ ok: true, annotation: { rev: 3 } })
    expect(validateAnnotation(ann({ qualityCheck: { ...qc, score: 'great' } }))).toMatchObject({ ok: false })
    expect(validateAnnotation(ann({ rev: -1 }))).toMatchObject({ ok: false })
  })

  it('rejects non-objects without throwing', () => {
    expect(validateAnnotation(null)).toMatchObject({ ok: false })
    expect(validateAnnotation('x')).toMatchObject({ ok: false })
    expect(validateAnnotation([ann()])).toMatchObject({ ok: false })
  })
})

describe('validateStore', () => {
  it('accepts a valid store and reports the offending index otherwise', () => {
    const good = validateStore({ version: 1, annotations: [ann(), ann({ id: 'ann-2' })] })
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.store.annotations.map((a: Annotation) => a.id)).toEqual(['ann-1', 'ann-2'])

    const bad = validateStore({ version: 1, annotations: [ann(), { id: 'broken' }] })
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.errors[0]).toMatch(/^annotations\[1\]\./)
  })

  it('rejects a wrong version or a non-array annotations field', () => {
    expect(validateStore({ version: 2, annotations: [] })).toMatchObject({ ok: false })
    expect(validateStore({ version: 1, annotations: {} })).toMatchObject({ ok: false })
  })
})
