import { describe, it, expect, vi } from 'vitest'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { handleAcknowledge } from './acknowledge'

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

describe('acknowledge', () => {
  it('transitions pending → in_progress and saves with appended lifecycle event', async () => {
    const { storage, save } = mockStorage([ann()])

    const result = await handleAcknowledge({ id: 't' }, storage)

    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({ ok: true, status: 'in_progress' })

    expect(save).toHaveBeenCalledTimes(1)
    const [saved] = save.mock.calls[0]
    expect(saved.status).toBe('in_progress')
    expect(saved.lifecycle).toHaveLength(2)
    expect(saved.lifecycle[1]).toMatchObject({
      type: 'acknowledged',
      actor: 'agent',
    })
    expect(typeof saved.lifecycle[1].timestamp).toBe('number')
  })

  it('returns invalid_transition when status is already in_progress', async () => {
    const { storage, save } = mockStorage([ann({ status: 'in_progress' })])

    const result = await handleAcknowledge({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('invalid_transition')
    expect(payload.details).toMatchObject({ currentStatus: 'in_progress' })
    expect(save).not.toHaveBeenCalled()
  })

  it('returns annotation_not_found when id missing', async () => {
    const { storage, save } = mockStorage([ann({ id: 'other' })])

    const result = await handleAcknowledge({ id: 'missing' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('annotation_not_found')
    expect(save).not.toHaveBeenCalled()
  })

  it('returns storage_error when load throws', async () => {
    const storage: StorageAdapter = {
      load: vi.fn().mockRejectedValue(new Error('network down')),
      save: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    }

    const result = await handleAcknowledge({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('storage_error')
  })

  it('returns storage_error when save throws', async () => {
    const { storage } = mockStorage([ann()])
    ;(storage.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('save failed'))

    const result = await handleAcknowledge({ id: 't' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('storage_error')
    expect(payload.message).toContain('save failed')
  })
})
