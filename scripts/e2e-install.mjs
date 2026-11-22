#!/usr/bin/env node
// Level-3 verification: scaffold real projects, install web-remarq into them the
// way `npx @web-remarq/cli init` tells a user to, and prove the build plugin
// stamps data-remarq-source on a real element through doctor and real dev
// servers. Next also verifies isolation in a production build. Network + minutes.
//
// Two modes, deliberately kept apart so a local pass is never mistaken for a
// verified release:
//
//   node scripts/e2e-install.mjs             local tarballs: this checkout's code
//   node scripts/e2e-install.mjs --registry  published packages: what `npm install` gives users
//
// `--only <name>` (repeatable or comma-separated) runs a subset of SCAFFOLDS,
// e.g. `--only react-vite`.
//
// Both modes require every installed web-remarq package to carry the version in
// its workspace package.json: right after a release npm can still serve the
// previous version, and a run against it must fail rather than pass.
//
// Local mode: build the workspace packages and install their tarballs before
// init. The installer makes setup decisions from the installed packages, so
// it must read the local builds even when the published releases are older.
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

// All scaffolds use the configuration written by the installer.
const ALL_SCAFFOLDS = [
  {
    name: 'vue-vite',
    cmd: 'npm create vite@latest app -- --template vue-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    devServerFile: 'src/App.vue',
  },
  {
    name: 'react-vite',
    cmd: 'npm create vite@latest app -- --template react-ts',
    tarballNames: ['web-remarq', '@web-remarq/unplugin'],
    devServerFile: 'src/App.tsx',
  },
  {
    name: 'next-app',
    cmd: 'npx --yes create-next-app@16 app --ts --app --no-eslint --no-tailwind --no-src-dir --no-import-alias --use-npm --yes',
    tarballNames: ['web-remarq', '@web-remarq/next'],
  },
]

/** `--only a --only b,c` -> ['a', 'b', 'c']; empty when the flag is absent. */
function onlyArgs(argv) {
  const names = []
  argv.forEach((arg, i) => {
    if (arg === '--only') names.push(argv[i + 1] ?? '')
    else if (arg.startsWith('--only=')) names.push(arg.slice('--only='.length))
  })
  return names.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
}

const ONLY = onlyArgs(process.argv.slice(2))
const unknownOnly = ONLY.filter((n) => !ALL_SCAFFOLDS.some((s) => s.name === n))
if (process.argv.includes('--only') && ONLY.length === 0) {
  console.error(`--only needs a scaffold name: ${ALL_SCAFFOLDS.map((s) => s.name).join(', ')}`)
  process.exit(2)
}
if (unknownOnly.length > 0) {
  console.error(`unknown --only scaffold(s): ${unknownOnly.join(', ')}; known: ${ALL_SCAFFOLDS.map((s) => s.name).join(', ')}`)
  process.exit(2)
}
const SCAFFOLDS = ONLY.length > 0 ? ALL_SCAFFOLDS.filter((s) => ONLY.includes(s.name)) : ALL_SCAFFOLDS

// What every scaffold must end up with installed: the versions in this
// checkout's manifests (the ones a release publishes).
const EXPECTED_VERSIONS = Object.fromEntries(
  TARBALL_WORKSPACES.map((pkg) => [
    pkg.name,
    JSON.parse(readFileSync(join(REPO, pkg.workspace, 'package.json'), 'utf8')).version,
  ]),
)

// Widget injection by the unplugin `widget` option (packages/unplugin/src/
// widget.ts, index.ts transformIndexHtml): on the dev server Vite's index.html
// gets <script type="module" src=WIDGET_SCRIPT_SRC>, and that virtual module
// calls WebRemarq.init. Kept literal: the script must not import plugin source.
const WIDGET_SCRIPT_SRC = '/@id/__x00__virtual:web-remarq/widget'
const WIDGET_INIT_MARKER = 'WebRemarq.init('

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })
const runCapture = (cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8' })

/** Quote a value for safe interpolation into a POSIX shell command. */
function shellQuote(value) {
  return `'${value.split("'").join("'\\''")}'`
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

/** Fail if a clean scaffold needs manual configuration. */
function checkBuildConfigEdit(scaffold, initResult) {
  const edit = initResult.edits.find((e) => e.kind === 'build-config' || e.kind === 'entry')
  if (edit) throw new Error(`init requires a manual edit: ${edit.note ?? edit.file}`)
  const configPattern = scaffold.name === 'next-app' ? /next\.config\./ : /vite\.config\./
  const auto = initResult.edited.find((e) => configPattern.test(e.file))
  if (!auto) throw new Error('init reported no build config edit')
  return `${auto.file} - ${auto.change}`
}

/**
 * Ask doctor: it runs the user's installed filter and transform over the user's
 * own file. Only the build-plugin check matters here - packages/widget-init/
 * mcp-config/mcp-server are not checked through doctor.
 *
 * An unavailable MCP server can still make doctor exit non-zero. Read its
 * JSON output in either case to inspect the build-plugin result.
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

async function withServer(appDir, binary, args, check) {
  const port = await freePort()
  const child = spawn(process.execPath, [join(appDir, 'node_modules/.bin', binary), ...args(port)], {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  let startupError
  child.stdout.on('data', (data) => { log += data })
  child.stderr.on('data', (data) => { log += data })
  child.once('error', (err) => { startupError = err })
  const exited = new Promise((resolveExit) => child.once('close', resolveExit))
  const base = `http://127.0.0.1:${port}`

  try {
    await waitFor(async () => {
      if (startupError || child.exitCode !== null) return true
      return (await fetch(`${base}/`, { signal: AbortSignal.timeout(5_000) })).ok
    }, 60_000)
    if (startupError) throw startupError
    if (child.exitCode !== null) throw new Error(`${binary} exited with code ${child.exitCode}`)
    return await check(base)
  } catch (err) {
    throw new Error(`${err.message}\n--- ${binary} log ---\n${log}`)
  } finally {
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    await exited
    clearTimeout(killTimer)
  }
}

async function devServerSmoke(appDir, relFile) {
  return withServer(appDir, 'vite', (port) => ['--port', String(port), '--strictPort', '--host', '127.0.0.1'], async (base) => {
    const widget = await checkWidgetInjected(base)
    const res = await fetch(`${base}/${relFile}`)
    const served = await res.text()
    const stamp = expectedStamp(appDir, relFile)

    if (!served.includes('data-remarq-source')) {
      throw new Error(`Vite served ${relFile} with no data-remarq-source at all`)
    }
    if (!served.includes(stamp)) {
      const found = served.match(/(?:src|app)\/[\w./-]+:\d+:\d+/g) ?? []
      throw new Error(
        `Vite served ${relFile} stamped, but not the expected element ${stamp}; stamps seen: ${[...new Set(found)].slice(0, 6).join(', ') || 'none'}`,
      )
    }
    return { stamp, widget }
  })
}

/**
 * The page Vite serves must carry the widget script tag, and that URL must
 * serve the generated module that starts the widget.
 */
async function checkWidgetInjected(base) {
  const html = await (await fetch(`${base}/`)).text()
  if (!html.includes(`src="${WIDGET_SCRIPT_SRC}"`)) {
    throw new Error(`Vite served / without the widget script ${WIDGET_SCRIPT_SRC}`)
  }
  const res = await fetch(`${base}${WIDGET_SCRIPT_SRC}`)
  const body = await res.text()
  if (res.status !== 200 || !body.includes(WIDGET_INIT_MARKER)) {
    throw new Error(`widget module ${WIDGET_SCRIPT_SRC} answered ${res.status}${res.status === 200 ? ` without ${WIDGET_INIT_MARKER}` : ''}`)
  }
  return `index.html has <script src="${WIDGET_SCRIPT_SRC}">, module 200 with ${WIDGET_INIT_MARKER}`
}

const NEXT_CONFIG_ROUTE = '/api/web-remarq/config.json'
const NEXT_PAGE = 'app/page.tsx'

// Keep the scaffold's config and build scripts. The fixture replaces the demo
// content so next build does not depend on fetching the scaffold's web fonts.
function setNextFixture(appDir) {
  writeFileSync(join(appDir, NEXT_PAGE), `export default function Page() {
  return <button data-test="remarq-target">Remarq target</button>
}
`)
  writeFileSync(join(appDir, 'app/layout.tsx'), `import type { ReactNode } from 'react'
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>
}
`)
}

async function nextPageAssets(base, html) {
  const scriptPaths = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1])
  if (scriptPaths.length === 0) throw new Error('Next rendered no client scripts')
  return Promise.all(scriptPaths.map(async (path) => {
    const res = await fetch(new URL(path, base))
    if (!res.ok) throw new Error(`Next client script ${path} answered ${res.status}`)
    return res.text()
  }))
}

async function nextSmoke(appDir) {
  const config = JSON.parse(readFileSync(join(appDir, '.remarq/config.json'), 'utf8'))
  if (!config.token || !config.projectId) throw new Error('init did not create local pairing credentials')
  const stamp = expectedStamp(appDir, NEXT_PAGE)
  const args = (mode) => (port) => [mode, '--hostname', '127.0.0.1', '--port', String(port)]

  await withServer(appDir, 'next', args('dev'), async (base) => {
    const html = await (await fetch(base)).text()
    if (!html.includes(`data-remarq-source="${stamp}"`)) {
      throw new Error(`Next dev rendered / without the expected source stamp ${stamp}`)
    }
    const scripts = await nextPageAssets(base, html)
    if (!scripts.some((script) => script.includes(NEXT_CONFIG_ROUTE))) {
      throw new Error('Next dev client scripts do not start the widget pairing flow')
    }
    if ([html, ...scripts].some((body) => body.includes(config.token))) {
      throw new Error('Next dev inlined the pairing credential into the page or client scripts')
    }
    const pairingUrl = `${base}${NEXT_CONFIG_ROUTE}`
    const res = await fetch(pairingUrl, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
    if (!res.ok || !res.headers.get('cache-control')?.includes('no-store')) {
      throw new Error(`Next dev pairing route answered ${res.status} without a successful uncached response`)
    }
    const pairing = await res.json()
    if (pairing.token !== config.token || pairing.projectId !== config.projectId) {
      throw new Error('Next dev pairing response does not match the installer credentials')
    }
    const crossSite = await fetch(pairingUrl, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
    if (crossSite.status !== 404 || (await crossSite.text()).includes(config.token)) {
      throw new Error('Next dev pairing route did not deny a cross-site request')
    }
  })
  console.log(`  next dev: rendered ${stamp}, bundled widget startup and served the local pairing config`)

  run('npm run build', appDir)
  const staticDir = join(appDir, '.next/static')
  const clientFiles = readdirSync(staticDir, { recursive: true }).filter((file) => file.endsWith('.js'))
  const scripts = clientFiles.map((file) => readFileSync(join(staticDir, file), 'utf8'))
  await withServer(appDir, 'next', args('start'), async (base) => {
    const html = await (await fetch(base)).text()
    if ([html, ...scripts].some((body) => body.includes('data-remarq-source') ||
      body.includes(NEXT_CONFIG_ROUTE) || body.includes(config.token))) {
      throw new Error('Next production served source stamps, widget startup or pairing credentials')
    }
    const res = await fetch(`${base}${NEXT_CONFIG_ROUTE}`)
    if (res.status !== 404 || (await res.text()).includes(config.token)) {
      throw new Error(`Next production pairing route answered ${res.status} or served credentials`)
    }
  })
  console.log('  next production: source stamps, widget startup and pairing credentials absent, pairing route 404')
}

console.log(`MODE: ${MODE_LABEL}`)
console.log(`scaffolds: ${SCAFFOLDS.map((s) => s.name).join(', ')}`)
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

/** Versions of the packages actually installed in the scaffold, for the report. */
function installedVersions(appDir, names) {
  return names
    .map((name) => {
      const pkg = join(appDir, 'node_modules', name, 'package.json')
      return existsSync(pkg) ? `${name}@${JSON.parse(readFileSync(pkg, 'utf8')).version}` : `${name}@missing`
    })
    .join(', ')
}

/**
 * Installed vs expected version for each name; mismatches only. Reads
 * node_modules directly: that is what the app resolves, whatever npm reported.
 */
function versionMismatches(appDir, names, expected) {
  return names
    .map((name) => {
      const pkg = join(appDir, 'node_modules', name, 'package.json')
      const installed = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : 'missing'
      return { name, expected: expected[name], installed }
    })
    .filter((v) => v.installed !== v.expected)
}

/** dist-tags.latest straight from the registry; `npm view` answers from its cache. */
async function registryLatest(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (!res.ok) return `unknown (registry answered ${res.status})`
    return (await res.json())['dist-tags']?.latest ?? 'unknown (no latest tag)'
  } catch (err) {
    return `unknown (${err.message})`
  }
}

async function checkVersions(appDir, names) {
  const mismatches = versionMismatches(appDir, names, EXPECTED_VERSIONS)
  if (mismatches.length === 0) return
  const lines = []
  for (const m of mismatches) {
    const latest = REGISTRY_MODE ? `; registry dist-tags.latest is ${await registryLatest(m.name)}` : ''
    lines.push(`${m.name}: expected ${m.expected}, installed ${m.installed}${latest}`)
  }
  const hint = REGISTRY_MODE
    ? '\n  If latest already shows the expected version, npm is still propagating the release: rerun in a few minutes.'
    : ''
  throw new Error(`installed versions differ from the workspace:\n  ${lines.join('\n  ')}${hint}`)
}

const failures = []

for (const scaffold of SCAFFOLDS) {
  const dir = mkdtempSync(join(tmpdir(), `remarq-e2e-${scaffold.name}-`))
  try {
    console.log(`\n=== ${scaffold.name} ===`)
    run(scaffold.cmd, dir)
    const appDir = join(dir, 'app')

    if (scaffold.name === 'next-app') setNextFixture(appDir)

    if (!REGISTRY_MODE) {
      const tarballArgs = scaffold.tarballNames.map((n) => shellQuote(tarballPaths[n])).join(' ')
      run(`npm install -D ${tarballArgs}`, appDir)
    }

    const initResult = runInitJson(appDir)
    console.log(`  init: installed ${initResult.installed.join(', ')}`)
    console.log(`  applied: ${checkBuildConfigEdit(scaffold, initResult)}`)

    const tooling = installedVersions(appDir, [...scaffold.tarballNames, 'vite', 'next', 'react', 'vue'].filter(
      (n, i, all) => all.indexOf(n) === i && (i < scaffold.tarballNames.length || existsSync(join(appDir, 'node_modules', n))),
    ))
    console.log(`  versions: ${tooling}`)
    await checkVersions(appDir, scaffold.tarballNames)
    console.log(`  versions match the workspace: ${scaffold.tarballNames.map((n) => `${n}@${EXPECTED_VERSIONS[n]}`).join(', ')}`)

    const detail = checkStamping(appDir)
    console.log(`  doctor build-plugin: ${detail}`)

    if (scaffold.devServerFile) {
      const { stamp, widget } = await devServerSmoke(appDir, scaffold.devServerFile)
      console.log(`  vite dev server: served ${scaffold.devServerFile} with data-remarq-source="${stamp}"`)
      console.log(`  widget: ${widget}`)
    } else {
      await nextSmoke(appDir)
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
console.log(`\nAll scaffolds (${SCAFFOLDS.map((s) => s.name).join(', ')}) passed versions, stamping and widget checks [${MODE_LABEL}].`)
if (!REGISTRY_MODE) {
  console.log('This verifies this checkout only. After publishing, run again with --registry to verify the published packages.')
}
