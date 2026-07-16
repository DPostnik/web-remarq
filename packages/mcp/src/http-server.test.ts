import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FileStorageAdapter } from './file-storage-adapter'
import { startHttpServer } from './http-server'
import type { Annotation } from 'web-remarq'

function ann(id: string): Annotation {
  return {
    id, comment: `c-${id}`, route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
  }
}

describe('local http server', () => {
  let dir: string
  let server: Server
  let base: string
  let storage: FileStorageAdapter

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-http-'))
    storage = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    server = await startHttpServer(storage, 0) // port 0 = ephemeral
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  it('GET /store returns rev + store (empty before writes) with CORS headers', async () => {
    const res = await fetch(`${base}/store`)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ rev: 0, store: { version: 1, annotations: [] } })
  })

  it('PUT upserts, DELETE removes, DELETE /annotations clears — rev advances', async () => {
    const put = await fetch(`${base}/annotations/a1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ann('a1')),
    })
    expect(await put.json()).toEqual({ rev: 1 })

    let store = (await (await fetch(`${base}/store`)).json()).store
    expect(store.annotations.map((a: Annotation) => a.id)).toEqual(['a1'])

    const del = await fetch(`${base}/annotations/a1`, { method: 'DELETE' })
    expect(await del.json()).toEqual({ rev: 2 })

    await fetch(`${base}/annotations/x`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ann('x')),
    })
    const clear = await fetch(`${base}/annotations`, { method: 'DELETE' })
    expect(await clear.json()).toEqual({ rev: 4 })
    store = (await (await fetch(`${base}/store`)).json()).store
    expect(store.annotations).toEqual([])
  })

  it('OPTIONS preflight answers 204 with CORS headers', async () => {
    const res = await fetch(`${base}/annotations/a1`, { method: 'OPTIONS' })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT')
  })

  it('rejects invalid JSON (400), id mismatch (400), unknown route (404)', async () => {
    const bad = await fetch(`${base}/annotations/a1`, { method: 'PUT', body: 'not json' })
    expect(bad.status).toBe(400)

    const mismatch = await fetch(`${base}/annotations/a1`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ann('other')),
    })
    expect(mismatch.status).toBe(400)

    const missing = await fetch(`${base}/nope`)
    expect(missing.status).toBe(404)
  })
})
