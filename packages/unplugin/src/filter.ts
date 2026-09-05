export const DEFAULT_INCLUDE = ['**/*.jsx', '**/*.tsx', '**/*.vue']
export const DEFAULT_EXCLUDE = ['node_modules/**']

/**
 * Expand `{a,b}` groups into one pattern per alternative:
 * `src/**\/*.{jsx,tsx}` -> `['src/**\/*.jsx', 'src/**\/*.tsx']`.
 * Nested groups are not supported; multiple sibling groups multiply out.
 */
export function expandBraces(glob: string): string[] {
  const match = glob.match(/\{([^{}]*)\}/)
  if (!match || match.index === undefined) return [glob]
  const head = glob.slice(0, match.index)
  const tail = glob.slice(match.index + match[0].length)
  return match[1].split(',').flatMap((alt) => expandBraces(`${head}${alt.trim()}${tail}`))
}

// Simple glob matching without a picomatch dependency. Supports `**`, `*`, `?`
// and (via expandBraces) `{a,b}`. A pattern matches when it matches the whole
// id or a trailing path segment sequence of it, so `src/**\/*.tsx` matches the
// absolute ids a bundler passes (`/home/me/app/src/App.tsx`).
function toRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§GLOBSTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/\/§GLOBSTAR§\//g, '§OPTPATH§')
    .replace(/§GLOBSTAR§/g, '.*')
    .replace(/\?/g, '[^/]')
    .replace(/§OPTPATH§/g, '/(?:.*/)?')
  return new RegExp(`(?:^|/)${escaped}$`)
}

/**
 * Build the include/exclude predicate the plugin applies in `transformInclude`.
 * Exported (via `@web-remarq/unplugin/transform`) so `@web-remarq/cli doctor`
 * can run the installed package's real filter over a real file instead of
 * guessing whether an include option would match.
 */
export function createFilter(
  include: string[] = DEFAULT_INCLUDE,
  exclude: string[] = DEFAULT_EXCLUDE,
): (id: string) => boolean {
  const includePatterns = include.flatMap(expandBraces).map(toRegex)
  const excludePatterns = exclude.flatMap(expandBraces).map(toRegex)

  return (id: string) => {
    const normalized = id.split('\\').join('/')
    if (excludePatterns.some((re) => re.test(normalized))) return false
    return includePatterns.some((re) => re.test(normalized))
  }
}
