import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Annotation, AnnotationStore, StorageAdapter } from 'web-remarq'

/**
 * Local-mode StorageAdapter over a JSON file (default .remarq/annotations.json).
 * All mutations flow through this process (MCP tools + the local HTTP server),
 * so change notification is a plain in-memory emitter — no fs.watch needed.
 */
export class FileStorageAdapter implements StorageAdapter {
  /** Monotonic revision — bumps on every mutation. Exposed via GET /store. */
  rev = 0
  private emitter = new EventEmitter()
  /** Serializes mutations (save/remove/clear) so concurrent read-modify-write ops don't clobber each other. */
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
    return {
      version: 1,
      annotations: Array.isArray(store.annotations) ? (store.annotations as Annotation[]) : [],
    }
  }

  async save(annotation: Annotation): Promise<void> {
    return this.enqueue(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      const idx = store.annotations.findIndex((a) => a.id === annotation.id)
      if (idx === -1) store.annotations.push(annotation)
      else store.annotations[idx] = annotation
      this.persist(store)
    })
  }

  async remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
      store.annotations = store.annotations.filter((a) => a.id !== id)
      this.persist(store)
    })
  }

  async clear(): Promise<void> {
    return this.enqueue(async () => {
      this.persist({ version: 1, annotations: [] })
    })
  }

  /** Chains `op` onto the mutation queue; a rejected op doesn't poison later ops. */
  private enqueue(op: () => Promise<void>): Promise<void> {
    const result = this.queue.then(op)
    // Swallow the rejection on the shared chain so the next enqueued op still runs;
    // the caller's own `result` promise still rejects with the original error.
    this.queue = result.catch(() => undefined)
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

  private persist(store: AnnotationStore): void {
    const dir = dirname(this.filePath)
    mkdirSync(dir, { recursive: true })
    // Auto-ignore the store when it lives in the conventional .remarq dir.
    // NEVER write a wildcard .gitignore into an arbitrary user directory.
    if (basename(dir) === '.remarq') {
      const gitignore = join(dir, '.gitignore')
      if (!existsSync(gitignore)) writeFileSync(gitignore, '*\n')
    }
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2))
    renameSync(tmp, this.filePath)
    this.rev++
    this.emitter.emit('change')
  }
}
