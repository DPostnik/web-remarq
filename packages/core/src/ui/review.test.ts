import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPanel, type ReviewItem } from './review'

const callbacks = { select() {}, confirm() {}, close() {} }
const item: ReviewItem = { id: '1', label: 'Target', route: '/', markerLabel: 'Target', comment: 'Transcript' }

describe('ReviewPanel', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'scrollingElement')
  })

  it('reveals a clipped nested target above the panel with reduced motion', () => {
    const review = new ReviewPanel(callbacks)
    const scroller = document.createElement('div')
    const target = document.createElement('div')
    scroller.appendChild(target)
    document.body.append(scroller, review.element)
    scroller.style.overflowY = 'auto'
    Object.defineProperties(scroller, { clientHeight: { value: 300 }, scrollHeight: { value: 800 } })
    const root = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(2000)
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 1000, 300))
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 1000, 100, 40))
    vi.spyOn(review.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 500, 600, 220))
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    review.update([item], item, true, target, false)
    review.reveal()

    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 270, behavior: 'instant' })
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ left: 0, top: 496, behavior: 'instant' })
  })

  it('keeps a target at the scroll limit clear by moving the panel above it', () => {
    const toolbar = document.createElement('div')
    const review = new ReviewPanel(callbacks, toolbar)
    const target = document.createElement('div')
    document.body.append(target, review.element, toolbar)
    const root = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root })
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(root, 'scrollHeight', 'get').mockReturnValue(800)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 640, 100, 40))
    vi.spyOn(review.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 500, 600, 220))
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(new DOMRect(400, 660, 400, 80))
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    review.update([item], item, true, target, false)

    review.reveal()

    expect(review.element.dataset.remarqClearance).toBe('above')
    expect(toolbar.hasAttribute('data-remarq-review-obstructing')).toBe(true)
    expect(scrollBy).not.toHaveBeenCalled()
    review.hide()
    expect(toolbar.hasAttribute('data-remarq-review-obstructing')).toBe(false)
  })
})
