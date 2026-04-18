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
      const cs = window.getComputedStyle(target)
      const transform = cs.transform
      const hasTransform = transform && transform !== 'none'

      this.overlayEl.style.display = 'block'

      if (hasTransform) {
        const w = target.offsetWidth
        const h = target.offsetHeight
        const origin = cs.transformOrigin
        const [ox, oy] = origin.split(' ').map(parseFloat)
        const matrix = new DOMMatrix(transform)

        // Compute where transform-origin maps on screen
        const corners = [
          matrix.transformPoint(new DOMPoint(-ox, -oy)),
          matrix.transformPoint(new DOMPoint(w - ox, -oy)),
          matrix.transformPoint(new DOMPoint(-ox, h - oy)),
          matrix.transformPoint(new DOMPoint(w - ox, h - oy)),
        ]
        const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x)
        const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y)

        // Origin screen position, then untransformed top-left
        const overlayX = rect.left - minX - ox
        const overlayY = rect.top - minY - oy

        this.overlayEl.style.left = `${overlayX}px`
        this.overlayEl.style.top = `${overlayY}px`
        this.overlayEl.style.width = `${w}px`
        this.overlayEl.style.height = `${h}px`
        this.overlayEl.style.transform = transform
        this.overlayEl.style.transformOrigin = origin
      } else {
        this.overlayEl.style.left = `${rect.left}px`
        this.overlayEl.style.top = `${rect.top}px`
        this.overlayEl.style.width = `${rect.width}px`
        this.overlayEl.style.height = `${rect.height}px`
        this.overlayEl.style.transform = ''
        this.overlayEl.style.transformOrigin = ''
      }

      this.tooltipEl.textContent = describeElement(target)
      this.tooltipEl.style.display = 'block'
      this.positionTooltip(rect.left, rect.top - 28)
    } catch {
      this.hide()
    }
  }

  updateTooltipPosition(x: number, y: number): void {
    this.positionTooltip(x + 12, y - 28)
  }

  hideHighlight(): void {
    this.overlayEl.style.display = 'none'
  }

  hide(): void {
    this.overlayEl.style.display = 'none'
    this.tooltipEl.style.display = 'none'
  }

  destroy(): void {
    this.overlayEl.remove()
    this.tooltipEl.remove()
  }

  private positionTooltip(left: number, top: number): void {
    // Temporarily position at origin to measure
    this.tooltipEl.style.left = '0px'
    this.tooltipEl.style.top = '0px'
    const tooltipWidth = this.tooltipEl.offsetWidth
    const tooltipHeight = this.tooltipEl.offsetHeight

    // Clamp to viewport
    const maxLeft = window.innerWidth - tooltipWidth - 8
    const maxTop = window.innerHeight - tooltipHeight - 8

    this.tooltipEl.style.left = `${Math.max(8, Math.min(left, maxLeft))}px`
    this.tooltipEl.style.top = `${Math.max(8, Math.min(top, maxTop))}px`
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
