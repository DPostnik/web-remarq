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

  subscribe(callback: (event: StorageChangeEvent) => void): () => void {
    this.callbacks.add(callback);
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL);
    }
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      if (!this.online) {
        // Reconnect probe: replay buffered writes FIRST so they win over the
        // server copy (last-write-wins), then read fresh state below. Flush
        // succeeding is what flips `online` back to true — that's the
        // reconnect signal for the rest of the adapter (save/remove/clear).
        await this.flush();
        this.online = true;
      }
      const res = await fetch(`${this.url}/store`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rev, store } = (await res.json()) as { rev: number; store: AnnotationStore };
      this.rev = rev;
      this.diffAndEmit(store);
      this.writeCache(store);
    } catch {
      this.online = false;
    } finally {
      this.polling = false;
    }
  }

  private diffAndEmit(store: AnnotationStore): void {
    const next = new Map<string, string>();
    for (const annotation of store.annotations) {
      next.set(annotation.id, JSON.stringify(annotation));
    }
    for (const [id, json] of next) {
      const prev = this.known.get(id);
      if (prev === undefined) this.emit({ type: 'add', annotation: JSON.parse(json) });
      else if (prev !== json) this.emit({ type: 'update', annotation: JSON.parse(json) });
    }
    for (const id of this.known.keys()) {
      if (!next.has(id)) this.emit({ type: 'remove', id });
    }
    this.known = next;
  }

  private emit(event: StorageChangeEvent): void {
    for (const cb of this.callbacks) cb(event);
  }

  /** Replay buffered offline ops. Throws if the server is still unreachable. */
  private async flush(): Promise<void> {
    const snapshot = this.readBuffer();
    if (snapshot.clear) {
      const res = await fetch(`${this.url}/annotations`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    for (const op of snapshot.ops) {
      if (op.op === 'save') {
        const res = await fetch(`${this.url}/annotations/${encodeURIComponent(op.annotation.id)}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(op.annotation),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        const res = await fetch(`${this.url}/annotations/${encodeURIComponent(op.id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
    }

    // Ops may have been buffered by a concurrent save()/remove()/clear() while
    // still offline during the awaited replay above - re-read rather than
    // blindly clearing, so those don't get silently dropped.
    const current = this.readBuffer();
    if (JSON.stringify(current) === JSON.stringify(snapshot)) {
      try {
        localStorage.removeItem(BUFFER_KEY);
      } catch {
        // ignore
      }
      return;
    }
    const replayed = new Set(snapshot.ops.map((op) => JSON.stringify(op)));
    this.writeBuffer({
      clear: snapshot.clear ? false : current.clear,
      ops: current.ops.filter((op) => !replayed.has(JSON.stringify(op))),
    });
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
