import * as http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { FileStorageAdapter } from './file-storage-adapter.js'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

const MAX_BODY_BYTES = 1024 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...CORS_HEADERS, 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handle(req: IncomingMessage, res: ServerResponse, storage: FileStorageAdapter): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  const annMatch = pathname.match(/^\/annotations\/([^/]+)$/)

  try {
    if (req.method === 'GET' && pathname === '/store') {
      // Capture rev before the await, not after: a concurrent mutation between
      // load() and reading storage.rev would pair a newer rev with the older
      // content this response body carries. Under-reporting is safe (the
      // client's next poll re-diffs); over-reporting is not.
      const rev = storage.rev
      const store = (await storage.load()) ?? { version: 1 as const, annotations: [] }
      json(res, 200, { rev, store })
      return
    }

    if (req.method === 'PUT' && annMatch) {
      const id = decodeURIComponent(annMatch[1])
      let annotation: { id?: unknown }
      try {
        annotation = JSON.parse(await readBody(req))
      } catch {
        json(res, 400, { error: 'invalid JSON body' })
        return
      }
      if (!annotation || annotation.id !== id) {
        json(res, 400, { error: 'annotation.id must match the URL id' })
        return
      }
      // The store is trusted local input from the widget; no schema validation.
      await storage.save(annotation as never)
      json(res, 200, { rev: storage.rev })
      return
    }

    if (req.method === 'DELETE' && annMatch) {
      await storage.remove(decodeURIComponent(annMatch[1]))
      json(res, 200, { rev: storage.rev })
      return
    }

    if (req.method === 'DELETE' && pathname === '/annotations') {
      await storage.clear()
      json(res, 200, { rev: storage.rev })
      return
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Starts the widget-facing endpoint on 127.0.0.1:port. Rejects on bind errors. */
export function startHttpServer(storage: FileStorageAdapter, port: number): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void handle(req, res, storage)
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}
