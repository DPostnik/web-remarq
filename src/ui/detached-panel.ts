import type { Annotation } from '../core/types'

export class DetachedPanel {
  private panelEl: HTMLElement | null = null

  constructor(
    private container: HTMLElement,
    private onDelete?: (id: string) => void,
  ) {}

  update(annotations: Annotation[]): void {
    this.remove()
    if (annotations.length === 0) return

    const panel = document.createElement('div')
    panel.className = 'remarq-detached-panel'

    const header = document.createElement('div')
    header.className = 'remarq-detached-header'
    header.textContent = `Detached (${annotations.length})`
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
      elDesc.textContent = desc

      info.appendChild(comment)
      info.appendChild(elDesc)

      const deleteBtn = document.createElement('button')
      deleteBtn.className = 'remarq-detached-delete'
      deleteBtn.textContent = '\u00d7'
      deleteBtn.addEventListener('click', () => {
        this.onDelete?.(ann.id)
      })

      item.appendChild(info)
      item.appendChild(deleteBtn)
      panel.appendChild(item)
    }

    this.container.appendChild(panel)
    this.panelEl = panel
  }

  destroy(): void {
    this.remove()
  }

  private remove(): void {
    if (this.panelEl) {
      this.panelEl.remove()
      this.panelEl = null
    }
  }
}
