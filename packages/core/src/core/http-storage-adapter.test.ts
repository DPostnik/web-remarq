import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpStorageAdapter } from './http-storage-adapter';
import type { Annotation, ElementFingerprint } from './types';

function fp(): ElementFingerprint {
  return {
    dataAnnotate: null, dataTestId: null, id: null,
    tagName: 'button', textContent: 'Save', role: null, ariaLabel: null,
    stableClasses: [], domPath: 'body > button', siblingIndex: 0, parentAnchor: null,
    sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
  };
}

function ann(id: string, status: Annotation['status'] = 'pending'): Annotation {
  return {
    id, comment: `c-${id}`, fingerprint: fp(), route: '/', viewport: '1024x768',
    viewportBucket: 1000, timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('HttpStorageAdapter online', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() GETs /store and returns the store', async () => {
    const store = { version: 1, annotations: [ann('a1')] };
    fetchMock.mockResolvedValueOnce(okJson({ rev: 3, store }));
    const adapter = new HttpStorageAdapter({ url: 'http://127.0.0.1:9999' });
    const result = await adapter.load();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:9999/store');
    expect(result?.annotations[0].id).toBe('a1');
  });

  it('save() PUTs the annotation to /annotations/:id', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ rev: 4 }));
    const adapter = new HttpStorageAdapter();
    await adapter.save(ann('a2'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:1817/annotations/a2');
    expect(init.method).toBe('PUT');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body).id).toBe('a2');
  });

  it('remove() DELETEs /annotations/:id and clear() DELETEs /annotations', async () => {
    fetchMock.mockResolvedValue(okJson({ rev: 5 }));
    const adapter = new HttpStorageAdapter();
    await adapter.remove('a3');
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:1817/annotations/a3', { method: 'DELETE' });
    await adapter.clear();
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:1817/annotations', { method: 'DELETE' });
  });
});

describe('HttpStorageAdapter offline', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('load() falls back to the localStorage cache when the server is down', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockResolvedValueOnce(okJson({ rev: 1, store: { version: 1, annotations: [ann('a1')] } }));
    await adapter.load(); // populates cache
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    const offline = await adapter.load();
    expect(offline?.annotations.map((a) => a.id)).toEqual(['a1']);
  });

  it('save() while offline buffers the op and keeps the cache current', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await adapter.load(); // flips offline
    await adapter.save(ann('a2'));
    const buffer = JSON.parse(localStorage.getItem('remarq:http-buffer')!);
    expect(buffer.ops).toHaveLength(1);
    expect(buffer.ops[0]).toMatchObject({ op: 'save' });
    const cache = JSON.parse(localStorage.getItem('remarq:http-cache')!);
    expect(cache.annotations.map((a: { id: string }) => a.id)).toContain('a2');
  });

  it('buffered ops dedupe by id, last write wins', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await adapter.load();
    await adapter.save(ann('a3'));
    await adapter.save({ ...ann('a3'), comment: 'edited' });
    const buffer = JSON.parse(localStorage.getItem('remarq:http-buffer')!);
    expect(buffer.ops).toHaveLength(1);
    expect(buffer.ops[0].annotation.comment).toBe('edited');
  });

  it('flush() keeps ops buffered mid-flush instead of dropping them', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await adapter.load(); // flips offline
    await adapter.save(ann('f1'));

    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(async () => {
      // Still offline at this instant - this buffers f2 rather than sending it,
      // simulating a save() that lands while the flush's PUT is in flight.
      await adapter.save(ann('f2'));
      return okJson({ rev: 10 });
    });

    // @ts-expect-error - private, tested directly
    await adapter.flush();

    const buffer = JSON.parse(localStorage.getItem('remarq:http-buffer')!);
    expect(buffer.ops).toHaveLength(1);
    expect(buffer.ops[0]).toMatchObject({ op: 'save', annotation: { id: 'f2' } });
  });

  it('flush() survives a clear() buffered mid-flush instead of dropping it', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await adapter.load(); // flips offline
    await adapter.clear();
    await adapter.save(ann('g1'));

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(okJson({})) // replay of the buffered clear (DELETE /annotations)
      .mockImplementationOnce(async () => {
        // Still offline at this instant - this buffers a new clear() rather
        // than sending it, simulating clear() landing while the flush's PUT
        // for g1 is in flight.
        await adapter.clear();
        return okJson({ rev: 11 });
      });

    // @ts-expect-error - private, tested directly
    await adapter.flush();

    const buffer = JSON.parse(localStorage.getItem('remarq:http-buffer')!);
    expect(buffer.clear).toBe(true);
    expect(buffer.ops).toHaveLength(0);

    // The pending clear must actually replay on the next flush.
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ rev: 12 }));
    // @ts-expect-error - private, tested directly
    await adapter.flush();

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url}`);
    expect(calls).toContain('DELETE http://127.0.0.1:1817/annotations');
    expect(localStorage.getItem('remarq:http-buffer')).toBeNull();
  });

  it('flush() replays clear-then-ops in order and empties the buffer', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await adapter.load();
    await adapter.clear();
    await adapter.save(ann('a4'));
    await adapter.remove('a5');

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ rev: 9 }));
    // @ts-expect-error — private, tested directly
    await adapter.flush();

    const calls = fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
    expect(calls).toEqual([
      'DELETE http://127.0.0.1:1817/annotations',
      'PUT http://127.0.0.1:1817/annotations/a4',
      'DELETE http://127.0.0.1:1817/annotations/a5',
    ]);
    expect(localStorage.getItem('remarq:http-buffer')).toBeNull();
  });
});

describe('HttpStorageAdapter subscribe', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function tick(): Promise<void> {
    await vi.advanceTimersByTimeAsync(2000);
  }

  it('emits add/update/remove diffs when content changes, nothing when content is unchanged', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockResolvedValueOnce(okJson({ rev: 1, store: { version: 1, annotations: [ann('a1')] } }));
    await adapter.load();

    const events: unknown[] = [];
    const unsub = adapter.subscribe((e) => events.push(e));

    // same rev, same content → no events (content-diffed via `known`, not rev)
    fetchMock.mockResolvedValueOnce(okJson({ rev: 1, store: { version: 1, annotations: [ann('a1')] } }));
    await tick();
    expect(events).toHaveLength(0);

    // new rev: a1 updated, a2 added
    const a1v2 = { ...ann('a1'), comment: 'edited' };
    fetchMock.mockResolvedValueOnce(okJson({ rev: 2, store: { version: 1, annotations: [a1v2, ann('a2')] } }));
    await tick();
    expect(events).toContainEqual(expect.objectContaining({ type: 'update', annotation: expect.objectContaining({ id: 'a1' }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'add', annotation: expect.objectContaining({ id: 'a2' }) }));

    // a2 removed
    events.length = 0;
    fetchMock.mockResolvedValueOnce(okJson({ rev: 3, store: { version: 1, annotations: [a1v2] } }));
    await tick();
    expect(events).toEqual([expect.objectContaining({ type: 'remove', id: 'a2' })]);

    unsub();
  });

  it('diffs on content change even when rev collides (server restarted, rev re-seeded)', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockResolvedValueOnce(okJson({ rev: 1, store: { version: 1, annotations: [ann('a1')] } }));
    await adapter.load();

    const events: unknown[] = [];
    const unsub = adapter.subscribe((e) => events.push(e));

    // Server restarted: its rev counter re-seeded at 0 and climbed back to 1 -
    // the same rev the client already stored - but the content differs. A
    // client-side `rev === this.rev` skip would hide this change forever.
    const a1v2 = { ...ann('a1'), comment: 'restarted-edit' };
    fetchMock.mockResolvedValueOnce(okJson({ rev: 1, store: { version: 1, annotations: [a1v2, ann('a2')] } }));
    await tick();

    expect(events).toContainEqual(expect.objectContaining({ type: 'update', annotation: expect.objectContaining({ id: 'a1' }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'add', annotation: expect.objectContaining({ id: 'a2' }) }));

    unsub();
  });

  it('flushes the offline buffer before diffing when the server comes back', async () => {
    const adapter = new HttpStorageAdapter();
    fetchMock.mockRejectedValue(new TypeError('down'));
    await adapter.load();
    await adapter.save(ann('a9'));

    const unsub = adapter.subscribe(() => {});
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ rev: 5, store: { version: 1, annotations: [ann('a9')] } }));
    // flush PUT replies also match mockResolvedValue({rev:5}) shape — fine
    await tick();

    const calls = fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${url}`);
    expect(calls[0]).toBe('PUT http://127.0.0.1:1817/annotations/a9');
    expect(calls).toContain('GET http://127.0.0.1:1817/store');
    expect(localStorage.getItem('remarq:http-buffer')).toBeNull();
    unsub();
  });
});
