import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { FileStorageAdapter } from './file-storage-adapter'
import { hostAllowed, originAllowed, startHttpServer } from './http-server'
import type { LocalProjectConfig } from './local-config'
import { TaskFolder } from './task-folder'
import type { Annotation } from 'web-remarq'

const TOKEN = 'test-token-0123456789abcdef'
const config: LocalProjectConfig = {
  projectId: 'prj_test',
  token: TOKEN,
  allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*', 'https://design.example.com'],
}

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

describe('local http server (protocol 2)', () => {
  let dir: string
  let server: Server
  let base: string
  let port: number
  let storage: FileStorageAdapter
  let storePath: string

  const auth = { authorization: `Bearer ${TOKEN}` }
  const jsonAuth = { ...auth, 'content-type': 'application/json' }

  /** Authenticated request from an allowed dev origin, the way the widget calls. */
  const widget = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { ...init, headers: { origin: 'http://localhost:5173', ...(init.headers as Record<string, string>) } })
  const put = (id: string, body: unknown, headers: Record<string, string> = {}) =>
    widget(`/annotations/${id}`, { method: 'PUT', headers: { ...jsonAuth, ...headers }, body: JSON.stringify(body) })
  const storeAnnotations = async () => ((await (await widget('/store', { headers: auth })).json()).store.annotations as Annotation[])

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-http-'))
    storePath = join(dir, '.remarq', 'annotations.json')
    storage = new FileStorageAdapter(storePath)
    server = await startHttpServer(storage, 0, config) // port 0 = ephemeral
    port = (server.address() as AddressInfo).port
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })

  describe('access control', () => {
    it('GET /health answers without a token and reports the protocol version', async () => {
      const res = await fetch(`${base}/health`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, protocol: 2 })
    })

    it('refuses GET /store and every mutation without a token (401), leaving the store untouched', async () => {
      expect((await fetch(`${base}/store`)).status).toBe(401)
      const putRes = await fetch(`${base}/annotations/a1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ann('a1')) })
      expect(putRes.status).toBe(401)
      expect(putRes.headers.get('www-authenticate')).toContain('Bearer')
      expect((await fetch(`${base}/annotations/a1`, { method: 'DELETE' })).status).toBe(401)
      expect((await fetch(`${base}/annotations`, { method: 'DELETE' })).status).toBe(401)
      const wrong = await fetch(`${base}/store`, { headers: { authorization: 'Bearer nope-nope-nope-nope-nope' } })
      expect(wrong.status).toBe(401)
      expect(existsSync(storePath)).toBe(false)
    })

    it('a CLI-style request with no Origin passes only with the token', async () => {
      const res = await fetch(`${base}/store`, { headers: auth })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.projectId).toBe('prj_test')
      expect(body.protocol).toBe(2)
      expect(body.store).toEqual({ version: 1, annotations: [] })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('an allowed dev origin gets exact CORS headers on preflight and on responses', async () => {
      const pre = await fetch(`${base}/annotations/a1`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'PUT' } })
      expect(pre.status).toBe(204)
      expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
      expect(pre.headers.get('access-control-allow-headers')).toContain('authorization')
      expect(pre.headers.get('access-control-allow-headers')).toContain('if-match')
      expect(pre.headers.get('vary')).toBe('Origin')

      const res = await widget('/store', { headers: auth })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    })

    it('a foreign origin is refused on preflight, read and write - even with the right token', async () => {
      for (const origin of ['http://evil.example', 'http://localhost.evil.example:5173', 'http://notlocalhost:5173', 'null', 'https://design.example.com.attacker.net']) {
        const pre = await fetch(`${base}/store`, { method: 'OPTIONS', headers: { origin } })
        expect(pre.status, origin).toBe(403)
        expect(pre.headers.get('access-control-allow-origin'), origin).toBeNull()
        const read = await fetch(`${base}/store`, { headers: { origin, ...auth } })
        expect(read.status, origin).toBe(403)
        const write = await fetch(`${base}/annotations/a1`, { method: 'PUT', headers: { origin, ...jsonAuth }, body: JSON.stringify(ann('a1')) })
        expect(write.status, origin).toBe(403)
      }
      expect(existsSync(storePath)).toBe(false)
    })

    it('an explicitly listed remote origin is allowed only at its exact scheme and default port', async () => {
      expect((await fetch(`${base}/store`, { headers: { origin: 'https://design.example.com', ...auth } })).status).toBe(200)
      expect((await fetch(`${base}/store`, { headers: { origin: 'http://design.example.com', ...auth } })).status).toBe(403)
      expect((await fetch(`${base}/store`, { headers: { origin: 'https://design.example.com:8443', ...auth } })).status).toBe(403)
    })

    it('GET /health answers any origin (liveness only, no data) so a refused page can explain itself', async () => {
      const res = await fetch(`${base}/health`, { headers: { origin: 'http://evil.example' } })
      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(await res.json()).toEqual({ ok: true, protocol: 2 })
      const pre = await fetch(`${base}/health`, { method: 'OPTIONS', headers: { origin: 'http://evil.example' } })
      expect(pre.status).toBe(204)
    })

    it('a mismatching Host header (DNS rebinding) is refused', async () => {
      // fetch() drops a caller-supplied Host header, so use the raw client.
      const withHost = (host: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port, path: '/health', method: 'GET', headers: { host }, setHost: false },
            (res) => {
              let body = ''
              res.on('data', (c) => { body += c })
              res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
            },
          )
          req.on('error', reject)
          req.end()
        })
      const evil = await withHost('evil.example')
      expect(evil.status).toBe(403)
      expect(JSON.parse(evil.body).code).toBe('bad_host')
      expect((await withHost(`127.0.0.1:${port + 1}`)).status).toBe(403)
      expect((await withHost(`localhost.evil.example:${port}`)).status).toBe(403)
      expect((await withHost(`localhost:${port}`)).status).toBe(200)
    })
  })

  describe('validation at the boundary', () => {
    it('rejects an id-only body with 400 and details; store and task folder stay untouched', async () => {
      const tasks = new TaskFolder(storage, join(dir, '.remarq', 'tasks'))
      storage.onChange(() => tasks.schedule())
      const res = await put('a1', { id: 'a1' })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('invalid_annotation')
      expect(body.details.join('\n')).toMatch(/fingerprint/)
      expect(existsSync(storePath)).toBe(false)
      await new Promise((r) => setTimeout(r, 20))
      expect(existsSync(join(dir, '.remarq', 'tasks')) ? readdirSync(join(dir, '.remarq', 'tasks')) : []).toEqual([])
    })

    it('rejects a wrong status, a missing fingerprint, and unknown fields', async () => {
      expect((await put('a1', { ...ann('a1'), status: 'done' })).status).toBe(400)
      const { fingerprint: _fp, ...noFingerprint } = ann('a1')
      expect((await put('a1', noFingerprint)).status).toBe(400)
      expect((await put('a1', { ...ann('a1'), owner: 'me' })).status).toBe(400)
      expect(existsSync(storePath)).toBe(false)
    })

    it('rejects invalid JSON, wrong content-type, oversized bodies and malformed ids; the process keeps serving', async () => {
      const badJson = await widget('/annotations/a1', { method: 'PUT', headers: jsonAuth, body: 'not json' })
      expect(badJson.status).toBe(400)
      expect((await badJson.json()).code).toBe('invalid_json')

      const wrongType = await widget('/annotations/a1', { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body: JSON.stringify(ann('a1')) })
      expect(wrongType.status).toBe(415)

      const huge = await put('a1', { ...ann('a1'), comment: 'x'.repeat(600 * 1024) })
      expect(huge.status).toBe(413)

      const badEncoding = await widget('/annotations/%E0%A4%A', { method: 'PUT', headers: jsonAuth, body: '{}' })
      expect(badEncoding.status).toBe(400)
      expect((await badEncoding.json()).code).toBe('invalid_id')

      const traversal = await widget('/annotations/..%2Fevil', { method: 'DELETE', headers: auth })
      expect(traversal.status).toBe(400)

      const mismatch = await put('a1', ann('other'))
      expect(mismatch.status).toBe(400)
      expect((await mismatch.json()).code).toBe('id_mismatch')

      expect(existsSync(storePath)).toBe(false)
      const ok = await put('a1', ann('a1'))
      expect(ok.status).toBe(200)
      expect((await storeAnnotations()).map((a) => a.id)).toEqual(['a1'])
    })
  })

  describe('revisions', () => {
    it('creates at rev 1, requires If-Match to update, and bumps rev on each accepted write', async () => {
      const created = await put('a1', ann('a1'))
      expect(created.status).toBe(200)
      const createdBody = await created.json()
      expect(createdBody.annotation.rev).toBe(1)
      expect(createdBody.rev).toBe(1)

      const noMatch = await put('a1', { ...ann('a1'), comment: 'edited' })
      expect(noMatch.status).toBe(428)
      expect((await noMatch.json()).code).toBe('precondition_required')

      const updated = await put('a1', { ...ann('a1'), comment: 'edited' }, { 'if-match': '1' })
      expect(updated.status).toBe(200)
      expect((await updated.json()).annotation.rev).toBe(2)

      const stale = await put('a1', { ...ann('a1'), comment: 'stale' }, { 'if-match': '1' })
      expect(stale.status).toBe(409)
      const staleBody = await stale.json()
      expect(staleBody.code).toBe('conflict')
      expect(staleBody.details.current.comment).toBe('edited')
      expect(staleBody.details.current.rev).toBe(2)

      const bad = await put('a1', ann('a1'), { 'if-match': 'abc' })
      expect(bad.status).toBe(400)

      const stored = await storeAnnotations()
      expect(stored[0].comment).toBe('edited')
      expect(stored[0].rev).toBe(2)
    })

    it('a stale full copy cannot roll back a newer status or truncate history', async () => {
      await put('a1', ann('a1'))
      // Agent moves it forward through the atomic path.
      const acknowledged = await storage.mutate('a1', (c) => ({
        ...c, status: 'in_progress', lifecycle: [...c.lifecycle, { type: 'acknowledged', actor: 'agent', timestamp: 2 }],
      }))
      expect(acknowledged.rev).toBe(2)

      // Widget still holds rev 1 with the old pending copy.
      const res = await put('a1', { ...ann('a1'), comment: 'edited offline' }, { 'if-match': '1' })
      expect(res.status).toBe(409)
      const stored = (await storeAnnotations())[0]
      expect(stored.status).toBe('in_progress')
      expect(stored.lifecycle).toHaveLength(2)
    })

    it('DELETE honours If-Match when given, is idempotent, and clear resets everything', async () => {
      await put('a1', ann('a1'))
      const stale = await widget('/annotations/a1', { method: 'DELETE', headers: { ...auth, 'if-match': '7' } })
      expect(stale.status).toBe(409)
      const del = await widget('/annotations/a1', { method: 'DELETE', headers: { ...auth, 'if-match': '1' } })
      expect(del.status).toBe(200)
      const again = await widget('/annotations/a1', { method: 'DELETE', headers: auth })
      expect(again.status).toBe(200)

      await put('x', ann('x'))
      const clear = await widget('/annotations', { method: 'DELETE', headers: auth })
      expect(clear.status).toBe(200)
      expect(await storeAnnotations()).toEqual([])
    })

    it('records written by an older server (no rev) load as rev 1', async () => {
      await storage.save(ann('legacy'))
      const raw = JSON.parse(readFileSync(storePath, 'utf8'))
      delete raw.annotations[0].rev
      const { writeFileSync } = await import('node:fs')
      writeFileSync(storePath, JSON.stringify(raw))
      const [loaded] = await storeAnnotations()
      expect(loaded.rev).toBe(1)
      const res = await put('legacy', { ...ann('legacy'), comment: 'touched' }, { 'if-match': '1' })
      expect(res.status).toBe(200)
    })
  })
})

describe('originAllowed', () => {
  const allowed = ['http://localhost:*', 'http://127.0.0.1:3000', 'https://design.example.com', 'http://[::1]:*']
  it('matches exact hosts, respects port wildcards, refuses substrings and lookalikes', () => {
    expect(originAllowed('http://localhost:5173', allowed)).toBe(true)
    expect(originAllowed('http://localhost', allowed)).toBe(true)
    expect(originAllowed('http://127.0.0.1:3000', allowed)).toBe(true)
    expect(originAllowed('http://127.0.0.1:3001', allowed)).toBe(false)
    expect(originAllowed('https://design.example.com', allowed)).toBe(true)
    expect(originAllowed('https://design.example.com:444', allowed)).toBe(false)
    expect(originAllowed('http://design.example.com', allowed)).toBe(false)
    expect(originAllowed('http://localhost.evil.com:5173', allowed)).toBe(false)
    expect(originAllowed('http://evil.com/localhost', allowed)).toBe(false)
    expect(originAllowed('http://[::1]:5173', allowed)).toBe(true)
    expect(originAllowed('http://[::2]:5173', allowed)).toBe(false)
    expect(originAllowed('null', allowed)).toBe(false)
    expect(originAllowed('garbage', allowed)).toBe(false)
  })
})

describe('hostAllowed', () => {
  it('accepts loopback names with or without the bound port, refuses everything else', () => {
    expect(hostAllowed('127.0.0.1:1817', 1817)).toBe(true)
    expect(hostAllowed('localhost:1817', 1817)).toBe(true)
    expect(hostAllowed('[::1]:1817', 1817)).toBe(true)
    expect(hostAllowed('localhost', 1817)).toBe(true)
    expect(hostAllowed('127.0.0.1:1818', 1817)).toBe(false)
    expect(hostAllowed('evil.example:1817', 1817)).toBe(false)
    expect(hostAllowed('localhost.evil.example:1817', 1817)).toBe(false)
    expect(hostAllowed(undefined, 1817)).toBe(false)
  })
})
