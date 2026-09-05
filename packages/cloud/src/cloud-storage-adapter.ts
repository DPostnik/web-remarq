import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Annotation,
  AnnotationEvent,
  AnnotationStatus,
  AnnotationStore,
  ElementFingerprint,
  QualityCheck,
  StorageAdapter,
} from 'web-remarq'
import { AnnotationNotFoundError, StorageConflictError } from 'web-remarq/core'
import type { CloudStorageOptions } from './types'

interface AnnotationRow {
  id: string
  project_id?: string
  route: string
  viewport: string
  viewport_bucket: number
  fingerprint: ElementFingerprint
  comment: string
  status: AnnotationStatus
  timestamp_ms: number
  lifecycle: AnnotationEvent[]
  quality_check?: QualityCheck | null
  rev?: number
  created_at?: string
  updated_at?: string
}

type AnnotationWriteRow = Omit<AnnotationRow, 'project_id' | 'created_at'>

/** How many times a conditional write is retried on a fresh read before giving up. */
const MAX_CAS_ATTEMPTS = 5

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    comment: row.comment,
    fingerprint: row.fingerprint,
    route: row.route,
    viewport: row.viewport,
    viewportBucket: row.viewport_bucket,
    timestamp: row.timestamp_ms,
    status: row.status,
    lifecycle: row.lifecycle ?? [],
    qualityCheck: row.quality_check ?? undefined,
    ...(typeof row.rev === 'number' ? { rev: row.rev } : {}),
  }
}

function annotationToRow(a: Annotation, rev: number): AnnotationWriteRow {
  return {
    id: a.id,
    route: a.route,
    viewport: a.viewport,
    viewport_bucket: a.viewportBucket,
    fingerprint: a.fingerprint,
    comment: a.comment,
    status: a.status,
    timestamp_ms: a.timestamp,
    lifecycle: a.lifecycle,
    quality_check: a.qualityCheck ?? null,
    rev,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Supabase-backed StorageAdapter. Project scoping is enforced by RLS through
 * the `x-remarq-project-key` header (see sql/001_init.sql); this class never
 * sends a project id.
 *
 * Concurrency (cloud 0.4.0, needs sql/004_rev.sql): every row carries `rev`.
 * - `save()` of a copy that carries `rev` is a conditional UPDATE
 *   (`id = ? and rev = ?`); zero matched rows means the row moved on and a
 *   `StorageConflictError` with the current copy is thrown - the stale copy
 *   never overwrites a newer status or history.
 * - `save()` of a copy without `rev` is an INSERT (a new record); if the id
 *   already exists that is also reported as a conflict.
 * - A successful `save()` resolves with the confirmed copy carrying the new
 *   `rev`, so `AnnotationStorage` keeps the current revision and the next
 *   edit is not a false conflict (and never a second INSERT). Nothing is
 *   resolved after an error the memory-fallback swallowed: no confirmation
 *   without a write.
 * - `mutate()` is a compare-and-swap loop: read, apply, conditional update,
 *   re-read on a miss. The check and the write are one SQL statement, so
 *   concurrent transitions on one row cannot both succeed. RLS still applies:
 *   a row outside the caller's project matches nothing and reads as not found.
 */
export class CloudStorageAdapter implements StorageAdapter {
  readonly isMemoryOnly = false
  private client: SupabaseClient
  private onError: 'throw' | 'memory-fallback'

  constructor(opts: CloudStorageOptions) {
    this.onError = opts.onError ?? 'throw'
    this.client = createClient(opts.supabaseUrl, opts.supabaseAnonKey, {
      global: {
        headers: { 'x-remarq-project-key': opts.projectKey },
      },
      auth: { persistSession: false },
    })
  }

  async load(): Promise<AnnotationStore> {
    const { data, error } = await this.client
      .from('annotations')
      .select('*')
      .order('timestamp_ms', { ascending: true })

    if (error) {
      return this.handleError<AnnotationStore>(error, { version: 1, annotations: [] })
    }

    const rows = (data ?? []) as AnnotationRow[]
    return { version: 1, annotations: rows.map(rowToAnnotation) }
  }

  async save(annotation: Annotation): Promise<Annotation | void> {
    if (typeof annotation.rev === 'number') {
      const matched = await this.conditionalUpdate(annotation, annotation.rev)
      if (matched === null) return // handled by memory-fallback: nothing confirmed
      if (!matched) throw new StorageConflictError(await this.fetchOne(annotation.id))
      return { ...annotation, rev: annotation.rev + 1 }
    }
    const { error } = await this.client.from('annotations').insert(annotationToRow(annotation, 1))
    if (error) {
      // 23505 = unique_violation: the id already exists, the caller's copy is stale.
      if ((error as { code?: string }).code === '23505') throw new StorageConflictError(await this.fetchOne(annotation.id))
      this.handleError<void>(error, undefined)
      return
    }
    return { ...annotation, rev: 1 }
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.client.from('annotations').delete().eq('id', id)
    if (error) this.handleError<void>(error, undefined)
  }

  async clear(): Promise<void> {
    const { error } = await this.client
      .from('annotations')
      .delete()
      .neq('id', '__never_matches__')
    if (error) this.handleError<void>(error, undefined)
  }

  async mutate(id: string, apply: (current: Annotation) => Annotation): Promise<Annotation> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await this.fetchOne(id)
      if (!current) throw new AnnotationNotFoundError(id)
      const next = apply(current)
      if (next === current) return current
      const expected = current.rev ?? 1
      const matched = await this.conditionalUpdate({ ...next, id }, expected)
      if (matched === null) return { ...next, id }
      if (matched) return { ...next, id, rev: expected + 1 }
      // Lost the race: another writer bumped rev. Re-read and re-apply.
    }
    throw new Error(`mutate(${id}): gave up after ${MAX_CAS_ATTEMPTS} concurrent updates`)
  }

  /** UPDATE ... WHERE id = $id AND rev = $expected. True/false = matched a row or not; null = error swallowed by memory-fallback. */
  private async conditionalUpdate(annotation: Annotation, expected: number): Promise<boolean | null> {
    const { data, error } = await this.client
      .from('annotations')
      .update(annotationToRow(annotation, expected + 1))
      .eq('id', annotation.id)
      .eq('rev', expected)
      .select('id')
    if (error) {
      this.handleError<void>(error, undefined)
      return null
    }
    return Array.isArray(data) && data.length > 0
  }

  private async fetchOne(id: string): Promise<Annotation | null> {
    const { data, error } = await this.client.from('annotations').select('*').eq('id', id).maybeSingle()
    if (error) {
      this.handleError<void>(error, undefined)
      return null
    }
    return data ? rowToAnnotation(data as AnnotationRow) : null
  }

  private handleError<T>(error: unknown, fallback: T): T {
    if (this.onError === 'throw') {
      throw error
    }
    console.warn('[web-remarq cloud]', error)
    return fallback
  }
}
