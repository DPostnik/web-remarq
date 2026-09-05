export interface CSSModuleClass {
  raw: string        // "lucky-banners__luckyBanners__cEqts"
  moduleHint: string // "lucky-banners"
  localName: string  // "luckyBanners"
}

export interface SourceDetectionResult {
  source: string | null
  component: string | null
}

export interface ElementFingerprint {
  // Priority 1 — stable anchors
  dataAnnotate: string | null
  dataTestId: string | null
  id: string | null

  // Priority 2 — semantics
  tagName: string
  textContent: string | null
  role: string | null
  ariaLabel: string | null

  // Priority 3 — structure
  stableClasses: string[]
  domPath: string
  siblingIndex: number

  // Priority 4 — parent context
  parentAnchor: string | null

  // Priority 5 — agent export (optional, not used for matching)
  rawClasses?: string[]
  cssModules?: CSSModuleClass[]

  // Priority 6 — source location (from build plugin or runtime detection)
  sourceLocation: string | null   // "src/components/Form.tsx:24:6"
  componentName: string | null    // "Form"
  detectedSource: string | null   // from React fiber or external data-source
  detectedComponent: string | null // from fiber.type.name or displayName
}

export type AnnotationStatus =
  | 'draft'
  | 'pending'
  | 'in_progress'
  | 'fixed_unverified'
  | 'verified'
  | 'dismissed'

export type Actor = 'designer' | 'agent' | 'developer'

export type AnnotationEventType =
  | 'created'
  | 'submitted'
  | 'acknowledged'
  | 'fix_claimed'
  | 'verified'
  | 'rejected'
  | 'dismissed'
  | 'reopened'
  | 'migrated'

export interface AnnotationEvent {
  type: AnnotationEventType
  actor: Actor | null
  actorName?: string
  timestamp: number
  reason?: string
  /**
   * Caller-chosen operation id (v0.9.0). A transition retried with the same
   * opId after a lost response is recognised as already applied instead of
   * appending a second event. Only agents/tools set it; the widget never does.
   */
  opId?: string
}

export interface QualityCheck {
  score: 'clear' | 'ambiguous' | 'unactionable'
  issues: string[]
  clarifyingQuestions: string[]
  suggestedRewrite?: string
  refinedBy: 'designer' | 'auto'
  timestamp: number
}

export interface QualityCheckInput {
  comment: string
  fingerprint: ElementFingerprint
  route: string
  viewport: { width: number; height: number }
}

/** Pluggable AI pre-flight check. Core never calls a provider itself. */
export interface QualityGateOptions {
  mode?: 'off' | 'suggest'  // default 'suggest'
  check: (input: QualityCheckInput) => Promise<QualityCheck>
}

export interface Annotation {
  id: string
  comment: string
  fingerprint: ElementFingerprint
  route: string
  viewport: string  // e.g. "1920x1080"
  viewportBucket: number  // e.g. 300 (width rounded down to 100px)
  timestamp: number
  status: AnnotationStatus
  lifecycle: AnnotationEvent[]
  qualityCheck?: QualityCheck
  /**
   * Per-annotation revision, assigned by a revision-aware backend (v0.9.0:
   * the local MCP server, the cloud adapter). Clients echo it back on writes
   * (`If-Match`) so a stale copy cannot overwrite a newer status or history.
   * Absent on backends that do not track revisions (localStorage).
   */
  rev?: number
}

export interface AnnotationStore {
  version: 1
  annotations: Annotation[]
}

export type ToolbarPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface WebRemarqOptions {
  theme?: 'light' | 'dark'
  classFilter?: (className: string) => boolean
  dataAttribute?: string
  position?: ToolbarPosition
  shortcuts?: boolean
  storage?: StorageAdapter
  qualityGate?: QualityGateOptions
  submitFlow?: boolean
}

export interface ImportResult {
  total: number
  matched: number
  otherBreakpoint: number
  detached: number
}

export type SearchConfidence = 'high' | 'medium' | 'low'

export interface GrepQuery {
  query: string
  glob: string
  confidence: SearchConfidence
}

export interface AgentSearchHints {
  grepQueries: GrepQuery[]
  domContext: string
  tagName: string
  classes: string[]
}

export interface AgentAnnotationSource {
  file: string
  line: number
  column: number
  component: string | null
}

export interface AgentLifecycleEvent {
  type: AnnotationEventType
  actor: Actor | null
  timestamp: number
  reason?: string
}

export interface AgentAnnotation {
  id: string
  route: string
  comment: string
  status: AnnotationStatus
  timestamp: number
  source: AgentAnnotationSource | null
  searchHints: AgentSearchHints
  lifecycle: AgentLifecycleEvent[]
  qualityCheck?: QualityCheck
}

export interface AgentExport {
  version: 1
  format: 'agent'
  viewportBucket: number
  annotations: AgentAnnotation[]
}

export interface StorageChangeEvent {
  type: 'add' | 'update' | 'remove' | 'clear'
  annotation?: Annotation
  id?: string
}

/**
 * Where the adapter's writes currently land (v0.9.0). Distinct states, never
 * collapsed: a write the server confirmed, a write that only reached durable
 * local storage (queued for the server), and a write that lives in memory only.
 */
export type StorageSyncState =
  /** Every write is confirmed by the backend. */
  | 'synced'
  /** Backend unreachable; writes are queued in durable local storage. */
  | 'queued'
  /** Durable local storage is unavailable too; writes survive only until reload. */
  | 'memory'
  /** Backend refused the credential or the project does not match; nothing is sent. */
  | 'unauthorized'
  /** Backend rejected an operation as invalid; it was parked, not retried. */
  | 'rejected'
  /** A stale write collided with a newer backend copy; local intent was kept for review. */
  | 'conflict'
  /** The backend speaks an older protocol; nothing is sent until it is upgraded. */
  | 'incompatible'

export interface StorageStatus {
  state: StorageSyncState
  /** Operations waiting to be sent (queued state) or parked (rejected/conflict). */
  pending: number
  /** Human-readable detail for the toolbar/toast. */
  message?: string
}

/**
 * Error thrown by `StorageAdapter.mutate` when the record does not exist.
 * Kept as a plain class (no subclassing of DOMException) so adapters in any
 * runtime can throw it.
 */
export class AnnotationNotFoundError extends Error {
  constructor(id: string) {
    super(`Annotation ${id} not found`)
    this.name = 'AnnotationNotFoundError'
  }
}

/**
 * Thrown by a revision-aware adapter's `save` when the record changed on the
 * backend since the caller last read it. `current` is the backend's copy
 * (null when it was deleted there). The caller keeps its intent and decides.
 */
export class StorageConflictError extends Error {
  constructor(public readonly current: Annotation | null) {
    super('annotation changed on the backend since it was last read')
    this.name = 'StorageConflictError'
  }
}

export interface StorageAdapter {
  load(): Promise<AnnotationStore | null>
  /**
   * Persist one annotation. A revision-aware backend may resolve with the
   * confirmed copy (v0.9.0: it carries the revision the backend assigned);
   * `AnnotationStorage` then replaces its cached copy with it, so the next
   * write carries the current revision instead of a stale one. Resolving
   * with nothing keeps the caller's copy as is. Never resolve with a copy
   * after a failed write - reject instead.
   */
  save(annotation: Annotation): Promise<void | Annotation>
  remove(id: string): Promise<void>
  clear(): Promise<void>
  subscribe?(callback: (event: StorageChangeEvent) => void): () => void
  /**
   * Atomic read-check-write (v0.9.0, optional). Loads the current record,
   * applies `apply` to it and persists the result so that no other mutation
   * of the same record can interleave: concurrent callers observe each
   * other's results, never a shared stale read. `apply` may throw to abort
   * (nothing is persisted, the error propagates); returning the same object
   * it was given persists nothing (no revision bump). Rejects with
   * `AnnotationNotFoundError` when the id is absent. Adapters without this
   * method only offer non-atomic load()+save().
   */
  mutate?(id: string, apply: (current: Annotation) => Annotation): Promise<Annotation>
  /** Sync-state notifications (v0.9.0, optional). Fires on every state change. */
  onStatus?(callback: (status: StorageStatus) => void): () => void
  readonly isMemoryOnly?: boolean
}
