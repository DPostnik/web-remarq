import type { Annotation, AnnotationEvent, AnnotationStore, ElementFingerprint, QualityCheck } from './types'

/**
 * Structural validation of an Annotation arriving from an untrusted boundary
 * (the local HTTP endpoint, a JSON import). Checks types, enums, and size
 * limits; it does not check business rules such as lifecycle consistency -
 * `transition()` owns those.
 *
 * Compatibility policy:
 * - Unknown top-level fields are rejected, so a client/server version skew is
 *   detected instead of silently dropping data.
 * - Unknown fields inside `fingerprint` are kept: it is an open bag of hints
 *   bounded by the size limits below.
 * - `rev` is accepted and passed through; a revision-aware backend overwrites it.
 */

export const LIMITS = {
  id: 128,
  comment: 10_000,
  route: 2_048,
  shortString: 2_048,
  domPath: 4_096,
  classCount: 200,
  className: 256,
  lifecycle: 500,
  reason: 2_000,
  actorName: 200,
  opId: 128,
  qualityList: 50,
  cssModules: 200,
} as const

const STATUSES = new Set(['draft', 'pending', 'in_progress', 'fixed_unverified', 'verified', 'dismissed'])
const ACTORS = new Set(['designer', 'agent', 'developer'])
const EVENT_TYPES = new Set([
  'created', 'submitted', 'acknowledged', 'fix_claimed', 'verified', 'rejected', 'dismissed', 'reopened', 'migrated',
])
const QUALITY_SCORES = new Set(['clear', 'ambiguous', 'unactionable'])
const REFINED_BY = new Set(['designer', 'auto'])
const ANNOTATION_KEYS = new Set([
  'id', 'comment', 'fingerprint', 'route', 'viewport', 'viewportBucket', 'timestamp', 'status', 'lifecycle', 'qualityCheck', 'rev',
])

export type ValidationResult =
  | { ok: true; annotation: Annotation }
  | { ok: false; errors: string[] }

/** Filename-safe id: no separators, no leading dot, no traversal. Shared with the MCP task folder. */
export function isSafeAnnotationId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= LIMITS.id && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
}

class Errors {
  list: string[] = []
  add(path: string, message: string): void {
    if (this.list.length < 20) this.list.push(`${path}: ${message}`)
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkString(errors: Errors, obj: Record<string, unknown>, key: string, path: string, max: number, opts: { nullable?: boolean; optional?: boolean } = {}): void {
  const v = obj[key]
  if (v === undefined) {
    if (!opts.optional) errors.add(`${path}.${key}`, 'required')
    return
  }
  if (v === null) {
    if (!opts.nullable) errors.add(`${path}.${key}`, 'must be a string')
    return
  }
  if (typeof v !== 'string') errors.add(`${path}.${key}`, 'must be a string')
  else if (v.length > max) errors.add(`${path}.${key}`, `longer than ${max} characters`)
}

function checkStringArray(errors: Errors, obj: Record<string, unknown>, key: string, path: string, maxItems: number, maxLen: number, optional = false): void {
  const v = obj[key]
  if (v === undefined) {
    if (!optional) errors.add(`${path}.${key}`, 'required')
    return
  }
  if (!Array.isArray(v)) {
    errors.add(`${path}.${key}`, 'must be an array')
    return
  }
  if (v.length > maxItems) errors.add(`${path}.${key}`, `more than ${maxItems} items`)
  if (!v.every((s) => typeof s === 'string' && s.length <= maxLen)) {
    errors.add(`${path}.${key}`, `items must be strings of at most ${maxLen} characters`)
  }
}

function checkInteger(errors: Errors, obj: Record<string, unknown>, key: string, path: string, min: number, optional = false): void {
  const v = obj[key]
  if (v === undefined) {
    if (!optional) errors.add(`${path}.${key}`, 'required')
    return
  }
  if (!Number.isInteger(v) || (v as number) < min) errors.add(`${path}.${key}`, `must be an integer >= ${min}`)
}

function validateFingerprint(errors: Errors, value: unknown): void {
  const path = 'fingerprint'
  if (!isObject(value)) {
    errors.add(path, 'required object')
    return
  }
  checkString(errors, value, 'tagName', path, 64)
  for (const key of ['dataAnnotate', 'dataTestId', 'id', 'textContent', 'role', 'ariaLabel', 'parentAnchor', 'sourceLocation', 'componentName', 'detectedSource', 'detectedComponent']) {
    checkString(errors, value, key, path, LIMITS.shortString, { nullable: true, optional: true })
  }
  checkString(errors, value, 'domPath', path, LIMITS.domPath)
  checkInteger(errors, value, 'siblingIndex', path, 0)
  checkStringArray(errors, value, 'stableClasses', path, LIMITS.classCount, LIMITS.className)
  checkStringArray(errors, value, 'rawClasses', path, LIMITS.classCount, LIMITS.className, true)
  const mods = value.cssModules
  if (mods !== undefined) {
    if (!Array.isArray(mods) || mods.length > LIMITS.cssModules) errors.add(`${path}.cssModules`, `must be an array of at most ${LIMITS.cssModules} items`)
    else {
      for (const m of mods) {
        if (!isObject(m) || [m.raw, m.moduleHint, m.localName].some((s) => typeof s !== 'string' || s.length > LIMITS.className)) {
          errors.add(`${path}.cssModules`, 'items must be { raw, moduleHint, localName } strings')
          break
        }
      }
    }
  }
}

function validateLifecycle(errors: Errors, value: unknown): void {
  const path = 'lifecycle'
  if (!Array.isArray(value)) {
    errors.add(path, 'required array')
    return
  }
  if (value.length === 0) errors.add(path, 'must contain at least the created event')
  if (value.length > LIMITS.lifecycle) errors.add(path, `more than ${LIMITS.lifecycle} events`)
  value.slice(0, LIMITS.lifecycle).forEach((event, i) => {
    const p = `${path}[${i}]`
    if (!isObject(event)) {
      errors.add(p, 'must be an object')
      return
    }
    if (!EVENT_TYPES.has(event.type as string)) errors.add(`${p}.type`, 'unknown event type')
    if (event.actor !== null && !ACTORS.has(event.actor as string)) errors.add(`${p}.actor`, 'unknown actor')
    checkInteger(errors, event, 'timestamp', p, 0)
    checkString(errors, event, 'actorName', p, LIMITS.actorName, { optional: true })
    checkString(errors, event, 'reason', p, LIMITS.reason, { optional: true })
    checkString(errors, event, 'opId', p, LIMITS.opId, { optional: true })
  })
}

function validateQualityCheck(errors: Errors, value: unknown): void {
  const path = 'qualityCheck'
  if (!isObject(value)) {
    errors.add(path, 'must be an object')
    return
  }
  if (!QUALITY_SCORES.has(value.score as string)) errors.add(`${path}.score`, 'unknown score')
  if (!REFINED_BY.has(value.refinedBy as string)) errors.add(`${path}.refinedBy`, 'unknown refinedBy')
  checkStringArray(errors, value, 'issues', path, LIMITS.qualityList, LIMITS.reason)
  checkStringArray(errors, value, 'clarifyingQuestions', path, LIMITS.qualityList, LIMITS.reason)
  checkString(errors, value, 'suggestedRewrite', path, LIMITS.comment, { optional: true })
  checkInteger(errors, value, 'timestamp', path, 0)
}

export function validateAnnotation(input: unknown): ValidationResult {
  const errors = new Errors()
  if (!isObject(input)) return { ok: false, errors: ['annotation: must be an object'] }

  for (const key of Object.keys(input)) {
    if (!ANNOTATION_KEYS.has(key)) errors.add(key, 'unknown field')
  }

  if (!isSafeAnnotationId(input.id)) errors.add('id', 'must be a filename-safe string (letters, digits, . _ -), at most 128 characters')
  checkString(errors, input, 'comment', 'annotation', LIMITS.comment)
  checkString(errors, input, 'route', 'annotation', LIMITS.route)
  if (typeof input.viewport !== 'string' || !/^\d{1,5}x\d{1,5}$/.test(input.viewport)) errors.add('viewport', 'must look like 1280x720')
  checkInteger(errors, input, 'viewportBucket', 'annotation', 0)
  checkInteger(errors, input, 'timestamp', 'annotation', 1)
  if (!STATUSES.has(input.status as string)) errors.add('status', 'unknown status')
  validateFingerprint(errors, input.fingerprint)
  validateLifecycle(errors, input.lifecycle)
  if (input.qualityCheck !== undefined) validateQualityCheck(errors, input.qualityCheck)
  checkInteger(errors, input, 'rev', 'annotation', 0, true)

  if (errors.list.length > 0) return { ok: false, errors: errors.list }

  const annotation: Annotation = {
    id: input.id as string,
    comment: input.comment as string,
    fingerprint: input.fingerprint as ElementFingerprint,
    route: input.route as string,
    viewport: input.viewport as string,
    viewportBucket: input.viewportBucket as number,
    timestamp: input.timestamp as number,
    status: input.status as Annotation['status'],
    lifecycle: input.lifecycle as AnnotationEvent[],
  }
  if (input.qualityCheck !== undefined) annotation.qualityCheck = input.qualityCheck as QualityCheck
  if (input.rev !== undefined) annotation.rev = input.rev as number
  return { ok: true, annotation }
}

export type StoreValidationResult =
  | { ok: true; store: AnnotationStore }
  | { ok: false; errors: string[] }

/** Validates an exported/imported store: `{ version: 1, annotations: Annotation[] }`. */
export function validateStore(input: unknown): StoreValidationResult {
  if (!isObject(input)) return { ok: false, errors: ['store: must be an object'] }
  if (input.version !== 1) return { ok: false, errors: ['store.version: must be 1'] }
  if (!Array.isArray(input.annotations)) return { ok: false, errors: ['store.annotations: must be an array'] }
  const annotations: Annotation[] = []
  const errors: string[] = []
  input.annotations.forEach((raw, i) => {
    const result = validateAnnotation(raw)
    if (result.ok) annotations.push(result.annotation)
    else errors.push(...result.errors.slice(0, 3).map((e) => `annotations[${i}].${e}`))
  })
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, 20) }
  return { ok: true, store: { version: 1, annotations } }
}
