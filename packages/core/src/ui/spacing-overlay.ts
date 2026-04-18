interface Sides {
  top: number
  right: number
  bottom: number
  left: number
}

function parsePx(value: string): number {
  return parseFloat(value) || 0
}

/**
 * Compute the untransformed top-left screen position for an element,
 * accounting for its CSS transform and transform-origin.
 */
function computeUntransformedOrigin(
  rect: DOMRect,
  offsetW: number,
  offsetH: number,
  transform: string,
  transformOrigin: string,
): { x: number; y: number } {
  if (!transform || transform === 'none') {
    return { x: rect.left, y: rect.top }
  }

  const [ox, oy] = transformOrigin.split(' ').map(parseFloat)
  const matrix = new DOMMatrix(transform)

  const corners = [
    matrix.transformPoint(new DOMPoint(-ox, -oy)),
    matrix.transformPoint(new DOMPoint(offsetW - ox, -oy)),
    matrix.transformPoint(new DOMPoint(-ox, offsetH - oy)),
    matrix.transformPoint(new DOMPoint(offsetW - ox, offsetH - oy)),
  ]
  const minX = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x)
  const minY = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y)

  return {
    x: rect.left - minX - ox,
    y: rect.top - minY - oy,
  }
}

export class SpacingOverlay {
  private containerEl: HTMLElement
  private marginEl: HTMLElement
  private paddingEl: HTMLElement
  private contentEl: HTMLElement
  private labels: HTMLElement[] = []
  private gapEls: HTMLElement[] = []
  private lastTarget: HTMLElement | null = null
  private scrollHandler = () => {
    if (this.lastTarget) {
      const target = this.lastTarget
      this.lastTarget = null
      this.show(target)
    }
  }

  constructor(private parent: HTMLElement) {
    window.addEventListener('scroll', this.scrollHandler, true)
    this.containerEl = document.createElement('div')
    this.containerEl.className = 'remarq-spacing'
    this.containerEl.style.display = 'none'

    this.marginEl = document.createElement('div')
    this.marginEl.className = 'remarq-spacing-margin'

    this.paddingEl = document.createElement('div')
    this.paddingEl.className = 'remarq-spacing-padding'

    this.contentEl = document.createElement('div')
    this.contentEl.className = 'remarq-spacing-content'

    this.containerEl.appendChild(this.marginEl)
    this.containerEl.appendChild(this.paddingEl)
    this.containerEl.appendChild(this.contentEl)

    parent.appendChild(this.containerEl)
  }

  show(target: HTMLElement): void {
    if (target === this.lastTarget) return
    this.lastTarget = target

    try {
      const rect = target.getBoundingClientRect()
      const cs = window.getComputedStyle(target)

      const margin = this.readSides(cs, 'margin')
      const padding = this.readSides(cs, 'padding')
      const border = this.readBorderSides(cs)

      const transform = cs.transform
      const transformOrigin = cs.transformOrigin
      const hasTransform = transform && transform !== 'none'

      // Element's untransformed border-box dimensions
      const w = target.offsetWidth
      const h = target.offsetHeight

      // Untransformed top-left position on screen
      const origin = computeUntransformedOrigin(rect, w, h, transform, transformOrigin)

      // Position and transform the container at the element's border-box
      this.containerEl.style.left = `${origin.x}px`
      this.containerEl.style.top = `${origin.y}px`
      this.containerEl.style.width = `${w}px`
      this.containerEl.style.height = `${h}px`

      if (hasTransform) {
        this.containerEl.style.transform = transform
        this.containerEl.style.transformOrigin = transformOrigin
      } else {
        this.containerEl.style.transform = ''
        this.containerEl.style.transformOrigin = ''
      }

      // All inner boxes use coordinates relative to container (0,0 = border-box top-left)

      // Margin box: expand outward
      this.positionEl(this.marginEl, -margin.left, -margin.top,
        w + margin.left + margin.right, h + margin.top + margin.bottom)

      // Padding box = border-box = container itself
      this.positionEl(this.paddingEl, 0, 0, w, h)

      // Content box: shrink inward by border + padding
      const contentLeft = border.left + padding.left
      const contentTop = border.top + padding.top
      const contentW = w - border.left - border.right - padding.left - padding.right
      const contentH = h - border.top - border.bottom - padding.top - padding.bottom
      this.positionEl(this.contentEl, contentLeft, contentTop, contentW, contentH)

      // Clear old labels and gaps
      this.clearLabels()
      this.clearGaps()

      // Margin labels (relative to container)
      this.addMarginPaddingLabels(margin, -margin.left, -margin.top,
        w + margin.left + margin.right, h + margin.top + margin.bottom,
        0, 0, w, h, 'margin')

      // Padding labels (relative to container)
      this.addMarginPaddingLabels(padding, 0, 0, w, h,
        contentLeft, contentTop, contentW, contentH, 'padding')

      // Content size label
      if (contentW > 40 && contentH > 14) {
        this.addLabel(
          `${Math.round(contentW)} × ${Math.round(contentH)}`,
          contentTop + contentH / 2 - 6,
          contentLeft + contentW / 2,
          'content',
        )
      }

      // Gap visualization (appended to parent, not container — gaps relate to siblings)
      this.showGaps(target)

      this.containerEl.style.display = 'block'
    } catch {
      this.hide()
    }
  }

  hide(): void {
    this.containerEl.style.display = 'none'
    this.lastTarget = null
    this.clearLabels()
    this.clearGaps()
  }

  destroy(): void {
    window.removeEventListener('scroll', this.scrollHandler, true)
    this.clearLabels()
    this.clearGaps()
    this.containerEl.remove()
  }

  private readSides(cs: CSSStyleDeclaration, prop: 'margin' | 'padding'): Sides {
    return {
      top: parsePx(cs[`${prop}Top` as keyof CSSStyleDeclaration] as string),
      right: parsePx(cs[`${prop}Right` as keyof CSSStyleDeclaration] as string),
      bottom: parsePx(cs[`${prop}Bottom` as keyof CSSStyleDeclaration] as string),
      left: parsePx(cs[`${prop}Left` as keyof CSSStyleDeclaration] as string),
    }
  }

  private readBorderSides(cs: CSSStyleDeclaration): Sides {
    return {
      top: parsePx(cs.borderTopWidth),
      right: parsePx(cs.borderRightWidth),
      bottom: parsePx(cs.borderBottomWidth),
      left: parsePx(cs.borderLeftWidth),
    }
  }

  private positionEl(el: HTMLElement, left: number, top: number, width: number, height: number): void {
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.width = `${Math.max(0, width)}px`
    el.style.height = `${Math.max(0, height)}px`
  }

  private addMarginPaddingLabels(
    sides: Sides,
    outerLeft: number, outerTop: number, outerW: number, outerH: number,
    innerLeft: number, innerTop: number, innerW: number, innerH: number,
    type: 'margin' | 'padding',
  ): void {
    if (sides.top > 0) {
      const y = outerTop + (innerTop - outerTop) / 2 - 6
      const x = outerLeft + outerW / 2
      this.addLabel(String(Math.round(sides.top)), y, x, type)
    }
    if (sides.bottom > 0) {
      const innerBottom = innerTop + innerH
      const outerBottom = outerTop + outerH
      const y = innerBottom + (outerBottom - innerBottom) / 2 - 6
      const x = outerLeft + outerW / 2
      this.addLabel(String(Math.round(sides.bottom)), y, x, type)
    }
    if (sides.left > 0) {
      const y = outerTop + outerH / 2 - 6
      const x = outerLeft + (innerLeft - outerLeft) / 2
      this.addLabel(String(Math.round(sides.left)), y, x, type)
    }
    if (sides.right > 0) {
      const innerRight = innerLeft + innerW
      const outerRight = outerLeft + outerW
      const y = outerTop + outerH / 2 - 6
      const x = innerRight + (outerRight - innerRight) / 2
      this.addLabel(String(Math.round(sides.right)), y, x, type)
    }
  }

  private addLabel(text: string, top: number, left: number, type: string): void {
    const label = document.createElement('div')
    label.className = `remarq-spacing-label remarq-spacing-label-${type}`
    label.textContent = text
    label.style.top = `${top}px`
    label.style.left = `${left}px`
    label.style.transform = 'translateX(-50%)'
    this.containerEl.appendChild(label)
    this.labels.push(label)
  }

  private clearLabels(): void {
    for (const label of this.labels) label.remove()
    this.labels = []
  }

  private showGaps(target: HTMLElement): void {
    const targetCs = window.getComputedStyle(target)
    if (targetCs.display.includes('flex')) {
      this.showContainerGaps(target, targetCs)
      return
    }

    const parent = target.parentElement
    if (!parent) return

    const parentCs = window.getComputedStyle(parent)
    if (!parentCs.display.includes('flex')) return

    const rowGap = parsePx(parentCs.rowGap)
    const columnGap = parsePx(parentCs.columnGap)
    const direction = parentCs.flexDirection
    const isRow = direction === 'row' || direction === 'row-reverse'
    const gap = isRow ? columnGap : rowGap

    if (gap <= 0) return

    const children = Array.from(parent.children) as HTMLElement[]
    const targetIndex = children.indexOf(target)
    if (targetIndex === -1) return

    if (targetIndex > 0) {
      this.renderGap(children[targetIndex - 1], target, gap, isRow)
    }
    if (targetIndex < children.length - 1) {
      this.renderGap(target, children[targetIndex + 1], gap, isRow)
    }
  }

  private showContainerGaps(container: HTMLElement, cs: CSSStyleDeclaration): void {
    const rowGap = parsePx(cs.rowGap)
    const columnGap = parsePx(cs.columnGap)
    const direction = cs.flexDirection
    const isRow = direction === 'row' || direction === 'row-reverse'
    const gap = isRow ? columnGap : rowGap

    if (gap <= 0) return

    const children = Array.from(container.children) as HTMLElement[]
    for (let i = 0; i < children.length - 1; i++) {
      this.renderGap(children[i], children[i + 1], gap, isRow)
    }
  }

  private renderGap(before: HTMLElement, after: HTMLElement, gap: number, isRow: boolean): void {
    const rectBefore = before.getBoundingClientRect()
    const rectAfter = after.getBoundingClientRect()
    const parent = before.parentElement
    const parentRect = parent ? parent.getBoundingClientRect() : null

    const gapEl = document.createElement('div')
    gapEl.className = 'remarq-spacing-gap'

    if (isRow) {
      const left = Math.min(rectBefore.right, rectAfter.right)
      const right = Math.max(rectBefore.left, rectAfter.left)
      const top = parentRect ? parentRect.top : Math.min(rectBefore.top, rectAfter.top)
      const height = parentRect ? parentRect.height : Math.max(rectBefore.height, rectAfter.height)

      gapEl.style.top = `${top}px`
      gapEl.style.left = `${left}px`
      gapEl.style.width = `${Math.abs(right - left)}px`
      gapEl.style.height = `${height}px`
    } else {
      const top = Math.min(rectBefore.bottom, rectAfter.bottom)
      const bottom = Math.max(rectBefore.top, rectAfter.top)
      const left = parentRect ? parentRect.left : Math.min(rectBefore.left, rectAfter.left)
      const width = parentRect ? parentRect.width : Math.max(rectBefore.width, rectAfter.width)

      gapEl.style.top = `${top}px`
      gapEl.style.left = `${left}px`
      gapEl.style.width = `${width}px`
      gapEl.style.height = `${Math.abs(bottom - top)}px`
    }

    if (gap >= 10) {
      const label = document.createElement('span')
      label.className = 'remarq-spacing-label-gap'
      label.textContent = `gap: ${Math.round(gap)}`
      label.style.cssText = 'font-size:10px;font-weight:700;pointer-events:none;'
      gapEl.appendChild(label)
    }

    // Gaps are between siblings — render outside the transformed container
    this.parent.appendChild(gapEl)
    this.gapEls.push(gapEl)
  }

  private clearGaps(): void {
    for (const el of this.gapEls) el.remove()
    this.gapEls = []
  }
}
