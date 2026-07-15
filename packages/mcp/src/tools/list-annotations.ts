import { z } from 'zod'
import type { Annotation, AnnotationStatus, QualityCheck, StorageAdapter } from 'web-remarq'
import { toolError, toolSuccess } from '../errors'

const STATUS_VALUES = ['pending', 'in_progress', 'fixed_unverified', 'verified', 'dismissed'] as const

export const listAnnotationsInputSchema = z.object({
  route: z.string().optional(),
  status: z.union([z.enum(STATUS_VALUES), z.array(z.enum(STATUS_VALUES))]).optional(),
  viewportBucket: z.number().int().optional(),
  file: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

export type ListAnnotationsInput = z.infer<typeof listAnnotationsInputSchema>

interface ThinAnnotation {
  id: string
  route: string
  comment: string
  status: AnnotationStatus
  viewport: number
  timestamp: number
  source: { file: string; line: number; column: number; component?: string } | null
  quality?: QualityCheck['score']
}

function parseSource(annotation: Annotation): ThinAnnotation['source'] {
  const fp = annotation.fingerprint
  const raw = fp.sourceLocation ?? fp.detectedSource
  if (!raw) return null
  const parts = raw.split(':')
  if (parts.length < 2) return null
  const column = parseInt(parts.pop()!, 10)
  const line = parseInt(parts.pop()!, 10)
  const file = parts.join(':')
  if (!file || isNaN(line)) return null
  const component = fp.componentName ?? fp.detectedComponent ?? undefined
  return { file, line, column: isNaN(column) ? 0 : column, ...(component ? { component } : {}) }
}

function toThin(a: Annotation): ThinAnnotation {
  return {
    id: a.id,
    route: a.route,
    comment: a.comment,
    status: a.status,
    viewport: a.viewportBucket,
    timestamp: a.timestamp,
    source: parseSource(a),
    ...(a.qualityCheck ? { quality: a.qualityCheck.score } : {}),
  }
}

export async function handleListAnnotations(input: ListAnnotationsInput, storage: StorageAdapter) {
  let store
  try {
    store = await storage.load()
  } catch (err) {
    return toolError('storage_error', err instanceof Error ? err.message : String(err))
  }
  const all = store?.annotations ?? []

  const statusFilter = Array.isArray(input.status)
    ? new Set(input.status)
    : input.status
    ? new Set([input.status])
    : null

  const filtered = all.filter((a) => {
    if (input.route !== undefined && a.route !== input.route) return false
    if (statusFilter && !statusFilter.has(a.status)) return false
    if (input.viewportBucket !== undefined && a.viewportBucket !== input.viewportBucket) return false
    if (input.file !== undefined) {
      const src = a.fingerprint.sourceLocation ?? a.fingerprint.detectedSource ?? ''
      if (!src.includes(input.file)) return false
    }
    return true
  })

  const limit = input.limit ?? 50
  const thinned = filtered.slice(0, limit).map(toThin)

  return toolSuccess({ annotations: thinned, total: filtered.length })
}
