import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Annotation } from 'web-remarq'

const here = dirname(fileURLToPath(import.meta.url))
const viteNode = join(dirname(createRequire(import.meta.url).resolve('vite-node/package.json')), 'vite-node.mjs')
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port
      s.close(() => resolve(p))
    })
  })

function mark(id: string, comment: string): Annotation {
  return {
    id, comment, route: '/pricing', viewport: '1024x768', viewportBucket: 1000, timestamp: 1,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: 'buy', id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: 'src/Pricing.tsx:42:7', componentName: null, detectedSource: null, detectedComponent: null,
    },
  }
}

describe('channel delivery over stdio', () => {
  let dir: string
  let client: Client
  let received: Array<{ method: string; params?: { content?: string; meta?: Record<string, string> } }>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-channel-it-'))
    received = []
  })
  afterEach(async () => {
    await client?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function start(env: Record<string, string>): Promise<{ base: string; token: () => string }> {
    const port = await freePort()
    const store = join(dir, '.remarq')
    client = new Client({ name: 'test', version: '0' }, { capabilities: {} })
    client.fallbackNotificationHandler = async (n) => {
      received.push(n as (typeof received)[number])
    }
    // The vite-node CLI copies every variable of `.env` in its root (default: cwd)
    // into process.env when unset, so a repo-root `.env` with REMARQ_PROJECT_KEY
    // switched the server to cloud mode. Pin the root to this package (it has no
    // `.env`; outside it the server's imports do not resolve) and drop inherited
    // REMARQ_* so only this test's variables apply.
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith('REMARQ_')),
    )
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [viteNode, join(here, 'server.ts')],
        cwd: join(here, '..'),
        env: {
          ...inherited,
          REMARQ_PORT: String(port),
          REMARQ_DATA_FILE: join(store, 'annotations.json'),
          REMARQ_CHANNEL_SETTLE_MS: '150',
          REMARQ_CHANNEL_REDELIVER_MS: '50',
          ...env,
        },
        stderr: 'ignore',
      }),
    )
    const base = `http://127.0.0.1:${port}`
    return { base, token: () => JSON.parse(readFileSync(join(store, 'config.json'), 'utf8')).token }
  }

  const put = (s: { base: string; token: () => string }, a: Annotation): Promise<Response> =>
    fetch(`${s.base}/annotations/${a.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token()}` },
      body: JSON.stringify(a),
    })

  const waitFor = async (cond: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !cond(); i++) await sleep(50)
    expect(cond()).toBe(true)
  }

  it('declares the channel capability, delivers a mark, and gates the next batch on claim_fix', async () => {
    const s = await start({})
    expect(client.getServerCapabilities()?.experimental).toHaveProperty('claude/channel')
    expect(client.getInstructions()).toContain('claim_fix')

    expect((await put(s, mark('m1', 'Button too small'))).status).toBe(200)
    await waitFor(() => received.length === 1)
    expect(received[0].method).toBe('notifications/claude/channel')
    expect(received[0].params?.meta).toEqual({ kind: 'marks', count: '1', ids: 'm1' })
    expect(received[0].params?.content).toContain('Button too small')
    expect(received[0].params?.content).toContain('src/Pricing.tsx:42:7')

    // m2 arrives mid-batch: held back
    expect((await put(s, mark('m2', 'Wrong colour'))).status).toBe(200)
    await sleep(600)
    expect(received).toHaveLength(1)

    const res = await client.callTool({ name: 'claim_fix', arguments: { id: 'm1', operationId: 'op-1' } })
    expect(res.isError).not.toBe(true)
    await waitFor(() => received.length === 2)
    expect(received[1].params?.meta).toEqual({ kind: 'marks', count: '1', ids: 'm2' })
  }, 30000)

  it('REMARQ_CHANNEL=off declares nothing and sends nothing', async () => {
    const s = await start({ REMARQ_CHANNEL: 'off' })
    expect(client.getServerCapabilities()?.experimental).toBeUndefined()
    expect(client.getInstructions()).toBeUndefined()
    expect((await put(s, mark('m1', 'x'))).status).toBe(200)
    await sleep(800)
    expect(received).toHaveLength(0)
    expect(existsSync(join(dir, '.remarq', 'delivery.json'))).toBe(false)
  }, 30000)
})
