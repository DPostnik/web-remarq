export interface ReviewItem {
  id: string
  label: string
  comment: string
  route: string
  markerLabel: string
  fixNote?: string
  voice?: { id: string }
}

interface ReviewCallbacks {
  select: (id: string) => void
  confirm: () => void
  close: () => void
}

export class ReviewPanel {
  readonly element = document.createElement('section')
  private readonly list = document.createElement('ul')
  private readonly body = document.createElement('div')
  private readonly details = document.createElement('p')
  private readonly comment = document.createElement('p')
  private readonly fixNote = document.createElement('p')
  private readonly routeLink = document.createElement('a')
  private readonly confirm: HTMLButtonElement
  private readonly next: HTMLButtonElement
  private listKey = ''
  private nextId?: string
  private commentId = ''
  private readonly marks = new Map<string, HTMLButtonElement>()
  private target: HTMLElement | undefined

  constructor(private readonly callbacks: ReviewCallbacks, private readonly toolbar?: HTMLElement) {
    this.element.className = 'remarq-review'
    this.element.setAttribute('aria-label', 'Review fixes')
    this.element.hidden = true

    this.list.className = 'remarq-review-fixes'
    this.list.setAttribute('aria-label', 'Fixes to review')
    this.details.className = 'remarq-review-target'
    this.details.setAttribute('role', 'status')
    this.comment.className = 'remarq-review-comment'
    this.fixNote.className = 'remarq-review-note'
    this.body.className = 'remarq-review-body'
    this.body.tabIndex = 0
    this.body.setAttribute('role', 'region')
    this.body.setAttribute('aria-label', 'Fix details')
    this.body.append(this.comment, this.list, this.details, this.routeLink, this.fixNote)

    this.confirm = this.button('Verify', callbacks.confirm)
    this.next = this.button('Next', () => {
      if (this.nextId) callbacks.select(this.nextId)
    })
    const actions = document.createElement('div')
    actions.className = 'remarq-review-actions'
    actions.append(this.confirm, this.next, this.button('Close', callbacks.close))
    this.element.append(this.body, actions)
  }

  update(items: ReviewItem[], active: ReviewItem, current: boolean, target: HTMLElement | undefined, busy: boolean): void {
    const key = JSON.stringify(items.map(({ id, label }) => [id, label]))
    if (key !== this.listKey) {
      this.listKey = key
      this.marks.clear()
      this.list.replaceChildren(...items.map(({ id, label }) => {
        const row = document.createElement('li')
        const button = this.button(label, () => this.callbacks.select(id))
        button.className = 'remarq-review-mark'
        this.marks.set(id, button)
        row.append(button)
        return row
      }))
    }
    const currentIndex = items.findIndex(item => item.id === active.id)
    this.nextId = items[(currentIndex + 1) % items.length]?.id
    const voice = active.voice
    const commentId = voice?.id ?? active.id
    if (this.comment.textContent !== active.comment) this.comment.textContent = active.comment
    for (const [id, mark] of this.marks) {
      mark.setAttribute('aria-pressed', String(id === active.id))
    }
    this.next.disabled = items.length < 2
    this.target = target
    const note = active.fixNote ? `Agent: ${active.fixNote}` : ''
    if (this.fixNote.textContent !== note) this.fixNote.textContent = note
    this.fixNote.hidden = !active.fixNote
    if (this.details.textContent !== active.markerLabel) this.details.textContent = active.markerLabel
    this.details.hidden = !active.markerLabel
    this.confirm.disabled = !current || busy
    this.confirm.textContent = busy ? 'Saving…' : target || !current ? 'Verify' : 'Verify manually'

    const route = !current && /^\/(?!\/)/.test(active.route) ? new URL(active.route, location.origin) : null
    this.routeLink.hidden = !route || route.origin !== location.origin
    if (route && route.origin === location.origin) {
      if (this.routeLink.href !== route.href) {
        this.routeLink.href = route.href
      }
      this.routeLink.textContent = voice ? 'Open target page' : `Open ${active.route}`
    }
    if (this.commentId !== commentId) {
      this.commentId = commentId
      this.body.scrollTop = 0
    }
  }

  focus(): void {
    if (this.element.contains(document.activeElement)) return
    const activeMark = this.list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    const first = activeMark ?? this.body
    first.focus({ preventScroll: true })
  }

  hide(): void {
    this.element.hidden = true
    this.toolbar?.removeAttribute('data-remarq-review-obstructing')
  }

  reveal(): void {
    const target = this.target
    const root = document.scrollingElement
    delete this.element.dataset.remarqClearance
    this.element.style.removeProperty('--remarq-review-room')
    this.toolbar?.removeAttribute('data-remarq-review-obstructing')
    if (!target || !root || !target.isConnected) return
    const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    const box = target.getBoundingClientRect()
    let top = box.top
    let left = box.left
    for (let ancestor = target.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
      const { overflowX, overflowY, direction } = getComputedStyle(ancestor)
      const bounds = ancestor.getBoundingClientRect()
      const x = bounds.left + ancestor.clientLeft
      const y = bounds.top + ancestor.clientTop
      const dx = /^(auto|scroll|hidden|overlay)$/.test(overflowX) && ancestor.scrollWidth > ancestor.clientWidth
        ? scrollDelta(left, box.width, x, x + ancestor.clientWidth) : 0
      const dy = /^(auto|scroll|hidden|overlay)$/.test(overflowY) && ancestor.scrollHeight > ancestor.clientHeight
        ? scrollDelta(top, box.height, y, y + ancestor.clientHeight) : 0
      if (!dx && !dy) continue
      const minX = direction === 'rtl' ? ancestor.clientWidth - ancestor.scrollWidth : 0
      const maxX = minX + ancestor.scrollWidth - ancestor.clientWidth
      const scrollLeft = Math.max(minX, Math.min(maxX, ancestor.scrollLeft + dx))
      const scrollTop = Math.max(0, Math.min(ancestor.scrollHeight - ancestor.clientHeight, ancestor.scrollTop + dy))
      left -= scrollLeft - ancestor.scrollLeft
      top -= scrollTop - ancestor.scrollTop
      ancestor.scrollTo({ left: scrollLeft, top: scrollTop, behavior })
    }

    const panel = this.element.getBoundingClientRect()
    const { clientWidth, clientHeight } = document.documentElement
    const dx = scrollDelta(left, box.width, 0, clientWidth)
    left -= dx
    const overlapsPanel = left < panel.right + 12 && left + box.width > panel.left - 12
    const bottom = overlapsPanel ? panel.top - 12 : clientHeight - 12
    let dy = scrollDelta(top, box.height, 20, bottom)
    const maxScroll = Math.max(0, root.scrollHeight - clientHeight)
    const viewportTop = (delta: number): number => top + root.scrollTop - Math.max(0, Math.min(maxScroll, root.scrollTop + delta))
    const projectedTop = viewportTop(dy)
    // A target at the end of a page may need room the document cannot scroll into.
    if (overlapsPanel && projectedTop < panel.bottom && projectedTop + Math.min(box.height, 40) > panel.top) {
      const topInset = clientHeight * 0.1
      const roomAbove = projectedTop - topInset - 12
      const roomBelow = panel.bottom - projectedTop - Math.min(box.height, 40) - 12
      if (roomAbove >= roomBelow && roomAbove >= 152) {
        const height = Math.min(panel.height, roomAbove)
        this.element.dataset.remarqClearance = 'above'
        this.element.style.setProperty('--remarq-review-room', `${height}px`)
        dy = scrollDelta(top, box.height, topInset + height + 12, clientHeight - 12)
      } else if (roomBelow >= 152) {
        this.element.style.setProperty('--remarq-review-room', `${roomBelow}px`)
        dy = scrollDelta(top, box.height, 20, panel.bottom - roomBelow - 12)
      }
    }
    const toolbar = this.toolbar?.getBoundingClientRect()
    if (toolbar) {
      const finalTop = viewportTop(dy)
      const finalPanel = this.element.getBoundingClientRect()
      const overlapsTarget = left < toolbar.right && left + box.width > toolbar.left &&
        finalTop < toolbar.bottom && finalTop + box.height > toolbar.top
      const overlapsReview = finalPanel.left < toolbar.right && finalPanel.right > toolbar.left &&
        finalPanel.top < toolbar.bottom && finalPanel.bottom > toolbar.top
      if (overlapsTarget || overlapsReview) {
        this.toolbar?.setAttribute('data-remarq-review-obstructing', '')
      }
    }
    if (dx || dy) window.scrollBy({ left: dx, top: dy, behavior })
  }

  private button(label: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', callback)
    return button
  }
}

function scrollDelta(start: number, size: number, min: number, max: number): number {
  if (start >= min && start + size <= max) return 0
  return start - min - Math.max(0, (max - min - size) / 2)
}
