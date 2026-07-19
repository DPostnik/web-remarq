import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * checkBuildPlugin's transform-success test resolves and runs the real
 * @web-remarq/unplugin transform, exactly as a user's app would. That requires
 * packages/unplugin to have been built first (dist/ is gitignored, and the root
 * `test` script is a bare `vitest run` with no build step). Build it here, once,
 * before the cli project's tests run, so that coverage genuinely executes on a
 * plain `npm test` from a clean checkout instead of silently skipping.
 */
export default function setup(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(here, '..', '..')
  const transformArtifact = resolve(here, '..', 'unplugin', 'dist', 'transform.js')

  if (existsSync(transformArtifact)) return

  execSync('npm run build --workspace=packages/unplugin', {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
