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
  reject: (reason: string) => void
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
  private readonly reject: HTMLButtonElement
  private readonly correction = document.createElement('form')
  private readonly reason = document.createElement('textarea')
  private readonly sendCorrection: HTMLButtonElement
  private activeId = ''
  private readonly previous: HTMLButtonElement
  private previousId?: string
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
    this.reject = this.button('Return for correction', () => {
      this.correction.hidden = false
      this.reject.setAttribute('aria-expanded', 'true')
      this.reason.focus()
    })
    this.reject.setAttribute('aria-expanded', 'false')
    this.correction.className = 'remarq-review-correction'
    this.correction.hidden = true
    const reasonLabel = document.createElement('label')
    reasonLabel.textContent = 'What still needs to change?'
    this.reason.required = true
    this.reason.rows = 2
    reasonLabel.append(this.reason)
    this.sendCorrection = document.createElement('button')
    this.sendCorrection.type = 'submit'
    this.sendCorrection.textContent = 'Send correction'
    const cancel = this.button('Cancel', () => {
      this.resetCorrection()
      this.reject.focus()
    })
    this.correction.append(reasonLabel, this.sendCorrection, cancel)
    this.correction.addEventListener('submit', (event) => {
      event.preventDefault()
      const reason = this.reason.value.trim()
      if (reason && !this.reject.disabled) callbacks.reject(reason)
      else this.reason.focus()
    })
    this.body.append(this.correction)
    this.previous = this.button('Previous', () => {
      if (this.previousId) callbacks.select(this.previousId)
    })
    this.next = this.button('Next', () => {
      if (this.nextId) callbacks.select(this.nextId)
    })
    const actions = document.createElement('div')
    actions.className = 'remarq-review-actions'
    actions.append(this.confirm, this.reject, this.previous, this.next, this.button('Close', callbacks.close))
    this.element.append(this.body, actions)
  }

  update(items: ReviewItem[], active: ReviewItem, current: boolean, target: HTMLElement | undefined, busy: boolean, reasonLimit: number): void {
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
    this.previousId = items[(currentIndex + items.length - 1) % items.length]?.id
    this.nextId = items[(currentIndex + 1) % items.length]?.id
    const voice = active.voice
    const commentId = voice?.id ?? active.id
    if (this.comment.textContent !== active.comment) this.comment.textContent = active.comment
    for (const [id, mark] of this.marks) {
      mark.setAttribute('aria-pressed', String(id === active.id))
    }
    this.previous.hidden = this.next.hidden = items.length < 2
    this.target = target
    const note = active.fixNote ? `Agent: ${active.fixNote}` : ''
    if (this.fixNote.textContent !== note) this.fixNote.textContent = note
    this.fixNote.hidden = !active.fixNote
    if (this.details.textContent !== active.markerLabel) this.details.textContent = active.markerLabel
    this.details.hidden = !active.markerLabel
    this.confirm.disabled = !current || busy
    this.confirm.textContent = busy ? 'Saving…' : target || !current ? 'Verify' : 'Verify manually'
    if (this.activeId !== active.id || !current) this.resetCorrection()
    this.activeId = active.id
    this.reason.maxLength = reasonLimit
    this.reject.disabled = !current || busy
    this.reason.disabled = this.reject.disabled
    this.sendCorrection.disabled = this.reject.disabled

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
    this.position()
  }

  focus(): void {
    if (this.element.contains(document.activeElement)) return
    const activeMark = this.list.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    const first = activeMark ?? this.body
    first.focus({ preventScroll: true })
  }

  hide(): void {
    this.element.hidden = true
    window.removeEventListener('scroll', this.position, true)
    window.removeEventListener('resize', this.position)
    this.observer?.disconnect()
    this.resetCorrection()
    this.toolbar?.removeAttribute('data-remarq-review-obstructing')
  }

  private resetCorrection(): void {
    this.correction.hidden = true
    this.reason.value = ''
    this.reject.setAttribute('aria-expanded', 'false')
  }

  reveal(): void {
    const target = this.target
    if (target?.isConnected) {
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
    window.addEventListener('scroll', this.position, true)
    window.addEventListener('resize', this.position)
    this.observer?.disconnect()
    this.observer?.observe(this.element)
    if (target) this.observer?.observe(target)
    this.position()
  }

  private readonly observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.position())

  private readonly position = (): void => {
    if (this.element.hidden) return
    const gap = 8
    const { clientWidth: width, clientHeight: height } = document.documentElement
    const panel = this.element.getBoundingClientRect()
    const box = this.target?.isConnected ? this.target.getBoundingClientRect() : undefined
    let x = (width - panel.width) / 2
    let y = (height - panel.height) / 2
    if (box) {
      x = box.left
      if (height - box.bottom >= panel.height + 2 * gap) y = box.bottom + gap
      else if (box.top >= panel.height + 2 * gap) y = box.top - panel.height - gap
      else {
        y = box.top
        if (width - box.right >= panel.width + 2 * gap) x = box.right + gap
        else if (box.left >= panel.width + 2 * gap) x = box.left - panel.width - gap
        else y = height - box.bottom >= box.top ? box.bottom + gap : box.top - panel.height - gap
      }
    }
    const left = Math.max(gap, Math.min(x, width - panel.width - gap))
    const top = Math.max(gap, Math.min(y, height - panel.height - gap))
    this.element.style.left = left + 'px'
    this.element.style.top = top + 'px'
    const bar = this.toolbar?.getBoundingClientRect()
    if (bar) {
      const overlaps = (r: DOMRect | DOMRectReadOnly) =>
        r.left < bar.right && r.right > bar.left && r.top < bar.bottom && r.bottom > bar.top
      this.toolbar?.toggleAttribute('data-remarq-review-obstructing',
        overlaps(new DOMRect(left, top, panel.width, panel.height)) || !!box && overlaps(box))
    }
  }

  private button(label: string, callback: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', callback)
    return button
  }
}
