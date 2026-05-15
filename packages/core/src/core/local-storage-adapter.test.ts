import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from './types';
import { LocalStorageAdapter } from './local-storage-adapter';

const STORAGE_KEY = 'remarq:annotations';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    comment: 'Fix padding',
    route: '/home',
    viewport: '1280x720',
    viewportBucket: 1200,
    timestamp: 1_700_000_000_000,
    status: 'pending',
    fingerprint: {
      dataAnnotate: null,
      dataTestId: null,
      id: null,
      tagName: 'button',
      textContent: 'Click me',
      role: null,
      ariaLabel: null,
      stableClasses: ['btn'],
      domPath: 'div > button',
      siblingIndex: 0,
      parentAnchor: null,
      sourceLocation: null,
      componentName: null,
      detectedSource: null,
      detectedComponent: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('LocalStorageAdapter load', () => {
  it('returns null when no data exists', async () => {
    const adapter = new LocalStorageAdapter();
    expect(await adapter.load()).toBeNull();
  });

  it('returns parsed store when data exists', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, annotations: [makeAnnotation()] }),
    );
    const adapter = new LocalStorageAdapter();
    const data = await adapter.load();
    expect(data?.annotations).toHaveLength(1);
    expect(data?.annotations[0].id).toBe('a1');
  });

  it('falls back to memory-only when getItem throws', async () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('boom');
    });
    try {
      const adapter = new LocalStorageAdapter();
      expect(await adapter.load()).toBeNull();
      expect(adapter.isMemoryOnly).toBe(true);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('LocalStorageAdapter save', () => {
  it('persists single annotation via upsert', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save(makeAnnotation({ id: 'a1' }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations).toHaveLength(1);
    expect(raw.annotations[0].id).toBe('a1');
  });

  it('save replaces existing annotation with same id', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save(makeAnnotation({ id: 'a1', comment: 'old' }));
    await adapter.save(makeAnnotation({ id: 'a1', comment: 'new' }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations).toHaveLength(1);
    expect(raw.annotations[0].comment).toBe('new');
  });

  it('appends when id differs', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save(makeAnnotation({ id: 'a1' }));
    await adapter.save(makeAnnotation({ id: 'a2' }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations.map((a: Annotation) => a.id)).toEqual(['a1', 'a2']);
  });

  it('preserves unknown top-level fields', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, annotations: [], customField: 'keep-me' }),
    );
    const adapter = new LocalStorageAdapter();
    await adapter.load();
    await adapter.save(makeAnnotation({ id: 'a1' }));
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.customField).toBe('keep-me');
    expect(raw.annotations).toHaveLength(1);
  });

  it('flips to memory-only when setItem throws', async () => {
    const adapter = new LocalStorageAdapter();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota');
    });
    try {
      await adapter.save(makeAnnotation({ id: 'a1' }));
      expect(adapter.isMemoryOnly).toBe(true);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('does not call setItem once memory-only', async () => {
    const adapter = new LocalStorageAdapter();
    const original = Storage.prototype.setItem;
    const spy = vi.fn(() => {
      throw new Error('quota');
    });
    Storage.prototype.setItem = spy;
    try {
      await adapter.save(makeAnnotation({ id: 'a1' }));
      const callsAfterFirst = spy.mock.calls.length;
      await adapter.save(makeAnnotation({ id: 'a2' }));
      expect(spy.mock.calls.length).toBe(callsAfterFirst);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('LocalStorageAdapter remove', () => {
  it('removes annotation by id', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save(makeAnnotation({ id: 'a1' }));
    await adapter.save(makeAnnotation({ id: 'a2' }));
    await adapter.remove('a1');
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations.map((a: Annotation) => a.id)).toEqual(['a2']);
  });

  it('no-op when id not found', async () => {
    const adapter = new LocalStorageAdapter();
    await adapter.save(makeAnnotation({ id: 'a1' }));
    await adapter.remove('missing');
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations.map((a: Annotation) => a.id)).toEqual(['a1']);
  });
});

describe('LocalStorageAdapter clear', () => {
  it('removes all annotations but keeps extra fields', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, annotations: [makeAnnotation()], customField: 'keep' }),
    );
    const adapter = new LocalStorageAdapter();
    await adapter.load();
    await adapter.clear();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.annotations).toEqual([]);
    expect(raw.customField).toBe('keep');
  });
});
