import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Annotation, ElementFingerprint } from 'web-remarq'
import { AnnotationStorage, StorageConflictError } from 'web-remarq/core'
import { CloudStorageAdapter } from './cloud-storage-adapter'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

const mockCreateClient = vi.mocked(createClient)

/**
 * Stateful stand-in for the `annotations` table: rows keyed by id, `rev`
 * enforced the way sql/004_rev.sql + the adapter's statements do (insert =
 * rev 1, unique id; `update ... eq(id) eq(rev)` matches only the expected
 * revision). It exists to check that AnnotationStorage and CloudStorageAdapter
 * agree on revisions across a sequence of writes - the SQL itself is covered
 * by the disposable-database run described in the README.
 */
function fakeTable(seed: Array<Record<string, unknown>> = []) {
  const rows = new Map<string, Record<string, unknown>>(seed.map((r) => [r.id as string, r]))
  const statements: string[] = []
  let failNext: { code?: string; message: string } | null = null
  const client = {
    from: () => {
      let op = 'select'
      let payload: Record<string, unknown> | null = null
      const filters: Array<[string, unknown]> = []
      let single = false
      const run = () => {
        const error = failNext
        failNext = null
        if (error) return { data: null, error }
        const match = (r: Record<string, unknown>) => filters.every(([k, v]) => r[k] === v)
        if (op === 'insert') {
          const id = payload!.id as string
          statements.push(`insert ${id}`)
          if (rows.has(id)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          rows.set(id, { ...payload! })
          return { data: null, error: null }
        }
        if (op === 'update') {
          const hit = [...rows.values()].filter(match)
          statements.push(`update ${filters.map(([k, v]) => `${k}=${v}`).join(',')} -> ${hit.length}`)
          for (const r of hit) rows.set(r.id as string, { ...r, ...payload! })
          return { data: hit.map((r) => ({ id: r.id })), error: null }
        }
        if (op === 'delete') {
          statements.push('delete')
          for (const r of [...rows.values()]) if (r.id !== '__never_matches__') rows.delete(r.id as string)
          return { data: null, error: null }
        }
        const hit = [...rows.values()].filter(match)
        return { data: single ? (hit[0] ?? null) : hit, error: null }
      }
      const chain: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => resolve(run()) }
      chain.select = () => chain
      chain.order = () => chain
      chain.maybeSingle = () => { single = true; return chain }
      chain.insert = (row: Record<string, unknown>) => { op = 'insert'; payload = row; return chain }
      chain.update = (row: Record<string, unknown>) => { op = 'update'; payload = row; return chain }
      chain.delete = () => { op = 'delete'; return chain }
      chain.eq = (k: string, v: unknown) => { filters.push([k, v]); return chain }
      chain.neq = () => chain
      return chain
    },
  }
  return { client, rows, statements, fail: (e: { code?: string; message: string }) => { failNext = e } }
}

const FP: ElementFingerprint = {
  dataAnnotate: null, dataTestId: 'btn', id: null, tagName: 'button', textContent: 'Save', role: null, ariaLabel: null,
  stableClasses: [], domPath: 'div>button', siblingIndex: 0, parentAnchor: null,
  sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
}

function ann(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id, comment: `c-${id}`, fingerprint: FP, route: '/', viewport: '1920x1080', viewportBucket: 1900,
    timestamp: 1711814400000, status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1711814400000 }],
    ...overrides,
  }
}

function row(id: string, rev: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id, route: '/', viewport: '1920x1080', viewport_bucket: 1900, fingerprint: FP, comment: `c-${id}`, status: 'pending',
    timestamp_ms: 1711814400000, lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1711814400000 }], rev, ...overrides,
  }
}

async function storeOver(table: ReturnType<typeof fakeTable>) {
  mockCreateClient.mockReturnValue(table.client as never)
  const adapter = new CloudStorageAdapter({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon', projectKey: 'pk_test' })
  const store = new AnnotationStorage(adapter)
  await store.ready
  return store
}

beforeEach(() => {
  mockCreateClient.mockReset()
})

describe('AnnotationStorage + CloudStorageAdapter revisions', () => {
  it('create / edit / edit: one INSERT then conditional UPDATEs on the current rev, no reload needed', async () => {
    const table = fakeTable()
    const store = await storeOver(table)
    await store.add(ann('a1'))
    await store.update('a1', { comment: 'second' })
    await store.update('a1', { comment: 'third' })
    expect(table.statements).toEqual(['insert a1', 'update id=a1,rev=1 -> 1', 'update id=a1,rev=2 -> 1'])
    expect(table.rows.get('a1')).toMatchObject({ comment: 'third', rev: 3 })
    expect(store.getById('a1')).toMatchObject({ comment: 'third', rev: 3 })
  })

  it('load / edit / edit starts from the loaded rev and keeps following it', async () => {
    const table = fakeTable([row('a1', 3)])
    const store = await storeOver(table)
    await store.update('a1', { comment: 'four' })
    await store.update('a1', { comment: 'five' })
    expect(table.statements).toEqual(['update id=a1,rev=3 -> 1', 'update id=a1,rev=4 -> 1'])
    expect(store.getById('a1')?.rev).toBe(5)
    expect(table.rows.get('a1')?.rev).toBe(5)
  })

  it('a real concurrent write is a conflict; the backend copy is adopted and the next edit succeeds', async () => {
    const table = fakeTable([row('a1', 3)])
    const store = await storeOver(table)
    table.rows.set('a1', row('a1', 4, { status: 'in_progress', comment: 'agent moved it' }))
    await expect(store.update('a1', { comment: 'stale' })).rejects.toBeInstanceOf(StorageConflictError)
    expect(store.getById('a1')).toMatchObject({ status: 'in_progress', comment: 'agent moved it', rev: 4 })
    await store.update('a1', { comment: 'fresh' })
    expect(table.rows.get('a1')).toMatchObject({ comment: 'fresh', status: 'in_progress', rev: 5 })
  })

  it('a database error confirms nothing: no rev is adopted and the cache is rolled back', async () => {
    const table = fakeTable([row('a1', 3)])
    const store = await storeOver(table)
    table.fail({ message: 'connection reset' })
    await expect(store.add(ann('n1'))).rejects.toMatchObject({ message: 'connection reset' })
    expect(store.getById('n1')).toBeUndefined()
    table.fail({ message: 'connection reset' })
    await expect(store.update('a1', { comment: 'x' })).rejects.toMatchObject({ message: 'connection reset' })
    expect(store.getById('a1')).toMatchObject({ comment: 'c-a1', rev: 3 })
    expect(table.rows.get('a1')?.rev).toBe(3)
  })

  it('import clears the table and INSERTs every record; an exported rev never drives an UPDATE of a deleted row', async () => {
    const table = fakeTable([row('a1', 3), row('gone', 2)])
    const store = await storeOver(table)
    await store.importJSON({ version: 1, annotations: [ann('a1', { comment: 'imported', rev: 3 }), ann('b1', { rev: 9 })] })
    expect(table.statements).toEqual(['delete', 'insert a1', 'insert b1'])
    expect([...table.rows.keys()]).toEqual(['a1', 'b1'])
    expect(table.rows.get('a1')).toMatchObject({ comment: 'imported', rev: 1 })
    expect(store.getAll().map((a) => [a.id, a.rev])).toEqual([['a1', 1], ['b1', 1]])
    await store.update('b1', { comment: 'after import' })
    expect(table.statements[table.statements.length - 1]).toBe('update id=b1,rev=1 -> 1')
  })
})
