import { describe, it, expect, vi } from 'vitest'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { handleDismiss } from './dismiss'

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

describe('dismiss', () => {
  it('dismisses from pending without reason', async () => {
    const { storage, save } = mockStorage([ann()])

    const result = await handleDismiss({ id: 't' }, storage)

    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ ok: true, status: 'dismissed' })
    const [saved] = save.mock.calls[0]
    expect(saved.status).toBe('dismissed')
    expect(saved.lifecycle[1]).toMatchObject({
      type: 'dismissed',
      actor: 'agent',
    })
    expect(saved.lifecycle[1].reason).toBeUndefined()
  })

  it('dismisses with reason recorded in lifecycle event', async () => {
    const { storage, save } = mockStorage([ann()])

    const result = await handleDismiss({ id: 't', reason: 'duplicate of #5' }, storage)

    expect(result.isError).toBeFalsy()
    const [saved] = save.mock.calls[0]
    expect(saved.lifecycle[1]).toMatchObject({
      type: 'dismissed',
      actor: 'agent',
      reason: 'duplicate of #5',
    })
  })

  it('dismisses from in_progress', async () => {
    const { storage } = mockStorage([ann({ status: 'in_progress' })])

    const result = await handleDismiss({ id: 't' }, storage)

    expect(JSON.parse(result.content[0].text).status).toBe('dismissed')
  })

  it('dismisses from fixed_unverified', async () => {
    const { storage } = mockStorage([ann({ status: 'fixed_unverified' })])

    const result = await handleDismiss({ id: 't' }, storage)

    expect(JSON.parse(result.content[0].text).status).toBe('dismissed')
  })

  it('returns invalid_transition from verified', async () => {
    const { storage, save } = mockStorage([ann({ status: 'verified' })])

    const result = await handleDismiss({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('invalid_transition')
    expect(save).not.toHaveBeenCalled()
  })

  it('returns invalid_transition from dismissed (already terminal)', async () => {
    const { storage } = mockStorage([ann({ status: 'dismissed' })])

    const result = await handleDismiss({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).code).toBe('invalid_transition')
  })
})
