import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from './types';
import { AnnotationStorage } from './storage';
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
      stableClasses: ['btn', 'primary'],
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

async function makeStore(): Promise<AnnotationStorage> {
  const store = new AnnotationStorage(new LocalStorageAdapter());
  await store.ready;
  return store;
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('AnnotationStorage round-trip', () => {
  it('starts empty when no prior data in localStorage', async () => {
    const store = await makeStore();
    expect(store.getAll()).toEqual([]);
    expect(store.isMemoryOnly).toBe(false);
  });

  it('persists added annotations via adapter and reads them back', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1' }));
    await store.add(makeAnnotation({ id: 'a2', route: '/about' }));

    const reloaded = await makeStore();
    expect(reloaded.getAll().map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('filters by route', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', route: '/home' }));
    await store.add(makeAnnotation({ id: 'a2', route: '/about' }));
    await store.add(makeAnnotation({ id: 'a3', route: '/home' }));

    expect(store.getByRoute('/home').map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(store.getByRoute('/about').map((a) => a.id)).toEqual(['a2']);
  });

  it('removes annotation by id', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1' }));
    await store.add(makeAnnotation({ id: 'a2' }));
    await store.remove('a1');

    expect(store.getAll().map((a) => a.id)).toEqual(['a2']);
    const reloaded = await makeStore();
    expect(reloaded.getAll().map((a) => a.id)).toEqual(['a2']);
  });

  it('updates annotation by id with partial changes', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', comment: 'old' }));
    await store.update('a1', { comment: 'new', status: 'resolved' });

    const updated = store.getAll()[0];
    expect(updated.comment).toBe('new');
    expect(updated.status).toBe('resolved');
    expect(updated.id).toBe('a1');
  });

  it('update no-op when id not found', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', comment: 'kept' }));
    await store.update('does-not-exist', { comment: 'changed' });

    expect(store.getAll()[0].comment).toBe('kept');
  });

  it('clearAll empties storage and persists empty state', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1' }));
    await store.clearAll();

    expect(store.getAll()).toEqual([]);
    const reloaded = await makeStore();
    expect(reloaded.getAll()).toEqual([]);
  });
});

describe('AnnotationStorage exportJSON / importJSON', () => {
  it('exportJSON returns versioned store with annotations copy', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1' }));

    const exported = store.exportJSON();
    expect(exported.version).toBe(1);
    expect(exported.annotations).toHaveLength(1);
    expect(exported.annotations[0].id).toBe('a1');
  });

  it('importJSON replaces current annotations and persists', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'old' }));
    await store.importJSON({
      version: 1,
      annotations: [makeAnnotation({ id: 'imported' })],
    });

    expect(store.getAll().map((a) => a.id)).toEqual(['imported']);
    const reloaded = await makeStore();
    expect(reloaded.getAll().map((a) => a.id)).toEqual(['imported']);
  });

  it('importJSON migrates legacy annotations missing viewportBucket', async () => {
    const store = await makeStore();
    const legacy = makeAnnotation({ id: 'legacy', viewport: '1440x900' });
    delete (legacy as { viewportBucket?: number }).viewportBucket;

    await store.importJSON({ version: 1, annotations: [legacy] });

    expect(store.getAll()[0].viewportBucket).toBe(1400);
  });
});

describe('AnnotationStorage with LocalStorageAdapter preserves unknown fields', () => {
  it('keeps extra top-level fields from localStorage on save', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        annotations: [],
        customField: 'from-future-version',
        anotherField: { nested: true },
      }),
    );

    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1' }));

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.customField).toBe('from-future-version');
    expect(raw.anotherField).toEqual({ nested: true });
    expect(raw.annotations).toHaveLength(1);
  });
});

describe('AnnotationStorage memory-only fallback', () => {
  it('isMemoryOnly true when adapter load throws', async () => {
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('boom');
    });

    try {
      const store = await makeStore();
      expect(store.isMemoryOnly).toBe(true);
    } finally {
      Storage.prototype.getItem = originalGet;
    }
  });

  it('isMemoryOnly true when adapter save throws', async () => {
    const store = await makeStore();
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });

    try {
      await store.add(makeAnnotation({ id: 'a1' }));
      expect(store.isMemoryOnly).toBe(true);
      expect(store.getAll().map((a) => a.id)).toEqual(['a1']);
    } finally {
      Storage.prototype.setItem = originalSet;
    }
  });
});

describe('AnnotationStorage with custom adapter', () => {
  it('uses injected adapter instead of default', async () => {
    const calls: string[] = [];
    const adapter = {
      isMemoryOnly: false,
      async load() {
        calls.push('load');
        return null;
      },
      async save(a: Annotation) {
        calls.push(`save:${a.id}`);
      },
      async remove(id: string) {
        calls.push(`remove:${id}`);
      },
      async clear() {
        calls.push('clear');
      },
    };
    const store = new AnnotationStorage(adapter);
    await store.ready;

    await store.add(makeAnnotation({ id: 'a1' }));
    await store.remove('a1');
    await store.clearAll();

    expect(calls).toEqual(['load', 'save:a1', 'remove:a1', 'clear']);
  });

  it('seeds cache from adapter.load() on init', async () => {
    const seeded: Annotation[] = [makeAnnotation({ id: 'seeded' })];
    const adapter = {
      async load() {
        return { version: 1 as const, annotations: seeded };
      },
      async save() {},
      async remove() {},
      async clear() {},
    };
    const store = new AnnotationStorage(adapter);
    await store.ready;
    expect(store.getAll().map((a) => a.id)).toEqual(['seeded']);
  });
});
