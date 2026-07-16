import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebRemarq } from './web-remarq'
import type { Annotation, AnnotationStore, StorageAdapter, ElementFingerprint } from './core/types'

function outlineWidth(id: string): string {
  const box = document.querySelector(`.remarq-status-outline[data-annotation-id="${id}"]`)
  if (!box) throw new Error(`no outline box for ${id}`)
  return (box as HTMLElement).style.borderWidth
}

function makeAnnotation(id: string, anchorId: string): Annotation {
  return {
    id,
    comment: `Fix ${anchorId}`,
    route: '/',
    viewport: '1024x768',
    viewportBucket: 1000,
    timestamp: 1_700_000_000_000,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null,
      dataTestId: null,
      // Anchors the match to getElementById — no fuzzy scoring in the way.
      id: anchorId,
      tagName: 'button',
      textContent: 'Click me',
      role: null,
      ariaLabel: null,
      stableClasses: [],
      domPath: 'body > button',
      siblingIndex: 0,
      parentAnchor: null,
      rawClasses: [],
      cssModules: [],
      sourceLocation: null,
      componentName: null,
      detectedSource: null,
      detectedComponent: null,
    },
  }
}

/** Serves a fixed set of annotations; writes go nowhere. */
function fakeAdapter(annotations: Annotation[]): StorageAdapter {
  return {
    load: async (): Promise<AnnotationStore | null> => ({ version: 1, annotations }),
    save: async () => {},
    remove: async () => {},
    clear: async () => {},
  }
}

function addButton(anchorId: string): HTMLElement {
  const el = document.createElement('button')
  el.id = anchorId
  el.textContent = 'Click me'
  document.body.appendChild(el)
  return el
}

function markerFor(id: string): HTMLElement {
  const marker = document.querySelector(`.remarq-marker[data-annotation-id="${id}"]`)
  if (!marker) throw new Error(`no marker rendered for ${id}`)
  return marker as HTMLElement
}

/** init() paints markers only after storage.ready resolves. */
async function initAndSettle(annotations: Annotation[]): Promise<void> {
  WebRemarq.init({ storage: fakeAdapter(annotations) })
  await Promise.resolve()
  await Promise.resolve()
}

describe('marker selection highlight wiring', () => {
  beforeEach(() => {
    addButton('target-btn')
  })

  afterEach(() => {
    WebRemarq.destroy()
    document.body.innerHTML = ''
  })

  it('highlights the element when its marker is clicked', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])
    expect(outlineWidth('a1')).toBe('2px')

    markerFor('a1').click()

    expect(outlineWidth('a1')).toBe('4px')
  })

  it('drops the highlight when the same marker toggles the popup shut', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    markerFor('a1').click()

    // This path calls popup.hide() directly, bypassing onClose.
    expect(document.querySelector('.remarq-popup')).toBeNull()
    expect(outlineWidth('a1')).toBe('2px')
  })

  it('drops the highlight when Escape closes the popup', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(outlineWidth('a1')).toBe('2px')
  })

  it('drops the highlight when a click outside closes the popup', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    // The outside-click handler is registered on a setTimeout(0).
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(outlineWidth('a1')).toBe('2px')
  })

  it('moves the highlight when another marker is selected', async () => {
    addButton('other-btn')
    await initAndSettle([makeAnnotation('a1', 'target-btn'), makeAnnotation('a2', 'other-btn')])

    markerFor('a1').click()
    markerFor('a2').click()

    expect(outlineWidth('a1')).toBe('2px')
    expect(outlineWidth('a2')).toBe('4px')
  })
})

function makeSubmitFingerprint(): ElementFingerprint {
  return {
    dataAnnotate: null, dataTestId: null, id: null,
    tagName: 'button', textContent: 'Save', role: null, ariaLabel: null,
    stableClasses: [], domPath: 'body > button', siblingIndex: 0, parentAnchor: null,
    sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
  }
}

function makeDraft(id: string, route: string): Annotation {
  return {
    id, comment: `note ${id}`, fingerprint: makeSubmitFingerprint(),
    route, viewport: '1024x768', viewportBucket: 1000, timestamp: Date.now(),
    status: 'draft',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: Date.now() }],
  }
}

class MemoryAdapter implements StorageAdapter {
  constructor(private annotations: Annotation[]) {}
  saved: Annotation[] = []
  async load(): Promise<AnnotationStore | null> {
    return { version: 1, annotations: this.annotations }
  }
  async save(annotation: Annotation): Promise<void> { this.saved.push(annotation) }
  async remove(): Promise<void> {}
  async clear(): Promise<void> {}
}

describe('WebRemarq.submitDrafts', () => {
  afterEach(() => WebRemarq.destroy())

  it('submits all drafts of the current route and leaves other routes alone', async () => {
    const adapter = new MemoryAdapter([
      makeDraft('d1', '/'),
      makeDraft('d2', '/'),
      makeDraft('d3', '/other'),
    ])
    WebRemarq.init({ submitFlow: true, storage: adapter })
    await new Promise((r) => setTimeout(r, 0))

    const submitted = WebRemarq.submitDrafts()
    expect(submitted).toBe(2)

    const anns = WebRemarq.getAnnotations()
    expect(anns.find((a) => a.id === 'd1')?.status).toBe('pending')
    expect(anns.find((a) => a.id === 'd2')?.status).toBe('pending')
    expect(anns.find((a) => a.id === 'd3')?.status).toBe('draft')
    const d1 = anns.find((a) => a.id === 'd1')!
    expect(d1.lifecycle[d1.lifecycle.length - 1]).toMatchObject({ type: 'submitted', actor: 'designer' })
  })
})
