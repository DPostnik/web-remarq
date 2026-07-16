import { describe, expect, it, vi } from 'vitest'
import { handleWatchAnnotations } from './watch-annotations'
import type { Annotation, AnnotationStore, StorageAdapter } from 'web-remarq'

function ann(id: string, status: Annotation['status']): Annotation {
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

function memoryStorage(initial: Annotation[]): StorageAdapter & { annotations: Annotation[] } {
  const state = { annotations: [...initial] }
  return {
    annotations: state.annotations,
    async load(): Promise<AnnotationStore> {
      return { version: 1, annotations: state.annotations }
    },
    async save(a: Annotation) {
      const idx = state.annotations.findIndex((x) => x.id === a.id)
      if (idx === -1) state.annotations.push(a)
      else state.annotations[idx] = a
    },
    async remove() {},
    async clear() {},
  }
}

function parse(result: { content: Array<{ text: string }> }): { annotations: Array<{ id: string }>; total: number; timedOut: boolean } {
  return JSON.parse(result.content[0].text)
}

describe('watch_annotations', () => {
  it('returns pending annotations immediately when they exist (drafts excluded)', async () => {
    const storage = memoryStorage([ann('d1', 'draft'), ann('p1', 'pending'), ann('v1', 'verified')])
    const waitForChange = vi.fn()
    const result = await handleWatchAnnotations({}, storage, waitForChange)
    const payload = parse(result as never)
    expect(payload.timedOut).toBe(false)
    expect(payload.annotations.map((a) => a.id)).toEqual(['p1'])
    expect(waitForChange).not.toHaveBeenCalled()
  })

  it('wakes up when a change arrives and returns the new pending annotation', async () => {
    const storage = memoryStorage([])
    let fired = false
    const waitForChange = async (): Promise<boolean> => {
      if (!fired) {
        fired = true
        await storage.save(ann('p2', 'pending'))
        return true
      }
      return false
    }
    const result = await handleWatchAnnotations({ timeoutSeconds: 5 }, storage, waitForChange)
    const payload = parse(result as never)
    expect(payload.timedOut).toBe(false)
    expect(payload.annotations.map((a) => a.id)).toEqual(['p2'])
  })

  it('times out with an empty result when nothing becomes pending', async () => {
    const storage = memoryStorage([ann('d1', 'draft')])
    const waitForChange = async (): Promise<boolean> => false
    const result = await handleWatchAnnotations({ timeoutSeconds: 1 }, storage, waitForChange)
    const payload = parse(result as never)
    expect(payload).toEqual({ annotations: [], total: 0, timedOut: true })
  })
})
