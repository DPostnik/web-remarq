import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MarkerManager } from './markers'
import type { Annotation } from '../core/types'

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    comment: 'Fix padding',
    route: '/home',
    viewport: '1280x720',
    viewportBucket: 1200,
    timestamp: 1_700_000_000_000,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null,
      dataTestId: null,
      id: null,
      tagName: 'button',
      textContent: 'Click me',
      role: null,
      ariaLabel: null,
      stableClasses: ['btn'],
      domPath: 'div > button',
      siblingIndex: 0,
      parentAnchor: null,
      rawClasses: ['btn'],
      cssModules: [],
      sourceLocation: null,
      componentName: null,
      detectedSource: null,
      detectedComponent: null,
    },
    ...overrides,
  }
}

/** Stub a target's layout: jsdom has none, so every rect would read as zeros. */
function makeTarget(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect }) as DOMRect
  document.body.appendChild(el)
  return el
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
}

describe('MarkerManager positioning', () => {
  let container: HTMLElement
  let markers: MarkerManager

  beforeEach(() => {
    setViewport(1440, 900)
    container = document.createElement('div')
    document.body.appendChild(container)
    markers = new MarkerManager(container)
  })

  afterEach(() => {
    markers.destroy()
    container.remove()
    document.body.innerHTML = ''
  })

  it('hangs the marker on the element top-right corner when there is room', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation(), target)

    const marker = container.querySelector('.remarq-marker') as HTMLElement
    // right - MARKER_OFFSET, top - MARKER_OFFSET
    expect(marker.style.left).toBe('288px')
    expect(marker.style.top).toBe('188px')
  })

  it('pins the marker inside the viewport when the element is flush right', () => {
    const target = makeTarget({ top: 100, left: 0, right: 1440, bottom: 400 })
    markers.addMarker(makeAnnotation(), target)

    const marker = container.querySelector('.remarq-marker') as HTMLElement
    // Unpinned this would be 1428px and hang half off-screen.
    expect(marker.style.left).toBe('1408px')
  })

  it('leaves the position alone while the viewport reports zero width', () => {
    setViewport(0, 0)
    const target = makeTarget({ top: 100, left: 0, right: 1440, bottom: 400 })
    markers.addMarker(makeAnnotation(), target)

    const marker = container.querySelector('.remarq-marker') as HTMLElement
    // Pinning against a 0-wide viewport would slam it to the left margin.
    expect(marker.style.left).toBe('1428px')
  })

  it('exposes the marker rect so the popup can anchor to it', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)

    expect(markers.getMarkerRect('a1')).not.toBeNull()
    expect(markers.getMarkerRect('missing')).toBeNull()
  })
})

describe('MarkerManager selection', () => {
  let container: HTMLElement
  let markers: MarkerManager

  beforeEach(() => {
    setViewport(1440, 900)
    container = document.createElement('div')
    document.body.appendChild(container)
    markers = new MarkerManager(container)
  })

  afterEach(() => {
    markers.destroy()
    container.remove()
    document.body.innerHTML = ''
  })

  it('thickens the outline of the selected element', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)

    expect(target.style.outline).toBe('2px solid #f97316')

    markers.setSelected('a1')

    expect(target.style.outline).toBe('4px solid #f97316')
    expect(target.style.outlineOffset).toBe('3px')
  })

  it('moves the highlight and unlights the previous element', () => {
    const first = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    const second = makeTarget({ top: 400, left: 200, right: 300, bottom: 440 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), first)
    markers.addMarker(makeAnnotation({ id: 'a2' }), second)

    markers.setSelected('a1')
    markers.setSelected('a2')

    expect(first.style.outline).toBe('2px solid #f97316')
    expect(first.style.outlineOffset).toBe('2px')
    expect(second.style.outline).toBe('4px solid #f97316')
  })

  it('drops the highlight on setSelected(null)', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)

    markers.setSelected('a1')
    markers.setSelected(null)

    expect(target.style.outline).toBe('2px solid #f97316')
    expect(target.style.outlineOffset).toBe('2px')
  })

  it('keeps the element highlighted when its status changes', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)

    markers.setSelected('a1')
    markers.updateStatus('a1', 'verified')

    // Colour follows the new status, thickness still marks it as selected.
    expect(target.style.outline).toBe('4px solid #22c55e')
  })

  it('survives a refresh that rebuilds every marker', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)
    markers.setSelected('a1')

    // What refreshMarkers() does: wipe, then re-add from storage.
    markers.clear()
    const rebuilt = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), rebuilt)

    expect(rebuilt.style.outline).toBe('4px solid #f97316')
  })

  it('leaves an unselected element at the normal outline after a refresh', () => {
    const target = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), target)
    markers.setSelected('a1')
    markers.setSelected(null)

    markers.clear()
    const rebuilt = makeTarget({ top: 200, left: 200, right: 300, bottom: 240 })
    markers.addMarker(makeAnnotation({ id: 'a1' }), rebuilt)

    expect(rebuilt.style.outline).toBe('2px solid #f97316')
  })
})
