import type { Annotation, AnnotationEvent, AnnotationStatus, AnnotationStore, StorageAdapter, StorageChangeEvent, StorageStatus } from './types'
import { StorageConflictError } from './types'
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

/** Strip the backend revision: the record is about to be written as a new one. */
function withoutRev(annotation: Annotation): Annotation {
  const { rev: _rev, ...rest } = annotation
  return rest
}

/**
 * Domain store over a pluggable adapter. The in-memory cache is updated
 * optimistically, but every mutation awaits the adapter and ROLLS BACK the
 * cache when the adapter rejects: a failed write is never shown as saved.
 * A `StorageConflictError` (revision-aware adapters) replaces the cached copy
 * with the backend's current one instead, so the UI shows what actually holds.
 * When the adapter resolves `save()` with the confirmed copy, that copy (with
 * the revision the backend assigned) replaces the cached one, so consecutive
 * edits never carry a stale revision.
 */
export class AnnotationStorage {
  private cache: Annotation[] = []
  private changeListener: ((event: StorageChangeEvent) => void) | null = null
  private unsubscribe: (() => void) | null = null
  private unsubscribeStatus: (() => void) | null = null
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
    try {
      const saved = await this.adapter.save(annotation)
      if (saved) this.replaceInCache(saved)
    } catch (err) {
      this.cache = this.cache.filter((a) => a.id !== annotation.id)
      throw err
    }
  }

  async remove(id: string): Promise<void> {
    const previous = this.cache
    this.cache = this.cache.filter((a) => a.id !== id)
    try {
      await this.adapter.remove(id)
    } catch (err) {
      this.cache = previous
      throw err
    }
  }

  async update(id: string, changes: Partial<Annotation>): Promise<void> {
    const idx = this.cache.findIndex((a) => a.id === id)
    if (idx === -1) return
    const before = this.cache[idx]
    const updated = { ...before, ...changes }
    this.cache[idx] = updated
    try {
      const saved = await this.adapter.save(updated)
      if (saved) this.replaceInCache(saved)
    } catch (err) {
      if (err instanceof StorageConflictError) {
        if (err.current) this.replaceInCache(migrateAnnotation(err.current))
        else this.cache = this.cache.filter((a) => a.id !== id)
      } else {
        this.replaceInCache(before)
      }
      throw err
    }
  }

  async clearAll(): Promise<void> {
    const previous = this.cache
    this.cache = []
    try {
      await this.adapter.clear()
    } catch (err) {
      this.cache = previous
      throw err
    }
  }

  exportJSON(): AnnotationStore {
    return {
      version: 1,
      annotations: [...this.cache],
    }
  }

  /**
   * Replace everything with `data`. Not transactional on adapters that only
   * offer clear()+save(): if a write fails part-way, the cache is restored and
   * the previous annotations are re-saved best-effort before the error is
   * rethrown, so the caller can tell the user and offer its backup copy.
   * Every record is written as a NEW one: an exported `rev` describes a row
   * that `clear()` just deleted (or another backend's row), so it is never
   * used as the expected revision of a conditional update.
   */
  async importJSON(data: AnnotationStore): Promise<void> {
    const previous = this.cache
    const imported = data.annotations.map(migrateAnnotation).map(withoutRev)
    this.cache = imported
    this.migrateViewportBuckets()
    try {
      await this.adapter.clear()
      for (const ann of imported) {
        const saved = await this.adapter.save(ann)
        if (saved) this.replaceInCache(saved)
      }
    } catch (err) {
      this.cache = previous
      for (const ann of previous) {
        try {
          const saved = await this.adapter.save(withoutRev(ann))
          if (saved) this.replaceInCache(saved)
        } catch {
          // best effort: the caller holds a backup copy
        }
      }
      throw err
    }
  }

  /** Notified after an EXTERNAL adapter change (another client / the agent)
   *  has been applied to the cache. Own mutations don't fire this. */
  onChange(callback: (event: StorageChangeEvent) => void): void {
    this.changeListener = callback
  }

  /** Sync-state notifications from adapters that report them (see StorageAdapter.onStatus). Fires immediately with the current state. */
  onStatus(callback: (status: StorageStatus) => void): void {
    this.unsubscribeStatus?.()
    this.unsubscribeStatus = this.adapter.onStatus?.(callback) ?? null
  }

  destroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeStatus?.()
    this.unsubscribeStatus = null
    this.changeListener = null
  }

  private replaceInCache(annotation: Annotation): void {
    const idx = this.cache.findIndex((a) => a.id === annotation.id)
    if (idx === -1) this.cache.push(annotation)
    else this.cache[idx] = annotation
  }

  private applyExternal(event: StorageChangeEvent): void {
    switch (event.type) {
      case 'add':
      case 'update': {
        if (!event.annotation) break
        this.replaceInCache(migrateAnnotation(event.annotation))
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
