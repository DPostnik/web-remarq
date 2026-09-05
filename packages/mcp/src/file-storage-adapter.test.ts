import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileStorageAdapter } from './file-storage-adapter'
import type { Annotation } from 'web-remarq'

function ann(id: string, status: Annotation['status'] = 'pending'): Annotation {
  return {
    id, comment: `c-${id}`, route: '/', viewport: '1024x768', viewportBucket: 1000,
    timestamp: 1, status,
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1 }],
    fingerprint: {
      dataAnnotate: null, dataTestId: null, id: null, tagName: 'button', textContent: null,
      role: null, ariaLabel: null, stableClasses: [], domPath: 'body > button', siblingIndex: 0,
      parentAnchor: null, sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
    },
  }
}

describe('FileStorageAdapter', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'remarq-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('load() returns null before any write, then round-trips saves', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    expect(await adapter.load()).toBeNull()
    await adapter.save(ann('a1'))
    await adapter.save(ann('a2'))
    const store = await adapter.load()
    expect(store?.annotations.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('save() upserts by id and bumps rev on every mutation', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    expect(adapter.rev).toBe(0)
    await adapter.save(ann('a1'))
    expect(adapter.rev).toBe(1)
    await adapter.save({ ...ann('a1'), comment: 'edited' })
    expect(adapter.rev).toBe(2)
    const store = await adapter.load()
    expect(store?.annotations).toHaveLength(1)
    expect(store?.annotations[0].comment).toBe('edited')
  })

  it('remove() and clear() work', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    await adapter.save(ann('a1'))
    await adapter.save(ann('a2'))
    await adapter.remove('a1')
    expect((await adapter.load())?.annotations.map((a) => a.id)).toEqual(['a2'])
    await adapter.clear()
    expect((await adapter.load())?.annotations).toEqual([])
  })

  it('creates a .gitignore inside a .remarq dir, but NOT elsewhere', async () => {
    const inRemarq = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    await inRemarq.save(ann('a1'))
    expect(readFileSync(join(dir, '.remarq', '.gitignore'), 'utf8')).toBe('*\n')

    const elsewhere = new FileStorageAdapter(join(dir, 'data', 'annotations.json'))
    await elsewhere.save(ann('a1'))
    expect(existsSync(join(dir, 'data', '.gitignore'))).toBe(false)
  })

  it('waitForChange resolves true on mutation, false on timeout', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    const waiting = adapter.waitForChange(1000)
    await adapter.save(ann('a1'))
    expect(await waiting).toBe(true)

    expect(await adapter.waitForChange(20)).toBe(false)
  })

  it('load() rejects with a descriptive error on a corrupted store, and save() does not silently wipe it', async () => {
    const storePath = join(dir, '.remarq', 'annotations.json')
    mkdirSync(join(dir, '.remarq'), { recursive: true })
    writeFileSync(storePath, '{"annotations": [')
    const adapter = new FileStorageAdapter(storePath)

    await expect(adapter.load()).rejects.toThrow(/corrupted/)
    await expect(adapter.load()).rejects.toThrow(storePath)

    // A subsequent save() loads first, so it must reject too (not silently wipe the corrupted store).
    await expect(adapter.save(ann('a1'))).rejects.toThrow(/corrupted/)
    expect(readFileSync(storePath, 'utf8')).toBe('{"annotations": [')
  })

  it('serializes concurrent save() calls so neither write is lost', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    await Promise.all([adapter.save(ann('c1')), adapter.save(ann('c2'))])
    const store = await adapter.load()
    expect(store?.annotations.map((a) => a.id).sort()).toEqual(['c1', 'c2'])
    expect(adapter.rev).toBe(2)
  })

  it('assigns a per-record rev: 1 on create, +1 per save, and rev 1 to legacy records on load', async () => {
    const storePath = join(dir, '.remarq', 'annotations.json')
    const adapter = new FileStorageAdapter(storePath)
    await adapter.save(ann('a1'))
    expect((await adapter.load())?.annotations[0].rev).toBe(1)
    await adapter.save({ ...ann('a1'), comment: 'edited', rev: 99 }) // client-supplied rev is ignored
    expect((await adapter.load())?.annotations[0].rev).toBe(2)

    const raw = JSON.parse(readFileSync(storePath, 'utf8'))
    delete raw.annotations[0].rev
    writeFileSync(storePath, JSON.stringify(raw))
    expect((await adapter.load())?.annotations[0].rev).toBe(1)
  })

  it('saveIfMatch() enforces the expected revision', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    expect(await adapter.saveIfMatch(ann('a1'), null)).toMatchObject({ ok: true, annotation: { rev: 1 } })
    expect(await adapter.saveIfMatch(ann('a2'), 3)).toMatchObject({ ok: false, reason: 'conflict', current: null })
    expect(await adapter.saveIfMatch({ ...ann('a1'), comment: 'x' }, null)).toMatchObject({ ok: false, reason: 'precondition_required' })
    expect(await adapter.saveIfMatch({ ...ann('a1'), comment: 'x' }, 2)).toMatchObject({ ok: false, reason: 'conflict', current: { rev: 1 } })
    expect(await adapter.saveIfMatch({ ...ann('a1'), comment: 'x' }, 1)).toMatchObject({ ok: true, annotation: { rev: 2, comment: 'x' } })
    expect(await adapter.removeIfMatch('a1', 1)).toMatchObject({ ok: false, reason: 'conflict' })
    expect(await adapter.removeIfMatch('a1', 2)).toMatchObject({ ok: true })
    expect(await adapter.removeIfMatch('a1', null)).toMatchObject({ ok: true })
  })

  it('mutate() applies inside the queue, skips persisting when apply returns the same object, and rejects unknown ids', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    await adapter.save(ann('a1'))
    const revBefore = adapter.rev

    const same = await adapter.mutate('a1', (c) => c)
    expect(same.rev).toBe(1)
    expect(adapter.rev).toBe(revBefore)

    const changed = await adapter.mutate('a1', (c) => ({ ...c, comment: 'via mutate' }))
    expect(changed).toMatchObject({ comment: 'via mutate', rev: 2 })
    expect(adapter.rev).toBe(revBefore + 1)

    await expect(adapter.mutate('nope', (c) => c)).rejects.toMatchObject({ name: 'AnnotationNotFoundError' })
    await expect(adapter.mutate('a1', () => { throw new Error('abort') })).rejects.toThrow('abort')
    expect((await adapter.load())?.annotations[0].rev).toBe(2)
  })

  it('onChange() fires on every mutation', async () => {
    const adapter = new FileStorageAdapter(join(dir, '.remarq', 'annotations.json'))
    let calls = 0
    adapter.onChange(() => calls++)
    await adapter.save(ann('a1'))
    await adapter.remove('a1')
    await adapter.clear()
    expect(calls).toBe(3)
  })
})
