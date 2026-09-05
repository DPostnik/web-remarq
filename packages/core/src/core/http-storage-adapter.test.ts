import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpStorageAdapter } from './http-storage-adapter';
import type { Annotation, ElementFingerprint, StorageStatus } from './types';

function fp(): ElementFingerprint {
  return {
    dataAnnotate: null, dataTestId: null, id: null,
    tagName: 'button', textContent: 'Save', role: null, ariaLabel: null,
    stableClasses: [], domPath: 'body > button', siblingIndex: 0, parentAnchor: null,
    sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
  };
}

function ann(id: string, status: Annotation['status'] = 'pending', rev?: number): Annotation {
  return {
    id, comment: `c-${id}`, fingerprint: fp(), route: '/', viewport: '1024x768',
    viewportBucket: 1000, timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    ...(rev !== undefined ? { rev } : {}),
  };
}

const URL_A = 'http://127.0.0.1:9999';
const TOKEN = 'tok-0123456789abcdef';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * In-memory stand-in for the local MCP server: protocol 2, token check,
 * per-record revisions with If-Match, one projectId. Lets the tests assert
 * convergence between what the widget believes and what the server holds.
 */
class FakeServer {
  annotations = new Map<string, Annotation>();
  storeRev = 0;
  down = false;
  calls: string[] = [];
  /** Runs before each PUT is handled - lets a test move the record between the 409 and the merged retry. */
  onPut: ((id: string) => void) | null = null;

  constructor(public projectId = 'prj_A', public token = TOKEN) {}

  handle = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    this.calls.push(`${method} ${url.replace(URL_A, '')}`);
    if (this.down) throw new TypeError('fetch failed');
    if (headers.authorization !== `Bearer ${this.token}`) return json({ error: 'unauthorized', code: 'unauthorized' }, 401);

    const path = url.replace(URL_A, '');
    if (method === 'GET' && path === '/store') {
      return json({ rev: this.storeRev, protocol: 2, projectId: this.projectId, store: { version: 1, annotations: [...this.annotations.values()] } });
    }
    const m = path.match(/^\/annotations\/(.+)$/);
    if (method === 'PUT' && m) {
      this.onPut?.(m[1]);
      const body = JSON.parse(String(init.body)) as Annotation;
      const current = this.annotations.get(m[1]);
      const ifMatch = headers['if-match'] === undefined ? null : Number(headers['if-match']);
      if (typeof body.comment !== 'string' || !body.fingerprint) return json({ error: 'invalid', code: 'invalid_annotation', details: ['comment: required'] }, 400);
      if (!current) {
        if (ifMatch !== null && ifMatch !== 0) return json({ error: 'conflict', code: 'conflict', details: { current: null, rev: this.storeRev } }, 409);
        const saved = { ...body, rev: 1 };
        this.annotations.set(m[1], saved);
        this.storeRev++;
        return json({ rev: this.storeRev, annotation: saved });
      }
      if (ifMatch === null) return json({ error: 'precondition', code: 'precondition_required', details: { current, rev: this.storeRev } }, 428);
      if (ifMatch !== current.rev) return json({ error: 'conflict', code: 'conflict', details: { current, rev: this.storeRev } }, 409);
      const saved = { ...body, rev: (current.rev ?? 0) + 1 };
      this.annotations.set(m[1], saved);
      this.storeRev++;
      return json({ rev: this.storeRev, annotation: saved });
    }
    if (method === 'DELETE' && m) {
      const current = this.annotations.get(m[1]);
      const ifMatch = headers['if-match'] === undefined ? null : Number(headers['if-match']);
      if (current && ifMatch !== null && ifMatch !== current.rev) return json({ error: 'conflict', code: 'conflict', details: { current, rev: this.storeRev } }, 409);
      this.annotations.delete(m[1]);
      this.storeRev++;
      return json({ rev: this.storeRev });
    }
    if (method === 'DELETE' && path === '/annotations') {
      this.annotations.clear();
      this.storeRev++;
      return json({ rev: this.storeRev });
    }
    return json({ error: 'not found', code: 'not_found' }, 404);
  };

  /** Simulate an agent-side transition through the atomic path. */
  agentAcknowledge(id: string): void {
    const c = this.annotations.get(id)!;
    this.annotations.set(id, { ...c, status: 'in_progress', lifecycle: [...c.lifecycle, { type: 'acknowledged', actor: 'agent', timestamp: 2 }], rev: (c.rev ?? 0) + 1 });
    this.storeRev++;
  }
}

let server: FakeServer;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  server = new FakeServer();
  fetchMock = vi.fn(server.handle);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const make = (opts: Partial<ConstructorParameters<typeof HttpStorageAdapter>[0]> = {}) =>
  new HttpStorageAdapter({ url: URL_A, token: TOKEN, configUrl: false, ...opts });

describe('HttpStorageAdapter online (protocol 2)', () => {
  it('load() GETs /store with the bearer token and returns the store', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    const result = await adapter.load();
    expect(result?.annotations[0].id).toBe('a1');
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    expect(adapter.getStatus()).toEqual({ state: 'synced', pending: 0 });
  });

  it('save() PUTs with If-Match for a known record and none for a new one; confirmed copies carry the rev', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 3));
    const adapter = make();
    await adapter.load();
    const events: unknown[] = [];
    adapter.subscribe((e) => events.push(e));

    await adapter.save({ ...ann('a1'), comment: 'edited' });
    const putA1 = fetchMock.mock.calls.find(([u, i]) => (i as RequestInit)?.method === 'PUT' && String(u).endsWith('/a1'));
    expect((putA1![1] as RequestInit).headers).toMatchObject({ 'if-match': '3', 'content-type': 'application/json' });
    expect(server.annotations.get('a1')?.rev).toBe(4);
    expect(events).toContainEqual(expect.objectContaining({ type: 'update', annotation: expect.objectContaining({ id: 'a1', rev: 4 }) }));

    await adapter.save(ann('new'));
    const putNew = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/new'));
    expect((putNew![1] as RequestInit).headers).not.toHaveProperty('if-match');
    expect(server.annotations.get('new')?.rev).toBe(1);
  });

  it('remove() and clear() hit the server with the token; rev tracking follows', async () => {
    server.annotations.set('a3', ann('a3', 'pending', 1));
    const adapter = make();
    await adapter.load();
    await adapter.remove('a3');
    expect(server.annotations.has('a3')).toBe(false);
    server.annotations.set('x', ann('x', 'pending', 1));
    await adapter.clear();
    expect(server.annotations.size).toBe(0);
    expect(server.calls).toContain('DELETE /annotations');
  });
});

describe('HttpStorageAdapter offline queue', () => {
  it('offline add/edit/remove -> reload -> reconnect converges to the expected store and empties the queue only after confirmation', async () => {
    // Session 1: connected once (learns the project), then the server goes away.
    const first = make();
    await first.load();
    server.down = true;
    await first.save(ann('a1'));
    await first.save({ ...ann('a1'), comment: 'edited offline' });
    await first.save(ann('a2'));
    await first.remove('a2');
    expect(first.getStatus()).toMatchObject({ state: 'queued', pending: 2 });
    const outboxKey = 'remarq:http:prj_A:outbox';
    expect(JSON.parse(localStorage.getItem(outboxKey)!).ops.map((o: { kind: string }) => o.kind)).toEqual(['save', 'remove']);

    // Session 2 (reload): still offline, the cache serves what the user saw.
    const second = make();
    const cached = await second.load();
    expect(cached?.annotations.map((a) => a.id)).toEqual(['a1']);
    expect(second.getStatus()).toMatchObject({ state: 'queued', pending: 2 });

    // Reconnect: the queue is replayed in order, then the server copy is read back.
    server.down = false;
    const store = await second.load();
    expect(store?.annotations.map((a) => [a.id, a.comment, a.rev])).toEqual([['a1', 'edited offline', 1]]);
    expect(server.annotations.get('a1')?.comment).toBe('edited offline');
    expect(server.annotations.has('a2')).toBe(false);
    expect(localStorage.getItem(outboxKey)).toBeNull();
    expect(second.getStatus()).toEqual({ state: 'synced', pending: 0 });
  });

  it('a save issued while the queue is being flushed is sent live, without another disconnect', async () => {
    const adapter = make();
    await adapter.load();
    server.down = true;
    await adapter.save(ann('f1'));
    server.down = false;

    // Kick the replay through load(); while its first PUT is in flight, queue another save.
    const reconnect = adapter.load();
    const late = adapter.save(ann('f2'));
    await Promise.all([reconnect, late]);

    expect(server.annotations.has('f1')).toBe(true);
    expect(server.annotations.has('f2')).toBe(true);
    expect(localStorage.getItem('remarq:http:prj_A:outbox')).toBeNull();
    expect(adapter.getStatus().state).toBe('synced');
  });

  it('preserves clear -> delete -> recreate order on replay', async () => {
    const adapter = make();
    await adapter.load();
    server.down = true;
    await adapter.save(ann('old'));
    await adapter.clear();
    await adapter.save(ann('a4'));
    await adapter.remove('a5');
    server.down = false;
    server.calls.length = 0;
    await adapter.load();
    const writes = server.calls.filter((c) => !c.startsWith('GET'));
    expect(writes).toEqual(['DELETE /annotations', 'PUT /annotations/a4', 'DELETE /annotations/a5']);
  });

  it('never sends a queue built before any server was seen; adoptUnsent() sends it on request', async () => {
    server.down = true;
    const adapter = make();
    await adapter.load();
    await adapter.save(ann('orphan'));
    expect(localStorage.getItem(`remarq:http:unknown@${URL_A}:outbox`)).not.toBeNull();

    server.down = false;
    await adapter.load();
    expect(server.annotations.has('orphan')).toBe(false);
    expect(adapter.listUnsent()).toEqual([{ namespace: `unknown@${URL_A}`, ops: 1 }]);
    expect(adapter.getStatus().message).toContain('adoptUnsent');

    expect(await adapter.adoptUnsent()).toBe(1);
    expect(server.annotations.has('orphan')).toBe(true);
    expect(adapter.listUnsent()).toEqual([]);
    expect(adapter.getStatus().state).toBe('synced');
  });

  it('keeps a queue for project A when the same port later serves project B, and sends it when A returns', async () => {
    const adapter = make();
    await adapter.load(); // prj_A
    server.down = true;
    await adapter.save(ann('for-a'));

    // Same port, different project.
    const serverB = new FakeServer('prj_B');
    fetchMock.mockImplementation(serverB.handle);
    const storeB = await adapter.load();
    expect(storeB?.annotations).toEqual([]);
    expect(serverB.annotations.has('for-a')).toBe(false);
    expect(localStorage.getItem('remarq:http:prj_A:outbox')).not.toBeNull();

    // Writes made now belong to B; a clear on B does not touch A's queue.
    await adapter.save(ann('for-b'));
    await adapter.clear();
    expect(JSON.parse(localStorage.getItem('remarq:http:prj_A:outbox')!).ops).toHaveLength(1);

    // Project A is back.
    server.down = false;
    fetchMock.mockImplementation(server.handle);
    await adapter.load();
    expect(server.annotations.has('for-a')).toBe(true);
    expect(server.annotations.has('for-b')).toBe(false);
    expect(localStorage.getItem('remarq:http:prj_A:outbox')).toBeNull();
  });

  it('a rotated token does not lose the queue: unauthorized stops sending, pair() resumes it', async () => {
    const adapter = make();
    await adapter.load();
    server.down = true;
    await adapter.save(ann('q1'));
    server.down = false;
    server.token = 'rotated-token-0000000000';

    await adapter.load();
    expect(adapter.getStatus()).toMatchObject({ state: 'unauthorized', pending: 1 });
    expect(server.annotations.has('q1')).toBe(false);

    // Unauthorized is not "offline": polling must not hammer the server.
    vi.useFakeTimers();
    const unsub = adapter.subscribe(() => {});
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock.mock.calls.length).toBe(before);
    unsub();
    vi.useRealTimers();

    await adapter.pair('rotated-token-0000000000');
    expect(server.annotations.has('q1')).toBe(true);
    expect(adapter.getStatus().state).toBe('synced');
    expect(localStorage.getItem(`remarq:http:token:${URL_A}`)).toBe('rotated-token-0000000000');
  });

  it('parks an operation the server rejects as invalid instead of retrying it forever', async () => {
    const adapter = make();
    await adapter.load();
    const bad = { ...ann('bad'), comment: undefined } as unknown as Annotation;
    await adapter.save(bad);
    expect(adapter.getStatus()).toMatchObject({ state: 'rejected', pending: 1 });
    const putCalls = () => server.calls.filter((c) => c === 'PUT /annotations/bad').length;
    const n = putCalls();
    await adapter.load();
    expect(putCalls()).toBe(n);
    expect(adapter.exportUnsent().rejected[0].reason).toContain('400');
    adapter.clearParked();
    expect(adapter.getStatus().state).toBe('synced');
  });

  it('tells a refused origin apart from a dead server: /store fails but /health answers', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/health')) return json({ ok: true, protocol: 2 });
      throw new TypeError('Failed to fetch'); // what a CORS refusal looks like from a page
    });
    const adapter = make();
    await adapter.load();
    const status = adapter.getStatus();
    expect(status.state).toBe('unauthorized');
    expect(status.message).toContain('allowedOrigins');

    // A genuinely dead server stays "queued".
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const other = make();
    await other.load();
    expect(other.getStatus()).toMatchObject({ state: 'queued', pending: 0 });
    expect(other.getStatus().message).toContain('unreachable');
  });

  it('refuses to talk to a protocol-1 server and says so, without sending the queue', async () => {
    fetchMock.mockImplementation(async () => json({ rev: 1, store: { version: 1, annotations: [] } }));
    const adapter = make();
    await adapter.load();
    expect(adapter.getStatus().state).toBe('incompatible');
    await adapter.save(ann('x'));
    expect(server.calls.filter((c) => c.startsWith('PUT'))).toEqual([]);
    expect(adapter.getStatus().message).toContain('upgrade');
  });

  it('migrates the pre-protocol-2 shared buffer into the legacy namespace instead of replaying it blindly', async () => {
    localStorage.setItem('remarq:http-buffer', JSON.stringify({ clear: false, clearSeq: 0, ops: [{ op: 'save', annotation: ann('old') }] }));
    localStorage.setItem('remarq:http-cache', JSON.stringify({ version: 1, annotations: [ann('old')] }));
    const adapter = make();
    await adapter.load();
    expect(localStorage.getItem('remarq:http-buffer')).toBeNull();
    expect(localStorage.getItem('remarq:http-cache')).toBeNull();
    expect(server.annotations.has('old')).toBe(false);
    expect(adapter.listUnsent()).toEqual([{ namespace: 'legacy', ops: 1 }]);
    await adapter.adoptUnsent();
    expect(server.annotations.has('old')).toBe(true);
  });
});

describe('HttpStorageAdapter conflicts', () => {
  it('a stale offline edit does not roll back an agent transition: comment merges, status and history are kept', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load();
    server.down = true;
    await adapter.save({ ...ann('a1', 'pending', 1), comment: 'edited offline' });
    server.down = false;
    server.agentAcknowledge('a1'); // rev 2, in_progress

    const events: unknown[] = [];
    adapter.subscribe((e) => events.push(e));
    await adapter.load();

    const onServer = server.annotations.get('a1')!;
    expect(onServer.status).toBe('in_progress');
    expect(onServer.lifecycle.map((e) => e.type)).toEqual(['created', 'acknowledged']);
    expect(onServer.comment).toBe('edited offline');
    expect(onServer.rev).toBe(3);
    expect(adapter.getStatus().state).toBe('synced');
    expect(events).toContainEqual(expect.objectContaining({ type: 'update', annotation: expect.objectContaining({ status: 'in_progress', comment: 'edited offline' }) }));
  });

  it('when both sides changed the same field the server wins and the local copy is kept in conflicts', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load();
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server edit' });
    server.storeRev++;

    await adapter.save({ ...ann('a1', 'pending', 1), comment: 'local edit' });
    expect(server.annotations.get('a1')?.comment).toBe('server edit');
    expect(adapter.getStatus()).toMatchObject({ state: 'conflict' });
    const conflicts = adapter.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.comment).toBe('local edit');
    expect(conflicts[0].dropped).toEqual(['comment']);
  });

  it('does not resurrect a record the server deleted', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load();
    server.annotations.delete('a1');
    server.storeRev++;
    const events: unknown[] = [];
    adapter.subscribe((e) => events.push(e));
    await adapter.save({ ...ann('a1', 'pending', 1), comment: 'edit after delete' });
    expect(server.annotations.has('a1')).toBe(false);
    expect(events).toContainEqual({ type: 'remove', id: 'a1' });
    expect(adapter.exportUnsent().conflicts[0].server).toBeNull();
  });
});

describe('HttpStorageAdapter conflicts after a reload (merge base is persisted with the queue)', () => {
  const outboxKey = 'remarq:http:prj_A:outbox';

  it('a queued edit merges against the copy it was made from, so the server\'s newer comment survives and the local route lands', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1)); // comment c-a1
    const first = make();
    await first.load();
    server.down = true;
    await first.save({ ...ann('a1', 'pending', 1), route: '/moved' }); // only route edited locally
    const queued = JSON.parse(localStorage.getItem(outboxKey)!);
    expect(queued.version).toBe(2);
    expect(queued.ops[0].base).toMatchObject({ id: 'a1', comment: 'c-a1', route: '/', rev: 1 });

    server.down = false;
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server-new-comment' });
    server.storeRev++;

    const second = make(); // reload: fresh instance, same localStorage, no in-memory state
    const store = await second.load();
    const onServer = server.annotations.get('a1')!;
    expect(onServer).toMatchObject({ comment: 'server-new-comment', route: '/moved', rev: 3 });
    expect(store?.annotations[0]).toMatchObject({ comment: 'server-new-comment', route: '/moved', rev: 3 });
    expect(second.getStatus()).toEqual({ state: 'synced', pending: 0 });
    expect(localStorage.getItem(outboxKey)).toBeNull();
  });

  it('several offline edits survive two reloads and an agent transition without duplicating history', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const first = make();
    await first.load();
    server.down = true;
    await first.save({ ...ann('a1', 'pending', 1), route: '/r1' });
    await first.save({ ...ann('a1', 'pending', 1), route: '/r2', viewport: '800x600' });

    const second = make(); // reload while still offline
    await second.load();
    expect(second.getStatus()).toMatchObject({ state: 'queued', pending: 1 });

    server.down = false;
    server.agentAcknowledge('a1'); // rev 2, in_progress
    const third = make(); // reload again, now the server answers
    await third.load();
    const onServer = server.annotations.get('a1')!;
    expect(onServer).toMatchObject({ route: '/r2', viewport: '800x600', comment: 'c-a1', status: 'in_progress', rev: 3 });
    expect(onServer.lifecycle.map((e) => e.type)).toEqual(['created', 'acknowledged']);
    expect(third.getStatus()).toEqual({ state: 'synced', pending: 0 });
  });

  it('a competing edit of the same field is an explicit conflict after a reload, never a silent overwrite', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const first = make();
    await first.load();
    server.down = true;
    await first.save({ ...ann('a1', 'pending', 1), comment: 'local edit' });
    server.down = false;
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server edit' });
    server.storeRev++;

    const second = make();
    await second.load();
    expect(server.annotations.get('a1')?.comment).toBe('server edit');
    expect(second.getStatus()).toMatchObject({ state: 'conflict' });
    const conflicts = second.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].local.comment).toBe('local edit');
    expect(conflicts[0].dropped).toEqual(['comment']);
    expect(localStorage.getItem(outboxKey)).toBeNull();
  });

  it('a queued operation from before bases were stored never overwrites server fields silently', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const first = make();
    await first.load(); // learns prj_A
    // Outbox format 1: no `base` on the op.
    localStorage.setItem(outboxKey, JSON.stringify({ ops: [{ opId: 'old-1', kind: 'save', annotation: { ...ann('a1', 'pending', 1), comment: 'stale local' }, baseRev: 1 }] }));
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), route: '/server-moved' });
    server.storeRev++;

    const second = make();
    await second.load();
    expect(server.annotations.get('a1')).toMatchObject({ comment: 'c-a1', route: '/server-moved', rev: 2 });
    expect(second.getStatus()).toMatchObject({ state: 'conflict' });
    // Without a base nobody can tell which side edited which field: both differences are reported, the server copy stands.
    expect(second.exportUnsent().conflicts[0]).toMatchObject({ dropped: ['comment', 'route'], local: expect.objectContaining({ comment: 'stale local' }) });
    expect(localStorage.getItem(outboxKey)).toBeNull();
  });

  it('a queued delete that collides with an agent transition keeps the deleted copy for review after a reload', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const first = make();
    await first.load();
    server.down = true;
    await first.remove('a1');
    server.down = false;
    server.agentAcknowledge('a1');

    const second = make();
    await second.load();
    expect(server.annotations.get('a1')?.status).toBe('in_progress');
    expect(second.getStatus()).toMatchObject({ state: 'conflict' });
    expect(second.exportUnsent().conflicts[0]).toMatchObject({
      dropped: ['delete'],
      local: expect.objectContaining({ id: 'a1', rev: 1 }),
      server: expect.objectContaining({ status: 'in_progress' }),
    });
  });

  it('a queue kept for project A merges against A\'s base when A returns after B was served meanwhile', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load(); // prj_A
    server.down = true;
    await adapter.save({ ...ann('a1', 'pending', 1), route: '/moved' });

    const serverB = new FakeServer('prj_B');
    fetchMock.mockImplementation(serverB.handle);
    await adapter.load(); // in-memory "known" now describes B
    expect(serverB.annotations.has('a1')).toBe(false);

    server.down = false;
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server-new-comment' });
    server.storeRev++;
    fetchMock.mockImplementation(server.handle);
    await adapter.load();
    expect(server.annotations.get('a1')).toMatchObject({ comment: 'server-new-comment', route: '/moved', rev: 3 });
    expect(adapter.getStatus()).toEqual({ state: 'synced', pending: 0 });
  });
});

describe('HttpStorageAdapter degraded storage', () => {
  it('switches to memory when localStorage throws (quota) and reports it; writes still queue in memory', async () => {
    const adapter = make();
    await adapter.load();
    const statuses: StorageStatus[] = [];
    adapter.onStatus((s) => statuses.push(s));
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    server.down = true;
    await adapter.save(ann('m1'));
    expect(adapter.isMemoryOnly).toBe(true);
    expect(adapter.getStatus().state).toBe('memory');
    expect(statuses[statuses.length - 1]?.message).toContain('reload');
    Storage.prototype.setItem = setItem;

    server.down = false;
    await adapter.load();
    expect(server.annotations.has('m1')).toBe(true);
  });
});

describe('HttpStorageAdapter subscribe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  async function tick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(2000);
  }

  it('emits add/update/remove diffs when content changes, nothing when content is unchanged', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load();
    const events: unknown[] = [];
    const unsub = adapter.subscribe((e) => events.push(e));

    await tick();
    expect(events).toHaveLength(0);

    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'edited' });
    server.annotations.set('a2', ann('a2', 'pending', 1));
    server.storeRev++;
    await tick();
    expect(events).toContainEqual(expect.objectContaining({ type: 'update', annotation: expect.objectContaining({ id: 'a1' }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'add', annotation: expect.objectContaining({ id: 'a2' }) }));

    events.length = 0;
    server.annotations.delete('a2');
    server.storeRev++;
    await tick();
    expect(events).toEqual([expect.objectContaining({ type: 'remove', id: 'a2' })]);
    unsub();
  });

  it('flushes the offline queue before diffing when the server comes back', async () => {
    const adapter = make();
    await adapter.load();
    server.down = true;
    await adapter.save(ann('a9'));
    const unsub = adapter.subscribe(() => {});
    server.down = false;
    server.calls.length = 0;
    await tick();
    expect(server.calls[0]).toBe('GET /store');
    expect(server.calls).toContain('PUT /annotations/a9');
    expect(localStorage.getItem('remarq:http:prj_A:outbox')).toBeNull();
    unsub();
  });
});

describe('HttpStorageAdapter durable conflicts (kept per project across reloads)', () => {
  const outboxKey = 'remarq:http:prj_A:outbox';
  const conflictsKey = 'remarq:http:prj_A:conflicts';

  /** a1 rev1 on both sides; edit the comment offline; the server edits the same field meanwhile. */
  async function competingCommentEdit(): Promise<void> {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const first = make();
    await first.load();
    server.down = true;
    await first.save({ ...ann('a1', 'pending', 1), comment: 'local-intent' });
    server.down = false;
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server-intent' });
    server.storeRev++;
  }

  it('the local text, the server copy and the dropped fields survive two more reloads; status stays conflict', async () => {
    await competingCommentEdit();
    const second = make();
    await second.load();
    expect(second.getStatus()).toMatchObject({ state: 'conflict' });
    expect(localStorage.getItem(outboxKey)).toBeNull();

    const third = make(); // second reload
    await third.load();
    expect(third.getStatus()).toMatchObject({ state: 'conflict' });
    const fourth = make(); // third reload
    await fourth.load();
    const conflicts = fourth.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      local: expect.objectContaining({ id: 'a1', comment: 'local-intent' }),
      server: expect.objectContaining({ id: 'a1', comment: 'server-intent', rev: 2 }),
      dropped: ['comment'],
    });
    expect(typeof conflicts[0].opId).toBe('string');
    expect(typeof conflicts[0].at).toBe('number');
    expect(server.annotations.get('a1')).toMatchObject({ comment: 'server-intent', rev: 2 });
  });

  it('the conflict is written before the queued operation is dropped, and a replay after a crash in between does not duplicate it', async () => {
    await competingCommentEdit();
    const queued = localStorage.getItem(outboxKey)!;
    const second = make();
    await second.load();
    expect(localStorage.getItem(outboxKey)).toBeNull();
    const stored = JSON.parse(localStorage.getItem(conflictsKey)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].opId).toBe(JSON.parse(queued).ops[0].opId);

    localStorage.setItem(outboxKey, queued); // crash between the conflict write and the outbox drop: the op is replayed
    const third = make();
    await third.load();
    expect(localStorage.getItem(outboxKey)).toBeNull();
    const conflicts = third.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ opId: stored[0].opId, local: expect.objectContaining({ comment: 'local-intent' }), dropped: ['comment'] });
    expect(server.annotations.get('a1')?.rev).toBe(2);
  });

  it('a queued delete that lost to an agent transition, and an edit of a record the server deleted, are kept across reloads too', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    server.annotations.set('a2', ann('a2', 'pending', 1));
    const first = make();
    await first.load();
    server.down = true;
    await first.remove('a1');
    await first.save({ ...ann('a2', 'pending', 1), comment: 'edit after delete' });
    server.down = false;
    server.agentAcknowledge('a1');
    server.annotations.delete('a2');
    server.storeRev++;

    const second = make();
    await second.load();
    const third = make();
    await third.load();
    const conflicts = third.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(2);
    expect(conflicts).toContainEqual(expect.objectContaining({ dropped: ['delete'], local: expect.objectContaining({ id: 'a1' }), server: expect.objectContaining({ status: 'in_progress' }) }));
    expect(conflicts).toContainEqual(expect.objectContaining({ dropped: ['*'], local: expect.objectContaining({ id: 'a2', comment: 'edit after delete' }), server: null }));
    expect(third.getStatus()).toMatchObject({ state: 'conflict', message: expect.stringContaining('2 changes') });
    expect(server.annotations.has('a2')).toBe(false);
  });

  it('a record that moves again while the merged retry is in flight yields one record (whole intent dropped), not two', async () => {
    server.annotations.set('a1', ann('a1', 'pending', 1));
    const adapter = make();
    await adapter.load();
    server.annotations.set('a1', { ...ann('a1', 'pending', 2), comment: 'server edit' });
    server.storeRev++;
    let puts = 0;
    server.onPut = () => {
      if (++puts === 2) server.agentAcknowledge('a1'); // between the 409 and the merged retry
    };
    await adapter.save({ ...ann('a1', 'pending', 1), comment: 'local edit', route: '/moved' });
    expect(server.annotations.get('a1')).toMatchObject({ comment: 'server edit', route: '/', status: 'in_progress', rev: 3 });

    const reloaded = make();
    await reloaded.load();
    const conflicts = reloaded.exportUnsent().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ dropped: ['*'], local: expect.objectContaining({ comment: 'local edit', route: '/moved' }) });
  });

  it('project A\'s conflicts are neither visible nor cleared while project B is served, and are back when A returns', async () => {
    await competingCommentEdit();
    const adapter = make();
    await adapter.load();
    expect(adapter.getStatus()).toMatchObject({ state: 'conflict' });

    const serverB = new FakeServer('prj_B');
    fetchMock.mockImplementation(serverB.handle);
    await adapter.load();
    expect(adapter.getStatus()).toEqual({ state: 'synced', pending: 0 });
    expect(adapter.exportUnsent().conflicts).toEqual([]);
    adapter.clearParked();
    expect(localStorage.getItem(conflictsKey)).not.toBeNull();

    fetchMock.mockImplementation(server.handle);
    await adapter.load();
    expect(adapter.getStatus()).toMatchObject({ state: 'conflict' });
    expect(adapter.exportUnsent().conflicts[0].local.comment).toBe('local-intent');
  });

  it('an explicit clearParked() survives a reload and touches nothing else', async () => {
    await competingCommentEdit();
    localStorage.setItem('remarq:http:prj_B:conflicts', '[]');
    const adapter = make();
    await adapter.load();
    adapter.clearParked();
    expect(adapter.getStatus()).toEqual({ state: 'synced', pending: 0 });
    expect(localStorage.getItem(conflictsKey)).toBeNull();
    expect(localStorage.getItem('remarq:http:prj_B:conflicts')).toBe('[]');

    const reloaded = make();
    await reloaded.load();
    expect(reloaded.getStatus()).toEqual({ state: 'synced', pending: 0 });
    expect(reloaded.exportUnsent().conflicts).toEqual([]);
  });

  it('when the conflict cannot be written (quota) the queued operation stays durable, the state says memory, and export still has both', async () => {
    await competingCommentEdit();
    const queued = localStorage.getItem(outboxKey)!;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    const second = make();
    await second.load();
    expect(second.getStatus()).toMatchObject({ state: 'memory', message: expect.stringContaining('export') });
    expect(localStorage.getItem(outboxKey)).toBe(queued); // the only durable copy of the intent is untouched
    expect(localStorage.getItem(conflictsKey)).toBeNull();
    const unsent = second.exportUnsent();
    expect(unsent.outboxes.prj_A).toHaveLength(1);
    expect(unsent.conflicts).toHaveLength(1);
    expect(unsent.conflicts[0].local.comment).toBe('local-intent');
    // The held operation is not replayed again and again within this session.
    const putsBefore = server.calls.filter((c) => c.startsWith('PUT')).length;
    await second.load();
    expect(server.calls.filter((c) => c.startsWith('PUT')).length).toBe(putsBefore);
    spy.mockRestore();

    const third = make(); // reload with room again: the queue replays, the conflict lands durably, the op is dropped
    await third.load();
    expect(localStorage.getItem(outboxKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(conflictsKey)!)).toHaveLength(1);
    expect(third.getStatus()).toMatchObject({ state: 'conflict' });
    expect(server.annotations.get('a1')).toMatchObject({ comment: 'server-intent', rev: 2 });
  });
});
