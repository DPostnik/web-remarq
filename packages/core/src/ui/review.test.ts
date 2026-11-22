import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPanel, type ReviewItem } from './review'

const callbacks = { select() {}, confirm() {}, reject() {}, close() {} }
const item: ReviewItem = { id: '1', label: 'Target', route: '/', markerLabel: 'Target', comment: 'Transcript' }

describe('ReviewPanel', () => {
  afterEach(() => {
    document.body.replaceChildren()
    localStorage.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'scrollingElement')
  })

  it('anchors below the selected target and flips above it after scrolling', () => {
    const review = new ReviewPanel(callbacks)
    const target = document.createElement('div')
    document.body.append(target, review.element)
    review.element.hidden = false
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(review.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200))
    const bounds = vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 50, 100, 40))
    review.update([item], item, true, target, false, 1500)
    review.reveal()
    expect(review.element.style.top).toBe('98px')
    expect(review.element.style.left).toBe('80px')

    bounds.mockReturnValue(new DOMRect(900, 650, 100, 40))
    window.dispatchEvent(new Event('scroll'))
    expect(review.element.style.top).toBe('442px')
    expect(review.element.style.left).toBe('692px')
    review.hide()
  })

  it('navigates in both directions without confirming any target', () => {
    const select = vi.fn()
    const review = new ReviewPanel({ ...callbacks, select })
    const items = [item, { ...item, id: '2' }, { ...item, id: '3' }]
    review.update(items, item, true, undefined, false, 1500)
    const buttons = [...review.element.querySelectorAll('button')]
    buttons.find(b => b.textContent === 'Previous')!.click()
    buttons.find(b => b.textContent === 'Next')!.click()
    expect(select.mock.calls).toEqual([['3'], ['2']])
  })
})
