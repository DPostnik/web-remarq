import { LIMITS } from '../core/validate'

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,td,th,pre,div,article,section,main'
const EXCLUDED = '[data-remarq-theme],input,textarea,select,[contenteditable]:not([contenteditable="false"])'

function blockFor(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  if (!element || element.closest(EXCLUDED)) return null
  return element.closest<HTMLElement>('button,[role="button"]') ?? element.closest<HTMLElement>(BLOCKS) ?? (element instanceof HTMLElement ? element : null)
}

// Project a point in button padding onto the nearest rendered text line.
function buttonCaret(button: HTMLElement, x: number, y: number): { node: Node; offset: number; inText: boolean } | undefined {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let closest: DOMRect | undefined
  let best = Infinity
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      const distance = dx * dx + dy * dy
      if (distance < best) { closest = rect; best = distance }
    }
  }
  if (!closest) return
  const px = Math.min(Math.max(x, closest.left + 0.1), closest.right - 0.1)
  const py = (closest.top + closest.bottom) / 2
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  const caret = doc.caretPositionFromPoint?.(px, py)
  const fallback = caret ? null : document.caretRangeFromPoint?.(px, py)
  const node = caret?.offsetNode ?? fallback?.startContainer
  if (node && button.contains(node)) return { node, offset: caret?.offset ?? fallback!.startOffset, inText: best === 0 }
}

export class TextSelection {
  private button = document.createElement('button')
  private drag?: { button: HTMLElement; id: number; x: number; y: number; node: Node; offset: number; moved: boolean }
  private suppressClick?: HTMLElement
  private selection?: { block: HTMLElement; quote: string; rect: DOMRect }

  constructor(container: HTMLElement, private enabled: () => boolean,
    onComment: (block: HTMLElement, quote: string, rect: DOMRect) => void) {
    this.button.type = 'button'
    this.button.className = 'remarq-selection-comment'
    this.button.textContent = /^ru\b/i.test(navigator.language) ? 'Комментировать' : 'Comment'
    this.button.hidden = true
    this.button.addEventListener('pointerdown', event => event.preventDefault())
    this.button.addEventListener('click', () => {
      const saved = this.selection
      this.hide()
      if (saved?.block.isConnected && this.enabled()) {
        document.getSelection()?.removeAllRanges()
        onComment(saved.block, saved.quote, saved.rect)
      }
    })
    container.append(this.button)
    document.addEventListener('pointerdown', this.startDrag, true)
    document.addEventListener('pointermove', this.moveDrag, true)
    document.addEventListener('pointerup', this.finishDrag, true)
    document.addEventListener('pointercancel', this.cancelDrag, true)
    document.addEventListener('click', this.afterDrag, true)
    document.addEventListener('selectionchange', this.update)
    document.addEventListener('scroll', this.update, true)
    window.addEventListener('resize', this.update)
  }

  private startDrag = (event: PointerEvent): void => {
    this.drag = undefined
    this.suppressClick = undefined
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.shiftKey || event.ctrlKey ||
        event.metaKey || event.altKey || !this.enabled() || !(event.target instanceof Element)) return
    const button = event.target.closest<HTMLElement>('button,[role="button"]')
    if (!button || button.closest(EXCLUDED) || button.matches(':disabled') ||
        getComputedStyle(button).userSelect === 'none') return
    const anchor = buttonCaret(button, event.clientX, event.clientY)
    if (anchor && !anchor.inText) {
      this.drag = { button, id: event.pointerId, x: event.clientX, y: event.clientY,
        node: anchor.node, offset: anchor.offset, moved: false }
    }
  }

  private moveDrag = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    if (!(event.buttons & 1) || !drag.button.isConnected || !this.enabled()) { this.drag = undefined; return }
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return
    const end = buttonCaret(drag.button, event.clientX, event.clientY)
    if (!end || !drag.button.contains(drag.node)) return
    drag.moved = true
    document.getSelection()?.setBaseAndExtent(drag.node, drag.offset, end.node, end.offset)
    event.preventDefault()
  }

  private finishDrag = (event: PointerEvent): void => {
    if (this.drag?.id !== event.pointerId) return
    if (this.drag.moved) this.suppressClick = this.drag.button
    this.drag = undefined
  }

  private cancelDrag = (): void => { this.drag = undefined }

  private afterDrag = (event: MouseEvent): void => {
    const button = this.suppressClick
    this.suppressClick = undefined
    if (button && event.detail > 0 && event.target instanceof Node && button.contains(event.target)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  private update = (): void => {
    const selected = document.getSelection()
    if (!this.enabled() || !selected || selected.isCollapsed || selected.rangeCount !== 1) return this.hide()
    const range = selected.getRangeAt(0)
    const block = blockFor(range.startContainer)
    if (!block || block !== blockFor(range.endContainer)) return this.hide()
    const quote = selected.toString()
    if (!quote.trim() || quote.length > LIMITS.comment) return this.hide()
    const rect = range.getBoundingClientRect()
    if (!rect.width || rect.bottom < 0 || rect.top > innerHeight) return this.hide()
    this.selection = { block, quote, rect }
    this.button.hidden = false
    this.button.style.left = Math.max(2, Math.min(rect.left, innerWidth - this.button.offsetWidth - 2)) + 'px'
    const above = rect.top - this.button.offsetHeight - 5
    this.button.style.top = (above >= 0 ? above : Math.min(rect.bottom + 5, innerHeight - this.button.offsetHeight)) + 'px'
  }

  hide(): void {
    this.selection = undefined
    this.button.hidden = true
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.startDrag, true)
    document.removeEventListener('pointermove', this.moveDrag, true)
    document.removeEventListener('pointerup', this.finishDrag, true)
    document.removeEventListener('pointercancel', this.cancelDrag, true)
    document.removeEventListener('click', this.afterDrag, true)
    document.removeEventListener('selectionchange', this.update)
    document.removeEventListener('scroll', this.update, true)
    window.removeEventListener('resize', this.update)
    this.button.remove()
  }
}
