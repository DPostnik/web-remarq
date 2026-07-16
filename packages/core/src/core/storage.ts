import type { Annotation, AnnotationEvent, AnnotationStatus, AnnotationStore, StorageAdapter, StorageChangeEvent } from './types'
import { toBucket } from './viewport'

export function migrateAnnotation(legacy: any): Annotation {
  const rawStatus = legacy.status
  const status: AnnotationStatus =
    rawStatus === 'resolved' ? 'verified' : rawStatus

  if (Array.isArray(legacy.lifecycle) && legacy.lifecycle.length > 0) {
    return { ...legacy, status, lifecycle: legacy.lifecycle }
  }

  const createdTs = typeof legacy.timestamp === 'number' ? legacy.timestamp : Date.now()
  const lifecycle: AnnotationEvent[] = [
    { type: 'created', actor: 'designer', timestamp: createdTs },
  ]
  if (rawStatus === 'resolved') {
    lifecycle.push({ type: 'migrated', actor: null, timestamp: Date.now() })
  }

  return { ...legacy, status, lifecycle }
}

export class AnnotationStorage {
  private cache: Annotation[] = []
  private changeListener: ((event: StorageChangeEvent) => void) | null = null
  private unsubscribe: (() => void) | null = null
  readonly ready: Promise<void>

  constructor(private adapter: StorageAdapter) {
    this.ready = this.init()
    if (adapter.subscribe) {
      this.unsubscribe = adapter.subscribe((event) => this.applyExternal(event))
    }
  }

  get isMemoryOnly(): boolean {
    return this.adapter.isMemoryOnly ?? false
  }

  getAll(): Annotation[] {
    return [...this.cache]
  }

  getByRoute(route: string): Annotation[] {
    return this.cache.filter((a) => a.route === route)
  }

  getById(id: string): Annotation | undefined {
    return this.cache.find((a) => a.id === id)
  }

  async add(annotation: Annotation): Promise<void> {
    this.cache.push(annotation)
    await this.adapter.save(annotation)
  }

  async remove(id: string): Promise<void> {
    this.cache = this.cache.filter((a) => a.id !== id)
    await this.adapter.remove(id)
  }

  async update(id: string, changes: Partial<Annotation>): Promise<void> {
    const idx = this.cache.findIndex((a) => a.id === id)
    if (idx === -1) return
    const updated = { ...this.cache[idx], ...changes }
    this.cache[idx] = updated
    await this.adapter.save(updated)
  }

  async clearAll(): Promise<void> {
    this.cache = []
    await this.adapter.clear()
  }

  exportJSON(): AnnotationStore {
    return {
      version: 1,
      annotations: [...this.cache],
    }
  }

  async importJSON(data: AnnotationStore): Promise<void> {
    this.cache = data.annotations.map(migrateAnnotation)
    this.migrateViewportBuckets()
    await this.adapter.clear()
    for (const ann of this.cache) {
      await this.adapter.save(ann)
    }
  }

  /** Notified after an EXTERNAL adapter change (another client / the agent)
   *  has been applied to the cache. Own mutations don't fire this. */
  onChange(callback: (event: StorageChangeEvent) => void): void {
    this.changeListener = callback
  }

  destroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.changeListener = null
  }

  private applyExternal(event: StorageChangeEvent): void {
    switch (event.type) {
      case 'add':
      case 'update': {
        if (!event.annotation) break
        const ann = migrateAnnotation(event.annotation)
        const idx = this.cache.findIndex((a) => a.id === ann.id)
        if (idx === -1) this.cache.push(ann)
        else this.cache[idx] = ann
        break
      }
      case 'remove':
        if (event.id) this.cache = this.cache.filter((a) => a.id !== event.id)
        break
      case 'clear':
        this.cache = []
        break
    }
    this.changeListener?.(event)
  }

  private async init(): Promise<void> {
    const data = await this.adapter.load()
    if (data) {
      this.cache = data.annotations.map(migrateAnnotation)
      this.migrateViewportBuckets()
    }
  }

  private migrateViewportBuckets(): void {
    for (const ann of this.cache) {
      if (ann.viewportBucket == null && ann.viewport) {
        const width = parseInt(ann.viewport.split('x')[0], 10)
        ann.viewportBucket = toBucket(width)
      }
    }
  }
}
