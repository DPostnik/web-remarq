import { relative } from 'node:path'
import type { Detection } from './types'

/** Packages to install for a given stack. Plain HTML needs nothing from npm. */
export function packagesFor(d: Detection): string[] {
  if (d.framework === 'plain-html') return []
  return d.plugin ? ['web-remarq', d.plugin] : ['web-remarq']
}

/**
 * Quote a value for safe interpolation into a POSIX shell command: wrap in single
 * quotes, escaping any embedded single quote as `'\''` (close the quote, an escaped
 * literal quote, reopen the quote). Unlike double-quote wrapping, this is safe
 * against every shell metacharacter a workspace path or package name could contain.
 */
function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`
}

/**
 * Build the dev-dependency install command for the detected package manager.
 * In a workspace the command must target the app package, otherwise the
 * packages land at the root and will not resolve from the app.
 */
export function buildInstallCommand(d: Detection, packages: string[]): string {
  const list = packages.join(' ')
  const rel = relative(d.repoRoot, d.appDir).split('\\').join('/')
  const inWorkspace = rel !== ''
  const quotedRel = shellQuote(rel)
  const quotedDotRel = shellQuote(`./${rel}`)

  switch (d.packageManager) {
    case 'pnpm':
      return inWorkspace ? `pnpm add -D --filter ${quotedDotRel} ${list}` : `pnpm add -D ${list}`
    case 'yarn':
      if (!inWorkspace) return `yarn add -D ${list}`
      return d.appPackageName
        ? `yarn workspace ${shellQuote(d.appPackageName)} add -D ${list}`
        : `yarn --cwd ${quotedDotRel} add -D ${list}`
    case 'bun':
      return inWorkspace ? `bun add -d --cwd ${quotedRel} ${list}` : `bun add -d ${list}`
    case 'npm':
    default:
      return inWorkspace ? `npm install -D -w ${quotedRel} ${list}` : `npm install -D ${list}`
  }
}
