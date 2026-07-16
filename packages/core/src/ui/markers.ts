import type { Annotation, AnnotationStatus } from '../core/types'

interface MarkerEntry {
  annotation: Annotation
  target: HTMLElement
  markerEl: HTMLElement
  outlineEl: HTMLElement
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
const OUTLINE_WIDTH = 2
const OUTLINE_GAP = 2
const SELECTED_OUTLINE_WIDTH = 4
const SELECTED_OUTLINE_GAP = 3

export class MarkerManager {
  private markers = new Map<string, MarkerEntry>()
  private rafId: number | null = null
  private counter = 0
  private selectedId: string | null = null

  constructor(
    private container: HTMLElement,
    private onClick?: (annotationId: string) => void,
    private onMarkerPosition?: (annotationId: string, top: number, left: number) => void,
  ) {
    this.startPositionLoop()
  }

  addMarker(annotation: Annotation, target: HTMLElement): void {
    this.counter++
    const markerEl = document.createElement('div')
    markerEl.className = `remarq-marker ${statusClass(annotation.status)}`
    markerEl.setAttribute('data-status', annotation.status)
    markerEl.setAttribute('data-annotation-id', annotation.id)
    markerEl.textContent = String(this.counter)
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

    this.container.appendChild(outlineEl)
    this.container.appendChild(markerEl)
    this.markers.set(annotation.id, { annotation, target, markerEl, outlineEl })
    this.updatePosition(annotation.id)
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

  /**
   * Thickens the outline box of the selected annotation's element. Every
   * annotated element already carries a permanent status outline box, so
   * selection reads as a heavier version of it rather than a separate
   * highlight treatment.
   */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return
    const previous = this.selectedId
    this.selectedId = id
    if (previous !== null) this.updatePosition(previous)
    if (id !== null) this.updatePosition(id)
  }

  scrollToMarker(id: string): void {
    const entry = this.markers.get(id)
    if (!entry) return
    try {
      entry.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      // ignore
    }
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

  private updatePosition(id: string): void {
    const entry = this.markers.get(id)
    if (!entry) return
    try {
      const rect = entry.target.getBoundingClientRect()
      let left = window.scrollX + rect.right - MARKER_OFFSET

      // An element flush with the right edge would push the marker half
      // off-screen, so pin it inside the viewport. Embedded panes report a
      // zero-width viewport for a frame — leave the position alone rather than
      // pin every marker to the left edge.
      const viewportWidth = window.innerWidth
      if (viewportWidth > MARKER_SIZE) {
        const minLeft = window.scrollX + MARKER_MARGIN
        const maxLeft = window.scrollX + viewportWidth - MARKER_SIZE - MARKER_MARGIN
        left = Math.max(minLeft, Math.min(left, maxLeft))
      }

      const top = window.scrollY + rect.top - MARKER_OFFSET
      entry.markerEl.style.top = `${top}px`
      entry.markerEl.style.left = `${left}px`
      this.onMarkerPosition?.(id, top, left)

      // Mimic `outline` + `outline-offset` geometry: the box's inner border
      // edge sits `gap` outside the element, so the whole box is the element
      // rect expanded by gap + border width (border-box sizing).
      const selected = id === this.selectedId
      const borderWidth = selected ? SELECTED_OUTLINE_WIDTH : OUTLINE_WIDTH
      const pad = borderWidth + (selected ? SELECTED_OUTLINE_GAP : OUTLINE_GAP)
      entry.outlineEl.style.borderWidth = `${borderWidth}px`
      entry.outlineEl.style.top = `${window.scrollY + rect.top - pad}px`
      entry.outlineEl.style.left = `${window.scrollX + rect.left - pad}px`
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
