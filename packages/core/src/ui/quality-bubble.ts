import type { QualityCheck } from '../core/types'

type BubbleState = 'pending' | 'ambiguous' | 'unactionable'

interface BubbleEntry {
  el: HTMLElement
  state: BubbleState
}

const LABEL: Record<BubbleState, string> = {
  pending: '🤖…',
  ambiguous: '🤖 ambiguous',
  unactionable: '🤖 unactionable',
}

const CHIP_GAP = 6

/**
 * Quality-verdict chips next to markers — the "first signal" after submit.
 * Chips live in the remarq container (immune to host overflow clipping, like
 * markers and status outlines) and are positioned by the markers' rAF loop
 * via updatePosition(). `clear` verdicts render nothing; the full verdict
 * lives in the annotation popup.
 */
export class QualityBubbleManager {
  private bubbles = new Map<string, BubbleEntry>()
  private suppressedId: string | null = null

  constructor(
    private container: HTMLElement,
    private onClick: (annotationId: string) => void,
  ) {}

  setPending(id: string): void {
    this.setState(id, 'pending')
  }

  setVerdict(id: string, check: QualityCheck | null): void {
    if (!check || check.score === 'clear') {
      this.remove(id)
      return
    }
    this.setState(id, check.score)
  }

  /** Hide the chip while its annotation's popup is open — no duplicate signal. */
  suppress(id: string | null): void {
    this.suppressedId = id
    for (const [bubbleId, entry] of this.bubbles) {
      entry.el.style.display = bubbleId === id ? 'none' : ''
    }
  }

  /** Chips only make sense next to a visible marker — drop the rest. */
  syncVisible(attachedIds: Set<string>): void {
    for (const id of [...this.bubbles.keys()]) {
      if (!attachedIds.has(id)) this.remove(id)
    }
  }

  /** Fed by the markers' rAF loop with the marker's page coordinates. */
  updatePosition(id: string, markerTop: number, markerLeft: number): void {
    const entry = this.bubbles.get(id)
    if (!entry) return
    entry.el.style.top = `${markerTop}px`
    entry.el.style.left = `${markerLeft - CHIP_GAP}px`
  }

  remove(id: string): void {
    const entry = this.bubbles.get(id)
    if (entry) {
      entry.el.remove()
      this.bubbles.delete(id)
    }
  }

  clear(): void {
    for (const entry of this.bubbles.values()) entry.el.remove()
    this.bubbles.clear()
  }

  destroy(): void {
    this.clear()
    this.suppressedId = null
  }

  private setState(id: string, state: BubbleState): void {
    let entry = this.bubbles.get(id)
    if (!entry) {
      const el = document.createElement('div')
      el.className = 'remarq-quality-bubble'
      el.setAttribute('data-annotation-id', id)
      el.addEventListener('click', () => this.onClick(id))
      this.container.appendChild(el)
      entry = { el, state }
      this.bubbles.set(id, entry)
    }
    entry.state = state
    entry.el.textContent = LABEL[state]
    entry.el.setAttribute('data-state', state)
    entry.el.style.display = id === this.suppressedId ? 'none' : ''
  }
}
