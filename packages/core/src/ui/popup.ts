interface ElementInfo {
  tag: string
  text: string
}

interface DetailInfo extends ElementInfo {
  comment: string
  status: 'pending' | 'resolved'
}

interface DetailCallbacks {
  onResolve: () => void
  onDelete: () => void
  onClose: () => void
  onEdit: (newComment: string) => void
  onCopy: () => void
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
    header.textContent = `<${info.tag}>${info.text ? ` "${info.text}"` : ''} [${info.status}]`

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

    const actions = document.createElement('div')
    actions.className = 'remarq-popup-actions'

    if (info.status === 'pending') {
      const resolveBtn = document.createElement('button')
      resolveBtn.className = 'remarq-primary'
      resolveBtn.textContent = 'Resolve'
      resolveBtn.addEventListener('click', () => {
        this.hide()
        callbacks.onResolve()
      })
      actions.appendChild(resolveBtn)
    }

    const copyBtn = document.createElement('button')
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('click', () => {
      callbacks.onCopy()
    })
    actions.appendChild(copyBtn)

    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', () => {
      this.hide()
      callbacks.onDelete()
    })
    actions.appendChild(deleteBtn)

    const closeBtn = document.createElement('button')
    closeBtn.textContent = 'Close'
    closeBtn.addEventListener('click', () => {
      this.hide()
      callbacks.onClose()
    })
    actions.appendChild(closeBtn)

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

  hide(): void {
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

    const saveEdit = () => {
      const newComment = textarea.value.trim()
      if (newComment && newComment !== info.comment) {
        info.comment = newComment
        callbacks.onEdit(newComment)
      }
      const restored = document.createElement('div')
      restored.textContent = info.comment
      restored.style.cursor = 'pointer'
      restored.title = 'Click to edit'
      restored.addEventListener('click', () => this.enterEditMode(restored, info, callbacks))
      textarea.replaceWith(restored)
    }

    textarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        saveEdit()
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        const restored = document.createElement('div')
        restored.textContent = info.comment
        restored.style.cursor = 'pointer'
        restored.title = 'Click to edit'
        restored.addEventListener('click', () => this.enterEditMode(restored, info, callbacks))
        textarea.replaceWith(restored)
      }
    })

    textarea.addEventListener('blur', () => {
      setTimeout(() => {
        if (textarea.isConnected) {
          saveEdit()
        }
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
