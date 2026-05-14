import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from './types';
import { AnnotationStorage } from './storage';

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

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('AnnotationStorage round-trip', () => {
  it('starts empty when no prior data in localStorage', () => {
    const store = new AnnotationStorage();
    expect(store.getAll()).toEqual([]);
    expect(store.isMemoryOnly).toBe(false);
  });

  it('persists added annotations to localStorage and reads them back', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1' }));
    store.add(makeAnnotation({ id: 'a2', route: '/about' }));

    const reloaded = new AnnotationStorage();
    expect(reloaded.getAll().map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('filters by route', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1', route: '/home' }));
    store.add(makeAnnotation({ id: 'a2', route: '/about' }));
    store.add(makeAnnotation({ id: 'a3', route: '/home' }));

    expect(store.getByRoute('/home').map((a) => a.id)).toEqual(['a1', 'a3']);
    expect(store.getByRoute('/about').map((a) => a.id)).toEqual(['a2']);
  });

  it('removes annotation by id', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1' }));
    store.add(makeAnnotation({ id: 'a2' }));
    store.remove('a1');

    expect(store.getAll().map((a) => a.id)).toEqual(['a2']);
    expect(new AnnotationStorage().getAll().map((a) => a.id)).toEqual(['a2']);
  });

  it('updates annotation by id with partial changes', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1', comment: 'old' }));
    store.update('a1', { comment: 'new', status: 'resolved' });

    const updated = store.getAll()[0];
    expect(updated.comment).toBe('new');
    expect(updated.status).toBe('resolved');
    expect(updated.id).toBe('a1');
  });

  it('update no-op when id not found', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1', comment: 'kept' }));
    store.update('does-not-exist', { comment: 'changed' });

    expect(store.getAll()[0].comment).toBe('kept');
  });

  it('clearAll empties storage and persists empty state', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1' }));
    store.clearAll();

    expect(store.getAll()).toEqual([]);
    expect(new AnnotationStorage().getAll()).toEqual([]);
  });
});

describe('AnnotationStorage exportJSON / importJSON', () => {
  it('exportJSON returns versioned store with annotations copy', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1' }));

    const exported = store.exportJSON();
    expect(exported.version).toBe(1);
    expect(exported.annotations).toHaveLength(1);
    expect(exported.annotations[0].id).toBe('a1');
  });

  it('importJSON replaces current annotations and persists', () => {
    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'old' }));
    store.importJSON({
      version: 1,
      annotations: [makeAnnotation({ id: 'imported' })],
    });

    expect(store.getAll().map((a) => a.id)).toEqual(['imported']);
    expect(new AnnotationStorage().getAll().map((a) => a.id)).toEqual(['imported']);
  });

  it('importJSON migrates legacy annotations missing viewportBucket', () => {
    const store = new AnnotationStorage();
    const legacy = makeAnnotation({ id: 'legacy', viewport: '1440x900' });
    // simulate legacy data with viewportBucket missing
    delete (legacy as { viewportBucket?: number }).viewportBucket;

    store.importJSON({ version: 1, annotations: [legacy] });

    expect(store.getAll()[0].viewportBucket).toBe(1400);
  });
});

describe('AnnotationStorage preserves unknown top-level fields', () => {
  it('keeps extra fields from localStorage on save', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        annotations: [],
        customField: 'from-future-version',
        anotherField: { nested: true },
      }),
    );

    const store = new AnnotationStorage();
    store.add(makeAnnotation({ id: 'a1' }));

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(raw.customField).toBe('from-future-version');
    expect(raw.anotherField).toEqual({ nested: true });
    expect(raw.annotations).toHaveLength(1);
  });
});

describe('AnnotationStorage memory-only fallback', () => {
  it('falls back to memory-only when localStorage.getItem throws on construction', () => {
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn(() => {
      throw new Error('boom');
    });

    try {
      const store = new AnnotationStorage();
      expect(store.isMemoryOnly).toBe(true);
    } finally {
      Storage.prototype.getItem = originalGet;
    }
  });

  it('falls back to memory-only when localStorage.setItem throws on save', () => {
    const store = new AnnotationStorage();
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });

    try {
      store.add(makeAnnotation({ id: 'a1' }));
      expect(store.isMemoryOnly).toBe(true);
      expect(store.getAll().map((a) => a.id)).toEqual(['a1']);
    } finally {
      Storage.prototype.setItem = originalSet;
    }
  });

  it('does not attempt to save once isMemoryOnly is true', () => {
    const store = new AnnotationStorage();
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error('quota');
    });

    try {
      store.add(makeAnnotation({ id: 'a1' }));
      const callsAfterFirstFailure = (Storage.prototype.setItem as ReturnType<typeof vi.fn>).mock.calls.length;
      store.add(makeAnnotation({ id: 'a2' }));
      const callsAfterSecond = (Storage.prototype.setItem as ReturnType<typeof vi.fn>).mock.calls.length;

      expect(callsAfterSecond).toBe(callsAfterFirstFailure);
      expect(store.getAll().map((a) => a.id)).toEqual(['a1', 'a2']);
    } finally {
      Storage.prototype.setItem = originalSet;
    }
  });
});
