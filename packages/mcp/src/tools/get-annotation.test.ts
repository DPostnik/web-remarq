import { describe, it, expect, vi } from 'vitest'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { handleGetAnnotation } from './get-annotation'

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'target',
    comment: 'fix button',
    fingerprint: {
      dataAnnotate: null,
      dataTestId: 'save-btn',
      id: null,
      tagName: 'button',
      textContent: 'Save',
      role: null,
      ariaLabel: null,
      stableClasses: ['primary'],
      domPath: 'div>button',
      siblingIndex: 0,
      parentAnchor: null,
      sourceLocation: 'src/Button.tsx:10:4',
      componentName: 'SaveButton',
      detectedSource: null,
      detectedComponent: null,
    },
    route: '/dashboard',
    viewport: '1920x1080',
    viewportBucket: 1900,
    timestamp: 100,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 100 }],
    ...overrides,
  }
}

function mockStorage(annotations: Annotation[]): StorageAdapter {
  return {
    load: vi.fn().mockResolvedValue({ version: 1, annotations }),
    save: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  }
}

describe('get_annotation', () => {
  it('returns full agent-export shape for a found annotation', async () => {
    const storage = mockStorage([ann()])

    const result = await handleGetAnnotation({ id: 'target' }, storage)

    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.id).toBe('target')
    expect(payload.source).toEqual({
      file: 'src/Button.tsx',
      line: 10,
      column: 4,
      component: 'SaveButton',
    })
    expect(payload.searchHints).toBeDefined()
    expect(payload.searchHints.grepQueries.length).toBeGreaterThan(0)
    expect(payload.lifecycle).toEqual([{ type: 'created', actor: 'designer', timestamp: 100 }])
  })

  it('includes qualityCheck when present and omits it otherwise', async () => {
    const qualityCheck = {
      score: 'unactionable' as const,
      issues: ['No concrete change requested'],
      clarifyingQuestions: ['What should change?'],
      suggestedRewrite: 'Align the save button with the input row',
      refinedBy: 'auto' as const,
      timestamp: 200,
    }
    const storage = mockStorage([ann({ qualityCheck }), ann({ id: 'plain' })])

    const withQuality = JSON.parse((await handleGetAnnotation({ id: 'target' }, storage)).content[0].text)
    const withoutQuality = JSON.parse((await handleGetAnnotation({ id: 'plain' }, storage)).content[0].text)

    expect(withQuality.qualityCheck).toEqual(qualityCheck)
    expect('qualityCheck' in withoutQuality).toBe(false)
  })

  it('returns annotation_not_found when id missing', async () => {
    const storage = mockStorage([ann({ id: 'other' })])

    const result = await handleGetAnnotation({ id: 'missing' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('annotation_not_found')
  })

  it('returns storage_error when adapter throws', async () => {
    const storage: StorageAdapter = {
      load: vi.fn().mockRejectedValue(new Error('rls denied')),
      save: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    }

    const result = await handleGetAnnotation({ id: 'x' }, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('storage_error')
  })
})
