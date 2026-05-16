import { describe, it, expect, vi } from 'vitest'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { handleClaimFix } from './claim-fix'

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 't',
    comment: 'c',
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'div',
      textContent: null, role: null, ariaLabel: null,
      stableClasses: [], domPath: 'div', siblingIndex: 0, parentAnchor: null,
      sourceLocation: null, componentName: null,
      detectedSource: null, detectedComponent: null,
    },
    route: '/r',
    viewport: '1920x1080',
    viewportBucket: 1900,
    timestamp: 100,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 100 }],
    ...overrides,
  }
}

function mockStorage(annotations: Annotation[]) {
  const save = vi.fn().mockResolvedValue(undefined)
  return {
    storage: {
      load: vi.fn().mockResolvedValue({ version: 1, annotations }),
      save,
      remove: vi.fn(),
      clear: vi.fn(),
    } as StorageAdapter,
    save,
  }
}

describe('claim_fix', () => {
  it('transitions pending → fixed_unverified', async () => {
    const { storage, save } = mockStorage([ann({ status: 'pending' })])

    const result = await handleClaimFix({ id: 't' }, storage)

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ ok: true, status: 'fixed_unverified' })
    const [saved] = save.mock.calls[0]
    expect(saved.status).toBe('fixed_unverified')
    expect(saved.lifecycle[1]).toMatchObject({ type: 'fix_claimed', actor: 'agent' })
  })

  it('transitions in_progress → fixed_unverified', async () => {
    const { storage, save } = mockStorage([ann({ status: 'in_progress' })])

    const result = await handleClaimFix({ id: 't' }, storage)

    const payload = JSON.parse(result.content[0].text)
    expect(payload.status).toBe('fixed_unverified')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('returns invalid_transition from verified', async () => {
    const { storage, save } = mockStorage([ann({ status: 'verified' })])

    const result = await handleClaimFix({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('invalid_transition')
    expect(payload.details.currentStatus).toBe('verified')
    expect(save).not.toHaveBeenCalled()
  })

  it('returns invalid_transition from dismissed', async () => {
    const { storage } = mockStorage([ann({ status: 'dismissed' })])

    const result = await handleClaimFix({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('invalid_transition')
  })

  it('returns annotation_not_found when id missing', async () => {
    const { storage } = mockStorage([ann({ id: 'other' })])

    const result = await handleClaimFix({ id: 'missing' }, storage)

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('annotation_not_found')
  })
})
