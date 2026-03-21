export class Overlay {
  private overlayEl: HTMLElement
  private tooltipEl: HTMLElement

  constructor(private container: HTMLElement) {
    this.overlayEl = document.createElement('div')
    this.overlayEl.className = 'remarq-overlay'
    this.overlayEl.style.display = 'none'

    this.tooltipEl = document.createElement('div')
    this.tooltipEl.className = 'remarq-tooltip'
    this.tooltipEl.style.display = 'none'

    container.appendChild(this.overlayEl)
    container.appendChild(this.tooltipEl)
  }

  show(target: HTMLElement): void {
    try {
      const rect = target.getBoundingClientRect()

      this.overlayEl.style.display = 'block'
      this.overlayEl.style.top = `${rect.top}px`
      this.overlayEl.style.left = `${rect.left}px`
      this.overlayEl.style.width = `${rect.width}px`
      this.overlayEl.style.height = `${rect.height}px`

      const tag = target.tagName.toLowerCase()
      const text = target.textContent?.trim().slice(0, 30) || ''
      const dataAnnotate = target.getAttribute('data-annotate')
      let label = `<${tag}>`
      if (text) label += ` "${text}"`
      if (dataAnnotate) label += ` [${dataAnnotate}]`

      this.tooltipEl.textContent = label
      this.tooltipEl.style.display = 'block'
      this.tooltipEl.style.top = `${rect.top - 28}px`
      this.tooltipEl.style.left = `${rect.left}px`
    } catch {
      this.hide()
    }
  }

  updateTooltipPosition(x: number, y: number): void {
    this.tooltipEl.style.left = `${x + 12}px`
    this.tooltipEl.style.top = `${y - 28}px`
  }

  hide(): void {
    this.overlayEl.style.display = 'none'
    this.tooltipEl.style.display = 'none'
  }

  destroy(): void {
    this.overlayEl.remove()
    this.tooltipEl.remove()
  }
}
