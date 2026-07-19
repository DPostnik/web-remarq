#!/usr/bin/env node
// Level-3 verification: scaffold real projects, install web-remarq into them,
// and confirm the build plugin stamps data-remarq-source. Network + minutes.
//
// Why tarballs instead of the registry: this branch depends on
// @web-remarq/unplugin@0.1.0, which adds the `./transform` subpath export used
// by doctor's build-plugin check. That version is not published yet - the
// registry's latest is 0.0.3. A plain registry install would pull 0.0.3, and
// doctor would report every Vite scaffold as "too old to expose ./transform",
// which is a fact about npm, not about this branch's code.
//
// So: build the workspace packages this flow needs, `npm pack` them into a
// temp directory, let `init` run its normal registry install (so the flow
// matches what a real user experiences end to end), then immediately
// reinstall those same package names from the local tarballs - overwriting
// what `init` just fetched with this branch's own build. `npm install
// <tarball path>` resolves the package name from the tarball's own
// package.json and rewrites the app's package.json dependency entry to a
// `file:` spec pointing at the tarball, so doctor resolves our code exactly
// as it would resolve a real install.
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const CLI = join(REPO, 'packages/cli/bin/web-remarq-cli.mjs')

// The three packages this flow touches, per the task-10 brief. Packed from the
// workspace, never installed from the registry.
const TARBALL_WORKSPACES = [
  { workspace: 'packages/core', name: 'web-remarq' },
  { workspace: 'packages/unplugin', name: '@web-remarq/unplugin' },
  { workspace: 'packages/next', name: '@web-remarq/next' },
]

// Config snippets below are copied from what packages/cli/src/snippets.ts
// actually prints today (buildConfigEdit), including the include globs, then
// wrapped into a complete, working config file the way an agent applying the
// edit would - vue-vite and react-vite differ only in the framework plugin
// import and the include glob; next-app's build-plugin check only checks for
// the literal wrapper (see checkBuildPlugin in checks.ts), so an exact
// character match with the printed snippet does not matter there, but is kept
// for fidelity anyway.
const SCAFFOLDS = [
  {
    name: 'vue-vite',
    cmd: 'npm create vite@latest app -- --template vue-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    writeConfig(appDir) {
      writeFileSync(
        join(appDir, 'vite.config.ts'),
        `import { defineConfig } from 'vite'\n` +
          `import vue from '@vitejs/plugin-vue'\n` +
          `import remarq from '@web-remarq/unplugin/vite'\n` +
          `export default defineConfig({ plugins: [vue(), remarq({ include: ['src/**/*.vue'] })] })\n`,
      )
    },
  },
  {
    name: 'react-vite',
    cmd: 'npm create vite@latest app -- --template react-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    writeConfig(appDir) {
      writeFileSync(
        join(appDir, 'vite.config.ts'),
        `import { defineConfig } from 'vite'\n` +
          `import react from '@vitejs/plugin-react'\n` +
          `import remarq from '@web-remarq/unplugin/vite'\n` +
          `export default defineConfig({ plugins: [react(), remarq({ include: ['src/**/*.{jsx,tsx}'] })] })\n`,
      )
    },
  },
  {
    name: 'next-app',
    cmd: 'npx create-next-app@latest app --ts --app --no-eslint --no-tailwind --no-src-dir --no-import-alias --use-npm',
    tarballNames: ['web-remarq', '@web-remarq/next'],
    writeConfig(appDir) {
      const cfg = existsSync(join(appDir, 'next.config.ts'))
        ? join(appDir, 'next.config.ts')
        : join(appDir, 'next.config.mjs')
      writeFileSync(
        cfg,
        `import withRemarq from '@web-remarq/next'\n\n` +
          `export default withRemarq({\n` +
          `  // your existing Next.js config\n` +
          `})\n`,
      )
    },
  },
]

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })
const runCapture = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8' })

/** Quote a value for safe interpolation into a POSIX shell command. */
function shellQuote(value) {
  return `'${value.split("'").join("'\\''")}'`
}

/** First file under app/, src/ or components/ matching one of `exts`, depth-bounded. */
function findSourceFile(appDir, exts) {
  const roots = [join(appDir, 'app'), join(appDir, 'src'), join(appDir, 'components')]
  const walk = (dir, depth) => {
    if (depth > 4 || !existsSync(dir)) return null
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        const nested = walk(path, depth + 1)
        if (nested) return nested
      } else if (exts.some((ext) => entry.name.endsWith(ext))) {
        return path
      }
    }
    return null
  }
  for (const root of roots) {
    const hit = walk(root, 0)
    if (hit) return hit
  }
  return null
}

/**
 * Ask doctor: it runs the user's installed transform over the user's own file.
 * Only the build-plugin check matters here - packages/widget-init/mcp-config/
 * mcp-server are out of scope for this script (see task-10 brief; doctor.ok
 * only means "the stack was detected", not "every check passed").
 *
 * `doctor` exits non-zero whenever ANY check fails (see exitCode() in
 * doctor.ts), which this script's widget-init edit (never applied here, by
 * design) triggers regardless of build-plugin. execSync throws on a non-zero
 * exit even with a captured encoding, but still attaches stdout/stderr to the
 * thrown error - so recover the JSON from there rather than treating a
 * non-zero doctor exit as "could not run doctor".
 */
function checkStamping(appDir) {
  let out
  try {
    out = runCapture(`node ${shellQuote(CLI)} doctor --json`, appDir)
  } catch (err) {
    if (typeof err.stdout !== 'string' || err.stdout.length === 0) throw err
    out = err.stdout
  }
  const report = JSON.parse(out)
  if (!report.ok) throw new Error(`doctor could not detect the stack: ${report.reason}`)
  const plugin = report.checks.find((c) => c.id === 'build-plugin')
  if (plugin.status !== 'ok') {
    throw new Error(`build-plugin check is ${plugin.status}: ${plugin.detail}`)
  }
  return plugin.detail
}

// doctor's build-plugin check for Next only greps next.config.* for the
// literal text "withRemarq" (see checkBuildPlugin in packages/cli/src/
// checks.ts) - it never loads @web-remarq/next or runs the SWC transform, so
// it cannot distinguish a locally packed build from a stale published one.
// Close that gap by running the installed webpack loader directly - the same
// entry point (`@web-remarq/next/loader`) Next's own webpack config calls via
// withRemarq() - against a real file from the scaffold, and asserting on its
// output. This is what actually proves the next-app scaffold exercises this
// branch's code, not just that a comment string is present in a config file.
//
// Run as a subprocess with cwd = appDir (not in-process in this script): the
// underlying @swc/core transform writes a `.swc/` plugin cache relative to
// process.cwd(), and running it in-process here would drop that cache into
// this repo's root instead of the disposable scaffold directory.
const NEXT_LOADER_CHECK_SCRIPT = `
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , appDir, sample] = process.argv
const require = createRequire(join(appDir, 'noop.js'))
const loaderFn = require(require.resolve('@web-remarq/next/loader')).default
const source = readFileSync(sample, 'utf8')

const output = await new Promise((res, rej) => {
  const ctx = {
    resourcePath: sample,
    rootContext: appDir,
    async: () => (err, code) => (err ? rej(err) : res(code)),
  }
  loaderFn.call(ctx, source)
})

if (!output.includes('data-remarq-source')) {
  console.error(\`@web-remarq/next loader on \${sample} produced no data-remarq-source\`)
  process.exit(1)
}
console.log(sample)
`

function checkNextLoaderStamps(appDir, scriptPath) {
  const sample = findSourceFile(appDir, ['.tsx'])
  if (!sample) throw new Error('no .tsx file found under app/ to test the SWC loader against')
  const stamped = runCapture(
    `node ${shellQuote(scriptPath)} ${shellQuote(appDir)} ${shellQuote(sample)}`,
    appDir,
  ).trim()
  return `${stamped} -> data-remarq-source stamped (@web-remarq/next/loader run directly)`
}

console.log('=== Building workspace packages (core, unplugin, next, cli) ===')
run(
  'npm run build --workspace=packages/core --workspace=packages/unplugin --workspace=packages/next --workspace=packages/cli',
  REPO,
)

const packDir = mkdtempSync(join(tmpdir(), 'remarq-e2e-pack-'))
const tarballPaths = {}
console.log('\n=== Packing local tarballs ===')
for (const pkg of TARBALL_WORKSPACES) {
  const out = runCapture(
    `npm pack --workspace=${pkg.workspace} --pack-destination ${shellQuote(packDir)} --json`,
    REPO,
  )
  const [info] = JSON.parse(out)
  const tarballPath = join(packDir, info.filename)
  tarballPaths[pkg.name] = tarballPath
  console.log(`packed ${pkg.name}@${info.version} -> ${tarballPath}`)
}

const nextLoaderCheckScript = join(packDir, 'next-loader-check.mjs')
writeFileSync(nextLoaderCheckScript, NEXT_LOADER_CHECK_SCRIPT)

const failures = []

for (const scaffold of SCAFFOLDS) {
  const dir = mkdtempSync(join(tmpdir(), `remarq-e2e-${scaffold.name}-`))
  try {
    console.log(`\n=== ${scaffold.name} ===`)
    run(scaffold.cmd, dir)
    const appDir = join(dir, 'app')

    run(`node ${shellQuote(CLI)} init`, appDir)

    // Apply the edit the way the agent would. Kept minimal and explicit so a
    // failure here means the snippet is wrong, not that the harness is clever.
    scaffold.writeConfig(appDir)

    // Override init's registry install with our local tarballs - the one step
    // that makes this an e2e run of THIS branch, not the last release.
    const tarballArgs = scaffold.tarballNames.map((n) => shellQuote(tarballPaths[n])).join(' ')
    run(`npm install -D ${tarballArgs}`, appDir)

    const detail = checkStamping(appDir)
    console.log(`  build-plugin: ${detail}`)

    if (scaffold.name === 'next-app') {
      const loaderDetail = checkNextLoaderStamps(appDir, nextLoaderCheckScript)
      console.log(`  loader check: ${loaderDetail}`)
    }

    console.log(`✔ ${scaffold.name}`)
  } catch (err) {
    console.error(`✖ ${scaffold.name}: ${err.message}`)
    failures.push(scaffold.name)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

rmSync(packDir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} scaffold(s) failed: ${failures.join(', ')}`)
  process.exit(1)
}
console.log('\nAll scaffolds stamped data-remarq-source.')
