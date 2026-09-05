import * as http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isSafeAnnotationId, validateAnnotation } from 'web-remarq/core'
import type { FileStorageAdapter } from './file-storage-adapter.js'
import type { LocalProjectConfig } from './local-config.js'

/**
 * Widget-facing HTTP endpoint, local mode. Protocol 2 (mcp 0.5.0).
 *
 * Threat model: the endpoint listens on 127.0.0.1 only, but any page open in
 * the same browser can still issue requests to it, and DNS rebinding can make
 * a remote page's requests arrive with a foreign Host. This layer therefore
 * checks, in order, for every request:
 *
 *  1. Host   - must name this loopback listener (127.0.0.1 / localhost / [::1],
 *              optionally with this port). Anything else is 403.
 *  2. Origin - when present, must exactly match one of `allowedOrigins`
 *              (scheme + host, port exact or `*`). `null` and foreign origins
 *              are 403 with no CORS headers, preflight included. Absent Origin
 *              (curl, CLI doctor) is allowed through to the token check.
 *  3. Token  - every route except GET /health needs `Authorization: Bearer
 *              <token>` from `.remarq/config.json`. Reads included: the store
 *              is data, not a health signal. /health itself carries no data
 *              and answers any origin, so a refused page can explain itself.
 *
 * Bodies are validated structurally (`validateAnnotation`) before anything is
 * persisted: an invalid record never reaches the store or the task folder.
 * Writes are revision-checked (`If-Match`) so a stale copy cannot overwrite a
 * newer status or history - see FileStorageAdapter.saveIfMatch.
 *
 * Out of scope, on purpose: a local process with filesystem access (it can
 * read the config file), remote/staging origins (not allowed by default).
 */

export const PROTOCOL_VERSION = 2
const MAX_BODY_BYTES = 512 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

interface ErrorBody {
  error: string
  code: string
  details?: unknown
}

function send(res: ServerResponse, status: number, body: unknown, cors: Record<string, string>): void {
  res.writeHead(status, { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function fail(res: ServerResponse, status: number, code: string, error: string, cors: Record<string, string>, details?: unknown): void {
  const body: ErrorBody = { error, code }
  if (details !== undefined) body.details = details
  send(res, status, body, cors)
}

/** Exact origin match against the allowlist. `http://host:*` matches any port on that exact host. */
export function originAllowed(origin: string, allowed: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
    return false
  }
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
  const originPort = parsed.port || defaultPort
  return allowed.some((pattern) => {
    const m = pattern.match(/^(https?):\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}|\*))?$/)
    if (!m) return false
    const [, scheme, host, port] = m
    if (parsed.protocol !== `${scheme}:`) return false
    if (parsed.hostname.toLowerCase() !== host.toLowerCase()) return false
    if (port === '*') return true
    return originPort === (port ?? (scheme === 'https' ? '443' : '80'))
  })
}

/** The Host header must name this loopback listener; a foreign name means DNS rebinding. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false
  let parsed: URL
  try {
    parsed = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return false
  return parsed.port === '' || parsed.port === String(port)
}

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header) return false
  const m = header.match(/^Bearer\s+(\S+)$/i)
  if (!m) return false
  const given = Buffer.from(m[1])
  const expected = Buffer.from(token)
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      req.resume()
      reject(new BodyTooLarge())
      return
    }
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.removeAllListeners('data')
        req.resume()
        reject(new BodyTooLarge())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Parses `If-Match` as a plain revision number. `undefined` = header absent, `null` = malformed. */
function parseIfMatch(header: string | string[] | undefined): number | null | undefined {
  if (header === undefined) return undefined
  const value = Array.isArray(header) ? header[0] : header
  const m = value.trim().match(/^"?(\d{1,12})"?$/)
  return m ? Number(m[1]) : null
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  storage: FileStorageAdapter,
  port: number,
  config: LocalProjectConfig,
): Promise<void> {
  const noCors: Record<string, string> = {}

  if (!hostAllowed(req.headers.host, port)) {
    fail(res, 403, 'bad_host', 'request Host does not name this loopback server', noCors)
    return
  }

  let pathname: string
  try {
    pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  } catch {
    fail(res, 400, 'bad_url', 'malformed request URL', noCors)
    return
  }

  // Liveness only - no data, no token. Answered for ANY origin so that a page
  // whose origin is refused can tell "server up, origin not allowed" apart from
  // "server down" (a CORS refusal and a dead socket look identical to fetch()).
  if (pathname === '/health' && (req.method === 'GET' || req.method === 'OPTIONS')) {
    const openCors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, openCors)
      res.end()
      return
    }
    send(res, 200, { ok: true, protocol: PROTOCOL_VERSION }, openCors)
    return
  }

  const origin = req.headers.origin
  let cors = noCors
  if (origin !== undefined) {
    if (origin === 'null' || !originAllowed(origin, config.allowedOrigins)) {
      fail(res, 403, 'forbidden_origin', 'origin is not allowed to use this server; add it to allowedOrigins in .remarq/config.json if it is yours', noCors)
      return
    }
    cors = {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, content-type, if-match',
      'Access-Control-Max-Age': '600',
    }
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }

  if (!tokenMatches(req.headers.authorization, config.token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="web-remarq"')
    fail(res, 401, 'unauthorized', 'missing or wrong token; the widget and CLI read it from .remarq/config.json', cors)
    return
  }

  const annMatch = pathname.match(/^\/annotations\/([^/]+)$/)
  let id: string | null = null
  if (annMatch) {
    try {
      id = decodeURIComponent(annMatch[1])
    } catch {
      fail(res, 400, 'invalid_id', 'annotation id is not valid URL encoding', cors)
      return
    }
    if (!isSafeAnnotationId(id)) {
      fail(res, 400, 'invalid_id', 'invalid annotation id', cors)
      return
    }
  }

  try {
    if (req.method === 'GET' && pathname === '/store') {
      // Capture rev before the await, not after: a concurrent mutation between
      // load() and reading storage.rev would pair a newer rev with the older
      // content this response body carries. Under-reporting is safe (the
      // client's next poll re-diffs); over-reporting is not.
      const rev = storage.rev
      const store = (await storage.load()) ?? { version: 1 as const, annotations: [] }
      send(res, 200, { rev, protocol: PROTOCOL_VERSION, projectId: config.projectId, store }, cors)
      return
    }

    if (req.method === 'PUT' && id !== null) {
      const contentType = String(req.headers['content-type'] ?? '')
      if (!/^application\/json\b/i.test(contentType)) {
        fail(res, 415, 'unsupported_media_type', 'content-type must be application/json', cors)
        return
      }
      const expectedRev = parseIfMatch(req.headers['if-match'])
      if (expectedRev === null) {
        fail(res, 400, 'invalid_if_match', 'If-Match must be a revision number', cors)
        return
      }
      let raw: unknown
      try {
        raw = JSON.parse(await readBody(req))
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          fail(res, 413, 'payload_too_large', `body exceeds ${MAX_BODY_BYTES} bytes`, cors)
        } else {
          fail(res, 400, 'invalid_json', 'invalid JSON body', cors)
        }
        return
      }
      const validated = validateAnnotation(raw)
      if (!validated.ok) {
        fail(res, 400, 'invalid_annotation', 'annotation failed validation', cors, validated.errors)
        return
      }
      if (validated.annotation.id !== id) {
        fail(res, 400, 'id_mismatch', 'annotation.id must match the URL id', cors)
        return
      }
      const result = await storage.saveIfMatch(validated.annotation, expectedRev ?? null)
      if (!result.ok) {
        const status = result.reason === 'conflict' ? 409 : 428
        fail(res, status, result.reason, result.reason === 'conflict' ? 'annotation changed since you last read it' : 'If-Match is required to update an existing annotation', cors, { current: result.current, rev: result.rev })
        return
      }
      send(res, 200, { rev: result.rev, annotation: result.annotation }, cors)
      return
    }

    if (req.method === 'DELETE' && id !== null) {
      const expectedRev = parseIfMatch(req.headers['if-match'])
      if (expectedRev === null) {
        fail(res, 400, 'invalid_if_match', 'If-Match must be a revision number', cors)
        return
      }
      const result = await storage.removeIfMatch(id, expectedRev ?? null)
      if (!result.ok) {
        fail(res, 409, 'conflict', 'annotation changed since you last read it', cors, { current: result.current, rev: result.rev })
        return
      }
      send(res, 200, { rev: result.rev }, cors)
      return
    }

    if (req.method === 'DELETE' && pathname === '/annotations') {
      await storage.clear()
      send(res, 200, { rev: storage.rev }, cors)
      return
    }

    fail(res, 404, 'not_found', 'not found', cors)
  } catch (err) {
    fail(res, 500, 'internal', err instanceof Error ? err.message : String(err), cors)
  }
}

/** Starts the widget-facing endpoint on 127.0.0.1:port. Rejects on bind errors. */
export function startHttpServer(storage: FileStorageAdapter, port: number, config: LocalProjectConfig): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const boundPort = (server.address() as { port: number } | null)?.port ?? port
    void handle(req, res, storage, boundPort, config)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
