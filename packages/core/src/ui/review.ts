export interface ReviewItem {
  id: string
  label: string
  comment: string
  route: string
  markerLabel: string
  groupId?: string
  hideMarkerLabelWhenVisible?: boolean
  fixNote?: string
  voice?: { id: string }
}

interface ReviewCallbacks {
  select: (id: string) => void
  confirm: () => void
  reject: (reason: string) => void
  close: () => void
}

const MOTION_SETTLE_MS = 240

export class ReviewPanel {
  readonly element = document.createElement('section')
  private readonly list = document.createElement('ul')
  private readonly body = document.createElement('div')
  private readonly positionText = document.createElement('span')
  private readonly details = document.createElement('p')
  private readonly comment = document.createElement('p')
  private readonly fixNote = document.createElement('p')
  private readonly routeLink = document.createElement('a')
  private readonly confirm: HTMLButtonElement
  private readonly reject: HTMLButtonElement
  private readonly actions = document.createElement('div')
  private readonly correction = document.createElement('form')
  private readonly reason = document.createElement('textarea')
  private readonly sendCorrection: HTMLButtonElement
  private readonly correctionDrafts = new Map<string, string>()
  private activeId = ''
  private activeIndex = -1
  private navigationDirection?: -1 | 1
  private contentMotion?: Animation
  private readonly previous: HTMLButtonElement
  private previousId?: string
  private readonly next: HTMLButtonElement
  private listKey = ''
  private nextId?: string
  private commentId = ''
  private readonly marks = new Map<string, HTMLButtonElement>()
  private target: HTMLElement | undefined
  private highlightTarget: HTMLElement | undefined
  private highlightIntersects?: boolean
  private revealed = false
  private scrollContainers: Element[] = []
  private movingTimeout?: number

  constructor(private readonly callbacks: ReviewCallbacks, private readonly toolbar?: HTMLElement) {
    this.element.className = 'remarq-review'
    this.element.setAttribute('aria-label', 'Review fixes')
    this.element.tabIndex = -1
    this.element.hidden = true

    const header = document.createElement('div')
    header.className = 'remarq-review-header'
    const title = document.createElement('p')
    title.className = 'remarq-review-title'
    title.textContent = 'Review'
    this.positionText.className = 'remarq-review-position'
    this.positionText.setAttribute('role', 'status')
    this.previous = this.iconButton('Previous fix', 'M8 14V2m-5 5 5-5 5 5', () => {
      this.navigate(this.previousId, -1)
    })
    this.next = this.iconButton('Next fix', 'M8 2v12m-5-5 5 5 5-5', () => {
      this.navigate(this.nextId, 1)
    })
    const navigation = document.createElement('div')
    navigation.className = 'remarq-review-navigation'
    navigation.append(this.previous, this.next)
    const close = this.iconButton('Close review', 'm2.5 2.5 11 11m0-11-11 11', callbacks.close)
    close.classList.add('remarq-review-close')
    header.append(title, this.positionText, navigation, close)

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
    this.confirm.className = 'remarq-review-primary'
    this.reject = this.button('Return for correction', () => {
      this.showCorrection()
      this.reason.focus()
      this.position()
    })
    this.correction.className = 'remarq-review-correction'
    this.correction.hidden = true
    const reasonLabel = document.createElement('label')
    reasonLabel.textContent = 'What still needs to change?'
    this.reason.required = true
    this.reason.rows = 2
    reasonLabel.append(this.reason)
    this.sendCorrection = document.createElement('button')
    this.sendCorrection.type = 'submit'
    this.sendCorrection.className = 'remarq-review-primary'
    this.sendCorrection.textContent = 'Send correction'
    const cancel = this.button('Cancel', () => {
      this.correctionDrafts.delete(this.activeId)
      this.resetCorrection()
      this.reject.focus()
      this.position()
    })
    const correctionActions = document.createElement('div')
    correctionActions.className = 'remarq-review-actions'
    correctionActions.append(this.sendCorrection, cancel)
    this.correction.append(reasonLabel, correctionActions)
    this.correction.addEventListener('submit', (event) => {
      event.preventDefault()
      const reason = this.reason.value.trim()
      if (reason && !this.sendCorrection.disabled) callbacks.reject(reason)
      else this.reason.focus()
    })
    this.body.append(this.correction)
    this.actions.className = 'remarq-review-actions remarq-review-footer'
    this.actions.append(this.confirm, this.reject)
    this.element.append(header, this.body, this.actions)
  }

  update(items: ReviewItem[], active: ReviewItem, current: boolean, target: HTMLElement | undefined, busy: boolean, reasonLimit: number): void {
    const choices = active.groupId ? items.filter(({ groupId }) => groupId === active.groupId) : []
    this.list.hidden = choices.length === 0
    const key = JSON.stringify(choices.map(({ id, label }) => [id, label]))
    if (key !== this.listKey) {
      this.listKey = key
      this.marks.clear()
      this.list.replaceChildren(...choices.map(({ id, label }) => {
        const row = document.createElement('li')
        const button = this.button(label, () => this.callbacks.select(id))
        button.className = 'remarq-review-mark'
        this.marks.set(id, button)
        row.append(button)
        return row
      }))
    }
    const currentIndex = items.findIndex(item => item.id === active.id)
    const positionText = `${currentIndex + 1} of ${items.length}`
    if (this.positionText.textContent !== positionText) this.positionText.textContent = positionText
    this.previousId = items[(currentIndex + items.length - 1) % items.length]?.id
    this.nextId = items[(currentIndex + 1) % items.length]?.id
    const voice = active.voice
    const commentId = voice?.id ?? active.id
    if (this.comment.textContent !== active.comment) this.comment.textContent = active.comment
    this.comment.hidden = !active.comment
    for (const [id, mark] of this.marks) {
      mark.setAttribute('aria-pressed', String(id === active.id))
    }
    this.previous.hidden = this.next.hidden = items.length < 2
    this.target = target
    const highlightTarget = active.hideMarkerLabelWhenVisible ? target : undefined
    if (this.highlightTarget !== highlightTarget) {
      this.stopWatchingHighlight()
      this.highlightTarget = highlightTarget
      if (highlightTarget) this.intersectionObserver?.observe(highlightTarget)
    }
    const note = active.fixNote ? `Agent: ${active.fixNote}` : ''
    if (this.fixNote.textContent !== note) this.fixNote.textContent = note
    this.fixNote.hidden = !active.fixNote
    if (this.details.textContent !== active.markerLabel) this.details.textContent = active.markerLabel
    this.confirm.disabled = !current || busy
    this.confirm.textContent = busy ? 'Saving…' : target || !current ? 'Verify' : 'Verify manually'
    if (this.activeId !== active.id || !current) {
      if (!this.correction.hidden) {
        if (this.reason.value) this.correctionDrafts.set(this.activeId, this.reason.value)
        else this.correctionDrafts.delete(this.activeId)
      }
      this.resetCorrection()
    }
    for (const id of this.correctionDrafts.keys()) {
      if (!items.some(item => item.id === id)) this.correctionDrafts.delete(id)
    }
    if (this.revealed && this.activeId !== active.id) {
      this.stopScrolling()
      this.contentMotion?.cancel()
      if (this.startMotion()) {
        const direction = this.navigationDirection ?? Math.sign(currentIndex - this.activeIndex)
        this.contentMotion = this.body.animate?.(
          [{ transform: `translateY(${6 * direction}px)`, opacity: 0.86 }, { transform: 'none', opacity: 1 }],
          { duration: 170, easing: 'ease-out' },
        )
      }
    }
    this.activeId = active.id
    this.activeIndex = currentIndex
    const draft = this.correctionDrafts.get(active.id)
    if (current && this.correction.hidden && draft !== undefined) {
      this.reason.value = draft
      this.showCorrection()
    }
    this.reason.maxLength = reasonLimit
    this.reject.disabled = !current || busy
    this.reason.disabled = this.reject.disabled
    this.sendCorrection.disabled = this.reject.disabled
    this.sendCorrection.textContent = busy ? 'Sending…' : 'Send correction'

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
    const first = activeMark ?? this.element
    first.focus({ preventScroll: true })
  }

  hide(): void {
    this.element.hidden = true
    this.revealed = false
    this.stopScrolling()
    this.stopMotion()
    this.contentMotion?.cancel()
    this.contentMotion = undefined
    this.element.style.removeProperty('left')
    this.element.style.removeProperty('top')
    window.removeEventListener('scroll', this.onScroll, true)
    window.removeEventListener('resize', this.position)
    this.observer?.disconnect()
    this.stopWatchingHighlight()
    this.correctionDrafts.clear()
    this.resetCorrection()
    this.toolbar?.removeAttribute('data-remarq-review-obstructing')
  }

  private resetCorrection(): void {
    this.correction.hidden = true
    this.actions.hidden = false
    this.reason.value = ''
  }

  private showCorrection(): void {
    this.correction.hidden = false
    this.actions.hidden = true
  }

  reveal(): void {
    this.revealed = true
    window.addEventListener('scroll', this.onScroll, true)
    window.addEventListener('resize', this.position)
    const target = this.target
    if (target?.isConnected && !this.targetVisibility(target).revealed) {
      this.stopScrolling()
      const smooth = this.startMotion()
      if (smooth) {
        this.scrollContainers = this.clippingParents(target).map(({ element }) => element)
          .filter((parent) => parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth)
        if (document.scrollingElement) this.scrollContainers.push(document.scrollingElement)
      }
      target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: smooth ? 'smooth' : 'instant' })
    }
    this.observer?.disconnect()
    this.observer?.observe(this.element)
    if (target) this.observer?.observe(target)
    this.position()
  }

  private navigate(id: string | undefined, direction: -1 | 1): void {
    if (!id) return
    this.navigationDirection = direction
    try {
      this.callbacks.select(id)
    } finally {
      this.navigationDirection = undefined
    }
  }

  private clippingParents(target: HTMLElement): { element: Element; x: boolean; y: boolean }[] {
    const parents: { element: Element; x: boolean; y: boolean }[] = []
    const clips = /^(auto|scroll|hidden|clip|overlay)$/
    for (let node: Element | null = target; node;) {
      const root = node.getRootNode()
      const parent: Element | null = node.assignedSlot ?? node.parentElement ?? (root instanceof ShadowRoot ? root.host : null)
      node = parent
      if (!parent || parent === document.scrollingElement) continue
      // The body may supply viewport overflow instead of its own scroll box.
      if (parent === document.body && getComputedStyle(document.documentElement).overflowY === 'visible') continue
      const { overflowX, overflowY } = getComputedStyle(parent)
      const x = clips.test(overflowX)
      const y = clips.test(overflowY)
      if (x || y) parents.push({ element: parent, x, y })
    }
    return parents
  }

  private targetVisibility(target: HTMLElement, box = target.getBoundingClientRect()): { intersecting: boolean; revealed: boolean } {
    const { clientWidth, clientHeight } = document.documentElement
    if (box.width <= 0 || box.height <= 0 || box.right <= 0 || box.bottom <= 0 ||
      box.left >= clientWidth || box.top >= clientHeight) return { intersecting: false, revealed: false }
    let left = 0
    let top = 0
    let right = clientWidth
    let bottom = clientHeight
    for (const { element, x, y } of this.clippingParents(target)) {
      const clip = element.getBoundingClientRect()
      if (x) {
        left = Math.max(left, clip.left)
        right = Math.min(right, clip.right)
      }
      if (y) {
        top = Math.max(top, clip.top)
        bottom = Math.min(bottom, clip.bottom)
      }
    }
    const width = Math.min(right, box.right) - Math.max(left, box.left)
    const height = Math.min(bottom, box.bottom) - Math.max(top, box.top)
    const intersecting = width > 0 && height > 0
    // A target larger than its scrollport is revealed when it fills the available space.
    const revealed = intersecting && width >= Math.min(box.width, right - left) - 0.5 &&
      height >= Math.min(box.height, bottom - top) - 0.5
    return { intersecting, revealed }
  }

  private stopScrolling(): void {
    for (const container of this.scrollContainers) {
      container.scrollTo({ left: container.scrollLeft, top: container.scrollTop, behavior: 'instant' })
    }
    this.scrollContainers = []
  }

  private startMotion(): boolean {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.stopMotion()
      return false
    }
    this.element.setAttribute('data-remarq-review-moving', '')
    this.waitForMotion()
    return true
  }

  private waitForMotion(): void {
    window.clearTimeout(this.movingTimeout)
    this.movingTimeout = window.setTimeout(() => {
      this.scrollContainers = []
      this.stopMotion()
      this.position()
    }, MOTION_SETTLE_MS)
  }

  private stopMotion(): void {
    window.clearTimeout(this.movingTimeout)
    this.movingTimeout = undefined
    this.element.removeAttribute('data-remarq-review-moving')
  }

  private readonly onScroll = (): void => {
    if (this.movingTimeout !== undefined) this.waitForMotion()
    this.position()
  }

  private readonly observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.position())

  private readonly intersectionObserver = typeof IntersectionObserver === 'undefined' ? undefined :
    new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry || entry.target !== this.highlightTarget) return
      this.highlightIntersects = entry.isIntersecting
      this.position()
    })

  private stopWatchingHighlight(): void {
    this.intersectionObserver?.disconnect()
    this.intersectionObserver?.takeRecords()
    this.highlightTarget = undefined
    this.highlightIntersects = undefined
  }

  private readonly position = (): void => {
    if (this.element.hidden) return
    const gap = 8
    const { clientWidth: width, clientHeight: height } = document.documentElement
    const target = this.target?.isConnected ? this.target : undefined
    const box = target?.getBoundingClientRect()
    const inView = target && box && this.targetVisibility(target, box).intersecting
    const hideMarkerLabel = target && target === this.highlightTarget && inView &&
      this.highlightIntersects !== false &&
      (target.checkVisibility?.({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }) ??
        getComputedStyle(target).visibility === 'visible')
    this.details.hidden = !this.details.textContent
    this.details.classList.toggle('remarq-review-target--visually-hidden', Boolean(hideMarkerLabel))
    const panel = this.element.getBoundingClientRect()
    let x = (width - panel.width) / 2
    let y = (height - panel.height) / 2
    if (box && inView) {
      x = box.left
      if (height - box.bottom >= panel.height + 2 * gap) y = box.bottom + gap
      else if (box.top >= panel.height + 2 * gap) y = box.top - panel.height - gap
      else {
        y = box.top
        if (width - box.right >= panel.width + 2 * gap) x = box.right + gap
        else if (box.left >= panel.width + 2 * gap) x = box.left - panel.width - gap
        else y = height - box.bottom >= box.top ? box.bottom + gap : box.top - panel.height - gap
      }
    } else if (box) {
      // Keep the card at its last visible anchor while a distant target scrolls into view.
      x = parseFloat(this.element.style.left) || x
      y = parseFloat(this.element.style.top) || y
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
        (this.movingTimeout !== undefined && overlaps(panel)) ||
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

  private iconButton(label: string, path: string, callback: () => void): HTMLButtonElement {
    const button = this.button('', callback)
    button.className = 'remarq-review-icon'
    button.setAttribute('aria-label', label)
    button.title = label
    button.innerHTML = `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`
    return button
  }
}
