import type { ElementFingerprint, WebRemarqOptions } from './types'
import { filterClasses } from './hash-detect'

const MATCH_THRESHOLD = 50

export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a.length || !b.length) return 0

  const matrix: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      )
    }
  }

  const distance = matrix[a.length][b.length]
  return 1 - distance / Math.max(a.length, b.length)
}

function textSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0
  const na = a.trim().toLowerCase()
  const nb = b.trim().toLowerCase()
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 1
  return levenshteinSimilarity(na, nb)
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = new Set([...a, ...b]).size
  return union === 0 ? 0 : intersection / union
}

function scoreCandidate(el: HTMLElement, fp: ElementFingerprint, dataAttr: string): number {
  let score = 0

  // dataAnnotate match (+100)
  const elAnnotate = el.getAttribute(dataAttr)
  if (fp.dataAnnotate && elAnnotate === fp.dataAnnotate) {
    score += 100
  }

  // textContent match (+35 scaled)
  const elText = el.textContent?.trim().slice(0, 50) ?? null
  const textSim = textSimilarity(fp.textContent, elText)
  if (textSim > 0.7) {
    score += textSim * 35
  }

  // role + ariaLabel match (+30)
  if (fp.role && el.getAttribute('role') === fp.role &&
    fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) {
    score += 30
  }

  // parentAnchor match (+15)
  if (fp.parentAnchor) {
    let parent = el.parentElement
    while (parent && parent !== document.body) {
      if (parent.getAttribute(dataAttr) === fp.parentAnchor) {
        score += 15
        break
      }
      parent = parent.parentElement
    }
  }

  // stableClasses overlap (+30 scaled)
  if (fp.stableClasses.length > 0) {
    const elClasses = filterClasses(Array.from(el.classList))
    const jaccard = jaccardSimilarity(fp.stableClasses, elClasses)
    score += jaccard * 30
  }

  // domPath match (+20 scaled)
  if (fp.domPath) {
    const elPath = buildDomPath(el)
    const pathSim = levenshteinSimilarity(fp.domPath, elPath)
    score += pathSim * 20
  }

  // siblingIndex match (+5)
  const parent = el.parentElement
  if (parent) {
    const idx = Array.from(parent.children).indexOf(el)
    if (idx === fp.siblingIndex) {
      score += 5
    }
  }

  return score
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

export function matchElement(
  fp: ElementFingerprint,
  options?: Pick<WebRemarqOptions, 'dataAttribute'>,
): HTMLElement | null {
  const dataAttr = options?.dataAttribute ?? 'data-annotate'

  // 1. Exact match by data-annotate
  if (fp.dataAnnotate) {
    const el = document.querySelector<HTMLElement>(`[${dataAttr}="${fp.dataAnnotate}"]`)
    if (el) return el
  }

  // 2. Exact match by data-testid
  if (fp.dataTestId) {
    const el = document.querySelector<HTMLElement>(
      `[data-testid="${fp.dataTestId}"], [data-test="${fp.dataTestId}"], [data-cy="${fp.dataTestId}"]`,
    )
    if (el) return el
  }

  // 3. Exact match by id
  if (fp.id) {
    const el = document.getElementById(fp.id) as HTMLElement | null
    if (el) return el
  }

  // 4. Fuzzy match by tagName + weighted scoring
  const candidates = document.querySelectorAll<HTMLElement>(fp.tagName)
  let bestEl: HTMLElement | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, fp, dataAttr)
    if (score > bestScore) {
      bestScore = score
      bestEl = candidate
    }
  }

  return bestScore >= MATCH_THRESHOLD ? bestEl : null
}
