import type { ElementFingerprint, WebRemarqOptions } from './types'
import { filterClasses, isHashedClass, decomposeCSSModules } from './hash-detect'
import { detectRemarqPlugin, detectSource } from './source-detect'

const TEXT_MAX_LENGTH = 50

export function createFingerprint(
  el: HTMLElement,
  options?: Pick<WebRemarqOptions, 'classFilter' | 'dataAttribute'>,
): ElementFingerprint {
  const dataAttr = options?.dataAttribute ?? 'data-annotate'

  return {
    dataAnnotate: el.getAttribute(dataAttr) ?? null,
    dataTestId: el.getAttribute('data-testid')
      ?? el.getAttribute('data-test')
      ?? el.getAttribute('data-cy')
      ?? null,
    id: getStableId(el),
    tagName: el.tagName.toLowerCase(),
    textContent: getTextContent(el),
    role: el.getAttribute('role') ?? null,
    ariaLabel: el.getAttribute('aria-label') ?? null,
    stableClasses: filterClasses(
      Array.from(el.classList),
      options?.classFilter,
    ),
    domPath: buildDomPath(el),
    siblingIndex: getSiblingIndex(el),
    parentAnchor: findParentAnchor(el, dataAttr),
    rawClasses: Array.from(el.classList),
    cssModules: decomposeCSSModules(Array.from(el.classList)),
    ...resolveSourceFields(el),
  }
}

function resolveSourceFields(el: HTMLElement): {
  sourceLocation: string | null
  componentName: string | null
  detectedSource: string | null
  detectedComponent: string | null
} {
  const plugin = detectRemarqPlugin(el)
  if (plugin.source) {
    return {
      sourceLocation: plugin.source,
      componentName: plugin.component,
      detectedSource: null,
      detectedComponent: null,
    }
  }

  const detected = detectSource(el)
  return {
    sourceLocation: null,
    componentName: null,
    detectedSource: detected.source,
    detectedComponent: detected.component,
  }
}

function getStableId(el: HTMLElement): string | null {
  const id = el.id
  if (!id) return null
  if (isHashedClass(id)) return null
  return id
}

function getTextContent(el: HTMLElement): string | null {
  // Use only direct text nodes, not nested children's text
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
    }
  }
  text = text.trim()

  // If no direct text, try first meaningful child's text (for wrappers like <span><b>Text</b></span>)
  if (!text && el.children.length <= 3) {
    text = el.textContent?.trim() ?? ''
  }

  if (!text) return null
  return text.length > TEXT_MAX_LENGTH ? text.slice(0, TEXT_MAX_LENGTH) : text
}

function buildDomPath(el: HTMLElement): string {
  const parts: string[] = []
  let current: HTMLElement | null = el

  while (current && current !== document.body && parts.length < 5) {
    let segment = current.tagName.toLowerCase()
    const stable = filterClasses(Array.from(current.classList))
    if (stable.length > 0) {
      segment += '.' + stable.slice(0, 2).join('.')
    }
    parts.unshift(segment)
    current = current.parentElement
  }

  return parts.join(' > ')
}

function getSiblingIndex(el: HTMLElement): number {
  const parent = el.parentElement
  if (!parent) return 0
  const children = Array.from(parent.children)
  return children.indexOf(el)
}

function findParentAnchor(el: HTMLElement, dataAttr: string): string | null {
  let current = el.parentElement
  while (current && current !== document.body) {
    const value = current.getAttribute(dataAttr)
    if (value) return value
    current = current.parentElement
  }
  return null
}
