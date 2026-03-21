import type { Annotation, AnnotationStore } from './types'

const STORAGE_KEY = 'remarq:annotations'

export class AnnotationStorage {
  private annotations: Annotation[] = []
  private extraFields: Record<string, unknown> = {}
  isMemoryOnly = false

  constructor() {
    this.load()
  }

  getAll(): Annotation[] {
    return [...this.annotations]
  }

  getByRoute(route: string): Annotation[] {
    return this.annotations.filter((a) => a.route === route)
  }

  add(annotation: Annotation): void {
    this.annotations.push(annotation)
    this.save()
  }

  remove(id: string): void {
    this.annotations = this.annotations.filter((a) => a.id !== id)
    this.save()
  }

  update(id: string, changes: Partial<Annotation>): void {
    const idx = this.annotations.findIndex((a) => a.id === id)
    if (idx !== -1) {
      this.annotations[idx] = { ...this.annotations[idx], ...changes }
      this.save()
    }
  }

  clearAll(): void {
    this.annotations = []
    this.save()
  }

  exportJSON(): AnnotationStore {
    return {
      version: 1,
      annotations: [...this.annotations],
    }
  }

  importJSON(data: AnnotationStore): void {
    this.annotations = [...data.annotations]
    this.save()
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        const { version, annotations, ...rest } = parsed
        this.annotations = annotations ?? []
        this.extraFields = rest
      }
    } catch {
      this.isMemoryOnly = true
    }
  }

  private save(): void {
    if (this.isMemoryOnly) return
    try {
      const data = {
        version: 1,
        ...this.extraFields,
        annotations: this.annotations,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      this.isMemoryOnly = true
    }
  }
}
