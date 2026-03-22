import type { CSSModuleClass } from './types'

const CSS_MODULES_RE = /^(.+)__([a-zA-Z0-9]{3,})$/
const CSS_MODULES_3SEG_RE = /^([^_]+(?:[_-][^_]+)*)__([a-zA-Z][a-zA-Z0-9]*)__([a-zA-Z0-9]{3,})$/
const STYLED_COMPONENTS_RE = /^sc-/
const EMOTION_RE = /^css-[a-zA-Z0-9]+$/
const PURE_HASH_RE = /^(?=.*[a-zA-Z])(?=.*\d)[a-zA-Z0-9]{8,}$/

export function isHashedClass(className: string): boolean {
  if (STYLED_COMPONENTS_RE.test(className)) return true
  if (EMOTION_RE.test(className)) return true
  if (CSS_MODULES_RE.test(className)) return true
  if (PURE_HASH_RE.test(className)) return true
  return false
}

export function stripHash(className: string): string {
  const match = className.match(CSS_MODULES_RE)
  if (match) {
    const prefix = className.slice(0, className.lastIndexOf('__'))
    return prefix
  }
  return className
}

export function filterClasses(
  classes: string[],
  classFilter?: (className: string) => boolean,
): string[] {
  const result: string[] = []

  for (const cls of classes) {
    if (STYLED_COMPONENTS_RE.test(cls)) continue
    if (EMOTION_RE.test(cls)) continue
    if (PURE_HASH_RE.test(cls)) continue

    let stable = stripHash(cls)

    if (classFilter && !classFilter(stable)) continue

    result.push(stable)
  }

  return result
}

export function decomposeCSSModules(classes: string[]): CSSModuleClass[] {
  const result: CSSModuleClass[] = []
  for (const cls of classes) {
    const match = cls.match(CSS_MODULES_3SEG_RE)
    if (match) {
      result.push({
        raw: cls,
        moduleHint: match[1],
        localName: match[2],
      })
    }
  }
  return result
}
