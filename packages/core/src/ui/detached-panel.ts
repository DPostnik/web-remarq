import type { Annotation } from '../core/types'

export class DetachedPanel {
  private panelEl: HTMLElement | null = null
  private toastEl: HTMLElement | null = null
  private toastTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private container: HTMLElement,
    private onDelete?: (id: string) => void,
  ) {}

  update(otherBreakpoint: Annotation[], detached: Annotation[]): void {
    this.remove()
    if (otherBreakpoint.length === 0 && detached.length === 0) return

    const panel = document.createElement('div')
    panel.className = 'remarq-detached-panel'

    if (otherBreakpoint.length > 0) {
      this.renderSection(panel, `Other viewport (${otherBreakpoint.length})`, otherBreakpoint, 'other')
    }

    if (detached.length > 0) {
      this.renderSection(panel, `Detached (${detached.length})`, detached, 'detached')
    }

    this.container.appendChild(panel)
    this.panelEl = panel
  }

  destroy(): void {
    this.remove()
    this.hideToast()
  }

  private renderSection(
    panel: HTMLElement,
    title: string,
    annotations: Annotation[],
    type: 'other' | 'detached',
  ): void {
    const header = document.createElement('div')
    header.className = 'remarq-detached-header'
    header.textContent = title
    panel.appendChild(header)

    for (const ann of annotations) {
      const item = document.createElement('div')
      item.className = 'remarq-detached-item'

      const info = document.createElement('div')
      info.className = 'remarq-detached-info'

      const comment = document.createElement('div')
      comment.className = 'remarq-detached-comment'
      comment.textContent = ann.comment

      const elDesc = document.createElement('div')
      elDesc.className = 'remarq-detached-element'
      const fp = ann.fingerprint
      let desc = `<${fp.tagName}>`
      if (fp.textContent) desc += ` "${fp.textContent}"`
      if (fp.dataAnnotate) desc += ` [${fp.dataAnnotate}]`
      if (type === 'other') desc += ` — ${ann.viewportBucket}px`
      elDesc.textContent = desc

      info.appendChild(comment)
      info.appendChild(elDesc)
      item.appendChild(info)

      if (type === 'other') {
        item.style.cursor = 'pointer'
        item.addEventListener('click', () => {
          this.showToast(`Annotation created at ${ann.viewportBucket}px width. Resize viewport to view.`)
        })
      } else {
        const deleteBtn = document.createElement('button')
        deleteBtn.className = 'remarq-detached-delete'
        deleteBtn.textContent = '\u00d7'
        deleteBtn.addEventListener('click', () => {
          this.onDelete?.(ann.id)
        })
        item.appendChild(deleteBtn)
      }

      panel.appendChild(item)
    }
  }

  private showToast(message: string): void {
    this.hideToast()

    const toast = document.createElement('div')
    toast.className = 'remarq-toast'
    toast.textContent = message
    this.container.appendChild(toast)
    this.toastEl = toast

    this.toastTimer = setTimeout(() => {
      if (this.toastEl) {
        this.toastEl.classList.add('remarq-toast-fade')
        setTimeout(() => this.hideToast(), 300)
      }
    }, 3000)
  }

  private hideToast(): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    if (this.toastEl) {
      this.toastEl.remove()
      this.toastEl = null
    }
  }

  private remove(): void {
    if (this.panelEl) {
      this.panelEl.remove()
      this.panelEl = null
    }
  }
}
