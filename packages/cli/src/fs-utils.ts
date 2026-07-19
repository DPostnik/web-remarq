import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'

/** Walk up from `from` until a directory containing .git is found. Falls back to `from`. */
export function findRepoRoot(from: string): string {
  let dir = from
  const { root } = parse(from)
  while (true) {
    if (existsSync(join(dir, '.git'))) return dir
    if (dir === root) return from
    dir = dirname(dir)
  }
}

export function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Return the first name in `names` that exists inside `dir`, or null. */
export function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    if (existsSync(join(dir, name))) return name
  }
  return null
}
