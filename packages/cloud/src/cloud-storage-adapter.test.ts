import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Annotation, ElementFingerprint } from 'web-remarq'
import { AnnotationNotFoundError, StorageConflictError } from 'web-remarq/core'
import { CloudStorageAdapter } from './cloud-storage-adapter'
import type { CloudStorageOptions } from './types'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

const mockCreateClient = vi.mocked(createClient)

interface ChainResult {
  data?: unknown
  error?: unknown
}

type Call = { method: string; args: unknown[] }

/**
 * Scripted stand-in for the supabase-js query builder. Every `from()` opens a
 * new chain; every builder method records itself and returns the chain; the
 * chain resolves (it is thenable) to the next scripted result. Tests assert on
 * the recorded call sequence per query - this proves WHICH statement was sent
 * (a conditional update with `eq('rev', n)`, an insert, a maybeSingle read),
 * which is what the concurrency guarantees rest on. It does NOT prove SQL
 * atomicity - see the README: the disposable-database run is a separate step.
 */
function scripted(results: ChainResult[]) {
  const queries: Call[][] = []
  const client = {
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }]
      queries.push(calls)
      const result = results.shift() ?? { data: null, error: null }
      const chain: Record<string, unknown> = {
        then: (resolve: (value: ChainResult) => unknown) => resolve(result),
      }
      for (const method of ['select', 'order', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'maybeSingle']) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ method, args })
          return chain
        }
      }
      return chain
    },
  }
  return { client, queries }
}

const methods = (q: Call[]) => q.map((c) => c.method)
const call = (q: Call[], method: string) => q.find((c) => c.method === method)!.args

const FP: ElementFingerprint = {
  dataAnnotate: null,
  dataTestId: 'btn',
  id: null,
  tagName: 'button',
  textContent: 'Save',
  role: null,
  ariaLabel: null,
  stableClasses: ['primary'],
  domPath: 'div>button',
  siblingIndex: 0,
  parentAnchor: null,
  sourceLocation: null,
  componentName: null,
  detectedSource: null,
  detectedComponent: null,
}

const ANNOTATION: Annotation = {
  id: 'a1',
  comment: 'fix this',
  fingerprint: FP,
  route: '/dashboard',
  viewport: '1920x1080',
  viewportBucket: 1900,
  timestamp: 1711814400000,
  status: 'pending',
  lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1711814400000 }],
}

const ROW = {
  id: 'a1',
  route: '/dashboard',
  viewport: '1920x1080',
  viewport_bucket: 1900,
  fingerprint: FP,
  comment: 'fix this',
  status: 'pending',
  timestamp_ms: 1711814400000,
  lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1711814400000 }],
  rev: 3,
}

const OPTS = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  projectKey: 'pk_testkey',
}

function adapterWith(results: ChainResult[], opts: CloudStorageOptions = OPTS) {
  const { client, queries } = scripted(results)
  mockCreateClient.mockReturnValue(client as never)
  return { adapter: new CloudStorageAdapter(opts), queries }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CloudStorageAdapter constructor', () => {
  it('passes project key header and disables session persistence', () => {
    adapterWith([])
    expect(mockCreateClient).toHaveBeenCalledWith(
      OPTS.supabaseUrl,
      OPTS.supabaseAnonKey,
      {
        global: { headers: { 'x-remarq-project-key': OPTS.projectKey } },
        auth: { persistSession: false },
      },
    )
  })
})

describe('CloudStorageAdapter.load', () => {
  it('returns annotations mapped from snake_case rows, including rev', async () => {
    const legacy = { ...ROW, id: 'a0', comment: 'legacy', lifecycle: undefined, rev: undefined }
    const { adapter, queries } = adapterWith([{ data: [legacy, ROW], error: null }])

    const store = await adapter.load()

    expect(methods(queries[0])).toEqual(['from', 'select', 'order'])
    expect(call(queries[0], 'order')).toEqual(['timestamp_ms', { ascending: true }])
    expect(store.annotations[0]).toEqual({
      id: 'a0', comment: 'legacy', fingerprint: FP, route: '/dashboard', viewport: '1920x1080',
      viewportBucket: 1900, timestamp: 1711814400000, status: 'pending', lifecycle: [],
    })
    expect(store.annotations[1]).toMatchObject({ id: 'a1', rev: 3, lifecycle: ROW.lifecycle })
  })

  it('returns empty store (not null) when no rows exist', async () => {
    const { adapter } = adapterWith([{ data: [], error: null }])
    expect(await adapter.load()).toEqual({ version: 1, annotations: [] })
  })

  it('throws on supabase error when onError is "throw", logs and falls back otherwise', async () => {
    const err = new Error('rls denied')
    const { adapter } = adapterWith([{ data: null, error: err }], { ...OPTS, onError: 'throw' })
    await expect(adapter.load()).rejects.toThrow('rls denied')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { adapter: lenient } = adapterWith([{ data: null, error: err }], { ...OPTS, onError: 'memory-fallback' })
    expect(await lenient.load()).toEqual({ version: 1, annotations: [] })
    expect(warn).toHaveBeenCalledWith('[web-remarq cloud]', err)
    warn.mockRestore()
  })
})

describe('CloudStorageAdapter.save', () => {
  it('inserts a new record (no rev) at rev 1, without project_id or created_at', async () => {
    const { adapter, queries } = adapterWith([{ data: null, error: null }])

    await adapter.save(ANNOTATION)

    expect(methods(queries[0])).toEqual(['from', 'insert'])
    const [row] = call(queries[0], 'insert') as [Record<string, unknown>]
    expect(row).not.toHaveProperty('project_id')
    expect(row).not.toHaveProperty('created_at')
    expect(row).toMatchObject({ id: 'a1', route: '/dashboard', comment: 'fix this', status: 'pending', timestamp_ms: 1711814400000, rev: 1 })
    expect(row.lifecycle).toEqual(ANNOTATION.lifecycle)
    expect(typeof row.updated_at).toBe('string')
  })

  it('a copy that carries rev is a conditional update on id AND rev, bumping rev', async () => {
    const { adapter, queries } = adapterWith([{ data: [{ id: 'a1' }], error: null }])

    await adapter.save({ ...ANNOTATION, comment: 'edited', rev: 3 })

    expect(methods(queries[0])).toEqual(['from', 'update', 'eq', 'eq', 'select'])
    const [row] = call(queries[0], 'update') as [Record<string, unknown>]
    expect(row).toMatchObject({ comment: 'edited', rev: 4 })
    const eqs = queries[0].filter((c) => c.method === 'eq').map((c) => c.args)
    expect(eqs).toEqual([['id', 'a1'], ['rev', 3]])
  })

  it('throws StorageConflictError with the current copy when the conditional update matches nothing', async () => {
    const { adapter } = adapterWith([
      { data: [], error: null }, // update matched 0 rows
      { data: { ...ROW, comment: 'server side', rev: 4 }, error: null }, // fetchOne
    ])

    const err = await adapter.save({ ...ANNOTATION, comment: 'stale', rev: 3 }).catch((e) => e)
    expect(err).toBeInstanceOf(StorageConflictError)
    expect((err as StorageConflictError).current).toMatchObject({ comment: 'server side', rev: 4 })
  })

  it('reports an insert of an id that already exists as a conflict, not a silent overwrite', async () => {
    const { adapter } = adapterWith([
      { data: null, error: { code: '23505', message: 'duplicate key' } },
      { data: ROW, error: null },
    ])
    await expect(adapter.save(ANNOTATION)).rejects.toBeInstanceOf(StorageConflictError)
  })

  it('throws other errors when onError is "throw"', async () => {
    const { adapter } = adapterWith([{ data: null, error: new Error('insert failed') }])
    await expect(adapter.save(ANNOTATION)).rejects.toThrow('insert failed')
  })
})

describe('CloudStorageAdapter.mutate', () => {
  it('reads, applies, and writes with a single conditional statement on the read revision', async () => {
    const { adapter, queries } = adapterWith([
      { data: ROW, error: null }, // fetchOne
      { data: [{ id: 'a1' }], error: null }, // conditional update matched
    ])

    const saved = await adapter.mutate('a1', (c) => ({
      ...c, status: 'in_progress', lifecycle: [...c.lifecycle, { type: 'acknowledged', actor: 'agent', timestamp: 2 }],
    }))

    expect(methods(queries[0])).toEqual(['from', 'select', 'eq', 'maybeSingle'])
    expect(methods(queries[1])).toEqual(['from', 'update', 'eq', 'eq', 'select'])
    expect(queries[1].filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([['id', 'a1'], ['rev', 3]])
    expect(saved).toMatchObject({ status: 'in_progress', rev: 4 })
    expect(saved.lifecycle).toHaveLength(2)
  })

  it('re-reads and re-applies when the conditional update lost the race, so the loser sees the winner', async () => {
    const applied: string[] = []
    const { adapter, queries } = adapterWith([
      { data: ROW, error: null }, // read rev 3, pending
      { data: [], error: null }, // update on rev 3 matched nothing: someone else won
      { data: { ...ROW, status: 'in_progress', rev: 4 }, error: null }, // re-read
    ])

    await expect(
      adapter.mutate('a1', (c) => {
        applied.push(c.status)
        if (c.status !== 'pending') throw new Error(`cannot acknowledge from ${c.status}`)
        return { ...c, status: 'in_progress' }
      }),
    ).rejects.toThrow('cannot acknowledge from in_progress')
    expect(applied).toEqual(['pending', 'in_progress'])
    expect(queries).toHaveLength(3)
  })

  it('persists nothing when apply returns the same object, and rejects unknown ids', async () => {
    const { adapter, queries } = adapterWith([{ data: ROW, error: null }])
    const same = await adapter.mutate('a1', (c) => c)
    expect(same.rev).toBe(3)
    expect(queries).toHaveLength(1)

    const { adapter: missing } = adapterWith([{ data: null, error: null }])
    await expect(missing.mutate('nope', (c) => c)).rejects.toBeInstanceOf(AnnotationNotFoundError)
  })
})

describe('CloudStorageAdapter lifecycle round-trip', () => {
  it('preserves multi-event lifecycle through save → load', async () => {
    const withHistory: Annotation = {
      ...ANNOTATION,
      status: 'fixed_unverified',
      lifecycle: [
        { type: 'created', actor: 'designer', timestamp: 100 },
        { type: 'acknowledged', actor: 'agent', timestamp: 200 },
        { type: 'fix_claimed', actor: 'agent', timestamp: 300 },
      ],
    }
    const { adapter: writer, queries } = adapterWith([{ data: null, error: null }])
    await writer.save(withHistory)
    const [captured] = call(queries[0], 'insert') as [Record<string, unknown>]

    const { adapter: reader } = adapterWith([{ data: [captured], error: null }])
    const store = await reader.load()
    expect(store.annotations[0].lifecycle).toEqual(withHistory.lifecycle)
    expect(store.annotations[0].rev).toBe(1)
  })

  it('defaults lifecycle to [] for pre-migration rows (missing or null)', async () => {
    const { adapter } = adapterWith([{ data: [{ ...ROW, lifecycle: undefined }, { ...ROW, id: 'n', lifecycle: null }], error: null }])
    const store = await adapter.load()
    expect(store.annotations.map((a) => a.lifecycle)).toEqual([[], []])
  })
})

describe('CloudStorageAdapter.remove / clear', () => {
  it('deletes by id', async () => {
    const { adapter, queries } = adapterWith([{ data: null, error: null }])
    await adapter.remove('target-id')
    expect(methods(queries[0])).toEqual(['from', 'delete', 'eq'])
    expect(call(queries[0], 'eq')).toEqual(['id', 'target-id'])
  })

  it('deletes all rows within RLS scope using the neq placeholder', async () => {
    const { adapter, queries } = adapterWith([{ data: null, error: null }])
    await adapter.clear()
    expect(methods(queries[0])).toEqual(['from', 'delete', 'neq'])
    expect(call(queries[0], 'neq')).toEqual(['id', '__never_matches__'])
  })

  it('throws on error when onError is "throw"', async () => {
    const { adapter } = adapterWith([{ data: null, error: new Error('delete failed') }, { data: null, error: new Error('clear failed') }])
    await expect(adapter.remove('x')).rejects.toThrow('delete failed')
    await expect(adapter.clear()).rejects.toThrow('clear failed')
  })
})

describe('CloudStorageAdapter quality_check round-trip', () => {
  const qualityCheck = {
    score: 'ambiguous' as const,
    issues: ['No target size given'],
    clarifyingQuestions: [],
    suggestedRewrite: 'Increase the button height to 48px',
    refinedBy: 'auto' as const,
    timestamp: 1,
  }

  it('writes quality_check in the inserted row and maps it back on load', async () => {
    const { adapter, queries } = adapterWith([{ data: null, error: null }])
    await adapter.save({ ...ANNOTATION, qualityCheck })
    const [row] = call(queries[0], 'insert') as [Record<string, unknown>]
    expect(row.quality_check).toEqual(qualityCheck)

    const { adapter: reader } = adapterWith([{ data: [{ ...ROW, quality_check: qualityCheck }, ROW], error: null }])
    const store = await reader.load()
    expect(store.annotations[0].qualityCheck).toEqual(qualityCheck)
    expect(store.annotations[1].qualityCheck).toBeUndefined()
  })
})
