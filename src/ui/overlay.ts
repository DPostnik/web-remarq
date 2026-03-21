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

      this.tooltipEl.textContent = describeElement(target)
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

function describeElement(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase()
  const parts: string[] = [`<${tag}>`]

  // data-annotate or data-testid
  const dataAnnotate = el.getAttribute('data-annotate')
  const dataTestId = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy')
  if (dataAnnotate) {
    parts.push(`[${dataAnnotate}]`)
  } else if (dataTestId) {
    parts.push(`[${dataTestId}]`)
  }

  // id
  if (el.id) {
    parts.push(`#${el.id}`)
  }

  // Meaningful classes (skip hashed ones, max 2)
  const classes = Array.from(el.classList)
    .filter((c) => !c.match(/^(sc-|css-)/) && !c.match(/^[a-zA-Z0-9]{8,}$/) && !c.match(/__[a-zA-Z0-9]{3,}$/))
    .slice(0, 2)
  if (classes.length) {
    parts.push(`.${classes.join('.')}`)
  }

  // Direct text content only (not nested)
  const directText = getDirectText(el)
  if (directText) {
    parts.push(`"${directText}"`)
  }

  return parts.join(' ')
}

function getDirectText(el: HTMLElement): string {
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    }
  }
  text = text.trim()

  // Fallback: if no direct text and few children, use shallow textContent
  if (!text && el.children.length <= 2) {
    text = el.textContent?.trim() ?? ''
  }

  return text.slice(0, 30)
}
