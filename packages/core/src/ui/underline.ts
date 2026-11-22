interface Point {
  x: number
  y: number
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_DISTANCE = 24

/** Select buttons on the row intersecting or just above a horizontal drag. All geometry is in viewport pixels. */
function buttonsAtLine(start: Point, endX: number): HTMLElement[] {
  const left = Math.min(start.x, endX)
  const right = Math.max(start.x, endX)
  if (right - left < 5) return []
  const matches: { button: HTMLElement; distance: number }[] = []
  let nearest = Infinity
  for (const button of document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]')) {
    if (button.closest('[data-remarq-theme]')) continue
    const rect = button.getBoundingClientRect()
    const gap = start.y - rect.bottom
    if (!rect.width || !rect.height || start.y < rect.top || gap > MAX_DISTANCE) continue
    const overlap = Math.min(right, rect.right - rect.width / 4) - Math.max(left, rect.left + rect.width / 4)
    if (overlap < Math.min(4, rect.width / 4)) continue
    const x = Math.max(rect.left + 1, Math.min((left + right) / 2, rect.right - 1))
    const hit = document.elementsFromPoint(x, Math.min(start.y, rect.bottom - Math.min(1, rect.height / 2)))
      .find(el => !el.closest('[data-remarq-theme]'))
    if (!hit || !button.contains(hit)) continue
    const distance = Math.max(0, gap)
    nearest = Math.min(nearest, distance)
    matches.push({ button, distance })
  }
  return matches.filter(match => match.distance <= (nearest === 0 ? 0 : nearest + 4)).map(match => match.button)
}

export class Underline {
  private layer = document.createElementNS(SVG_NS, 'svg')
  private line = document.createElementNS(SVG_NS, 'line')
  private highlights = document.createElementNS(SVG_NS, 'g')
  private drag?: { id: number; start: Point }

  constructor(container: HTMLElement, private onSelect: (targets: HTMLElement[], point: Point) => void) {
    this.layer.classList.add('remarq-underline')
    this.layer.setAttribute('aria-hidden', 'true')
    this.layer.setAttribute('stroke', 'currentColor')
    this.layer.setAttribute('fill', 'none')
    this.line.setAttribute('stroke-width', '3')
    this.layer.append(this.highlights, this.line)
    this.layer.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.drag) return
      e.preventDefault()
      this.drag = { id: e.pointerId, start: { x: e.clientX, y: e.clientY } }
      this.layer.setPointerCapture(e.pointerId)
      this.draw(e.clientX)
    })
    this.layer.addEventListener('pointermove', e => {
      if (this.drag?.id === e.pointerId) this.draw(e.clientX)
    })
    this.layer.addEventListener('pointerup', e => {
      if (this.drag?.id !== e.pointerId) return
      const { start } = this.drag
      const targets = buttonsAtLine(start, e.clientX)
      this.reset()
      if (targets.length) this.onSelect(targets, { x: e.clientX, y: start.y })
    })
    for (const type of ['pointercancel', 'lostpointercapture'] as const) {
      this.layer.addEventListener(type, e => { if (this.drag?.id === e.pointerId) this.reset() })
    }
    this.layer.addEventListener('click', e => { e.preventDefault(); e.stopPropagation() })
    this.setActive(false)
    container.append(this.layer)
  }

  private draw(x: number): void {
    const { start } = this.drag!
    this.line.setAttribute('x1', String(start.x))
    this.line.setAttribute('x2', String(x))
    this.line.setAttribute('y1', String(start.y))
    this.line.setAttribute('y2', String(start.y))
    this.line.style.display = ''
    this.highlights.replaceChildren(...buttonsAtLine(start, x).map(button => {
      const box = button.getBoundingClientRect()
      const rect = document.createElementNS(SVG_NS, 'rect')
      rect.setAttribute('x', String(box.left))
      rect.setAttribute('y', String(box.top))
      rect.setAttribute('width', String(box.width))
      rect.setAttribute('height', String(box.height))
      rect.setAttribute('stroke-width', '2')
      return rect
    }))
  }

  private reset(): void {
    const id = this.drag?.id
    this.drag = undefined
    if (id !== undefined && this.layer.hasPointerCapture(id)) this.layer.releasePointerCapture(id)
    this.line.style.display = 'none'
    this.highlights.replaceChildren()
  }

  setActive(active: boolean): void {
    if (!active) this.reset()
    this.layer.style.display = active ? 'block' : 'none'
  }

  destroy(): void {
    this.reset()
    this.layer.remove()
  }
}
