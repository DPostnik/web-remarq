import type {
  Annotation,
  AnnotationStore,
  StorageAdapter,
  StorageChangeEvent,
  StorageStatus,
  StorageSyncState,
} from './types';
import { mergeAnnotation } from './merge';

const DEFAULT_URL = 'http://127.0.0.1:1817';
const DEFAULT_CONFIG_PATH = '/__web-remarq/config.json';
const POLL_INTERVAL = 2000;
export const HTTP_PROTOCOL_VERSION = 2;

const KEY_PREFIX = 'remarq:http:';
const LEGACY_CACHE_KEY = 'remarq:http-cache';
const LEGACY_BUFFER_KEY = 'remarq:http-buffer';
const LEGACY_NAMESPACE = 'legacy';

/**
 * Queued operation (outbox format 2). `base` is the server copy the operation
 * was made from - the merge base when the write later collides with a newer
 * server copy. It is stored with the operation because the adapter's
 * in-memory view does not survive a reload; `baseRev` alone cannot say which
 * fields the user actually changed. Null when the record was unknown at the
 * time (a new record, or an operation from format 1): such a collision is
 * merged conservatively, see `mergeAnnotation`.
 */
export type OutboxOp =
  | { opId: string; kind: 'save'; annotation: Annotation; baseRev: number | null; base?: Annotation | null }
  | { opId: string; kind: 'remove'; id: string; baseRev: number | null; base?: Annotation | null }
  | { opId: string; kind: 'clear' };

const OUTBOX_VERSION = 2;

export interface ParkedOp {
  op: OutboxOp;
  reason: string;
  at: number;
}

export interface ConflictRecord {
  /**
   * Identity of the operation that collided (its outbox opId, or a fresh id
   * for a live write). Replaying the same operation - after a crash between
   * the conflict write and the outbox drop, or a retry - replaces the record
   * instead of adding a second one.
   */
  opId: string;
  /** The local copy whose changes (all or some) did not make it to the server. */
  local: Annotation;
  /** The server copy that won (null when the server had deleted the record). */
  server: Annotation | null;
  /** Which local fields/events were dropped. */
  dropped: string[];
  at: number;
}

export interface UnsentSummary {
  namespace: string;
  ops: number;
}

export interface HttpStorageAdapterOptions {
  /** Base URL of the local MCP server. Default: http://127.0.0.1:1817 */
  url?: string;
  /**
   * Bearer token from `.remarq/config.json`. When omitted the adapter looks for
   * one pasted earlier through `pair()`, then asks the dev server for it at
   * `configUrl` (served by @web-remarq/unplugin in development only).
   */
  token?: string;
  /** Same-origin endpoint that serves `{ token }` in development. `false` disables the lookup. Default: /__web-remarq/config.json */
  configUrl?: string | false;
}

type StoreFetch =
  | { kind: 'store'; rev: number; projectId: string; store: AnnotationStore }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'incompatible' };

/**
 * `held`: the operation collided and its conflict record could NOT be written
 * durably (localStorage failed). The record lives in memory only, so the
 * queued operation - the last durable copy of the intent - must stay in the
 * outbox; it is not replayed again in this session.
 */
type SendOutcome = 'sent' | 'offline' | 'unauthorized' | 'parked' | 'held';

/**
 * Zero-deps StorageAdapter over the local MCP server's HTTP endpoint (protocol 2).
 *
 * Durability contract - three distinct states, never collapsed:
 * - `synced`: the server confirmed the write (it returned the record with its rev).
 * - `queued`: the server was unreachable; the write sits in a per-project outbox
 *   in localStorage and is replayed, in order, as soon as the server answers.
 * - `memory`: localStorage is unavailable too; the write lives in this tab only.
 *
 * Project identity: the server names its project in every `/store` reply. The
 * cache and outbox are keyed by that id, so a different project served later
 * on the same port never receives another project's queue; a queue built
 * before any server was ever seen is kept under an "unknown" namespace and is
 * only sent after an explicit `adoptUnsent()`.
 *
 * Revisions: every write carries `If-Match` with the revision last seen for
 * that record. A 409 is resolved by a three-way merge onto the server copy
 * (see `mergeAnnotation`) against the copy the write was made from - kept in
 * memory for live writes and stored with the queued operation otherwise, so a
 * reload does not turn a partial edit into an overwrite. Whatever local intent
 * cannot be kept is recorded in a per-project conflict journal in localStorage
 * (written BEFORE the queued operation is dropped, so a crash in between
 * replays the operation and replaces the record rather than losing it) and
 * surfaced through `onStatus` and `exportUnsent()` until an explicit
 * `clearParked()`. It is never silently discarded and never allowed to roll
 * back a newer server status. When the journal itself cannot be written the
 * operation stays in the outbox and the state says `memory`.
 */
export class HttpStorageAdapter implements StorageAdapter {
  private url: string;
  private token: string | null;
  private configUrl: string | false;

  private namespace: string;
  private online = true;
  private authFailed = false;
  private originRefused = false;
  private incompatible = false;
  private memoryOnly = false;
  private rev = -1;
  private known = new Map<string, string>();
  private chain: Promise<unknown> = Promise.resolve();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private callbacks = new Set<(event: StorageChangeEvent) => void>();
  private statusCallbacks = new Set<(status: StorageStatus) => void>();
  private lastStatusJson = '';
  /** Overlay used once localStorage fails: values written since, `null` = removed since. */
  private mem = new Map<string, string | null>();
  /** Outbox operations whose conflict could not be journaled durably; kept queued, not replayed in this session. */
  private heldOps = new Set<string>();

  constructor(options: HttpStorageAdapterOptions = {}) {
    this.url = (options.url ?? DEFAULT_URL).replace(/\/+$/, '');
    this.token = options.token ?? this.getItem(this.tokenKey());
    this.configUrl = options.configUrl ?? DEFAULT_CONFIG_PATH;
    this.migrateLegacyKeys();
    this.namespace = this.getItem(this.lastProjectKey()) ?? this.unknownNamespace();
  }

  // ---------------------------------------------------------------- StorageAdapter

  async load(): Promise<AnnotationStore | null> {
    return this.run(async () => {
      await this.ensureToken();
      const first = await this.fetchStore();
      if (first.kind !== 'store') {
        this.emitStatus();
        return this.readCache();
      }
      this.adoptServer(first);
      // Replay the outbox BEFORE the server copy replaces what the user sees:
      // pending operations, not an online flag, decide whether there is
      // something to send.
      const sent = await this.flushOutbox();
      const fresh = sent > 0 ? await this.fetchStore() : first;
      const snapshot = fresh.kind === 'store' ? fresh : first;
      this.rev = snapshot.rev;
      this.remember(snapshot.store);
      this.writeCache(snapshot.store);
      this.emitStatus();
      return snapshot.store;
    });
  }

  async save(annotation: Annotation): Promise<void> {
    return this.run(async () => {
      const base = this.knownAnnotation(annotation.id);
      const baseRev = base?.rev ?? annotation.rev ?? null;
      this.cacheUpsert(annotation);
      const opId = this.newOpId();
      if (this.canSend()) {
        const outcome = await this.sendSave(annotation, baseRev, opId, base);
        if (outcome === 'sent' || outcome === 'parked' || outcome === 'held') {
          this.emitStatus();
          return;
        }
      }
      this.enqueue({ opId, kind: 'save', annotation, baseRev, base });
      this.emitStatus();
    });
  }

  async remove(id: string): Promise<void> {
    return this.run(async () => {
      const base = this.knownAnnotation(id);
      const baseRev = base?.rev ?? null;
      this.cacheRemove(id);
      const opId = this.newOpId();
      if (this.canSend()) {
        const outcome = await this.sendRemove(id, baseRev, opId, base);
        if (outcome === 'sent' || outcome === 'parked' || outcome === 'held') {
          this.emitStatus();
          return;
        }
      }
      this.enqueue({ opId, kind: 'remove', id, baseRev, base });
      this.emitStatus();
    });
  }

  async clear(): Promise<void> {
    return this.run(async () => {
      this.writeCache({ version: 1, annotations: [] });
      if (this.canSend()) {
        const outcome = await this.sendClear();
        if (outcome === 'sent') {
          this.emitStatus();
          return;
        }
      }
      this.enqueue({ opId: this.newOpId(), kind: 'clear' });
      this.emitStatus();
    });
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

  onStatus(callback: (status: StorageStatus) => void): () => void {
    this.statusCallbacks.add(callback);
    callback(this.getStatus());
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  get isMemoryOnly(): boolean {
    return this.memoryOnly;
  }

  // ---------------------------------------------------------------- public extras

  getStatus(): StorageStatus {
    const outbox = this.readOutbox().ops.length;
    const parked = this.readParked().length;
    const conflicts = this.readConflicts().length;
    const unsent = this.listUnsent().reduce((n, u) => n + u.ops, 0);
    let state: StorageSyncState;
    let message: string | undefined;
    if (this.memoryOnly) {
      state = 'memory';
      message = 'localStorage unavailable: changes survive only until reload';
      if (conflicts > 0) message += `; ${conflicts} conflict${conflicts === 1 ? '' : 's'} kept in memory only - export them before reloading`;
    } else if (this.incompatible) {
      state = 'incompatible';
      message = `the local server speaks an older protocol; upgrade @web-remarq/mcp (needs protocol ${HTTP_PROTOCOL_VERSION})`;
    } else if (this.authFailed) {
      state = 'unauthorized';
      const origin = typeof location !== 'undefined' ? location.origin : 'this origin';
      message = this.originRefused
        ? `the local server is up but does not allow ${origin}; add it to allowedOrigins in .remarq/config.json and restart the server`
        : this.token
          ? 'the local server refused the token; it may have been rotated - pair again'
          : 'not paired with the local server: no token (start the dev server with the remarq plugin, or paste the token from .remarq/config.json)';
    } else if (!this.online || outbox > 0) {
      state = 'queued';
      message = outbox > 0
        ? `${outbox} change${outbox === 1 ? '' : 's'} saved locally, waiting for the server`
        : 'local server unreachable; new changes will be saved locally until it is back';
    } else if (parked > 0) {
      state = 'rejected';
      message = `${parked} change${parked === 1 ? '' : 's'} rejected by the server (kept locally, not retried)`;
    } else if (conflicts > 0) {
      state = 'conflict';
      message = `${conflicts} change${conflicts === 1 ? '' : 's'} collided with newer server copies (kept locally)`;
    } else {
      state = 'synced';
    }
    if (unsent > 0) {
      message = `${message ? `${message}; ` : ''}${unsent} unsent change${unsent === 1 ? '' : 's'} from an unknown project await adoptUnsent()`;
    }
    return { state, pending: outbox + parked, ...(message ? { message } : {}) };
  }

  /** Store a token pasted by the user (kept in localStorage for this endpoint) and reconnect. */
  async pair(token: string): Promise<void> {
    this.token = token.trim();
    this.setItem(this.tokenKey(), this.token);
    this.authFailed = false;
    this.originRefused = false;
    this.incompatible = false;
    await this.load();
  }

  /** Queued operations that belong to no known project (built before any server was seen, or migrated from an older widget). */
  listUnsent(): UnsentSummary[] {
    const out: UnsentSummary[] = [];
    for (const ns of [this.unknownNamespace(), LEGACY_NAMESPACE]) {
      if (ns === this.namespace) continue;
      const count = this.readOutbox(ns).ops.length;
      if (count > 0) out.push({ namespace: ns, ops: count });
    }
    return out;
  }

  /** Move unknown-project queues into the current project's outbox and replay them. Returns the number of adopted operations. */
  async adoptUnsent(): Promise<number> {
    return this.run(async () => {
      let adopted = 0;
      for (const { namespace } of this.listUnsent()) {
        const foreign = this.readOutbox(namespace);
        const mine = this.readOutbox();
        for (const op of foreign.ops) {
          // Made against no known server copy: no revision and no merge base to trust.
          mine.ops.push(op.kind === 'clear' ? op : { ...op, baseRev: null, base: null });
          adopted++;
        }
        this.writeOutbox(mine);
        this.removeItem(this.outboxKey(namespace));
      }
      if (adopted > 0 && this.canSend()) await this.flushOutbox();
      this.emitStatus();
      return adopted;
    });
  }

  /** Everything that has not reached the server: queues of every namespace, parked ops, and conflict records. For export/backup. */
  exportUnsent(): { url: string; namespace: string; outboxes: Record<string, OutboxOp[]>; rejected: ParkedOp[]; conflicts: ConflictRecord[] } {
    const outboxes: Record<string, OutboxOp[]> = {};
    const own = this.readOutbox();
    if (own.ops.length) outboxes[this.namespace] = own.ops;
    for (const { namespace } of this.listUnsent()) outboxes[namespace] = this.readOutbox(namespace).ops;
    return { url: this.url, namespace: this.namespace, outboxes, rejected: this.readParked(), conflicts: this.readConflicts() };
  }

  /** Drop parked (rejected) operations and conflict records of the current project after the user exported or reviewed them. */
  clearParked(): void {
    this.removeItem(this.parkedKey());
    this.removeItem(this.conflictsKey());
    this.emitStatus();
  }

  // ---------------------------------------------------------------- polling

  private async poll(): Promise<void> {
    if (this.polling || this.authFailed || this.incompatible) return;
    this.polling = true;
    try {
      await this.run(async () => {
        const first = await this.fetchStore();
        if (first.kind !== 'store') {
          this.emitStatus();
          return;
        }
        this.adoptServer(first);
        const sent = await this.flushOutbox();
        const snapshot = sent > 0 ? await this.fetchStore() : first;
        if (snapshot.kind !== 'store') return;
        this.rev = snapshot.rev;
        this.diffAndEmit(snapshot.store);
        this.writeCache(snapshot.store);
        this.emitStatus();
      });
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

  private emitStatus(): void {
    const status = this.getStatus();
    const json = JSON.stringify(status);
    if (json === this.lastStatusJson) return;
    this.lastStatusJson = json;
    for (const cb of this.statusCallbacks) cb(status);
  }

  // ---------------------------------------------------------------- transport

  private canSend(): boolean {
    return this.online && !this.authFailed && !this.incompatible;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async ensureToken(): Promise<void> {
    if (this.token || this.configUrl === false) return;
    if (typeof location === 'undefined') return;
    try {
      const res = await fetch(this.configUrl, { headers: { accept: 'application/json' } });
      if (!res.ok) return;
      const body = (await res.json()) as { token?: unknown };
      if (typeof body.token === 'string' && body.token.length > 0) this.token = body.token;
    } catch {
      // no dev-server config endpoint: pairing has to happen through pair()
    }
  }

  private async fetchStore(): Promise<StoreFetch> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/store`, { headers: this.headers() });
    } catch {
      // A dead socket and a CORS refusal both surface as a TypeError. /health
      // answers every origin without data: if it is reachable, the server is up
      // and this page's origin is what it refuses.
      if (await this.serverAlive()) {
        this.authFailed = true;
        this.originRefused = true;
        return { kind: 'unauthorized' };
      }
      this.online = false;
      return { kind: 'offline' };
    }
    if (res.status === 401 || res.status === 403) {
      this.authFailed = true;
      return { kind: 'unauthorized' };
    }
    if (!res.ok) {
      this.online = false;
      return { kind: 'offline' };
    }
    let body: { rev?: unknown; protocol?: unknown; projectId?: unknown; store?: unknown };
    try {
      body = await res.json();
    } catch {
      this.online = false;
      return { kind: 'offline' };
    }
    if (body.protocol !== HTTP_PROTOCOL_VERSION || typeof body.projectId !== 'string') {
      this.incompatible = true;
      return { kind: 'incompatible' };
    }
    this.online = true;
    this.authFailed = false;
    this.originRefused = false;
    this.incompatible = false;
    const store = body.store as AnnotationStore;
    return { kind: 'store', rev: typeof body.rev === 'number' ? body.rev : 0, projectId: body.projectId, store };
  }

  private async serverAlive(): Promise<boolean> {
    try {
      const res = await fetch(`${this.url}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private adoptServer(snapshot: Extract<StoreFetch, { kind: 'store' }>): void {
    if (this.namespace !== snapshot.projectId) {
      this.namespace = snapshot.projectId;
      this.setItem(this.lastProjectKey(), snapshot.projectId);
    }
  }

  private async sendSave(annotation: Annotation, baseRev: number | null, opId: string, base: Annotation | null): Promise<SendOutcome> {
    const { rev: _rev, ...payload } = annotation;
    let res: Response;
    try {
      res = await fetch(`${this.url}/annotations/${encodeURIComponent(annotation.id)}`, {
        method: 'PUT',
        headers: this.headers({ 'content-type': 'application/json', ...(baseRev !== null ? { 'if-match': String(baseRev) } : {}) }),
        body: JSON.stringify(payload),
      });
    } catch {
      this.online = false;
      return 'offline';
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { rev?: number; annotation?: Annotation };
      if (typeof body.rev === 'number') this.rev = body.rev;
      this.confirm(body.annotation ?? annotation);
      return 'sent';
    }
    if (res.status === 401 || res.status === 403) {
      this.authFailed = true;
      return 'unauthorized';
    }
    if (res.status === 409 || res.status === 428) {
      const body = (await res.json().catch(() => ({}))) as { details?: { current?: Annotation | null } };
      return this.resolveConflict(annotation, body.details?.current ?? null, opId, base);
    }
    if (res.status >= 500) {
      this.online = false;
      return 'offline';
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    this.park({ opId, kind: 'save', annotation, baseRev }, `HTTP ${res.status}${body.error ? `: ${body.error}` : ''}${body.details ? ` ${JSON.stringify(body.details)}` : ''}`);
    return 'parked';
  }

  private async sendRemove(id: string, baseRev: number | null, opId: string, base: Annotation | null): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/annotations/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.headers(baseRev !== null ? { 'if-match': String(baseRev) } : {}),
      });
    } catch {
      this.online = false;
      return 'offline';
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { rev?: number };
      if (typeof body.rev === 'number') this.rev = body.rev;
      this.known.delete(id);
      return 'sent';
    }
    if (res.status === 401 || res.status === 403) {
      this.authFailed = true;
      return 'unauthorized';
    }
    if (res.status === 409) {
      // The record moved on the server since we decided to delete it. The server copy
      // wins (an agent may be working on it); the intent is kept for review.
      const body = (await res.json().catch(() => ({}))) as { details?: { current?: Annotation | null } };
      const current = body.details?.current ?? null;
      const local = base ?? current;
      const durable = local ? this.recordConflict({ opId, local, server: current, dropped: ['delete'], at: Date.now() }) : true;
      if (current) this.confirm(current);
      return durable ? 'parked' : 'held';
    }
    if (res.status >= 500) {
      this.online = false;
      return 'offline';
    }
    this.park({ opId: this.newOpId(), kind: 'remove', id, baseRev }, `HTTP ${res.status}`);
    return 'parked';
  }

  private async sendClear(): Promise<SendOutcome> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/annotations`, { method: 'DELETE', headers: this.headers() });
    } catch {
      this.online = false;
      return 'offline';
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { rev?: number };
      if (typeof body.rev === 'number') this.rev = body.rev;
      this.known.clear();
      return 'sent';
    }
    if (res.status === 401 || res.status === 403) {
      this.authFailed = true;
      return 'unauthorized';
    }
    this.online = false;
    return 'offline';
  }

  /**
   * 409/428 handling: merge the local copy onto the server's against `base`
   * (the copy the local edit was made from; null = unknown, merged
   * conservatively), retry once with the server's revision, and record
   * whatever local intent did not survive. The in-memory view is deliberately
   * NOT used as a fallback base: after a reload it describes the server's
   * current copy, and merging against that would turn every difference into a
   * "local edit" that overwrites the server.
   */
  private async resolveConflict(local: Annotation, current: Annotation | null, opId: string, base: Annotation | null): Promise<SendOutcome> {
    if (current === null) {
      // Deleted on the server: recreating from a stale copy would resurrect it.
      const durable = this.recordConflict({ opId, local, server: null, dropped: ['*'], at: Date.now() });
      this.known.delete(local.id);
      this.cacheRemove(local.id);
      this.emit({ type: 'remove', id: local.id });
      return durable ? 'parked' : 'held';
    }
    const merged = mergeAnnotation(base, local, current);
    let durable = true;
    if (merged.dropped.length > 0) {
      durable = this.recordConflict({ opId, local, server: current, dropped: merged.dropped, at: Date.now() });
    }
    if (!merged.changed) {
      this.confirm(current);
      return durable ? 'parked' : 'held';
    }
    const { rev: _rev, ...payload } = merged.annotation;
    let res: Response;
    try {
      res = await fetch(`${this.url}/annotations/${encodeURIComponent(local.id)}`, {
        method: 'PUT',
        headers: this.headers({ 'content-type': 'application/json', 'if-match': String(current.rev ?? 0) }),
        body: JSON.stringify(payload),
      });
    } catch {
      this.online = false;
      return 'offline';
    }
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { rev?: number; annotation?: Annotation };
      if (typeof body.rev === 'number') this.rev = body.rev;
      this.confirm(body.annotation ?? merged.annotation);
      if (merged.dropped.length === 0) return 'sent';
      return durable ? 'parked' : 'held';
    }
    // Moved again while we merged: give up on this attempt, keep the server copy.
    // Same opId: this replaces the partial record above rather than adding a second one.
    durable = this.recordConflict({ opId, local, server: current, dropped: ['*'], at: Date.now() });
    this.confirm(current);
    return durable ? 'parked' : 'held';
  }

  /** Server-confirmed copy: remember it, cache it, and tell the UI (it carries the new rev). */
  private confirm(saved: Annotation): void {
    const json = JSON.stringify(saved);
    const changed = this.known.get(saved.id) !== json;
    this.known.set(saved.id, json);
    this.cacheUpsert(saved);
    if (changed) this.emit({ type: 'update', annotation: JSON.parse(json) });
  }

  /** Replay the current project's outbox in order. Stops at the first transport failure. Returns ops sent (or parked). */
  private async flushOutbox(): Promise<number> {
    return this.withLock(async () => {
      let done = 0;
      const snapshot = this.readOutbox();
      for (const op of snapshot.ops) {
        if (this.heldOps.has(op.opId)) continue;
        let outcome: SendOutcome;
        if (op.kind === 'save') outcome = await this.sendSave(op.annotation, op.baseRev, op.opId, op.base ?? null);
        else if (op.kind === 'remove') outcome = await this.sendRemove(op.id, op.baseRev, op.opId, op.base ?? null);
        else outcome = await this.sendClear();
        if (outcome === 'offline' || outcome === 'unauthorized') break;
        if (outcome === 'held') {
          // The conflict record is in memory only: the queued op is the last durable copy of the intent. Keep it.
          this.heldOps.add(op.opId);
          continue;
        }
        // The conflict (if any) is durable by now: the op can go.
        this.dropOp(op.opId);
        done++;
      }
      return done;
    });
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = (globalThis as { navigator?: { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } } }).navigator?.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request(`${KEY_PREFIX}${this.namespace}:outbox`, fn);
    }
    return fn();
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  // ---------------------------------------------------------------- known state

  private remember(store: AnnotationStore): void {
    this.known.clear();
    for (const ann of store.annotations) {
      this.known.set(ann.id, JSON.stringify(ann));
    }
  }

  private knownAnnotation(id: string): Annotation | null {
    const json = this.known.get(id);
    return json ? (JSON.parse(json) as Annotation) : null;
  }

  private knownRev(id: string): number | null {
    const rev = this.knownAnnotation(id)?.rev;
    return typeof rev === 'number' ? rev : null;
  }

  private newOpId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ---------------------------------------------------------------- outbox / parked

  private enqueue(op: OutboxOp): void {
    const outbox = this.readOutbox();
    if (op.kind === 'clear') {
      // A clear supersedes everything queued before it.
      outbox.ops = [op];
    } else {
      const id = op.kind === 'save' ? op.annotation.id : op.id;
      const lastClear = outbox.ops.map((o) => o.kind).lastIndexOf('clear');
      const idx = outbox.ops.findIndex((o, i) => i > lastClear && o.kind !== 'clear' && (o.kind === 'save' ? o.annotation.id : o.id) === id);
      if (idx !== -1) {
        // Keep the earliest base (and its revision): none of the earlier attempts was confirmed.
        const earlier = outbox.ops[idx] as Extract<OutboxOp, { kind: 'save' | 'remove' }>;
        outbox.ops.splice(idx, 1);
        op = { ...op, baseRev: earlier.baseRev, base: earlier.base ?? null } as OutboxOp;
      }
      outbox.ops.push(op);
    }
    this.writeOutbox(outbox);
  }

  private dropOp(opId: string): void {
    const outbox = this.readOutbox();
    outbox.ops = outbox.ops.filter((o) => o.opId !== opId);
    if (outbox.ops.length === 0) this.removeItem(this.outboxKey());
    else this.writeOutbox(outbox);
  }

  private park(op: OutboxOp, reason: string): void {
    const parked = this.readParked();
    parked.push({ op, reason, at: Date.now() });
    this.setItem(this.parkedKey(), JSON.stringify(parked));
  }

  private readOutbox(namespace = this.namespace): { ops: OutboxOp[] } {
    try {
      const raw = this.getItem(this.outboxKey(namespace));
      if (!raw) return { ops: [] };
      const parsed = JSON.parse(raw) as { ops?: OutboxOp[] };
      return { ops: Array.isArray(parsed.ops) ? parsed.ops : [] };
    } catch {
      return { ops: [] };
    }
  }

  private writeOutbox(outbox: { ops: OutboxOp[] }): void {
    this.setItem(this.outboxKey(), JSON.stringify({ version: OUTBOX_VERSION, ops: outbox.ops }));
  }

  private readParked(): ParkedOp[] {
    try {
      const raw = this.getItem(this.parkedKey());
      return raw ? (JSON.parse(raw) as ParkedOp[]) : [];
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------- conflict journal

  private readConflicts(namespace = this.namespace): ConflictRecord[] {
    try {
      const raw = this.getItem(this.conflictsKey(namespace));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((r): r is ConflictRecord => !!r && typeof r === 'object' && typeof (r as ConflictRecord).opId === 'string' && !!(r as ConflictRecord).local);
    } catch {
      return [];
    }
  }

  /**
   * Journal a conflict for the current project. One record per operation: a
   * replay of the same opId replaces the earlier record (keeping its time).
   * Returns whether the journal reached localStorage - the caller must not
   * drop the queued operation when it did not.
   */
  private recordConflict(record: ConflictRecord): boolean {
    const list = this.readConflicts();
    const idx = list.findIndex((r) => r.opId === record.opId);
    if (idx === -1) list.push(record);
    else list[idx] = { ...record, at: list[idx].at };
    return this.setItem(this.conflictsKey(), JSON.stringify(list));
  }

  // ---------------------------------------------------------------- cache

  private readCache(): AnnotationStore | null {
    try {
      const raw = this.getItem(this.cacheKey());
      return raw ? (JSON.parse(raw) as AnnotationStore) : null;
    } catch {
      return null;
    }
  }

  private writeCache(store: AnnotationStore): void {
    this.setItem(this.cacheKey(), JSON.stringify(store));
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

  // ---------------------------------------------------------------- keys / storage

  private unknownNamespace(): string {
    return `unknown@${this.url}`;
  }

  private lastProjectKey(): string {
    return `${KEY_PREFIX}last-project:${this.url}`;
  }

  private tokenKey(): string {
    return `${KEY_PREFIX}token:${this.url}`;
  }

  private cacheKey(namespace = this.namespace): string {
    return `${KEY_PREFIX}${namespace}:cache`;
  }

  private outboxKey(namespace = this.namespace): string {
    return `${KEY_PREFIX}${namespace}:outbox`;
  }

  private parkedKey(): string {
    return `${KEY_PREFIX}${this.namespace}:rejected`;
  }

  private conflictsKey(namespace = this.namespace): string {
    return `${KEY_PREFIX}${namespace}:conflicts`;
  }

  /**
   * Reads go to localStorage until it fails; from then on the in-memory
   * overlay answers for every key written or removed since, and untouched
   * keys still come from localStorage (reads keep working under a full
   * quota), so a durable queue is never hidden by a failed write.
   */
  private getItem(key: string): string | null {
    if (this.memoryOnly && this.mem.has(key)) return this.mem.get(key) ?? null;
    try {
      return localStorage.getItem(key);
    } catch {
      this.memoryOnly = true;
      return this.mem.get(key) ?? null;
    }
  }

  /** Returns true when the value reached localStorage. */
  private setItem(key: string, value: string): boolean {
    this.mem.set(key, value);
    if (this.memoryOnly) return false;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      // quota exceeded / disabled: keep everything in memory from now on and say so
      this.memoryOnly = true;
      this.emitStatus();
      return false;
    }
  }

  private removeItem(key: string): void {
    this.mem.set(key, null);
    if (this.memoryOnly) return;
    try {
      localStorage.removeItem(key);
    } catch {
      this.memoryOnly = true;
    }
  }

  /**
   * Widgets before protocol 2 kept one shared buffer for every endpoint. Its
   * owner cannot be known, so it is moved - not replayed - under the `legacy`
   * namespace, where `listUnsent()` reports it and `adoptUnsent()` can claim it.
   */
  private migrateLegacyKeys(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(LEGACY_BUFFER_KEY);
    } catch {
      return;
    }
    if (raw) {
      try {
        const legacy = JSON.parse(raw) as { clear?: boolean; ops?: Array<{ op: 'save'; annotation: Annotation } | { op: 'remove'; id: string }> };
        const ops: OutboxOp[] = [];
        if (legacy.clear) ops.push({ opId: this.newOpId(), kind: 'clear' });
        for (const op of legacy.ops ?? []) {
          if (op.op === 'save') ops.push({ opId: this.newOpId(), kind: 'save', annotation: op.annotation, baseRev: null });
          else ops.push({ opId: this.newOpId(), kind: 'remove', id: op.id, baseRev: null });
        }
        if (ops.length > 0) {
          const existing = this.readOutbox(LEGACY_NAMESPACE);
          this.setItem(this.outboxKey(LEGACY_NAMESPACE), JSON.stringify({ ops: [...existing.ops, ...ops] }));
        }
      } catch {
        // unreadable legacy buffer: leave it in place for manual recovery
        return;
      }
    }
    try {
      localStorage.removeItem(LEGACY_BUFFER_KEY);
      localStorage.removeItem(LEGACY_CACHE_KEY);
    } catch {
      // ignore
    }
  }
}
