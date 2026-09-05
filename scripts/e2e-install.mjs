#!/usr/bin/env node
// Level-3 verification: scaffold real projects, install web-remarq into them the
// way `npx @web-remarq/cli init` tells a user to, and prove the build plugin
// stamps data-remarq-source on a real element - through doctor AND through a
// real Vite dev server. Network + minutes.
//
// Two modes, deliberately kept apart so a local pass is never mistaken for a
// verified release:
//
//   node scripts/e2e-install.mjs             local tarballs: this checkout's code
//   node scripts/e2e-install.mjs --registry  published packages: what `npm install` gives users
//
// Local mode: build the workspace packages, `npm pack` them, let `init` run its
// normal registry install (so the flow matches a real user end to end), then
// reinstall those same package names from the tarballs - overwriting what
// `init` fetched with this checkout's build. `npm install <tarball>` rewrites
// the app's dependency entry to a `file:` spec, so doctor and Vite resolve our
// code exactly as they would resolve a real install.
//
// Registry mode: no packing, no override. Whatever `init` installed from npm is
// what gets verified. Run this after publishing; a failure here means the
// published set is broken for users, whatever the local run said.
import { execSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '..')
const CLI = join(REPO, 'packages/cli/bin/web-remarq-cli.mjs')
const REGISTRY_MODE = process.argv.includes('--registry')
const MODE_LABEL = REGISTRY_MODE ? 'registry (published packages)' : 'local tarballs (this checkout)'

// The packages this flow touches. In local mode they are packed from the
// workspace, never installed from the registry.
const TARBALL_WORKSPACES = [
  { workspace: 'packages/core', name: 'web-remarq' },
  { workspace: 'packages/unplugin', name: '@web-remarq/unplugin' },
  { workspace: 'packages/next', name: '@web-remarq/next' },
]

// Each scaffold applies the build-config edit exactly as `init --json` printed
// it (see applyBuildConfigEdit) - the include option is taken from the printed
// snippet, never retyped here, so a drift between what the CLI prints and what
// the plugin accepts fails this run instead of only failing users.
const SCAFFOLDS = [
  {
    name: 'vue-vite',
    cmd: 'npm create vite@latest app -- --template vue-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    frameworkImport: `import vue from '@vitejs/plugin-vue'`,
    frameworkPlugin: 'vue()',
    devServerFile: 'src/App.vue',
  },
  {
    name: 'react-vite',
    cmd: 'npm create vite@latest app -- --template react-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    frameworkImport: `import react from '@vitejs/plugin-react'`,
    frameworkPlugin: 'react()',
    devServerFile: 'src/App.tsx',
  },
  {
    name: 'next-app',
    cmd: 'npx create-next-app@latest app --ts --app --no-eslint --no-tailwind --no-src-dir --no-import-alias --use-npm',
    tarballNames: ['web-remarq', '@web-remarq/next'],
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

/** Run `init --json` and return the parsed result. Throws when init itself failed. */
function runInitJson(appDir) {
  let out
  try {
    out = runCapture(`node ${shellQuote(CLI)} init --json`, appDir)
  } catch (err) {
    if (typeof err.stdout !== 'string' || err.stdout.length === 0) throw err
    out = err.stdout
  }
  const result = JSON.parse(out)
  if (!result.ok) throw new Error(`init failed: ${result.reason} - ${result.hint}`)
  return result
}

/**
 * Apply the build-config edit the way an agent following SKILL.md would: take
 * the printed snippet as given and place it into a complete config file.
 * For Vite the snippet is a fragment (`plugins: [..., remarq({ include: [...] })]`),
 * so the `remarq(...)` call is lifted out of it verbatim; for Next the snippet
 * is the whole file.
 */
function applyBuildConfigEdit(scaffold, appDir, initResult) {
  const edit = initResult.edits.find((e) => e.kind === 'build-config')
  if (!edit) throw new Error('init printed no build-config edit')

  if (scaffold.name === 'next-app') {
    const cfg = existsSync(join(appDir, 'next.config.ts'))
      ? join(appDir, 'next.config.ts')
      : join(appDir, 'next.config.mjs')
    writeFileSync(cfg, `${edit.snippet}\n`)
    return edit.snippet
  }

  const call = edit.snippet.match(/remarq\(\{[^}]*\}\)/)
  if (!call) throw new Error(`could not find the remarq(...) call in the printed snippet:\n${edit.snippet}`)
  writeFileSync(
    join(appDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite'\n` +
      `${scaffold.frameworkImport}\n` +
      `import remarq from '@web-remarq/unplugin/vite'\n` +
      `export default defineConfig({ plugins: [${scaffold.frameworkPlugin}, ${call[0]}] })\n`,
  )
  return call[0]
}

/**
 * Ask doctor: it runs the user's installed filter and transform over the user's
 * own file. Only the build-plugin check matters here - packages/widget-init/
 * mcp-config/mcp-server are out of scope for this script (doctor.ok only means
 * "the stack was detected", not "every check passed").
 *
 * `doctor` exits non-zero whenever ANY check fails (see exitCode() in
 * doctor.ts), which this script's never-applied widget-init edit triggers
 * regardless of build-plugin. execSync throws on a non-zero exit even with a
 * captured encoding, but still attaches stdout to the thrown error - so recover
 * the JSON from there rather than treating a non-zero exit as "could not run".
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

// ---------------------------------------------------------------------------
// Real Vite dev server smoke.
//
// doctor proves the installed transform stamps a file when called directly.
// The dev server proves the whole chain a user actually runs: Vite loads the
// config, the plugin's include filter admits the file, the transform runs in
// the plugin pipeline, and the module Vite serves to the browser carries the
// stamp - for a specific element at a specific file:line:col, not merely
// "the attribute appears somewhere".
// ---------------------------------------------------------------------------

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

/**
 * The stamp the plugin must emit for the first element in `relFile`: the first
 * line (inside <template> for SFCs) whose first tag is a real element - not a
 * fragment `<>`, not the SFC wrappers. Line is 1-based, column is the 0-based
 * offset of `<` on that line - exactly what transformJSX/transformVueSFC write.
 */
function expectedStamp(appDir, relFile) {
  const lines = readFileSync(join(appDir, relFile), 'utf8').split('\n')
  const isSfc = relFile.endsWith('.vue')
  let inTemplate = !isSfc
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isSfc && /^\s*<template\b/.test(line)) {
      inTemplate = true
      continue
    }
    if (!inTemplate) continue
    const col = line.search(/<[A-Za-z]/)
    if (col === -1) continue
    return `${relFile}:${i + 1}:${col}`
  }
  throw new Error(`no element found in ${relFile} to derive an expected stamp from`)
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`timed out after ${timeoutMs}ms${lastError ? `: ${lastError.message}` : ''}`)
}

async function devServerSmoke(appDir, relFile) {
  const port = await freePort()
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d })
  child.stderr.on('data', (d) => { log += d })
  const exited = new Promise((r) => child.once('exit', r))

  try {
    const base = `http://127.0.0.1:${port}`
    await waitFor(async () => (await fetch(`${base}/`)).ok, 60_000)
    const res = await fetch(`${base}/${relFile}`)
    const served = await res.text()
    const stamp = expectedStamp(appDir, relFile)

    if (!served.includes('data-remarq-source')) {
      throw new Error(`Vite served ${relFile} with no data-remarq-source at all\n--- vite log ---\n${log}`)
    }
    if (!served.includes(stamp)) {
      const found = served.match(/(?:src|app)\/[\w./-]+:\d+:\d+/g) ?? []
      throw new Error(
        `Vite served ${relFile} stamped, but not the expected element ${stamp}; stamps seen: ${[...new Set(found)].slice(0, 6).join(', ') || 'none'}`,
      )
    }
    return stamp
  } finally {
    child.kill('SIGTERM')
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))])
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

// doctor's build-plugin check for Next only greps next.config.* for the
// literal text "withRemarq" (see checkBuildPlugin in packages/cli/src/
// checks.ts) - it never loads @web-remarq/next or runs the SWC transform, so
// it cannot distinguish a locally packed build from a stale published one.
// Close that gap by running the installed webpack loader directly - the same
// entry point (`@web-remarq/next/loader`) Next's own webpack config calls via
// withRemarq() - against a real file from the scaffold, and asserting on its
// output.
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

console.log(`MODE: ${MODE_LABEL}`)
console.log(`node ${process.version}`)

console.log('\n=== Building the CLI ===')
run('npm run build --workspace=packages/cli', REPO)

const packDir = mkdtempSync(join(tmpdir(), 'remarq-e2e-pack-'))
const tarballPaths = {}
if (!REGISTRY_MODE) {
  console.log('\n=== Building workspace packages (core, unplugin, next) ===')
  run('npm run build --workspace=packages/core --workspace=packages/unplugin --workspace=packages/next', REPO)
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
}

const nextLoaderCheckScript = join(packDir, 'next-loader-check.mjs')
writeFileSync(nextLoaderCheckScript, NEXT_LOADER_CHECK_SCRIPT)

/** Versions of the packages actually installed in the scaffold, for the report. */
function installedVersions(appDir, names) {
  return names
    .map((name) => {
      const pkg = join(appDir, 'node_modules', name, 'package.json')
      return existsSync(pkg) ? `${name}@${JSON.parse(readFileSync(pkg, 'utf8')).version}` : `${name}@missing`
    })
    .join(', ')
}

const failures = []

for (const scaffold of SCAFFOLDS) {
  const dir = mkdtempSync(join(tmpdir(), `remarq-e2e-${scaffold.name}-`))
  try {
    console.log(`\n=== ${scaffold.name} ===`)
    run(scaffold.cmd, dir)
    const appDir = join(dir, 'app')

    const initResult = runInitJson(appDir)
    console.log(`  init: installed ${initResult.installed.join(', ')}`)

    // Apply the printed edit the way the agent would - from init's own output.
    const applied = applyBuildConfigEdit(scaffold, appDir, initResult)
    console.log(`  applied: ${applied.split('\n')[0]}${applied.includes('\n') ? ' ...' : ''}`)

    if (!REGISTRY_MODE) {
      // Override init's registry install with our local tarballs - the one step
      // that makes this an e2e run of THIS checkout, not the last release.
      const tarballArgs = scaffold.tarballNames.map((n) => shellQuote(tarballPaths[n])).join(' ')
      run(`npm install -D ${tarballArgs}`, appDir)
    }
    const tooling = installedVersions(appDir, [...scaffold.tarballNames, 'vite', 'next', 'react', 'vue'].filter(
      (n, i, all) => all.indexOf(n) === i && (i < scaffold.tarballNames.length || existsSync(join(appDir, 'node_modules', n))),
    ))
    console.log(`  versions: ${tooling}`)

    const detail = checkStamping(appDir)
    console.log(`  doctor build-plugin: ${detail}`)

    if (scaffold.devServerFile) {
      const stamp = await devServerSmoke(appDir, scaffold.devServerFile)
      console.log(`  vite dev server: served ${scaffold.devServerFile} with data-remarq-source="${stamp}"`)
    }

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
  console.error(`\n${failures.length} scaffold(s) failed [${MODE_LABEL}]: ${failures.join(', ')}`)
  process.exit(1)
}
console.log(`\nAll scaffolds stamped data-remarq-source [${MODE_LABEL}].`)
if (!REGISTRY_MODE) {
  console.log('This verifies this checkout only. After publishing, run again with --registry to verify the published packages.')
}
