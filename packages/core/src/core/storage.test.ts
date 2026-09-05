import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, StorageAdapter, StorageChangeEvent, StorageStatus } from './types';
import { StorageConflictError } from './types';
import { AnnotationStorage, migrateAnnotation } from './storage';
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
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
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
    await store.update('a1', { comment: 'new', status: 'verified' });

    const updated = store.getAll()[0];
    expect(updated.comment).toBe('new');
    expect(updated.status).toBe('verified');
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

  it('getById returns the annotation when present, undefined otherwise', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', comment: 'first' }));
    await store.add(makeAnnotation({ id: 'a2', comment: 'second' }));

    expect(store.getById('a1')?.comment).toBe('first');
    expect(store.getById('a2')?.comment).toBe('second');
    expect(store.getById('missing')).toBeUndefined();
  });

  it('getById reflects updates made via update() — no stale snapshots', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', comment: 'original' }));

    // Capture a reference before update — should NOT be what a fresh call returns later.
    const before = store.getById('a1');
    expect(before?.comment).toBe('original');

    await store.update('a1', { comment: 'edited' });

    expect(store.getById('a1')?.comment).toBe('edited');
  });

  it('getById reflects status changes from lifecycle transitions', async () => {
    const store = await makeStore();
    await store.add(makeAnnotation({ id: 'a1', status: 'pending' }));

    await store.update('a1', {
      status: 'in_progress',
      lifecycle: [
        { type: 'created', actor: 'designer', timestamp: 1 },
        { type: 'acknowledged', actor: 'developer', timestamp: 2 },
      ],
    });

    const fresh = store.getById('a1');
    expect(fresh?.status).toBe('in_progress');
    expect(fresh?.lifecycle).toHaveLength(2);
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

describe('AnnotationStorage rollback on adapter failure', () => {
  function failingAdapter(fail: Partial<Record<'save' | 'remove' | 'clear', boolean>>, seed: Annotation[] = []): StorageAdapter {
    return {
      load: async () => ({ version: 1, annotations: seed }),
      save: async () => { if (fail.save) throw new Error('save failed') },
      remove: async () => { if (fail.remove) throw new Error('remove failed') },
      clear: async () => { if (fail.clear) throw new Error('clear failed') },
    };
  }

  it('add() rejects and the annotation is not shown as saved', async () => {
    const store = new AnnotationStorage(failingAdapter({ save: true }));
    await store.ready;
    await expect(store.add(makeAnnotation({ id: 'x' }))).rejects.toThrow('save failed');
    expect(store.getAll()).toEqual([]);
  });

  it('update() rejects and restores the previous copy', async () => {
    const seed = makeAnnotation({ id: 'a1', comment: 'before' });
    const store = new AnnotationStorage(failingAdapter({ save: true }, [seed]));
    await store.ready;
    await expect(store.update('a1', { comment: 'after' })).rejects.toThrow('save failed');
    expect(store.getById('a1')?.comment).toBe('before');
  });

  it('update() on a StorageConflictError adopts the backend copy instead of the local one', async () => {
    const seed = makeAnnotation({ id: 'a1', comment: 'before', rev: 1 });
    const current = makeAnnotation({ id: 'a1', comment: 'server', status: 'in_progress', rev: 2 });
    const adapter: StorageAdapter = {
      ...failingAdapter({}, [seed]),
      save: async () => { throw new StorageConflictError(current) },
    };
    const store = new AnnotationStorage(adapter);
    await store.ready;
    await expect(store.update('a1', { comment: 'mine' })).rejects.toBeInstanceOf(StorageConflictError);
    expect(store.getById('a1')).toMatchObject({ comment: 'server', status: 'in_progress', rev: 2 });
  });

  it('remove() and clearAll() reject and restore the cache', async () => {
    const seed = [makeAnnotation({ id: 'a1' }), makeAnnotation({ id: 'a2' })];
    const store = new AnnotationStorage(failingAdapter({ remove: true, clear: true }, seed));
    await store.ready;
    await expect(store.remove('a1')).rejects.toThrow('remove failed');
    expect(store.getAll().map((a) => a.id)).toEqual(['a1', 'a2']);
    await expect(store.clearAll()).rejects.toThrow('clear failed');
    expect(store.getAll()).toHaveLength(2);
  });

  it('importJSON() restores the previous annotations when a write fails part-way', async () => {
    const seed = [makeAnnotation({ id: 'old' })];
    const saved: string[] = [];
    let calls = 0;
    const adapter: StorageAdapter = {
      load: async () => ({ version: 1, annotations: seed }),
      save: async (a) => { calls++; if (calls === 2) throw new Error('disk full'); saved.push(a.id) },
      remove: async () => {},
      clear: async () => {},
    };
    const store = new AnnotationStorage(adapter);
    await store.ready;
    await expect(
      store.importJSON({ version: 1, annotations: [makeAnnotation({ id: 'n1' }), makeAnnotation({ id: 'n2' })] }),
    ).rejects.toThrow('disk full');
    expect(store.getAll().map((a) => a.id)).toEqual(['old']);
    expect(saved).toContain('old'); // best-effort re-save of the previous set
  });

  it('forwards adapter status notifications through onStatus()', async () => {
    const seen: StorageStatus[] = [];
    const adapter: StorageAdapter = {
      ...failingAdapter({}),
      onStatus: (cb) => { cb({ state: 'queued', pending: 2 }); return () => {} },
    };
    const store = new AnnotationStorage(adapter);
    store.onStatus((s) => seen.push(s));
    expect(seen).toEqual([{ state: 'queued', pending: 2 }]);
  });
});

describe('AnnotationStorage with a revision-aware adapter (save resolves with the confirmed copy)', () => {
  /** Backend that assigns revisions like the cloud adapter: insert = rev 1, conditional update = rev + 1. */
  function revisionAdapter(seed: Annotation[] = []) {
    const rows = new Map(seed.map((a) => [a.id, a]));
    const seenRevs: Array<number | undefined> = [];
    const adapter: StorageAdapter = {
      load: async () => ({ version: 1, annotations: [...rows.values()] }),
      save: async (a) => {
        seenRevs.push(a.rev);
        if (typeof a.rev === 'number') {
          const current = rows.get(a.id);
          if (!current || current.rev !== a.rev) throw new StorageConflictError(current ?? null);
          const saved = { ...a, rev: a.rev + 1 };
          rows.set(a.id, saved);
          return saved;
        }
        if (rows.has(a.id)) throw new StorageConflictError(rows.get(a.id)!);
        const saved = { ...a, rev: 1 };
        rows.set(a.id, saved);
        return saved;
      },
      remove: async (id) => { rows.delete(id) },
      clear: async () => { rows.clear() },
    };
    return { adapter, rows, seenRevs };
  }

  it('create / edit / edit carries the current revision every time, without a reload or a false conflict', async () => {
    const { adapter, rows, seenRevs } = revisionAdapter();
    const store = new AnnotationStorage(adapter);
    await store.ready;
    await store.add(makeAnnotation({ id: 'a1' }));
    expect(store.getById('a1')?.rev).toBe(1);
    await store.update('a1', { comment: 'second' });
    expect(store.getById('a1')?.rev).toBe(2);
    await store.update('a1', { comment: 'third' });
    expect(store.getById('a1')).toMatchObject({ comment: 'third', rev: 3 });
    expect(rows.get('a1')).toMatchObject({ comment: 'third', rev: 3 });
    expect(seenRevs).toEqual([undefined, 1, 2]);
  });

  it('load / edit / edit starts from the loaded revision', async () => {
    const { adapter, seenRevs } = revisionAdapter([makeAnnotation({ id: 'a1', rev: 3 })]);
    const store = new AnnotationStorage(adapter);
    await store.ready;
    await store.update('a1', { comment: 'four' });
    await store.update('a1', { comment: 'five' });
    expect(store.getById('a1')?.rev).toBe(5);
    expect(seenRevs).toEqual([3, 4]);
  });

  it('a real concurrent change is still a conflict, and the adopted backend copy makes the next edit succeed', async () => {
    const { adapter, rows } = revisionAdapter([makeAnnotation({ id: 'a1', rev: 3 })]);
    const store = new AnnotationStorage(adapter);
    await store.ready;
    rows.set('a1', makeAnnotation({ id: 'a1', status: 'in_progress', rev: 4 })); // someone else wrote
    await expect(store.update('a1', { comment: 'stale' })).rejects.toBeInstanceOf(StorageConflictError);
    expect(store.getById('a1')).toMatchObject({ status: 'in_progress', rev: 4 });
    await store.update('a1', { comment: 'fresh' });
    expect(rows.get('a1')).toMatchObject({ comment: 'fresh', status: 'in_progress', rev: 5 });
  });

  it('an adapter that resolves with nothing (localStorage-style) leaves the local copy untouched', async () => {
    const store = await makeStore();
    const ann = makeAnnotation({ id: 'a1' });
    await store.add(ann);
    expect(store.getById('a1')).toEqual(ann);
    expect(store.getById('a1')?.rev).toBeUndefined();
  });

  it('a failed write confirms nothing: no revision is adopted, the cache is rolled back', async () => {
    const { adapter } = revisionAdapter([makeAnnotation({ id: 'a1', rev: 3 })]);
    const failing: StorageAdapter = { ...adapter, save: async () => { throw new Error('network down') } };
    const store = new AnnotationStorage(failing);
    await store.ready;
    await expect(store.add(makeAnnotation({ id: 'new' }))).rejects.toThrow('network down');
    expect(store.getById('new')).toBeUndefined();
    await expect(store.update('a1', { comment: 'x' })).rejects.toThrow('network down');
    expect(store.getById('a1')).toMatchObject({ comment: 'Fix padding', rev: 3 });
  });

  it('importJSON writes every record as a new one: an exported rev never becomes the expected revision of an update', async () => {
    const { adapter, rows, seenRevs } = revisionAdapter([makeAnnotation({ id: 'a1', rev: 3 })]);
    const store = new AnnotationStorage(adapter);
    await store.ready;
    await store.importJSON({ version: 1, annotations: [makeAnnotation({ id: 'a1', comment: 'imported', rev: 3 }), makeAnnotation({ id: 'b1', rev: 9 })] });
    expect(seenRevs).toEqual([undefined, undefined]);
    expect(rows.get('a1')).toMatchObject({ comment: 'imported', rev: 1 });
    expect(store.getAll().map((a) => [a.id, a.rev])).toEqual([['a1', 1], ['b1', 1]]);
  });

  it('importJSON rollback re-creates the previous records without their old revisions', async () => {
    const { adapter, rows, seenRevs } = revisionAdapter([makeAnnotation({ id: 'old', rev: 7 })]);
    let calls = 0;
    const flaky: StorageAdapter = { ...adapter, save: async (a) => { calls++; if (calls === 1) throw new Error('disk full'); return adapter.save(a) } };
    const store = new AnnotationStorage(flaky);
    await store.ready;
    await expect(store.importJSON({ version: 1, annotations: [makeAnnotation({ id: 'n1' })] })).rejects.toThrow('disk full');
    expect(seenRevs).toEqual([undefined]); // only the rollback re-save reached the backend, as a new record
    expect(rows.get('old')).toMatchObject({ id: 'old', rev: 1 });
    expect(store.getById('old')?.rev).toBe(1);
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

describe('AnnotationStorage external change sync', () => {
  it('applies adapter subscribe events to the cache and notifies onChange', async () => {
    let emit: ((e: StorageChangeEvent) => void) | null = null;
    const adapter: StorageAdapter = {
      async load() { return { version: 1, annotations: [] }; },
      async save() {},
      async remove() {},
      async clear() {},
      subscribe(cb) { emit = cb; return () => { emit = null; }; },
    };
    const store = new AnnotationStorage(adapter);
    await store.ready;
    const seen: StorageChangeEvent[] = [];
    store.onChange((e) => seen.push(e));

    const a1 = makeAnnotation({ id: 'x1' });
    emit!({ type: 'add', annotation: a1 });
    expect(store.getById('x1')).toBeDefined();

    emit!({ type: 'update', annotation: { ...a1, comment: 'edited' } });
    expect(store.getById('x1')?.comment).toBe('edited');

    emit!({ type: 'remove', id: 'x1' });
    expect(store.getById('x1')).toBeUndefined();

    emit!({ type: 'clear' });
    expect(store.getAll()).toEqual([]);

    expect(seen.map((e) => e.type)).toEqual(['add', 'update', 'remove', 'clear']);

    store.destroy();
    expect(emit).toBeNull();
  });
});

describe('migrateAnnotation', () => {
  function legacyBase(extra: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      comment: 'x',
      route: '/',
      viewport: '1280x720',
      viewportBucket: 1200,
      timestamp: 1_700_000_000_000,
      fingerprint: {} as any,
      ...extra,
    };
  }

  it('legacy pending without lifecycle → status pending + created event', () => {
    const result = migrateAnnotation(legacyBase({ status: 'pending' }));
    expect(result.status).toBe('pending');
    expect(result.lifecycle).toHaveLength(1);
    expect(result.lifecycle[0]).toEqual({
      type: 'created',
      actor: 'designer',
      timestamp: 1_700_000_000_000,
    });
  });

  it('legacy resolved → status verified + created + migrated events', () => {
    const result = migrateAnnotation(legacyBase({ status: 'resolved' }));
    expect(result.status).toBe('verified');
    expect(result.lifecycle).toHaveLength(2);
    expect(result.lifecycle[0].type).toBe('created');
    expect(result.lifecycle[1].type).toBe('migrated');
    expect(result.lifecycle[1].actor).toBeNull();
  });

  it('annotation with existing lifecycle passes through (status pending preserved)', () => {
    const existing = [
      { type: 'created' as const, actor: 'designer' as const, timestamp: 1 },
      { type: 'acknowledged' as const, actor: 'developer' as const, timestamp: 2 },
    ];
    const result = migrateAnnotation(legacyBase({ status: 'in_progress', lifecycle: existing }));
    expect(result.status).toBe('in_progress');
    expect(result.lifecycle).toEqual(existing);
  });

  it('annotation with existing lifecycle and legacy resolved still maps status to verified', () => {
    const existing = [{ type: 'created' as const, actor: 'designer' as const, timestamp: 1 }];
    const result = migrateAnnotation(legacyBase({ status: 'resolved', lifecycle: existing }));
    expect(result.status).toBe('verified');
    expect(result.lifecycle).toEqual(existing);
  });

  it('is idempotent', () => {
    const once = migrateAnnotation(legacyBase({ status: 'pending' }));
    const twice = migrateAnnotation(once);
    expect(twice.status).toBe(once.status);
    expect(twice.lifecycle).toEqual(once.lifecycle);
  });
});

describe('AnnotationStorage migration on load', () => {
  it('migrates legacy annotations loaded from localStorage', async () => {
    localStorage.setItem(
      'remarq:annotations',
      JSON.stringify({
        version: 1,
        annotations: [
          { ...{ id: 'a1', comment: 'x', route: '/', viewport: '1280x720', viewportBucket: 1200, timestamp: 1_700_000_000_000, fingerprint: {} }, status: 'resolved' },
        ],
      }),
    );

    const store = new AnnotationStorage(new LocalStorageAdapter());
    await store.ready;
    const loaded = store.getAll()[0];
    expect(loaded.status).toBe('verified');
    expect(loaded.lifecycle.length).toBeGreaterThanOrEqual(1);
    expect(loaded.lifecycle[0].type).toBe('created');
  });

  it('migrates legacy annotations via importJSON', async () => {
    const store = await makeStore();
    await store.importJSON({
      version: 1,
      annotations: [
        { id: 'imp', comment: 'x', route: '/', viewport: '1280x720', viewportBucket: 1200, timestamp: 1_700_000_000_000, status: 'pending', fingerprint: {} as any } as any,
      ],
    });
    const ann = store.getAll()[0];
    expect(ann.lifecycle[0].type).toBe('created');
    expect(ann.lifecycle[0].actor).toBe('designer');
  });
});
