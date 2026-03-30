import type { SourceDetectionResult } from './types'

/**
 * Level 1: Read data-remarq-source/data-remarq-component attrs
 * injected by @web-remarq/babel-plugin or @web-remarq/unplugin.
 */
export function detectRemarqPlugin(el: HTMLElement): SourceDetectionResult {
  const source = el.getAttribute('data-remarq-source')
  if (!source) return { source: null, component: null }
  return {
    source,
    component: el.getAttribute('data-remarq-component'),
  }
}

/**
 * Level 2a: Read data-source or data-locator attrs
 * from locator.js or similar external tools.
 */
export function detectExternalSource(el: HTMLElement): SourceDetectionResult {
  const source = el.dataset.source ?? el.getAttribute('data-locator')
  if (!source) return { source: null, component: null }
  return { source, component: null }
}

/**
 * Level 2b: Read React fiber _debugSource (dev mode only).
 * Unstable/best-effort — React internals are not public API.
 * Walks up the fiber tree because _debugSource lives on component fibers,
 * not on host (DOM element) fibers.
 */
export function detectReactFiber(el: HTMLElement): SourceDetectionResult {
  const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'))
  if (!key) return { source: null, component: null }

  let current = (el as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null
  // Walk up fiber tree to find nearest fiber with _debugSource (max 15 levels)
  let depth = 0
  while (current && depth < 15) {
    const debugSource = current._debugSource as { fileName?: string; lineNumber?: number; columnNumber?: number } | undefined
    if (debugSource?.fileName) {
      const source = `${debugSource.fileName}:${debugSource.lineNumber ?? 0}:${debugSource.columnNumber ?? 0}`

      // Try to get component name from fiber.type
      const fiberType = current.type as { displayName?: string; name?: string } | string | undefined
      const component = typeof fiberType === 'object' && fiberType
        ? (fiberType.displayName ?? fiberType.name ?? null)
        : null

      return { source, component }
    }
    current = current.return as Record<string, unknown> | null
    depth++
  }

  return { source: null, component: null }
}

/**
 * Runs Level 2 detectors in order. Returns first non-null result.
 */
export function detectSource(el: HTMLElement): SourceDetectionResult {
  const external = detectExternalSource(el)
  if (external.source) return external

  const fiber = detectReactFiber(el)
  if (fiber.source) return fiber

  return { source: null, component: null }
}
