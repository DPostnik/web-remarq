import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebRemarq } from './web-remarq'
import type { Annotation, AnnotationStore, StorageAdapter } from './core/types'

const SELECTED_OUTLINE = '4px solid #f97316'
const NORMAL_OUTLINE = '2px solid #f97316'

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
  let target: HTMLElement

  beforeEach(() => {
    target = addButton('target-btn')
  })

  afterEach(() => {
    WebRemarq.destroy()
    document.body.innerHTML = ''
  })

  it('highlights the element when its marker is clicked', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])
    expect(target.style.outline).toBe(NORMAL_OUTLINE)

    markerFor('a1').click()

    expect(target.style.outline).toBe(SELECTED_OUTLINE)
  })

  it('drops the highlight when the same marker toggles the popup shut', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    markerFor('a1').click()

    // This path calls popup.hide() directly, bypassing onClose.
    expect(document.querySelector('.remarq-popup')).toBeNull()
    expect(target.style.outline).toBe(NORMAL_OUTLINE)
  })

  it('drops the highlight when Escape closes the popup', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(target.style.outline).toBe(NORMAL_OUTLINE)
  })

  it('drops the highlight when a click outside closes the popup', async () => {
    await initAndSettle([makeAnnotation('a1', 'target-btn')])

    markerFor('a1').click()
    // The outside-click handler is registered on a setTimeout(0).
    await new Promise((resolve) => setTimeout(resolve, 0))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(target.style.outline).toBe(NORMAL_OUTLINE)
  })

  it('moves the highlight when another marker is selected', async () => {
    const second = addButton('other-btn')
    await initAndSettle([makeAnnotation('a1', 'target-btn'), makeAnnotation('a2', 'other-btn')])

    markerFor('a1').click()
    markerFor('a2').click()

    expect(target.style.outline).toBe(NORMAL_OUTLINE)
    expect(second.style.outline).toBe(SELECTED_OUTLINE)
  })
})
