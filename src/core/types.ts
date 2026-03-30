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

export interface Annotation {
  id: string
  comment: string
  fingerprint: ElementFingerprint
  route: string
  viewport: string  // e.g. "1920x1080"
  viewportBucket: number  // e.g. 300 (width rounded down to 100px)
  timestamp: number
  status: 'pending' | 'resolved'
}

export interface AnnotationStore {
  version: 1
  annotations: Annotation[]
}

export interface WebRemarqOptions {
  theme?: 'light' | 'dark'
  classFilter?: (className: string) => boolean
  dataAttribute?: string
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

export interface AgentAnnotation {
  id: string
  route: string
  comment: string
  status: 'pending' | 'resolved'
  timestamp: number
  source: AgentAnnotationSource | null
  searchHints: AgentSearchHints
}

export interface AgentExport {
  version: 1
  format: 'agent'
  viewportBucket: number
  annotations: AgentAnnotation[]
}
