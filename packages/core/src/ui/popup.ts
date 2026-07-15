interface ElementInfo {
  tag: string
  text: string
}

import type { AnnotationEvent, AnnotationStatus, QualityCheck } from '../core/types'
import type { LifecycleAction } from '../core/lifecycle'

export interface DetailInfo extends ElementInfo {
  id: string
  comment: string
  status: AnnotationStatus
  lifecycle: AnnotationEvent[]
  qualityCheck?: QualityCheck
  qualityPending?: boolean
}

interface DetailCallbacks {
  onTransition: (action: LifecycleAction, reason?: string) => void
  onDelete: () => void
  onClose: () => void
  onEdit: (newComment: string) => void
  onCopy: () => void
  onUseRewrite?: (rewrite: string) => void
  onRecheck?: () => void
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
  private openId: string | null = null
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
    const quality = this.buildQualitySection(info, callbacks)
    if (quality) body.appendChild(quality)
    body.appendChild(this.buildLifecycleViewer(info.lifecycle))

    const actions = document.createElement('div')
    actions.className = 'remarq-popup-actions'
    this.renderActionButtons(actions, info, callbacks)

    popup.appendChild(header)
    popup.appendChild(body)
    popup.appendChild(actions)

    this.container.appendChild(popup)
    this.popupEl = popup
    this.openId = info.id

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
        if (!target) return
        if (target.closest('.remarq-popup')) return
        // The marker this popup belongs to is not "outside": mousedown must
        // leave the popup standing so the marker's own click handler can
        // toggle it shut. Otherwise the popup closes here and immediately
        // reopens on click.
        if (target.closest(`.remarq-marker[data-annotation-id="${info.id}"]`))
          return
        this.hide()
        callbacks.onClose()
      }
      document.addEventListener('mousedown', this.outsideClickHandler)
    }, 0)
  }

  isOpenFor(id: string): boolean {
    return this.popupEl !== null && this.openId === id
  }

  private buildQualitySection(
    info: DetailInfo,
    callbacks: DetailCallbacks,
  ): HTMLElement | null {
    if (!info.qualityCheck && !info.qualityPending) return null

    const section = document.createElement('div')
    section.className = 'remarq-popup-quality'

    if (info.qualityPending) {
      section.textContent = '🤖 Checking comment quality…'
      return section
    }

    const check = info.qualityCheck!

    const badge = document.createElement('span')
    badge.className = `remarq-popup-quality-badge remarq-popup-quality-badge--${check.score}`
    badge.textContent = `🤖 ${check.score}`
    section.appendChild(badge)

    if (check.issues.length) {
      const list = document.createElement('ul')
      list.className = 'remarq-popup-quality-issues'
      for (const issue of check.issues) {
        const li = document.createElement('li')
        li.textContent = issue
        list.appendChild(li)
      }
      section.appendChild(list)
    }

    if (check.suggestedRewrite) {
      const rewrite = document.createElement('div')
      rewrite.className = 'remarq-popup-quality-rewrite'
      rewrite.textContent = check.suggestedRewrite
      section.appendChild(rewrite)
    }

    const actions = document.createElement('div')
    actions.className = 'remarq-popup-quality-actions'

    if (check.suggestedRewrite && callbacks.onUseRewrite) {
      const useBtn = document.createElement('button')
      useBtn.className = 'remarq-popup-utility-btn remarq-popup-quality-use'
      useBtn.textContent = 'Use rewrite'
      useBtn.addEventListener('click', () => {
        this.hide()
        callbacks.onUseRewrite!(check.suggestedRewrite!)
      })
      actions.appendChild(useBtn)
    }

    if (callbacks.onRecheck) {
      const recheckBtn = document.createElement('button')
      recheckBtn.className = 'remarq-popup-utility-btn remarq-popup-quality-recheck'
      recheckBtn.textContent = 'Re-check'
      recheckBtn.addEventListener('click', () => {
        this.hide()
        callbacks.onRecheck!()
      })
      actions.appendChild(recheckBtn)
    }

    if (actions.childElementCount) section.appendChild(actions)
    return section
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
    this.openId = null
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
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const viewportBottom = window.scrollY + viewportHeight
    const viewportRight = window.scrollX + viewportWidth

    let top = position.top
    let left = position.left

    // Embedded panes report a 0x0 viewport for a frame. Clamping against it
    // would fling the popup into the top-left corner, so keep the anchored
    // position until the viewport reports real dimensions.
    if (viewportHeight > 0) {
      // Flip above anchor if overflows viewport bottom
      if (top + popupHeight > viewportBottom - POPUP_MARGIN) {
        top = position.anchorBottom - popupHeight
      }

      // Clamp: don't go above visible area
      if (top < window.scrollY + POPUP_MARGIN) {
        top = window.scrollY + POPUP_MARGIN
      }
    }

    if (viewportWidth > 0) {
      // Clamp right edge
      if (left + POPUP_WIDTH > viewportRight - POPUP_MARGIN) {
        left = viewportRight - POPUP_WIDTH - POPUP_MARGIN
      }

      // Clamp left edge
      if (left < window.scrollX + POPUP_MARGIN) {
        left = window.scrollX + POPUP_MARGIN
      }
    }

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`
  }
}
