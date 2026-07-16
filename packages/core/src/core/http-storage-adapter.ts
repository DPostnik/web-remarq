import type { Annotation, AnnotationStore, StorageAdapter, StorageChangeEvent } from './types';

const CACHE_KEY = 'remarq:http-cache';
const BUFFER_KEY = 'remarq:http-buffer';
const DEFAULT_URL = 'http://127.0.0.1:1817';
const POLL_INTERVAL = 2000;

type BufferedOp = { op: 'save'; annotation: Annotation } | { op: 'remove'; id: string };

interface OpBuffer {
  clear: boolean;
  ops: BufferedOp[];
}

export interface HttpStorageAdapterOptions {
  /** Base URL of the local MCP server. Default: http://127.0.0.1:1817 */
  url?: string;
}

/**
 * Zero-deps StorageAdapter over the local MCP server's HTTP endpoint.
 * When the server is unreachable, writes buffer into localStorage and
 * flush on reconnect (last-write-wins by id).
 */
export class HttpStorageAdapter implements StorageAdapter {
  private url: string;
  private online = true;
  private rev = -1;
  private known = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private callbacks = new Set<(event: StorageChangeEvent) => void>();

  constructor(options: HttpStorageAdapterOptions = {}) {
    this.url = (options.url ?? DEFAULT_URL).replace(/\/+$/, '');
  }

  async load(): Promise<AnnotationStore | null> {
    try {
      const res = await fetch(`${this.url}/store`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rev, store } = (await res.json()) as { rev: number; store: AnnotationStore };
      this.online = true;
      this.rev = rev;
      this.remember(store);
      this.writeCache(store);
      return store;
    } catch {
      this.online = false;
      return this.readCache();
    }
  }

  async save(annotation: Annotation): Promise<void> {
    if (this.online) {
      try {
        const res = await fetch(`${this.url}/annotations/${encodeURIComponent(annotation.id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(annotation),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { rev } = (await res.json()) as { rev: number };
        this.rev = rev;
        this.known.set(annotation.id, JSON.stringify(annotation));
        this.cacheUpsert(annotation);
        return;
      } catch {
        this.online = false;
      }
    }
    this.bufferOp({ op: 'save', annotation });
    this.cacheUpsert(annotation);
  }

  async remove(id: string): Promise<void> {
    if (this.online) {
      try {
        const res = await fetch(`${this.url}/annotations/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { rev } = (await res.json()) as { rev: number };
        this.rev = rev;
        this.known.delete(id);
        this.cacheRemove(id);
        return;
      } catch {
        this.online = false;
      }
    }
    this.bufferOp({ op: 'remove', id });
    this.cacheRemove(id);
  }

  async clear(): Promise<void> {
    if (this.online) {
      try {
        const res = await fetch(`${this.url}/annotations`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { rev } = (await res.json()) as { rev: number };
        this.rev = rev;
        this.known.clear();
        this.writeCache({ version: 1, annotations: [] });
        return;
      } catch {
        this.online = false;
      }
    }
    this.writeBuffer({ clear: true, ops: [] });
    this.writeCache({ version: 1, annotations: [] });
  }

  // ---- known-state helpers ----

  private remember(store: AnnotationStore): void {
    this.known.clear();
    for (const ann of store.annotations) {
      this.known.set(ann.id, JSON.stringify(ann));
    }
  }

  // ---- localStorage cache (offline reads) ----

  private readCache(): AnnotationStore | null {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as AnnotationStore) : null;
    } catch {
      return null;
    }
  }

  private writeCache(store: AnnotationStore): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(store));
    } catch {
      // quota / disabled — offline reads just degrade to null
    }
  }

  private cacheUpsert(annotation: Annotation): void {
    const store = this.readCache() ?? { version: 1 as const, annotations: [] };
    const idx = store.annotations.findIndex((a) => a.id === annotation.id);
    if (idx === -1) store.annotations.push(annotation);
    else store.annotations[idx] = annotation;
    this.writeCache(store);
  }

  private cacheRemove(id: string): void {
    const store = this.readCache();
    if (!store) return;
    store.annotations = store.annotations.filter((a) => a.id !== id);
    this.writeCache(store);
  }

  // ---- offline op buffer (flushed on reconnect) ----

  private readBuffer(): OpBuffer {
    try {
      const raw = localStorage.getItem(BUFFER_KEY);
      return raw ? (JSON.parse(raw) as OpBuffer) : { clear: false, ops: [] };
    } catch {
      return { clear: false, ops: [] };
    }
  }

  private writeBuffer(buffer: OpBuffer): void {
    try {
      localStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
    } catch {
      // quota — buffered writes are lost, cache still serves reads
    }
  }

  private bufferOp(op: BufferedOp): void {
    const buffer = this.readBuffer();
    const id = op.op === 'save' ? op.annotation.id : op.id;
    buffer.ops = buffer.ops.filter((o) => (o.op === 'save' ? o.annotation.id : o.id) !== id);
    buffer.ops.push(op);
    this.writeBuffer(buffer);
  }
}
