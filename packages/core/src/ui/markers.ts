import type { Annotation, AnnotationStatus } from '../core/types'

interface MarkerEntry {
  annotation: Annotation
  target: HTMLElement
  markerEl: HTMLElement
}

const STATUS_VAR: Record<AnnotationStatus, string> = {
  pending: '--remarq-status-pending',
  in_progress: '--remarq-status-in-progress',
  fixed_unverified: '--remarq-status-fixed-unverified',
  verified: '--remarq-status-verified',
  dismissed: '--remarq-status-dismissed',
}

/** Light-theme values, mirroring ui/styles.ts. Used when the var won't resolve. */
const STATUS_FALLBACK: Record<AnnotationStatus, string> = {
  pending: '#f97316',
  in_progress: '#eab308',
  fixed_unverified: '#3b82f6',
  verified: '#22c55e',
  dismissed: '#6b7280',
}

function statusClass(status: AnnotationStatus): string {
  return `remarq-marker--${status.replace('_', '-')}`
}

const MARKER_SIZE = 24
const MARKER_OFFSET = 12
const MARKER_MARGIN = 8

export class MarkerManager {
  private markers = new Map<string, MarkerEntry>()
  private rafId: number | null = null
  private counter = 0
  private selectedId: string | null = null

  constructor(
    private container: HTMLElement,
    private onClick?: (annotationId: string) => void,
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

    this.container.appendChild(markerEl)
    this.markers.set(annotation.id, { annotation, target, markerEl })
    this.applyOutline(target, annotation.status, annotation.id === this.selectedId)
    this.updatePosition(annotation.id)
  }

  removeMarker(id: string): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.markerEl.remove()
      this.removeOutline(entry.target)
      this.markers.delete(id)
    }
  }

  updateStatus(id: string, status: AnnotationStatus): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.annotation.status = status
      entry.markerEl.className = `remarq-marker ${statusClass(status)}`
      entry.markerEl.setAttribute('data-status', status)
      this.applyOutline(entry.target, status, id === this.selectedId)
    }
  }

  /**
   * Thickens the outline of the selected annotation's element. Every annotated
   * element already carries a permanent status outline, so selection reads as a
   * heavier version of it rather than a separate highlight layer — which also
   * means it needs no positioning of its own and survives the rAF freeze that
   * hits embedded panes.
   */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return
    const previous = this.selectedId
    this.selectedId = id

    if (previous !== null) {
      const entry = this.markers.get(previous)
      if (entry) this.applyOutline(entry.target, entry.annotation.status, false)
    }
    if (id !== null) {
      const entry = this.markers.get(id)
      if (entry) this.applyOutline(entry.target, entry.annotation.status, true)
    }
  }

  /** Outlines hold resolved literals, so a theme switch has to repaint them. */
  refreshOutlines(): void {
    for (const [id, entry] of this.markers) {
      this.applyOutline(entry.target, entry.annotation.status, id === this.selectedId)
    }
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
      this.removeOutline(entry.target)
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

  /**
   * Resolves the status colour to a literal here rather than handing the page
   * element a `var(--remarq-status-*)`. Those custom properties are declared on
   * the themed container, and an annotated element is never inside it — the var
   * would not resolve, which invalidates the whole `outline` declaration at
   * computed-value time and renders no outline at all. The container carries the
   * theme attribute, so reading through it keeps the colour theme-correct.
   */
  private statusColor(status: AnnotationStatus): string {
    try {
      const resolved = getComputedStyle(this.container)
        .getPropertyValue(STATUS_VAR[status])
        .trim()
      if (resolved) return resolved
    } catch {
      // fall through to the literal
    }
    return STATUS_FALLBACK[status]
  }

  private applyOutline(target: HTMLElement, status: AnnotationStatus, selected: boolean): void {
    target.style.outline = `${selected ? 4 : 2}px solid ${this.statusColor(status)}`
    target.style.outlineOffset = selected ? '3px' : '2px'
  }

  private removeOutline(target: HTMLElement): void {
    target.style.outline = ''
    target.style.outlineOffset = ''
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

      entry.markerEl.style.top = `${window.scrollY + rect.top - MARKER_OFFSET}px`
      entry.markerEl.style.left = `${left}px`
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
