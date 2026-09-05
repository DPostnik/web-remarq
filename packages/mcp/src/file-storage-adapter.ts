import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Annotation, AnnotationStore, StorageAdapter } from 'web-remarq'
import { AnnotationNotFoundError } from 'web-remarq/core'
import { ensureSelfIgnored } from './local-config.js'

export type ConditionalWriteResult =
  | { ok: true; annotation: Annotation; rev: number }
  /** The record exists at a different revision than the caller expected. */
  | { ok: false; reason: 'conflict'; current: Annotation | null; rev: number }
  /** The record exists but the caller sent no expected revision. */
  | { ok: false; reason: 'precondition_required'; current: Annotation; rev: number }

/**
 * Local-mode StorageAdapter over a JSON file (default .remarq/annotations.json).
 * All mutations flow through this process (MCP tools + the local HTTP server) -
 * see `acquireStoreLock` for how a second process on the same store is refused -
 * so change notification is a plain in-memory emitter and one promise queue
 * serialises every read-check-write.
 *
 * Every annotation carries a per-record `rev` (1 on creation, +1 per accepted
 * write). Records written by older versions get `rev: 1` on load.
 */
export class FileStorageAdapter implements StorageAdapter {
  /** Monotonic store revision - bumps on every persisted mutation. Exposed via GET /store. */
  rev = 0
  private emitter = new EventEmitter()
  /** Serializes every read-check-write so concurrent ops observe each other's results. */
  private queue: Promise<void> = Promise.resolve()

  constructor(private filePath: string) {
    this.emitter.setMaxListeners(0)
  }

  async load(): Promise<AnnotationStore | null> {
    if (!existsSync(this.filePath)) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`annotations store corrupted at ${this.filePath}: ${message}`)
    }
    const store = parsed as { annotations?: unknown }
    const annotations = Array.isArray(store.annotations) ? (store.annotations as Annotation[]) : []
    return {
      version: 1,
      annotations: annotations.map((a) => (Number.isInteger(a.rev) && (a.rev as number) > 0 ? a : { ...a, rev: 1 })),
    }
  }

  /** Unconditional upsert (StorageAdapter contract). Bumps the record's rev. */
  async save(annotation: Annotation): Promise<void> {
    await this.enqueue(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      const idx = store.annotations.findIndex((a) => a.id === annotation.id)
      const nextRev = idx === -1 ? 1 : (store.annotations[idx].rev ?? 0) + 1
      const saved = { ...annotation, rev: nextRev }
      if (idx === -1) store.annotations.push(saved)
      else store.annotations[idx] = saved
      this.persist(store)
    })
  }

  /**
   * Revision-checked upsert used by the HTTP endpoint. `expectedRev` is the
   * revision the client last saw (`If-Match`); `null` means the client sent
   * none. Creating a new record needs no expectation; updating an existing one
   * requires a matching expectation, so a stale copy can never overwrite a
   * newer status or history.
   */
  saveIfMatch(annotation: Annotation, expectedRev: number | null): Promise<ConditionalWriteResult> {
    return this.enqueueResult(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      const idx = store.annotations.findIndex((a) => a.id === annotation.id)
      if (idx === -1) {
        if (expectedRev !== null && expectedRev !== 0) {
          return { ok: false, reason: 'conflict', current: null, rev: this.rev }
        }
        const saved = { ...annotation, rev: 1 }
        store.annotations.push(saved)
        this.persist(store)
        return { ok: true, annotation: saved, rev: this.rev }
      }
      const current = store.annotations[idx]
      if (expectedRev === null) {
        return { ok: false, reason: 'precondition_required', current, rev: this.rev }
      }
      if (expectedRev !== current.rev) {
        return { ok: false, reason: 'conflict', current, rev: this.rev }
      }
      const saved = { ...annotation, rev: (current.rev ?? 0) + 1 }
      store.annotations[idx] = saved
      this.persist(store)
      return { ok: true, annotation: saved, rev: this.rev }
    })
  }

  async remove(id: string): Promise<void> {
    const result = await this.removeIfMatch(id, null)
    if (!result.ok) throw new Error(`remove(${id}): unexpected ${result.reason}`)
  }

  /** Revision-checked delete; `expectedRev === null` skips the check. Deleting a missing id is a no-op success. */
  removeIfMatch(id: string, expectedRev: number | null): Promise<ConditionalWriteResult> {
    return this.enqueueResult(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      const current = store.annotations.find((a) => a.id === id) ?? null
      if (current && expectedRev !== null && expectedRev !== current.rev) {
        return { ok: false, reason: 'conflict', current, rev: this.rev }
      }
      store.annotations = store.annotations.filter((a) => a.id !== id)
      this.persist(store)
      return { ok: true, annotation: current ?? ({ id } as Annotation), rev: this.rev }
    })
  }

  async clear(): Promise<void> {
    await this.enqueue(async () => {
      this.persist({ version: 1, annotations: [] })
    })
  }

  /**
   * Atomic read-check-write: load, apply, persist inside one queue slot, so two
   * concurrent transitions on the same record see each other. `apply` throwing
   * aborts without persisting; returning the same object persists nothing.
   */
  mutate(id: string, apply: (current: Annotation) => Annotation): Promise<Annotation> {
    return this.enqueueResult(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      const idx = store.annotations.findIndex((a) => a.id === id)
      if (idx === -1) throw new AnnotationNotFoundError(id)
      const current = store.annotations[idx]
      const next = apply(current)
      if (next === current) return current
      const saved = { ...next, id, rev: (current.rev ?? 0) + 1 }
      store.annotations[idx] = saved
      this.persist(store)
      return saved
    })
  }

  /** Chains `op` onto the mutation queue; a rejected op doesn't poison later ops. */
  private enqueue(op: () => Promise<void>): Promise<void> {
    return this.enqueueResult(op)
  }

  private enqueueResult<T>(op: () => Promise<T>): Promise<T> {
    const result = this.queue.then(op)
    // Swallow the rejection on the shared chain so the next enqueued op still runs;
    // the caller's own `result` promise still rejects with the original error.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Resolves true on the next mutation, false after timeoutMs. */
  waitForChange(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const onChange = (): void => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        this.emitter.off('change', onChange)
        resolve(false)
      }, timeoutMs)
      this.emitter.once('change', onChange)
    })
  }

  /** Persistent listener for every persisted mutation (save/remove/clear/mutate). Conflicts and no-ops never fire it. */
  onChange(listener: () => void): void {
    this.emitter.on('change', listener)
  }

  private persist(store: AnnotationStore): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    // Auto-ignore the store when it lives in the conventional .remarq dir.
    // NEVER write a wildcard .gitignore into an arbitrary user directory.
    ensureSelfIgnored(dir)
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2))
    renameSync(tmp, this.filePath)
    this.rev++
    this.emitter.emit('change')
  }
}
