import type { Annotation } from '../core/types'

interface MarkerEntry {
  annotation: Annotation
  target: HTMLElement
  markerEl: HTMLElement
}

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
    markerEl.className = 'remarq-marker'
    markerEl.setAttribute('data-status', annotation.status)
    markerEl.setAttribute('data-annotation-id', annotation.id)
    markerEl.textContent = String(this.counter)
    markerEl.title = annotation.comment

    markerEl.addEventListener('click', () => {
      this.onClick?.(annotation.id)
    })

    this.container.appendChild(markerEl)
    this.markers.set(annotation.id, { annotation, target, markerEl })
    this.updatePosition(annotation.id)
  }

  removeMarker(id: string): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.markerEl.remove()
      this.markers.delete(id)
    }
  }

  updateStatus(id: string, status: 'pending' | 'resolved'): void {
    const entry = this.markers.get(id)
    if (entry) {
      entry.annotation.status = status
      entry.markerEl.setAttribute('data-status', status)
    }
  }

  clear(): void {
    for (const entry of this.markers.values()) {
      entry.markerEl.remove()
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

  private updatePosition(id: string): void {
    const entry = this.markers.get(id)
    if (!entry) return
    try {
      const rect = entry.target.getBoundingClientRect()
      entry.markerEl.style.top = `${window.scrollY + rect.top - 12}px`
      entry.markerEl.style.left = `${window.scrollX + rect.right - 12}px`
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
