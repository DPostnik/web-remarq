interface ElementInfo {
  tag: string
  text: string
}

import type { AnnotationEvent, AnnotationStatus } from '../core/types'
import type { LifecycleAction } from '../core/lifecycle'

interface DetailInfo extends ElementInfo {
  comment: string
  status: AnnotationStatus
  lifecycle: AnnotationEvent[]
}

interface DetailCallbacks {
  onTransition: (action: LifecycleAction, reason?: string) => void
  onDelete: () => void
  onClose: () => void
  onEdit: (newComment: string) => void
  onCopy: () => void
}

const STATUS_LABEL: Record<AnnotationStatus, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  fixed_unverified: 'Fix claimed',
  verified: 'Verified',
  dismissed: 'Dismissed',
}

const EVENT_LABEL: Record<AnnotationEvent['type'], string> = {
  created: 'Created',
  acknowledged: 'In progress',
  fix_claimed: 'Fix claimed',
  verified: 'Verified',
  rejected: 'Rejected',
  dismissed: 'Dismissed',
  reopened: 'Reopened',
  migrated: 'Migrated',
}

interface ActionDef {
  label: string
  action: LifecycleAction
  needsReason?: boolean
  primary?: boolean
}

function actionsForStatus(status: AnnotationStatus): ActionDef[] {
  switch (status) {
    case 'pending':
      return [
        { label: 'Acknowledge', action: 'acknowledge', primary: true },
        { label: 'Dismiss', action: 'dismiss', needsReason: true },
      ]
    case 'in_progress':
      return [
        { label: 'Mark verified', action: 'verify', primary: true },
        { label: 'Dismiss', action: 'dismiss', needsReason: true },
      ]
    case 'fixed_unverified':
      return [
        { label: 'Verify', action: 'verify', primary: true },
        { label: 'Reject', action: 'reject', needsReason: true },
        { label: 'Dismiss', action: 'dismiss', needsReason: true },
      ]
    case 'verified':
      return [{ label: 'Reopen', action: 'reopen' }]
    case 'dismissed':
      return [{ label: 'Reopen', action: 'reopen' }]
  }
}

interface Position {
  top: number        // absolute page Y below the element
  left: number       // absolute page X
  anchorBottom: number // absolute page Y above the element (for flipping)
}

const POPUP_WIDTH = 300
const POPUP_MARGIN = 8

export class Popup {
  private popupEl: HTMLElement | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private outsideClickHandler: ((e: MouseEvent) => void) | null = null
  private pendingEditFlush: (() => void) | null = null

  constructor(private container: HTMLElement) {}

  show(
    info: ElementInfo,
    position: Position,
    onSubmit: (comment: string) => void,
    onCancel: () => void,
  ): void {
    this.hide()

    const popup = document.createElement('div')
    popup.className = 'remarq-popup'

    const header = document.createElement('div')
    header.className = 'remarq-popup-header'
    header.textContent = `<${info.tag}>${info.text ? ` "${info.text}"` : ''}`

    const body = document.createElement('div')
    body.className = 'remarq-popup-body'

    const textarea = document.createElement('textarea')
    textarea.placeholder = 'Add your comment...'

    const hint = document.createElement('div')
    hint.className = 'remarq-popup-hint'
    hint.textContent = 'Enter to submit \u00b7 Shift+Enter for new line'

    body.appendChild(textarea)
    body.appendChild(hint)

    const actions = document.createElement('div')
    actions.className = 'remarq-popup-actions'

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = 'Cancel'
    cancelBtn.addEventListener('click', () => {
      this.hide()
      onCancel()
    })

    const addBtn = document.createElement('button')
    addBtn.className = 'remarq-primary'
    addBtn.textContent = 'Add'
    addBtn.addEventListener('click', () => {
      const comment = textarea.value.trim()
      if (!comment) return
      this.hide()
      onSubmit(comment)
    })

    actions.appendChild(cancelBtn)
    actions.appendChild(addBtn)

    popup.appendChild(header)
    popup.appendChild(body)
    popup.appendChild(actions)

    this.container.appendChild(popup)
    this.popupEl = popup

    // Measure after layout, then position
    requestAnimationFrame(() => {
      this.adjustPosition(popup, position)
      textarea.focus()
    })

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide()
        onCancel()
        return
      }
      // Enter submits from textarea (Shift+Enter = newline)
      if (e.key === 'Enter' && !e.shiftKey && e.target === textarea) {
        e.preventDefault()
        const comment = textarea.value.trim()
        if (!comment) return
        this.hide()
        onSubmit(comment)
        return
      }
      // Keep Cmd/Ctrl+Enter as alternative
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const comment = textarea.value.trim()
        if (!comment) return
        this.hide()
        onSubmit(comment)
      }
    }
    document.addEventListener('keydown', this.keyHandler)

    setTimeout(() => {
      this.outsideClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (target && !target.closest('.remarq-popup')) {
          this.hide()
          onCancel()
        }
      }
      document.addEventListener('mousedown', this.outsideClickHandler)
    }, 0)
  }

  showDetail(
    info: DetailInfo,
    position: Position,
    callbacks: DetailCallbacks,
  ): void {
    this.hide()

    const popup = document.createElement('div')
    popup.className = 'remarq-popup'

    const header = document.createElement('div')
    header.className = 'remarq-popup-header'
    header.textContent =
      `<${info.tag}>${info.text ? ` "${info.text}"` : ''} [${STATUS_LABEL[info.status]}]`

    const body = document.createElement('div')
    body.className = 'remarq-popup-body'

    const makeCommentEl = (): HTMLElement => {
      const el = document.createElement('div')
      el.textContent = info.comment
      el.style.cursor = 'pointer'
      el.title = 'Click to edit'
      el.addEventListener('click', () => this.enterEditMode(el, info, callbacks))
      return el
    }
    body.appendChild(makeCommentEl())
    body.appendChild(this.buildLifecycleViewer(info.lifecycle))

    const actions = document.createElement('div')
    actions.className = 'remarq-popup-actions'
    this.renderActionButtons(actions, info, callbacks)

    popup.appendChild(header)
    popup.appendChild(body)
    popup.appendChild(actions)

    this.container.appendChild(popup)
    this.popupEl = popup

    // Measure after layout, then position
    requestAnimationFrame(() => {
      this.adjustPosition(popup, position)
    })

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide()
        callbacks.onClose()
      }
    }
    document.addEventListener('keydown', this.keyHandler)

    setTimeout(() => {
      this.outsideClickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (target && !target.closest('.remarq-popup')) {
          this.hide()
          callbacks.onClose()
        }
      }
      document.addEventListener('mousedown', this.outsideClickHandler)
    }, 0)
  }

  private buildLifecycleViewer(lifecycle: AnnotationEvent[]): HTMLElement {
    const details = document.createElement('details')
    details.className = 'remarq-popup-history'

    const summary = document.createElement('summary')
    summary.textContent = `History (${lifecycle.length})`
    details.appendChild(summary)

    const list = document.createElement('ul')
    list.className = 'remarq-popup-history-list'

    for (const ev of lifecycle) {
      const li = document.createElement('li')
      const when = new Date(ev.timestamp).toLocaleString()
      const who = ev.actor ?? 'system'
      const what = EVENT_LABEL[ev.type] ?? ev.type
      let text = `${when} · ${who} · ${what}`
      if (ev.reason) text += ` — ${ev.reason}`
      li.textContent = text
      list.appendChild(li)
    }
    details.appendChild(list)
    return details
  }

  private renderActionButtons(
    container: HTMLElement,
    info: DetailInfo,
    callbacks: DetailCallbacks,
  ): void {
    container.replaceChildren()

    const transitions = document.createElement('div')
    transitions.className = 'remarq-popup-actions-row remarq-popup-actions-row--transitions'

    for (const def of actionsForStatus(info.status)) {
      const btn = document.createElement('button')
      btn.textContent = def.label
      if (def.primary) btn.className = 'remarq-primary'
      btn.addEventListener('click', () => {
        if (def.needsReason) {
          this.showReasonInput(container, info, callbacks, def)
        } else {
          this.hide()
          callbacks.onTransition(def.action)
        }
      })
      transitions.appendChild(btn)
    }
    container.appendChild(transitions)

    const utility = document.createElement('div')
    utility.className = 'remarq-popup-actions-row remarq-popup-actions-row--utility'

    const copyBtn = document.createElement('button')
    copyBtn.className = 'remarq-popup-utility-btn'
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('click', () => callbacks.onCopy())
    utility.appendChild(copyBtn)

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'remarq-popup-utility-btn'
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', () => {
      this.hide()
      callbacks.onDelete()
    })
    utility.appendChild(deleteBtn)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'remarq-popup-utility-btn'
    closeBtn.textContent = 'Close'
    closeBtn.addEventListener('click', () => {
      this.hide()
      callbacks.onClose()
    })
    utility.appendChild(closeBtn)

    container.appendChild(utility)
  }

  private showReasonInput(
    container: HTMLElement,
    info: DetailInfo,
    callbacks: DetailCallbacks,
    def: ActionDef,
  ): void {
    container.replaceChildren()

    const textarea = document.createElement('textarea')
    textarea.placeholder = `Reason for ${def.label.toLowerCase()} (optional)…`
    textarea.className = 'remarq-popup-reason'
    container.appendChild(textarea)

    const row = document.createElement('div')
    row.className = 'remarq-popup-reason-row'

    const cancel = document.createElement('button')
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => {
      this.renderActionButtons(container, info, callbacks)
    })

    const submit = document.createElement('button')
    submit.className = 'remarq-primary'
    submit.textContent = 'Submit'
    submit.addEventListener('click', () => {
      const reason = textarea.value.trim() || undefined
      this.hide()
      callbacks.onTransition(def.action, reason)
    })

    row.appendChild(cancel)
    row.appendChild(submit)
    container.appendChild(row)

    textarea.focus()
  }

  hide(): void {
    if (this.pendingEditFlush) {
      this.pendingEditFlush()
      this.pendingEditFlush = null
    }
    if (this.popupEl) {
      this.popupEl.remove()
      this.popupEl = null
    }
    if (this.keyHandler) {
      document.removeEventListener('keydown', this.keyHandler)
      this.keyHandler = null
    }
    if (this.outsideClickHandler) {
      document.removeEventListener('mousedown', this.outsideClickHandler)
      this.outsideClickHandler = null
    }
  }

  destroy(): void {
    this.hide()
  }

  private enterEditMode(
    commentEl: HTMLElement,
    info: DetailInfo,
    callbacks: DetailCallbacks,
  ): void {
    const textarea = document.createElement('textarea')
    textarea.value = info.comment
    textarea.className = 'remarq-popup-edit-textarea'
    textarea.style.width = '100%'
    textarea.style.minHeight = '60px'
    textarea.style.padding = '8px'
    textarea.style.border = '1px solid var(--remarq-border)'
    textarea.style.borderRadius = '4px'
    textarea.style.background = 'var(--remarq-bg-secondary)'
    textarea.style.color = 'var(--remarq-text)'
    textarea.style.fontFamily = 'inherit'
    textarea.style.fontSize = '13px'
    textarea.style.resize = 'vertical'
    textarea.style.boxSizing = 'border-box'

    commentEl.replaceWith(textarea)
    textarea.focus()
    textarea.selectionStart = textarea.value.length

    const restoreView = (): void => {
      if (!textarea.isConnected) return
      const restored = document.createElement('div')
      restored.textContent = info.comment
      restored.style.cursor = 'pointer'
      restored.title = 'Click to edit'
      restored.addEventListener('click', () => this.enterEditMode(restored, info, callbacks))
      textarea.replaceWith(restored)
    }

    const commitEdit = (): void => {
      this.pendingEditFlush = null
      const newComment = textarea.value.trim()
      if (newComment && newComment !== info.comment) {
        info.comment = newComment
        callbacks.onEdit(newComment)
      }
      restoreView()
    }

    const cancelEdit = (): void => {
      this.pendingEditFlush = null
      restoreView()
    }

    this.pendingEditFlush = commitEdit

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commitEdit()
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelEdit()
      }
    })

    textarea.addEventListener('blur', () => {
      // Defer so click-outside-to-close has a chance to fire hide() first,
      // which already calls pendingEditFlush. If popup is still open after
      // the deferred tick, commit normally.
      setTimeout(() => {
        if (textarea.isConnected) commitEdit()
      }, 50)
    })
  }

  private adjustPosition(popup: HTMLElement, position: Position): void {
    const popupHeight = popup.offsetHeight
    const viewportBottom = window.scrollY + window.innerHeight
    const viewportRight = window.scrollX + window.innerWidth

    let top = position.top
    let left = position.left

    // Flip above element if overflows viewport bottom
    if (top + popupHeight > viewportBottom - POPUP_MARGIN) {
      top = position.anchorBottom - popupHeight
    }

    // Clamp: don't go above visible area
    if (top < window.scrollY + POPUP_MARGIN) {
      top = window.scrollY + POPUP_MARGIN
    }

    // Clamp right edge
    if (left + POPUP_WIDTH > viewportRight - POPUP_MARGIN) {
      left = viewportRight - POPUP_WIDTH - POPUP_MARGIN
    }

    // Clamp left edge
    if (left < window.scrollX + POPUP_MARGIN) {
      left = window.scrollX + POPUP_MARGIN
    }

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`
  }
}
