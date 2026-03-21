import type { ElementFingerprint, WebRemarqOptions } from './types'
import { filterClasses, isHashedClass } from './hash-detect'

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
  }
}

function getStableId(el: HTMLElement): string | null {
  const id = el.id
  if (!id) return null
  if (isHashedClass(id)) return null
  return id
}

function getTextContent(el: HTMLElement): string | null {
  const text = el.textContent?.trim() ?? null
  if (!text) return null
  return text.length > TEXT_MAX_LENGTH ? text.slice(0, TEXT_MAX_LENGTH) : text
}

function buildDomPath(el: HTMLElement): string {
  const parts: string[] = []
  let current: HTMLElement | null = el

  while (current && current !== document.body && parts.length < 5) {
    parts.unshift(current.tagName.toLowerCase())
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
