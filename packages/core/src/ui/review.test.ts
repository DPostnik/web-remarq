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

  it('shows a single ordinary comment once and keeps distinct target details', () => {
    const review = new ReviewPanel(callbacks)
    const single = { ...item, label: 'make just release', comment: 'make just release' }
    review.update([single], single, true, undefined, false, 1500)
    expect(review.element.textContent?.match(/make just release/g)).toHaveLength(1)
    review.update([item], item, true, undefined, false, 1500)
    expect(review.element.querySelector('.remarq-review-target')?.textContent).toBe(item.markerLabel)
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

  it('reveals clipped targets, keeps the last anchor while outside, and stops superseded scrolling', () => {
    const review = new ReviewPanel(callbacks)
    const near = document.createElement('div')
    const far = document.createElement('div')
    const scroller = document.createElement('div')
    const farItem = { ...item, id: '2' }
    scroller.style.overflowY = 'auto'
    scroller.append(far)
    document.body.append(near, scroller, review.element)
    review.element.hidden = false
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(scroller, 'scrollHeight', 'get').mockReturnValue(1600)
    vi.spyOn(scroller, 'clientHeight', 'get').mockReturnValue(400)
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 1000, 400))
    vi.spyOn(review.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200))
    vi.spyOn(near, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 50, 100, 40))
    const farBounds = vi.spyOn(far, 'getBoundingClientRect').mockReturnValue(new DOMRect(500, 200, 100, 40))
    const scrollFar = vi.fn()
    const scrollNear = vi.fn()
    const stopScroll = vi.fn()
    far.scrollIntoView = scrollFar
    near.scrollIntoView = scrollNear
    scroller.scrollTo = stopScroll
    const select = (active: ReviewItem, target: HTMLElement) => {
      review.update([item, farItem], active, true, target, false, 1500)
      review.reveal()
    }
    try {
      select(item, near)
      select(farItem, far)
      expect(scrollFar).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      expect(review.element.style.left).toBe('80px')
      expect(review.element.style.top).toBe('98px')

      select(item, near)
      expect(stopScroll).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'instant' })
      expect(scrollNear).not.toHaveBeenCalled()

      farBounds.mockReturnValue(new DOMRect(500, 361, 100, 40))
      select(farItem, far)
      expect(scrollFar).toHaveBeenCalledTimes(2)
      farBounds.mockReturnValue(new DOMRect(500, 450, 100, 40))
      window.dispatchEvent(new Event('scroll'))
      expect(review.element.style.left).toBe('500px')
      expect(review.element.style.top).toBe('498px')

      farBounds.mockReturnValue(new DOMRect(500, 350, 100, 500))
      review.reveal()
      expect(scrollFar).toHaveBeenCalledTimes(2)
    } finally {
      review.hide()
    }
  })

  it('scrolls instantly and anchors directly when reduced motion is preferred', () => {
    const review = new ReviewPanel(callbacks)
    const target = document.createElement('div')
    document.body.append(target, review.element)
    review.element.hidden = false
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(review.element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 200))
    const bounds = vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 900, 100, 40))
    const scrollTarget = vi.fn(() => {
      bounds.mockReturnValue(new DOMRect(80, 400, 100, 40))
    })
    target.scrollIntoView = scrollTarget
    try {
      review.update([item], item, true, target, false, 1500)
      review.reveal()
      expect(scrollTarget).toHaveBeenCalledWith({ block: 'center', inline: 'nearest', behavior: 'instant' })
      expect(review.element.hasAttribute('data-remarq-review-moving')).toBe(false)
      expect(review.element.style.top).toBe('448px')
    } finally {
      review.hide()
    }
  })

  it('navigates in both directions without confirming any target', () => {
    const select = vi.fn()
    const review = new ReviewPanel({ ...callbacks, select })
    const items = [item, { ...item, id: '2' }, { ...item, id: '3' }]
    review.update(items, item, true, undefined, false, 1500)
    const buttons = [...review.element.querySelectorAll('button')]
    expect(review.element.querySelector('.remarq-review-position')?.textContent).toBe('1 of 3')
    expect(review.element.querySelector('.remarq-review-mark')).toBeNull()
    buttons.find(b => b.getAttribute('aria-label') === 'Previous fix')!.click()
    buttons.find(b => b.getAttribute('aria-label') === 'Next fix')!.click()
    expect(select.mock.calls).toEqual([['3'], ['2']])
  })

  it('restores unsent corrections when switching targets and discards them on cancel, removal, or close', () => {
    const review = new ReviewPanel(callbacks)
    document.body.append(review.element)
    review.element.hidden = false
    const other = { ...item, id: '2' }
    const update = (active: ReviewItem) => review.update([item, other], active, true, undefined, false, 1500)
    update(item)
    const actions = review.element.querySelector<HTMLElement>('.remarq-review-footer')!
    const open = actions.querySelectorAll('button')[1]
    const reason = review.element.querySelector('textarea')!
    const cancel = review.element.querySelector<HTMLButtonElement>('form button[type="button"]')!
    open.click()
    expect(actions.hidden).toBe(true)
    expect(document.activeElement).toBe(reason)
    reason.value = 'Still clips'
    update(item)
    expect(reason.value).toBe('Still clips')
    cancel.click()
    expect(actions.hidden).toBe(false)
    expect(document.activeElement).toBe(open)
    open.click()
    reason.value = 'Another draft'
    update(other)
    expect(reason.value).toBe('')
    expect(actions.hidden).toBe(false)
    update(item)
    expect(reason.value).toBe('Another draft')
    expect(actions.hidden).toBe(true)

    cancel.click()
    update(other)
    update(item)
    expect(reason.value).toBe('')
    expect(actions.hidden).toBe(false)

    open.click()
    reason.value = 'Submitted'
    review.update([other], other, true, undefined, false, 1500)
    update(item)
    expect(reason.value).toBe('')

    open.click()
    reason.value = 'Not sent'
    update(other)
    review.hide()
    update(item)
    expect(reason.value).toBe('')
    expect(actions.hidden).toBe(false)
  })

  it('restores target details when a scroll container clips the highlighted target', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let reportIntersection: (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof reportIntersection) { reportIntersection = callback }
      observe = observe
      disconnect = disconnect
      takeRecords = () => []
    })
    const review = new ReviewPanel(callbacks)
    const target = document.createElement('div')
    target.style.visibility = 'visible'
    document.body.append(target, review.element)
    review.element.hidden = false
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(80, 50, 100, 40))
    const marked = { ...item, hideMarkerLabelWhenVisible: true }
    review.update([marked], marked, true, target, false, 1500)
    expect(observe).toHaveBeenCalledWith(target)
    const details = review.element.querySelector('.remarq-review-target')!

    expect(details.classList.contains('remarq-review-target--visually-hidden')).toBe(true)
    reportIntersection!([{ target, isIntersecting: true }])
    expect(details.classList.contains('remarq-review-target--visually-hidden')).toBe(true)
    reportIntersection!([{ target, isIntersecting: false }])
    expect(details.classList.contains('remarq-review-target--visually-hidden')).toBe(false)

    disconnect.mockClear()
    review.hide()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
