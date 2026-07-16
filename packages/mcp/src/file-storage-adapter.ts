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

  constructor(private filePath: string) {
    this.emitter.setMaxListeners(0)
  }

  async load(): Promise<AnnotationStore | null> {
    if (!existsSync(this.filePath)) return null
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
    return {
      version: 1,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
    }
  }

  async save(annotation: Annotation): Promise<void> {
    const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
    const idx = store.annotations.findIndex((a) => a.id === annotation.id)
    if (idx === -1) store.annotations.push(annotation)
    else store.annotations[idx] = annotation
    this.persist(store)
  }

  async remove(id: string): Promise<void> {
    const store = (await this.load()) ?? { version: 1 as const, annotations: [] }
    store.annotations = store.annotations.filter((a) => a.id !== id)
    this.persist(store)
  }

  async clear(): Promise<void> {
    this.persist({ version: 1, annotations: [] })
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
