interface Sides {
  top: number
  right: number
  bottom: number
  left: number
}

interface BoxRect {
  top: number
  left: number
  width: number
  height: number
}

function parsePx(value: string): number {
  return parseFloat(value) || 0
}

export class SpacingOverlay {
  private containerEl: HTMLElement
  private marginEl: HTMLElement
  private paddingEl: HTMLElement
  private contentEl: HTMLElement
  private labels: HTMLElement[] = []
  private gapEls: HTMLElement[] = []
  private lastTarget: HTMLElement | null = null

  constructor(private parent: HTMLElement) {
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

      // Margin box: expand outward from border-box
      const marginBox: BoxRect = {
        top: rect.top - margin.top,
        left: rect.left - margin.left,
        width: rect.width + margin.left + margin.right,
        height: rect.height + margin.top + margin.bottom,
      }

      // Padding box = rect (border-box)
      const paddingBox: BoxRect = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }

      // Content box: shrink inward by border + padding
      const contentBox: BoxRect = {
        top: rect.top + border.top + padding.top,
        left: rect.left + border.left + padding.left,
        width: rect.width - border.left - border.right - padding.left - padding.right,
        height: rect.height - border.top - border.bottom - padding.top - padding.bottom,
      }

      this.positionEl(this.marginEl, marginBox)
      this.positionEl(this.paddingEl, paddingBox)
      this.positionEl(this.contentEl, contentBox)

      // Clear old labels and gaps
      this.clearLabels()
      this.clearGaps()

      // Margin labels
      this.addSideLabels(margin, marginBox, paddingBox, 'margin')

      // Padding labels
      this.addSideLabels(padding, paddingBox, contentBox, 'padding')

      // Content size label
      if (contentBox.width > 40 && contentBox.height > 14) {
        this.addLabel(
          `${Math.round(contentBox.width)} × ${Math.round(contentBox.height)}`,
          contentBox.top + contentBox.height / 2 - 6,
          contentBox.left + contentBox.width / 2,
          'content',
        )
      }

      // Gap visualization
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

  private positionEl(el: HTMLElement, box: BoxRect): void {
    el.style.top = `${box.top}px`
    el.style.left = `${box.left}px`
    el.style.width = `${Math.max(0, box.width)}px`
    el.style.height = `${Math.max(0, box.height)}px`
  }

  private addSideLabels(sides: Sides, outerBox: BoxRect, innerBox: BoxRect, type: 'margin' | 'padding'): void {
    // Top label
    if (sides.top > 0) {
      const y = outerBox.top + (innerBox.top - outerBox.top) / 2 - 6
      const x = outerBox.left + outerBox.width / 2
      this.addLabel(String(Math.round(sides.top)), y, x, type)
    }

    // Bottom label
    if (sides.bottom > 0) {
      const innerBottom = innerBox.top + innerBox.height
      const outerBottom = outerBox.top + outerBox.height
      const y = innerBottom + (outerBottom - innerBottom) / 2 - 6
      const x = outerBox.left + outerBox.width / 2
      this.addLabel(String(Math.round(sides.bottom)), y, x, type)
    }

    // Left label
    if (sides.left > 0) {
      const y = outerBox.top + outerBox.height / 2 - 6
      const x = outerBox.left + (innerBox.left - outerBox.left) / 2
      this.addLabel(String(Math.round(sides.left)), y, x, type)
    }

    // Right label
    if (sides.right > 0) {
      const innerRight = innerBox.left + innerBox.width
      const outerRight = outerBox.left + outerBox.width
      const y = outerBox.top + outerBox.height / 2 - 6
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
    // Case 1: Target IS a flex container — show gaps between its own children
    const targetCs = window.getComputedStyle(target)
    if (targetCs.display.includes('flex')) {
      this.showContainerGaps(target, targetCs)
      return
    }

    // Case 2: Target is a child of a flex container — show adjacent gaps
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

    // Show gap before target (between prev sibling and target)
    if (targetIndex > 0) {
      this.renderGap(children[targetIndex - 1], target, gap, isRow)
    }

    // Show gap after target (between target and next sibling)
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
    // Show all gaps between children (since we're hovering the container itself)
    for (let i = 0; i < children.length - 1; i++) {
      this.renderGap(children[i], children[i + 1], gap, isRow)
    }
  }

  private renderGap(before: HTMLElement, after: HTMLElement, gap: number, isRow: boolean): void {
    const rectBefore = before.getBoundingClientRect()
    const rectAfter = after.getBoundingClientRect()

    const gapEl = document.createElement('div')
    gapEl.className = 'remarq-spacing-gap'

    if (isRow) {
      const left = Math.min(rectBefore.right, rectAfter.right)
      const right = Math.max(rectBefore.left, rectAfter.left)
      const top = Math.min(rectBefore.top, rectAfter.top)
      const height = Math.max(rectBefore.height, rectAfter.height)

      gapEl.style.top = `${top}px`
      gapEl.style.left = `${left}px`
      gapEl.style.width = `${Math.abs(right - left)}px`
      gapEl.style.height = `${height}px`
    } else {
      const top = Math.min(rectBefore.bottom, rectAfter.bottom)
      const bottom = Math.max(rectBefore.top, rectAfter.top)
      const left = Math.min(rectBefore.left, rectAfter.left)
      const width = Math.max(rectBefore.width, rectAfter.width)

      gapEl.style.top = `${top}px`
      gapEl.style.left = `${left}px`
      gapEl.style.width = `${width}px`
      gapEl.style.height = `${Math.abs(bottom - top)}px`
    }

    // Label inside gap (skip if too small)
    if (gap >= 10) {
      const label = document.createElement('span')
      label.className = 'remarq-spacing-label-gap'
      label.textContent = `gap: ${Math.round(gap)}`
      label.style.cssText = 'font-size:10px;font-weight:700;pointer-events:none;'
      gapEl.appendChild(label)
    }

    this.containerEl.appendChild(gapEl)
    this.gapEls.push(gapEl)
  }

  private clearGaps(): void {
    for (const el of this.gapEls) el.remove()
    this.gapEls = []
  }
}
