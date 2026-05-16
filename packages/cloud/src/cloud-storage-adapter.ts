import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Annotation,
  AnnotationEvent,
  AnnotationStatus,
  AnnotationStore,
  ElementFingerprint,
  StorageAdapter,
} from 'web-remarq'
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
  lifecycle?: AnnotationEvent[]
  created_at?: string
  updated_at?: string
}

type AnnotationWriteRow = Omit<AnnotationRow, 'project_id' | 'created_at'>

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
  }
}

function annotationToRow(a: Annotation): AnnotationWriteRow {
  // lifecycle is intentionally NOT written here — cloud-0.1.0 schema doesn't
  // have a lifecycle column. Will be added in cloud-0.1.1 alongside SQL migration.
  // Until then, lifecycle history doesn't survive across browser sessions for
  // cloud users; migrateAnnotation synthesizes a created event on load.
  return {
    id: a.id,
    route: a.route,
    viewport: a.viewport,
    viewport_bucket: a.viewportBucket,
    fingerprint: a.fingerprint,
    comment: a.comment,
    status: a.status,
    timestamp_ms: a.timestamp,
    updated_at: new Date().toISOString(),
  }
}

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

  async save(annotation: Annotation): Promise<void> {
    const row = annotationToRow(annotation)
    const { error } = await this.client
      .from('annotations')
      .upsert(row, { onConflict: 'id' })
    if (error) this.handleError<void>(error, undefined)
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

  private handleError<T>(error: unknown, fallback: T): T {
    if (this.onError === 'throw') {
      throw error
    }
    console.warn('[web-remarq cloud]', error)
    return fallback
  }
}
