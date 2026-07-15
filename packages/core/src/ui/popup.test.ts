import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { Popup } from './popup'
import type { DetailInfo } from './popup'

function makeInfo(overrides: Partial<DetailInfo> = {}): DetailInfo {
  return {
    id: 'ann-1',
    tag: 'button',
    text: 'Save',
    comment: 'Increase padding',
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 0 }],
    ...overrides,
  }
}

const POSITION = { top: 100, left: 100, anchorBottom: 80 }

const NOOP_CALLBACKS = {
  onTransition: () => {},
  onDelete: () => {},
  onClose: () => {},
  onEdit: () => {},
  onCopy: () => {},
}

function makeMarker(id: string): HTMLElement {
  const marker = document.createElement('div')
  marker.className = 'remarq-marker'
  marker.setAttribute('data-annotation-id', id)
  document.body.appendChild(marker)
  return marker
}

function clickOn(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

// The outside-click handler is registered in a setTimeout(0), so tests must let
// the macrotask queue drain before simulating clicks.
function flushTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Popup detail view', () => {
  let container: HTMLElement
  let popup: Popup

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    popup = new Popup(container)
  })

  afterEach(() => {
    popup.destroy()
    document.body.innerHTML = ''
  })

  const isOpen = () => container.querySelector('.remarq-popup') !== null

  it('opens on showDetail', () => {
    popup.showDetail(makeInfo(), POSITION, NOOP_CALLBACKS)
    expect(isOpen()).toBe(true)
  })

  it('reports which annotation it is open for', () => {
    popup.showDetail(makeInfo({ id: 'ann-1' }), POSITION, NOOP_CALLBACKS)
    expect(popup.isOpenFor('ann-1')).toBe(true)
    expect(popup.isOpenFor('ann-2')).toBe(false)
  })

  it('is not open for any annotation after hide', () => {
    popup.showDetail(makeInfo({ id: 'ann-1' }), POSITION, NOOP_CALLBACKS)
    popup.hide()
    expect(popup.isOpenFor('ann-1')).toBe(false)
  })

  it('stays open when its own marker is pressed, so the click can toggle it', async () => {
    const marker = makeMarker('ann-1')
    popup.showDetail(makeInfo({ id: 'ann-1' }), POSITION, NOOP_CALLBACKS)
    await flushTimers()

    clickOn(marker)

    // The owning marker is not "outside" — the popup must survive mousedown and
    // still report itself open, so the marker's click handler can close it.
    expect(popup.isOpenFor('ann-1')).toBe(true)
    expect(isOpen()).toBe(true)
  })

  it('closes when a different annotation marker is pressed', async () => {
    const other = makeMarker('ann-2')
    popup.showDetail(makeInfo({ id: 'ann-1' }), POSITION, NOOP_CALLBACKS)
    await flushTimers()

    clickOn(other)

    expect(isOpen()).toBe(false)
  })

  it('closes on a click outside the popup', async () => {
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    popup.showDetail(makeInfo(), POSITION, NOOP_CALLBACKS)
    await flushTimers()

    clickOn(outside)

    expect(isOpen()).toBe(false)
  })

  it('stays open on a click inside the popup', async () => {
    popup.showDetail(makeInfo(), POSITION, NOOP_CALLBACKS)
    await flushTimers()

    const inside = container.querySelector('.remarq-popup-body') as HTMLElement
    clickOn(inside)

    expect(isOpen()).toBe(true)
  })
})
