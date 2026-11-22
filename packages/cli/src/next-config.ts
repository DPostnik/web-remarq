import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkWidgetInit, findNextClientInstrumentation, hasLegacyNextAdapter, isBelow, resolveInstalled } from './checks'
import { firstExisting, readJson } from './fs-utils'
import type { AutoEdit } from './init'
import { nextConfigEdit, nextEntryEdit, repoRelative } from './snippets'
import type { Detection, Edit } from './types'
import { codeOnly, stripComments } from './vite-config'

const NEXT_PACKAGE = '@web-remarq/next'
const PAIRING_ROUTE = '/api/web-remarq/config.json'
const CLIENT_FILE = 'instrumentation-client'
const CLIENT_INIT = `// web-remarq dev widget
if (process.env.NODE_ENV === 'development') {
  void import('web-remarq').then(({ WebRemarq, HttpStorageAdapter }) => {
    WebRemarq.init({
      simple: true,
      storage: new HttpStorageAdapter({
        configUrl: (process.env.__NEXT_ROUTER_BASEPATH || '') + '${PAIRING_ROUTE}',
      }),
    })
  })
}
`

const APP_ROUTE = `// web-remarq dev pairing
/** @param {Request} request */
export async function GET(request) {
  const headers = { 'cache-control': 'no-store' }
  if (process.env.NODE_ENV === 'development') {
    const { getLocalPairing } = await import('@web-remarq/next/config')
    const pairing = getLocalPairing(request.headers.get('host'), request.headers.get('sec-fetch-site'))
    if (pairing) return Response.json(pairing, { headers })
  }
  return new Response(null, { status: 404, headers })
}
`

const PAGES_ROUTE = `// web-remarq dev pairing
/**
 * @param {import('next').NextApiRequest} req
 * @param {import('next').NextApiResponse} res
 */
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  if (process.env.NODE_ENV === 'development' && req.method === 'GET') {
    const { getLocalPairing } = await import('@web-remarq/next/config')
    const fetchSite = req.headers['sec-fetch-site']
    if (Array.isArray(fetchSite)) return res.status(404).end()
    const pairing = getLocalPairing(req.headers.host ?? null, fetchSite ?? null)
    if (pairing) return res.json(pairing)
  }
  return res.status(404).end()
}
`

export function wrapNextConfig(source: string, pairThroughRoute: boolean): string | null {
  const code = codeOnly(source)
  if (/['"]@web-remarq\/next['"]/.test(stripComments(source))) {
    if (!pairThroughRoute) return source
    const generatedExport = /^(?:export default|module\.exports =) withRemarq\(webRemarqConfig\)(?=\r?$)/m
    const generated = generatedExport.exec(code)
    if (generated) {
      const close = generated.index + generated[0].length - 1
      return source.slice(0, close) + ", { pairing: 'route' }" + source.slice(close)
    }
    return /\bpairing\s*:\s*['"]route['"]/.test(stripComments(source)) ? source : null
  }
  if (/\b(?:withRemarq|webRemarqConfig)\b/.test(code)) return null

  const esm = /^export\s+default\s+/m.exec(code)
  const cjs = /^module\.exports\s*=\s*/m.exec(code)
  if (Boolean(esm) === Boolean(cjs) || (cjs && (code.match(/\b(?:module\.exports|exports\.)/g) ?? []).length !== 1)) return null
  const declaration = esm ?? cjs!
  const exprAt = declaration.index + declaration[0].length
  const expression = code.slice(exprAt).trim()
  if (!expression || (esm && /^(?:async\s+)?(?:function\s*\*?|class\s+)\s*[\w$]/.test(expression))) return null

  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const wrapper = esm ? `import withRemarq from '${NEXT_PACKAGE}'` : `const { withRemarq } = require('${NEXT_PACKAGE}')`
  const exportPrefix = esm ? 'export default' : 'module.exports ='
  const options = pairThroughRoute ? ", { pairing: 'route' }" : ''
  return source.slice(0, declaration.index)
    + 'const webRemarqConfig = ' + source.slice(exprAt).trimEnd() + eol + eol
    + wrapper + eol + `${exportPrefix} withRemarq(webRemarqConfig${options})` + eol
}

function supportsClientInstrumentation(d: Detection): boolean {
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(join(d.appDir, 'package.json'))
  const version = resolveInstalled(d.appDir, 'next')?.version ?? pkg?.dependencies?.next ?? pkg?.devDependencies?.next
  const parsed = version?.match(/^[~^]?(\d+)\.(\d+)\.(\d+)/)
  return Boolean(parsed && !isBelow(parsed[0].replace(/^[~^]/, ''), '15.3.0'))
}

function nextFiles(d: Detection): { client: string; route: string; source: string } | null {
  const router = firstExisting(d.appDir, ['app', 'src/app', 'pages', 'src/pages'])
  if (!router) return null
  const prefix = router.startsWith('src/') ? 'src/' : ''
  const existingClient = findNextClientInstrumentation(d.appDir)
  const client = existingClient ?? `${prefix}${CLIENT_FILE}.${d.configFile?.endsWith('.ts') ? 'ts' : 'js'}`
  const app = router.endsWith('app')
  return {
    client,
    route: app ? `${router}${PAIRING_ROUTE}/route.js` : `${router}/api/web-remarq/config.json.js`,
    source: app ? APP_ROUTE : PAGES_ROUTE,
  }
}

export function setUpNextConfig(d: Detection): { edited: AutoEdit[]; edits: Edit[] } {
  const edited: AutoEdit[] = []
  const edits: Edit[] = []
  const configFile = d.configFile ?? 'next.config.mjs'
  const configPath = join(d.appDir, configFile)
  const source = d.configFile ? readFileSync(configPath, 'utf8') : 'export default {}\n'

  const files = nextFiles(d)
  const alreadyBootstrapped = files && existsSync(join(d.appDir, files.client))
    && readFileSync(join(d.appDir, files.client), 'utf8').includes(CLIENT_INIT)
  const manualWidget = !alreadyBootstrapped && checkWidgetInit(d).status === 'ok'
  const supportsWidget = supportsClientInstrumentation(d) && !/\bpageExtensions\b/.test(codeOnly(source))
  const staticExport = /\boutput\s*:\s*['"]export['"]/.test(stripComments(source))
  const routeCollision = files && (
    existsSync(join(d.appDir, files.route.replace(/\.js$/, '.ts')))
    || (existsSync(join(d.appDir, files.route)) && readFileSync(join(d.appDir, files.route), 'utf8') !== files.source)
  )
  const legacyAdapter = hasLegacyNextAdapter(d.appDir)
  const canPair = !legacyAdapter && files && !manualWidget && supportsWidget && !staticExport && !routeCollision
  const routeConfig = canPair ? wrapNextConfig(source, true) : null
  const automatically = routeConfig !== null
  const wrapped = routeConfig ?? wrapNextConfig(source, false)
  if (wrapped === null) {
    edits.push(nextConfigEdit(d, 'the exported config could not be wrapped safely'))
  } else if (!d.configFile || wrapped !== source) {
    writeFileSync(configPath, wrapped, 'utf8')
    edited.push({ file: repoRelative(d, configFile), change: 'wrapped the exported Next.js config in withRemarq()' })
  }

  if (files && automatically) {
    const route = join(d.appDir, files.route)
    if (!existsSync(route)) {
      mkdirSync(dirname(route), { recursive: true })
      writeFileSync(route, files.source, { encoding: 'utf8', flag: 'wx' })
      edited.push({ file: repoRelative(d, files.route), change: 'added the development pairing route' })
    }
    if (!alreadyBootstrapped) {
      const client = join(d.appDir, files.client)
      writeFileSync(client, existsSync(client) ? `\n${CLIENT_INIT}` : CLIENT_INIT, { encoding: 'utf8', flag: 'a' })
      edited.push({ file: repoRelative(d, files.client), change: 'registered the widget in Next.js client instrumentation' })
    }
  } else if (!manualWidget) {
    let reason = 'Automatic widget startup requires Next.js 15.3+, standard route extensions and a supported router.'
    if (routeCollision) reason = 'The Next.js pairing route already exists.'
    else if (legacyAdapter) reason = 'The installed @web-remarq/next package lacks automatic pairing.'
    else if (staticExport) reason = 'Automatic widget startup requires a Next.js server output.'
    else if (canPair) reason = 'The Next.js config could not be prepared for automatic pairing.'
    edits.push(nextEntryEdit(d, reason))
  }
  return { edited, edits }
}
