import type { Annotation, AnnotationStatus } from '../core/types'

interface MarkerEntry {
  annotation: Annotation
  target: HTMLElement
  markerEl: HTMLElement
  outlineEl: HTMLElement
  simpleReview: boolean
  /** Position among markers sharing the same target — fans them out so none is buried. */
  stackIndex: number
}

const STATUS_VAR: Record<AnnotationStatus, string> = {
  draft: '--remarq-status-draft',
  pending: '--remarq-status-pending',
  in_progress: '--remarq-status-in-progress',
  fixed_unverified: '--remarq-status-fixed-unverified',
  verified: '--remarq-status-verified',
  dismissed: '--remarq-status-dismissed',
}

function statusClass(status: AnnotationStatus): string {
  return `remarq-marker--${status.replace('_', '-')}`
}

const MARKER_SIZE = 24
const MARKER_OFFSET = 12
const MARKER_MARGIN = 8
const MARKER_STACK_GAP = 4
const OUTLINE_WIDTH = 2
const OUTLINE_GAP = 2
const SELECTED_OUTLINE_WIDTH = 4
const SELECTED_OUTLINE_GAP = 3
const REVIEW_OUTLINE_WIDTH = 1
const REVIEW_OUTLINE_GAP = 1

export class MarkerManager {
  private markers = new Map<string, MarkerEntry>()
  private rafId: number | null = null
  private counter = 0
  private selectedId: string | null = null
  private simpleReviewOpen = false

  constructor(
    private container: HTMLElement,
    private onClick?: (annotationId: string) => void,
    private onMarkerPosition?: (annotationId: string, top: number, left: number) => void,
  ) {
    this.startPositionLoop()
  }

  addMarker(annotation: Annotation, target: HTMLElement, label?: string, simpleReview = false): void {
    this.counter++
    const markerEl = document.createElement('div')
    markerEl.className = `remarq-marker ${statusClass(annotation.status)}`
    markerEl.setAttribute('data-status', annotation.status)
    markerEl.setAttribute('data-annotation-id', annotation.id)
    markerEl.textContent = label ?? String(this.counter)
    markerEl.title = annotation.comment

    markerEl.addEventListener('click', () => {
      this.onClick?.(annotation.id)
    })

    // The status outline is a box in the remarq container, NOT an inline
    // outline on the target. An outline (or box-shadow) on the target itself
    // gets cut by any `overflow: clip|hidden` ancestor in the host page —
    // confirmed on real layouts. Boxes here escape the host's clipping the
    // same way the markers do, and `var(--remarq-status-*)` resolves because
    // the box lives inside the themed container.
    const outlineEl = document.createElement('div')
    outlineEl.className = 'remarq-status-outline'
    outlineEl.setAttribute('data-annotation-id', annotation.id)
    outlineEl.style.borderColor = `var(${STATUS_VAR[annotation.status]})`

    let stackIndex = 0
    for (const entry of this.markers.values()) {
      if (entry.target === target) stackIndex++
    }

    this.container.appendChild(outlineEl)
    this.container.appendChild(markerEl)
    this.markers.set(annotation.id, { annotation, target, markerEl, outlineEl, simpleReview, stackIndex })
    this.updateSelection(annotation.id)
  }

  removeMarker(id: string): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.markerEl.remove()
      entry.outlineEl.remove()
      this.markers.delete(id)
    }
  }

  updateStatus(id: string, status: AnnotationStatus): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.annotation.status = status
      entry.markerEl.className = `remarq-marker ${statusClass(status)}`
      entry.markerEl.setAttribute('data-status', status)
      entry.outlineEl.style.borderColor = `var(${STATUS_VAR[status]})`
    }
  }

  setSelected(id: string | null, simpleReviewOpen = false): void {
    const modeChanged = this.simpleReviewOpen !== simpleReviewOpen
    if (this.selectedId === id && !modeChanged) return
    const previous = this.selectedId
    this.selectedId = id
    this.simpleReviewOpen = simpleReviewOpen
    if (modeChanged) {
      for (const markerId of this.markers.keys()) this.updateSelection(markerId)
      return
    }
    if (previous !== null) this.updateSelection(previous)
    if (id !== null) this.updateSelection(id)
  }

  private updateSelection(id: string): void {
    const entry = this.markers.get(id)
    if (!entry) return
    const inReview = this.simpleReviewOpen && entry.simpleReview
    const selected = id === this.selectedId
    entry.markerEl.toggleAttribute('data-remarq-review-active', inReview && selected)
    entry.outlineEl.toggleAttribute('data-remarq-review-inactive', inReview && !selected)
    this.updatePosition(id)
  }

  /**
   * Keeps `selectedId` — a refresh rebuilds every marker from scratch, and the
   * popup can still be open across it. addMarker re-applies the selected
   * outline, so the highlight survives instead of silently dropping.
   */
  clear(): void {
    for (const entry of this.markers.values()) {
      entry.markerEl.remove()
      entry.outlineEl.remove()
    }
    this.markers.clear()
    this.counter = 0
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.clear()
    this.selectedId = null
    this.simpleReviewOpen = false
  }

  /** Viewport rect of the marker itself, or null if it has no marker. */
  getMarkerRect(id: string): DOMRect | null {
    const entry = this.markers.get(id)
    if (!entry) return null
    try {
      return entry.markerEl.getBoundingClientRect()
    } catch {
      return null
    }
  }

  hasTarget(target: Element): boolean {
    for (const entry of this.markers.values()) {
      if (entry.target === target) return true
    }
    return false
  }

  getReviewHit(event: MouseEvent): string | null {
    if (!this.simpleReviewOpen || event.detail === 0) return null
    const path = event.composedPath()
    if (path.includes(this.container)) return null

    let id: string | null = null
    let depth = path.length
    for (const [markerId, entry] of this.markers) {
      if (!entry.simpleReview) continue
      const index = path.indexOf(entry.target)
      if (index < 0 || index > depth || (index === depth && markerId !== this.selectedId)) continue
      const { left, right, top, bottom } = entry.target.getBoundingClientRect()
      if (event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom) continue
      depth = index
      id = markerId
    }
    return id
  }

  private updatePosition(id: string): void {
    const entry = this.markers.get(id)
    if (!entry) return
    try {
      const rect = entry.target.getBoundingClientRect()
      // Markers sharing a target fan out leftwards from the corner — stacked
      // in place they fully cover each other and only the top one is clickable.
      let left =
        rect.right -
        MARKER_OFFSET -
        entry.stackIndex * (MARKER_SIZE + MARKER_STACK_GAP)

      // An element flush with the right edge would push the marker half
      // off-screen, so pin it inside the viewport. Embedded panes report a
      // zero-width viewport for a frame — leave the position alone rather than
      // pin every marker to the left edge.
      const viewportWidth = window.innerWidth
      if (viewportWidth > MARKER_SIZE) {
        const minLeft = MARKER_MARGIN
        const maxLeft = viewportWidth - MARKER_SIZE - MARKER_MARGIN
        left = Math.max(minLeft, Math.min(left, maxLeft))
      }

      const top = rect.top - MARKER_OFFSET
      entry.markerEl.style.top = `${top}px`
      entry.markerEl.style.left = `${left}px`
      this.onMarkerPosition?.(id, top, left)

      // Mimic `outline` + `outline-offset` geometry: the box's inner border
      // edge sits `gap` outside the element, so the whole box is the element
      // rect expanded by gap + border width (border-box sizing).
      const inReview = this.simpleReviewOpen && entry.simpleReview
      const selected = id === this.selectedId
      const borderWidth = selected ? SELECTED_OUTLINE_WIDTH : inReview ? REVIEW_OUTLINE_WIDTH : OUTLINE_WIDTH
      const gap = selected ? SELECTED_OUTLINE_GAP : inReview ? REVIEW_OUTLINE_GAP : OUTLINE_GAP
      const pad = borderWidth + gap
      entry.outlineEl.style.borderWidth = `${borderWidth}px`
      entry.outlineEl.style.top = `${rect.top - pad}px`
      entry.outlineEl.style.left = `${rect.left - pad}px`
      entry.outlineEl.style.width = `${rect.right - rect.left + pad * 2}px`
      entry.outlineEl.style.height = `${rect.bottom - rect.top + pad * 2}px`
    } catch {
      // element may have been removed
    }
  }

  private startPositionLoop(): void {
    const update = () => {
      for (const id of this.markers.keys()) {
        this.updatePosition(id)
      }
      this.rafId = requestAnimationFrame(update)
    }
    this.rafId = requestAnimationFrame(update)
  }
}
