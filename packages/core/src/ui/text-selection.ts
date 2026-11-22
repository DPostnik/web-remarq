import { LIMITS } from '../core/validate'

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,figcaption,td,th,pre,div,article,section,main'
const EXCLUDED = '[data-remarq-theme],input,textarea,select,[contenteditable]:not([contenteditable="false"])'

function blockFor(node: Node): HTMLElement | null {
  const element = node instanceof Element ? node : node.parentElement
  if (!element || element.closest(EXCLUDED)) return null
  return element.closest<HTMLElement>(BLOCKS) ?? (element instanceof HTMLElement ? element : null)
}

export class TextSelection {
  private button = document.createElement('button')
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
    document.addEventListener('selectionchange', this.update)
    document.addEventListener('scroll', this.update, true)
    window.addEventListener('resize', this.update)
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
    document.removeEventListener('selectionchange', this.update)
    document.removeEventListener('scroll', this.update, true)
    window.removeEventListener('resize', this.update)
    this.button.remove()
  }
}
