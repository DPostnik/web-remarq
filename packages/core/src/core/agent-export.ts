import type {
  Annotation,
  AgentExport,
  AgentAnnotation,
  AgentAnnotationSource,
  AgentSearchHints,
  GrepQuery,
  ElementFingerprint,
} from './types'

function parseSourceLocation(raw: string): { file: string; line: number; column: number } | null {
  const parts = raw.split(':')
  if (parts.length < 2) return null
  // file path may contain ":" on Windows (C:\...), so rejoin all but last 2
  const column = parseInt(parts.pop()!, 10)
  const line = parseInt(parts.pop()!, 10)
  const file = parts.join(':')
  if (!file || isNaN(line)) return null
  return { file, line, column: isNaN(column) ? 0 : column }
}

function resolveSource(fp: ElementFingerprint): AgentAnnotationSource | null {
  // Level 1: plugin source
  if (fp.sourceLocation) {
    const parsed = parseSourceLocation(fp.sourceLocation)
    if (parsed) return { ...parsed, component: fp.componentName ?? null }
  }

  // Level 2: detected source
  if (fp.detectedSource) {
    const parsed = parseSourceLocation(fp.detectedSource)
    if (parsed) return { ...parsed, component: fp.detectedComponent ?? null }
  }

  return null
}

const TEMPLATE_GLOB = '*.{tsx,jsx,vue,svelte,html}'
const CSS_MODULE_GLOB = '*.module.{css,scss,less}'
const COMPONENT_GLOB = '*.{tsx,jsx,vue,ts,js}'

function buildSearchHints(fp: ElementFingerprint): AgentSearchHints {
  const grepQueries: GrepQuery[] = []

  // High confidence — unique selectors
  if (fp.dataAnnotate) {
    grepQueries.push({ query: `data-annotate="${fp.dataAnnotate}"`, glob: TEMPLATE_GLOB, confidence: 'high' })
  }
  if (fp.dataTestId) {
    grepQueries.push({ query: `data-testid="${fp.dataTestId}"`, glob: TEMPLATE_GLOB, confidence: 'high' })
  }
  if (fp.id) {
    grepQueries.push({ query: `id="${fp.id}"`, glob: TEMPLATE_GLOB, confidence: 'high' })
  }
  if (fp.ariaLabel) {
    grepQueries.push({ query: `aria-label="${fp.ariaLabel}"`, glob: TEMPLATE_GLOB, confidence: 'high' })
  }

  // Medium confidence — text, CSS modules, role
  if (fp.textContent) {
    grepQueries.push({ query: `"${fp.textContent}"`, glob: TEMPLATE_GLOB, confidence: 'medium' })
  }
  if (fp.role) {
    grepQueries.push({ query: `role="${fp.role}"`, glob: TEMPLATE_GLOB, confidence: 'medium' })
  }
  if (fp.cssModules?.length) {
    for (const mod of fp.cssModules) {
      grepQueries.push({ query: `.${mod.localName}`, glob: CSS_MODULE_GLOB, confidence: 'medium' })
      grepQueries.push({ query: `styles.${mod.localName}`, glob: COMPONENT_GLOB, confidence: 'medium' })
    }
  }

  // Low confidence — classes, domPath
  if (fp.stableClasses.length) {
    for (const cls of fp.stableClasses.slice(0, 3)) {
      grepQueries.push({ query: `"${cls}"`, glob: TEMPLATE_GLOB, confidence: 'low' })
    }
  }

  return {
    grepQueries,
    domContext: fp.domPath,
    tagName: fp.tagName,
    classes: fp.rawClasses ?? fp.stableClasses,
  }
}

export function generateAgentExport(annotations: Annotation[], viewportBucket: number): AgentExport {
  const agentAnnotations: AgentAnnotation[] = annotations.map(ann => ({
    id: ann.id,
    route: ann.route,
    comment: ann.comment,
    status: ann.status,
    timestamp: ann.timestamp,
    source: resolveSource(ann.fingerprint),
    searchHints: buildSearchHints(ann.fingerprint),
  }))

  return {
    version: 1,
    format: 'agent',
    viewportBucket,
    annotations: agentAnnotations,
  }
}
