import type { Annotation, AnnotationStore, StorageAdapter } from './types';

const STORAGE_KEY = 'remarq:annotations';

export class LocalStorageAdapter implements StorageAdapter {
  isMemoryOnly = false;
  private extraFields: Record<string, unknown> = {};
  private memoryStore: AnnotationStore | null = null;

  async load(): Promise<AnnotationStore | null> {
    if (this.isMemoryOnly) return this.memoryStore;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const { version, annotations, ...rest } = parsed;
      this.extraFields = rest;
      const store: AnnotationStore = {
        version: 1,
        annotations: Array.isArray(annotations) ? annotations : [],
      };
      this.memoryStore = store;
      return store;
    } catch {
      this.isMemoryOnly = true;
      return this.memoryStore;
    }
  }

  async save(annotation: Annotation): Promise<void> {
    const store = await this.ensureStore();
    const idx = store.annotations.findIndex((a) => a.id === annotation.id);
    if (idx === -1) {
      store.annotations.push(annotation);
    } else {
      store.annotations[idx] = annotation;
    }
    this.persist(store);
  }

  async remove(id: string): Promise<void> {
    const store = await this.ensureStore();
    store.annotations = store.annotations.filter((a) => a.id !== id);
    this.persist(store);
  }

  async clear(): Promise<void> {
    const store = await this.ensureStore();
    store.annotations = [];
    this.persist(store);
  }

  private async ensureStore(): Promise<AnnotationStore> {
    if (this.memoryStore) return this.memoryStore;
    const loaded = await this.load();
    if (loaded) return loaded;
    this.memoryStore = { version: 1, annotations: [] };
    return this.memoryStore;
  }

  private persist(store: AnnotationStore): void {
    if (this.isMemoryOnly) return;
    try {
      const data = {
        version: 1,
        ...this.extraFields,
        annotations: store.annotations,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      this.isMemoryOnly = true;
    }
  }
}
