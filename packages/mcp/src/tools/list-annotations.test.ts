import { describe, it, expect, vi } from 'vitest'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { handleListAnnotations } from './list-annotations'

function fp(overrides: Partial<Annotation['fingerprint']> = {}): Annotation['fingerprint'] {
  return {
    dataAnnotate: null,
    dataTestId: null,
    id: null,
    tagName: 'div',
    textContent: null,
    role: null,
    ariaLabel: null,
    stableClasses: [],
    domPath: 'div',
    siblingIndex: 0,
    parentAnchor: null,
    sourceLocation: null,
    componentName: null,
    detectedSource: null,
    detectedComponent: null,
    ...overrides,
  }
}

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'x',
    comment: 'c',
    fingerprint: fp(),
    route: '/r',
    viewport: '1920x1080',
    viewportBucket: 1900,
    timestamp: 1,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
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

describe('list_annotations', () => {
  it('returns all annotations with thin shape when no filters', async () => {
    const storage = mockStorage([
      ann({ id: 'a', route: '/dashboard', status: 'pending' }),
      ann({ id: 'b', route: '/settings', status: 'verified' }),
    ])

    const result = await handleListAnnotations({}, storage)

    const payload = JSON.parse(result.content[0].text)
    expect(payload.total).toBe(2)
    expect(payload.annotations).toHaveLength(2)
    expect(payload.annotations[0]).toEqual({
      id: 'a',
      route: '/dashboard',
      comment: 'c',
      status: 'pending',
      viewport: 1900,
      timestamp: 1,
      source: null,
    })
  })

  it('filters by exact route match', async () => {
    const storage = mockStorage([
      ann({ id: 'a', route: '/dashboard' }),
      ann({ id: 'b', route: '/settings' }),
    ])

    const result = await handleListAnnotations({ route: '/dashboard' }, storage)
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations).toHaveLength(1)
    expect(payload.annotations[0].id).toBe('a')
  })

  it('filters by single status', async () => {
    const storage = mockStorage([
      ann({ id: 'a', status: 'pending' }),
      ann({ id: 'b', status: 'verified' }),
      ann({ id: 'c', status: 'dismissed' }),
    ])

    const result = await handleListAnnotations({ status: 'pending' }, storage)
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations).toHaveLength(1)
    expect(payload.annotations[0].id).toBe('a')
  })

  it('filters by array of statuses', async () => {
    const storage = mockStorage([
      ann({ id: 'a', status: 'pending' }),
      ann({ id: 'b', status: 'verified' }),
      ann({ id: 'c', status: 'dismissed' }),
    ])

    const result = await handleListAnnotations(
      { status: ['pending', 'verified'] },
      storage,
    )
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations.map((a: { id: string }) => a.id).sort()).toEqual(['a', 'b'])
  })

  it('filters by viewportBucket exact match', async () => {
    const storage = mockStorage([
      ann({ id: 'a', viewportBucket: 1900 }),
      ann({ id: 'b', viewportBucket: 1000 }),
    ])

    const result = await handleListAnnotations({ viewportBucket: 1900 }, storage)
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations).toHaveLength(1)
    expect(payload.annotations[0].id).toBe('a')
  })

  it('filters by file substring against source.file', async () => {
    const storage = mockStorage([
      ann({ id: 'a', fingerprint: fp({ sourceLocation: 'src/components/Button.tsx:5:10', componentName: 'Button' }) }),
      ann({ id: 'b', fingerprint: fp({ sourceLocation: 'src/pages/Home.tsx:1:1', componentName: 'Home' }) }),
      ann({ id: 'c' }),
    ])

    const result = await handleListAnnotations({ file: 'components' }, storage)
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations).toHaveLength(1)
    expect(payload.annotations[0].id).toBe('a')
    expect(payload.annotations[0].source).toEqual({
      file: 'src/components/Button.tsx',
      line: 5,
      column: 10,
      component: 'Button',
    })
  })

  it('respects limit (default 50, max 200)', async () => {
    const many = Array.from({ length: 75 }, (_, i) => ann({ id: `a${i}` }))
    const storage = mockStorage(many)

    const result = await handleListAnnotations({}, storage)
    const payload = JSON.parse(result.content[0].text)

    expect(payload.annotations).toHaveLength(50)
    expect(payload.total).toBe(75)
  })

  it('returns storage_error when adapter throws', async () => {
    const storage: StorageAdapter = {
      load: vi.fn().mockRejectedValue(new Error('network down')),
      save: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    }

    const result = await handleListAnnotations({}, storage)

    expect(result.isError).toBe(true)
    const payload = JSON.parse(result.content[0].text)
    expect(payload.code).toBe('storage_error')
    expect(payload.message).toContain('network down')
  })
})
