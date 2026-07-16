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
