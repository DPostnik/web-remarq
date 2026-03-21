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
}

interface Position {
  top: number
  left: number
}

const POPUP_WIDTH = 300
const POPUP_MARGIN = 8

export class Popup {
  private popupEl: HTMLElement | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null

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

    body.appendChild(textarea)

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

    this.adjustPosition(popup, position)

    // Cmd/Ctrl+Enter to submit
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const comment = textarea.value.trim()
        if (!comment) return
        this.hide()
        onSubmit(comment)
      }
      if (e.key === 'Escape') {
        this.hide()
        onCancel()
      }
    }
    document.addEventListener('keydown', this.keyHandler)

    // Focus textarea after render
    requestAnimationFrame(() => textarea.focus())
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
    body.textContent = info.comment

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

    this.adjustPosition(popup, position)

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide()
        callbacks.onClose()
      }
    }
    document.addEventListener('keydown', this.keyHandler)
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
  }

  destroy(): void {
    this.hide()
  }

  private adjustPosition(popup: HTMLElement, position: Position): void {
    const popupRect = popup.getBoundingClientRect()
    const viewH = window.innerHeight
    const viewW = window.innerWidth

    let top = position.top
    let left = position.left

    // Flip above if overflows bottom
    if (top + popupRect.height > viewH - POPUP_MARGIN) {
      top = position.top - popupRect.height - 16
    }

    // Clamp to top edge
    if (top < POPUP_MARGIN) {
      top = POPUP_MARGIN
    }

    // Clamp to right edge
    if (left + POPUP_WIDTH > viewW - POPUP_MARGIN) {
      left = viewW - POPUP_WIDTH - POPUP_MARGIN
    }

    // Clamp to left edge
    if (left < POPUP_MARGIN) {
      left = POPUP_MARGIN
    }

    popup.style.top = `${top}px`
    popup.style.left = `${left}px`
  }
}
