import { vi, describe, it, expect, beforeEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import type { Annotation, ElementFingerprint } from 'web-remarq'
import { CloudStorageAdapter } from './cloud-storage-adapter'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

const mockCreateClient = vi.mocked(createClient)

interface ChainResult {
  data?: unknown
  error?: unknown
}

interface ChainSpies {
  from: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
}

function buildChain(result: ChainResult): { client: unknown; spies: ChainSpies } {
  const spies: ChainSpies = {
    from: vi.fn(),
    select: vi.fn(),
    order: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    neq: vi.fn(),
  }

  const chain: Record<string, unknown> = {
    then: (resolve: (value: ChainResult) => unknown) => resolve(result),
  }
  chain.select = (...args: unknown[]) => {
    spies.select(...args)
    return chain
  }
  chain.order = (...args: unknown[]) => {
    spies.order(...args)
    return chain
  }
  chain.upsert = (...args: unknown[]) => {
    spies.upsert(...args)
    return chain
  }
  chain.delete = (...args: unknown[]) => {
    spies.delete(...args)
    return chain
  }
  chain.eq = (...args: unknown[]) => {
    spies.eq(...args)
    return chain
  }
  chain.neq = (...args: unknown[]) => {
    spies.neq(...args)
    return chain
  }

  const client = {
    from: (...args: unknown[]) => {
      spies.from(...args)
      return chain
    },
  }

  return { client, spies }
}

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

const OPTS = {
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  projectKey: 'pk_testkey',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CloudStorageAdapter constructor', () => {
  it('passes project key header and disables session persistence', () => {
    const { client } = buildChain({ data: [], error: null })
    mockCreateClient.mockReturnValue(client as never)
    new CloudStorageAdapter(OPTS)
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
  it('returns annotations mapped from snake_case rows', async () => {
    const rows = [
      {
        id: 'a1',
        route: '/r',
        viewport: '1920x1080',
        viewport_bucket: 1900,
        fingerprint: FP,
        comment: 'one',
        status: 'pending',
        timestamp_ms: 100,
      },
      {
        id: 'a2',
        route: '/r',
        viewport: '1024x768',
        viewport_bucket: 1000,
        fingerprint: FP,
        comment: 'two',
        status: 'verified',
        timestamp_ms: 200,
        lifecycle: [
          { type: 'created', actor: 'designer', timestamp: 200 },
          { type: 'verified', actor: 'developer', timestamp: 250 },
        ],
      },
    ]
    const { client, spies } = buildChain({ data: rows, error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    const store = await adapter.load()

    expect(spies.from).toHaveBeenCalledWith('annotations')
    expect(spies.select).toHaveBeenCalledWith('*')
    expect(spies.order).toHaveBeenCalledWith('timestamp_ms', { ascending: true })
    expect(store).toEqual({
      version: 1,
      annotations: [
        {
          id: 'a1',
          comment: 'one',
          fingerprint: FP,
          route: '/r',
          viewport: '1920x1080',
          viewportBucket: 1900,
          timestamp: 100,
          status: 'pending',
          lifecycle: [],
        },
        {
          id: 'a2',
          comment: 'two',
          fingerprint: FP,
          route: '/r',
          viewport: '1024x768',
          viewportBucket: 1000,
          timestamp: 200,
          status: 'verified',
          lifecycle: [
            { type: 'created', actor: 'designer', timestamp: 200 },
            { type: 'verified', actor: 'developer', timestamp: 250 },
          ],
        },
      ],
    })
  })

  it('returns empty store (not null) when no rows exist', async () => {
    const { client } = buildChain({ data: [], error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    const store = await adapter.load()

    expect(store).toEqual({ version: 1, annotations: [] })
  })

  it('throws on supabase error when onError is "throw"', async () => {
    const err = new Error('rls denied')
    const { client } = buildChain({ data: null, error: err })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter({ ...OPTS, onError: 'throw' })

    await expect(adapter.load()).rejects.toThrow('rls denied')
  })

  it('returns empty store and logs when onError is "memory-fallback"', async () => {
    const err = new Error('network down')
    const { client } = buildChain({ data: null, error: err })
    mockCreateClient.mockReturnValue(client as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const adapter = new CloudStorageAdapter({ ...OPTS, onError: 'memory-fallback' })

    const store = await adapter.load()

    expect(store).toEqual({ version: 1, annotations: [] })
    expect(warn).toHaveBeenCalledWith('[web-remarq cloud]', err)
    warn.mockRestore()
  })
})

describe('CloudStorageAdapter.save', () => {
  it('upserts a row without project_id and with updated_at', async () => {
    const { client, spies } = buildChain({ data: null, error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await adapter.save(ANNOTATION)

    expect(spies.from).toHaveBeenCalledWith('annotations')
    const [row, options] = spies.upsert.mock.calls[0]
    expect(row).not.toHaveProperty('project_id')
    expect(row).not.toHaveProperty('created_at')
    expect(row).toMatchObject({
      id: 'a1',
      route: '/dashboard',
      viewport: '1920x1080',
      viewport_bucket: 1900,
      fingerprint: FP,
      comment: 'fix this',
      status: 'pending',
      timestamp_ms: 1711814400000,
    })
    expect(typeof row.updated_at).toBe('string')
    expect(() => new Date(row.updated_at).toISOString()).not.toThrow()
    expect(options).toEqual({ onConflict: 'id' })
  })

  it('throws when supabase returns an error and onError is "throw"', async () => {
    const err = new Error('insert failed')
    const { client } = buildChain({ data: null, error: err })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await expect(adapter.save(ANNOTATION)).rejects.toThrow('insert failed')
  })

  it('writes lifecycle array in the upserted row', async () => {
    const { client, spies } = buildChain({ data: null, error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await adapter.save(ANNOTATION)

    const [row] = spies.upsert.mock.calls[0]
    expect(row.lifecycle).toEqual([
      { type: 'created', actor: 'designer', timestamp: 1711814400000 },
    ])
  })
})

describe('CloudStorageAdapter lifecycle round-trip', () => {
  it('preserves multi-event lifecycle through save → load', async () => {
    const annotationWithHistory: Annotation = {
      ...ANNOTATION,
      status: 'fixed_unverified',
      lifecycle: [
        { type: 'created', actor: 'designer', timestamp: 100 },
        { type: 'acknowledged', actor: 'agent', timestamp: 200 },
        { type: 'fix_claimed', actor: 'agent', timestamp: 300 },
      ],
    }

    // Capture what gets upserted, then feed it back to load
    let capturedRow: Record<string, unknown> | null = null
    const captureChain = buildChain({ data: null, error: null })
    captureChain.spies.upsert.mockImplementation((row: Record<string, unknown>) => {
      capturedRow = row
      return (captureChain.client as { from: () => unknown }).from()
    })
    mockCreateClient.mockReturnValue(captureChain.client as never)
    const writer = new CloudStorageAdapter(OPTS)
    await writer.save(annotationWithHistory)

    expect(capturedRow).not.toBeNull()
    const readChain = buildChain({ data: [capturedRow], error: null })
    mockCreateClient.mockReturnValue(readChain.client as never)
    const reader = new CloudStorageAdapter(OPTS)
    const store = await reader.load()

    expect(store.annotations[0].lifecycle).toEqual(annotationWithHistory.lifecycle)
  })

  it('defaults lifecycle to [] when row has no lifecycle field (pre-migration row)', async () => {
    const legacyRow = {
      id: 'a-legacy',
      route: '/r',
      viewport: '1920x1080',
      viewport_bucket: 1900,
      fingerprint: FP,
      comment: 'old',
      status: 'pending',
      timestamp_ms: 1,
      // no lifecycle field
    }
    const { client } = buildChain({ data: [legacyRow], error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    const store = await adapter.load()

    expect(store.annotations[0].lifecycle).toEqual([])
  })

  it('defaults lifecycle to [] when row has lifecycle: null', async () => {
    const nullRow = {
      id: 'a-null',
      route: '/r',
      viewport: '1920x1080',
      viewport_bucket: 1900,
      fingerprint: FP,
      comment: 'null lifecycle',
      status: 'pending',
      timestamp_ms: 1,
      lifecycle: null,
    }
    const { client } = buildChain({ data: [nullRow], error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    const store = await adapter.load()

    expect(store.annotations[0].lifecycle).toEqual([])
  })
})

describe('CloudStorageAdapter.remove', () => {
  it('deletes by id', async () => {
    const { client, spies } = buildChain({ data: null, error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await adapter.remove('target-id')

    expect(spies.from).toHaveBeenCalledWith('annotations')
    expect(spies.delete).toHaveBeenCalled()
    expect(spies.eq).toHaveBeenCalledWith('id', 'target-id')
  })

  it('throws on error when onError is "throw"', async () => {
    const err = new Error('delete failed')
    const { client } = buildChain({ data: null, error: err })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await expect(adapter.remove('x')).rejects.toThrow('delete failed')
  })
})

describe('CloudStorageAdapter.clear', () => {
  it('deletes all rows within RLS scope using neq placeholder', async () => {
    const { client, spies } = buildChain({ data: null, error: null })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await adapter.clear()

    expect(spies.from).toHaveBeenCalledWith('annotations')
    expect(spies.delete).toHaveBeenCalled()
    expect(spies.neq).toHaveBeenCalledWith('id', '__never_matches__')
  })

  it('throws on error when onError is "throw"', async () => {
    const err = new Error('clear failed')
    const { client } = buildChain({ data: null, error: err })
    mockCreateClient.mockReturnValue(client as never)
    const adapter = new CloudStorageAdapter(OPTS)

    await expect(adapter.clear()).rejects.toThrow('clear failed')
  })
})
