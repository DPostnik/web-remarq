import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Annotation } from 'web-remarq'
import { ChannelDelivery, readLedger, renderMarks } from './channel-delivery'

function ann(id: string, status: Annotation['status'] = 'pending', extra: Partial<Annotation> = {}): Annotation {
  return {
    id, comment: `c-${id}`, route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
    ...extra,
  }
}

const SETTLE = 3000
const STALE = 180000
const REDELIVER = 2000

describe('ChannelDelivery', () => {
  let dir: string
  let ledgerPath: string
  let store: Annotation[]
  let sent: Array<{ content: string; meta: Record<string, string> }>
  let live: ChannelDelivery[]

  const make = (send?: (c: string, m: Record<string, string>) => Promise<void>): ChannelDelivery => {
    const d = new ChannelDelivery({
      storage: { load: async () => ({ version: 1, annotations: store }) },
      send: send ?? (async (content, meta) => { sent.push({ content, meta }) }),
      ledgerPath,
      config: { settleMs: SETTLE, staleMs: STALE, redeliverMs: REDELIVER },
      log: () => {},
    })
    live.push(d)
    return d
  }
  /** Mutates the store like the real adapter does, then fires the change hook. */
  const set = (d: ChannelDelivery, id: string, status: Annotation['status'] | 'deleted'): void => {
    store = status === 'deleted'
      ? store.filter((a) => a.id !== id)
      : store.some((a) => a.id === id)
        ? store.map((a) => (a.id === id ? { ...a, status } : a))
        : [...store, ann(id, status)]
    d.onChange()
  }
  const ids = (i: number): string => sent[i].meta.ids
  const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
  }
  const ready = async (d: ChannelDelivery): Promise<void> => {
    d.onInitialized()
    await advance(REDELIVER)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'remarq-channel-'))
    ledgerPath = join(dir, 'delivery.json')
    store = []
    sent = []
    live = []
  })
  afterEach(() => {
    for (const d of live) d.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('sends nothing before the client initialized, then pumps queued marks', async () => {
    const d = make()
    set(d, 'a', 'pending')
    await advance(10000)
    expect(sent).toHaveLength(0)
    await ready(d)
    expect(sent).toHaveLength(1)
    expect(sent[0].meta).toEqual({ kind: 'marks', count: '1', ids: 'a' })
    expect(sent[0].content).toContain('Mark a')
    expect(sent[0].content).toContain('comment: c-a')
  })

  it('gates: A in flight, B and C queue, one batch B+C after completion and settle', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    expect(sent).toHaveLength(1)

    set(d, 'b', 'pending')
    set(d, 'c', 'pending')
    await advance(10000)
    expect(sent).toHaveLength(1)

    set(d, 'a', 'fixed_unverified')
    await advance(SETTLE - 1)
    expect(sent).toHaveLength(1)
    await advance(1)
    expect(sent).toHaveLength(2)
    expect(ids(1)).toBe('b,c')
    expect(sent[1].meta.count).toBe('2')
  })

  it('treats in_progress as unfinished and a deletion as finished', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    set(d, 'b', 'pending')
    set(d, 'a', 'in_progress')
    await advance(SETTLE + 100)
    expect(sent).toHaveLength(1)
    set(d, 'a', 'deleted')
    await advance(SETTLE)
    expect(sent).toHaveLength(2)
    expect(ids(1)).toBe('b')
  })

  it('completion by dismissal opens the gate too', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    set(d, 'b', 'pending')
    set(d, 'a', 'dismissed')
    await advance(SETTLE)
    expect(ids(1)).toBe('b')
  })

  it('never delivers drafts, only once they are pending', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'draft')
    await advance(10000)
    expect(sent).toHaveLength(0)
    set(d, 'a', 'pending')
    await advance(0)
    expect(ids(0)).toBe('a')
  })

  it('does not resend a mark that is already in flight on unrelated changes', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    set(d, 'x', 'draft')
    await advance(SETTLE * 3)
    expect(sent).toHaveLength(1)
  })

  it('watchdog re-pushes a stuck batch once and keeps it in flight', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    set(d, 'b', 'pending')
    await advance(STALE)
    expect(sent).toHaveLength(2)
    expect(sent[1].meta).toEqual({ kind: 'marks', count: '1', ids: 'a', redelivered: 'true' })
    await advance(STALE * 3)
    expect(sent).toHaveLength(2)
    // still gated: b was not delivered
    expect(readLedger(ledgerPath)?.inFlight).toEqual(['a'])
  })

  it('progress resets the stale clock', async () => {
    const d = make()
    await ready(d)
    set(d, 'a', 'pending')
    set(d, 'b', 'pending')
    await advance(0)
    expect(ids(0)).toBe('a,b')
    await advance(STALE - 1000)
    set(d, 'a', 'fixed_unverified')
    await advance(STALE - 1000)
    expect(sent).toHaveLength(1)
    await advance(1000)
    expect(sent).toHaveLength(2)
    expect(ids(1)).toBe('b')
  })

  it('persists the ledger and a restarted server re-pushes the unfinished batch', async () => {
    const first = make()
    await ready(first)
    set(first, 'a', 'pending')
    set(first, 'b', 'pending')
    await advance(0)
    set(first, 'a', 'fixed_unverified')
    await advance(0)
    set(first, 'c', 'pending')
    await advance(0)
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).inFlight).toEqual(['b'])
    first.stop()

    sent = []
    const second = make()
    second.onInitialized()
    await advance(REDELIVER - 1)
    expect(sent).toHaveLength(0)
    await advance(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].meta).toEqual({ kind: 'marks', count: '1', ids: 'b', redelivered: 'true' })

    // c stays queued behind the gate until b is reported
    await advance(SETTLE * 2)
    expect(sent).toHaveLength(1)
    set(second, 'b', 'dismissed')
    await advance(SETTLE)
    expect(ids(1)).toBe('c')
  })

  it('startup pumps queued marks when nothing was in flight', async () => {
    store = [ann('a'), ann('b', 'draft')]
    const d = make()
    await ready(d)
    expect(sent).toHaveLength(1)
    expect(sent[0].meta).toEqual({ kind: 'marks', count: '1', ids: 'a' })
  })

  it('startup drops ledger ids that finished while the server was down', async () => {
    writeFileSync(ledgerPath, JSON.stringify({ version: 1, inFlight: ['a'], sentAt: 1, redelivered: false }))
    store = [ann('a', 'fixed_unverified'), ann('b')]
    const d = make()
    await ready(d)
    expect(sent).toHaveLength(0) // settle gate after the finished batch
    await advance(SETTLE)
    expect(ids(0)).toBe('b')
  })

  it('tolerates a corrupt or missing ledger', async () => {
    expect(readLedger(ledgerPath)).toBeNull()
    writeFileSync(ledgerPath, '{not json')
    expect(readLedger(ledgerPath)).toBeNull()
    writeFileSync(ledgerPath, JSON.stringify({ inFlight: 'x' }))
    expect(readLedger(ledgerPath)).toBeNull()
    store = [ann('a')]
    const d = make()
    await ready(d)
    expect(ids(0)).toBe('a')
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).inFlight).toEqual(['a'])
  })

  it('a failed send is not recorded as in flight and retries on the next change', async () => {
    let fail = true
    const d = make(async (content, meta) => {
      if (fail) throw new Error('closed')
      sent.push({ content, meta })
    })
    await ready(d)
    set(d, 'a', 'pending')
    await advance(0)
    expect(existsSync(ledgerPath)).toBe(false)
    fail = false
    set(d, 'b', 'pending')
    await advance(0)
    expect(ids(0)).toBe('a,b')
  })

  it('serializes concurrent store changes into a single batch', async () => {
    let inside = 0
    let maxInside = 0
    const d = make(async (content, meta) => {
      inside++
      maxInside = Math.max(maxInside, inside)
      await new Promise((r) => setTimeout(r, 50))
      sent.push({ content, meta })
      inside--
    })
    await ready(d)
    store = [ann('a'), ann('b'), ann('c')]
    for (let i = 0; i < 5; i++) d.onChange()
    await advance(1000)
    expect(maxInside).toBe(1)
    expect(sent).toHaveLength(1)
    expect(ids(0)).toBe('a,b,c')
  })
})

describe('renderMarks', () => {
  it('carries id, route, comment, source and search hints', () => {
    const a = ann('a1', 'pending', { route: '/pricing', comment: 'Too small' })
    a.fingerprint.sourceLocation = 'src/Pricing.tsx:42:7'
    a.fingerprint.dataTestId = 'buy'
    const text = renderMarks([a, ann('a2')])
    expect(text).toContain('Mark a1')
    expect(text).toContain('route: /pricing')
    expect(text).toContain('comment: Too small')
    expect(text).toContain('source: src/Pricing.tsx:42:7')
    expect(text).toMatch(/search \[\w+\]:/)
    expect(text).toContain('Mark a2')
  })
})
