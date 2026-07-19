import { relative } from 'node:path'
import type { Detection } from './types'

/** Packages to install for a given stack. Plain HTML needs nothing from npm. */
export function packagesFor(d: Detection): string[] {
  if (d.framework === 'plain-html') return []
  return d.plugin ? ['web-remarq', d.plugin] : ['web-remarq']
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

  switch (d.packageManager) {
    case 'pnpm':
      return inWorkspace ? `pnpm add -D --filter "./${rel}" ${list}` : `pnpm add -D ${list}`
    case 'yarn':
      if (!inWorkspace) return `yarn add -D ${list}`
      return d.appPackageName
        ? `yarn workspace ${d.appPackageName} add -D ${list}`
        : `yarn --cwd "./${rel}" add -D ${list}`
    case 'bun':
      return inWorkspace ? `bun add -d --cwd "${rel}" ${list}` : `bun add -d ${list}`
    case 'npm':
    default:
      return inWorkspace ? `npm install -D -w "${rel}" ${list}` : `npm install -D ${list}`
  }
}
