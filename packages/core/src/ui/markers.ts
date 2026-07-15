import type { Annotation, AnnotationStatus } from '../core/types'

interface MarkerEntry {
  annotation: Annotation
  target: HTMLElement
  markerEl: HTMLElement
}

const STATUS_COLOR: Record<AnnotationStatus, string> = {
  pending: 'var(--remarq-status-pending)',
  in_progress: 'var(--remarq-status-in-progress)',
  fixed_unverified: 'var(--remarq-status-fixed-unverified)',
  verified: 'var(--remarq-status-verified)',
  dismissed: 'var(--remarq-status-dismissed)',
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
    this.applyOutline(target, annotation.status)
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
      this.applyOutline(entry.target, status)
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
  }

  private applyOutline(target: HTMLElement, status: AnnotationStatus): void {
    const color = STATUS_COLOR[status]
    target.style.outline = `2px solid ${color}`
    target.style.outlineOffset = '2px'
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
