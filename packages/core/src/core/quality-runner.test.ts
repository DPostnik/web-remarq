import { describe, it, expect, vi } from 'vitest'
import { QualityRunner, type QualityRunnerCallbacks } from './quality-runner'
import type { QualityCheck, QualityCheckInput } from './types'

const input: QualityCheckInput = {
  comment: 'fix this',
  route: '/x',
  viewport: { width: 1440, height: 900 },
  fingerprint: {
    dataAnnotate: null, dataTestId: null, id: null,
    tagName: 'div', textContent: null, role: null, ariaLabel: null,
    stableClasses: [], domPath: 'body>div', siblingIndex: 0, parentAnchor: null,
    rawClasses: [], cssModules: [],
    sourceLocation: null, componentName: null, detectedSource: null, detectedComponent: null,
  },
}

function verdict(score: QualityCheck['score']): QualityCheck {
  return { score, issues: [], clarifyingQuestions: [], refinedBy: 'auto', timestamp: 1 }
}

function callbacks(): QualityRunnerCallbacks & {
  persist: ReturnType<typeof vi.fn>
  onPending: ReturnType<typeof vi.fn>
  onSettled: ReturnType<typeof vi.fn>
} {
  return { persist: vi.fn(), onPending: vi.fn(), onSettled: vi.fn() }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('QualityRunner', () => {
  it('is disabled without a gate and does nothing', () => {
    const cb = callbacks()
    const runner = new QualityRunner(undefined, cb)
    expect(runner.enabled).toBe(false)
    runner.run('a1', input)
    expect(cb.onPending).not.toHaveBeenCalled()
  })

  it('is disabled when mode is off', () => {
    const cb = callbacks()
    const runner = new QualityRunner({ mode: 'off', check: vi.fn() }, cb)
    expect(runner.enabled).toBe(false)
    runner.run('a1', input)
    expect(cb.onPending).not.toHaveBeenCalled()
  })

  it('persists and settles on success (mode defaults to suggest)', async () => {
    const cb = callbacks()
    const qc = verdict('ambiguous')
    const runner = new QualityRunner({ check: vi.fn().mockResolvedValue(qc) }, cb)
    runner.run('a1', input)
    expect(cb.onPending).toHaveBeenCalledWith('a1')
    expect(runner.isPending('a1')).toBe(true)
    await flush()
    expect(cb.persist).toHaveBeenCalledWith('a1', qc)
    expect(cb.onSettled).toHaveBeenCalledWith('a1', qc)
    expect(runner.isPending('a1')).toBe(false)
  })

  it('is a silent no-op when the checker rejects', async () => {
    const cb = callbacks()
    const runner = new QualityRunner({ check: vi.fn().mockRejectedValue(new Error('net')) }, cb)
    runner.run('a1', input)
    await flush()
    expect(cb.persist).not.toHaveBeenCalled()
    expect(cb.onSettled).toHaveBeenCalledWith('a1', null)
    expect(runner.isPending('a1')).toBe(false)
  })

  it('discards a stale verdict when a newer run started', async () => {
    const cb = callbacks()
    const first = deferred<QualityCheck>()
    const second = deferred<QualityCheck>()
    const check = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const runner = new QualityRunner({ check }, cb)

    runner.run('a1', input)
    runner.run('a1', { ...input, comment: 'edited' })

    second.resolve(verdict('clear'))
    await flush()
    first.resolve(verdict('unactionable'))  // resolves AFTER the newer run
    await flush()

    expect(cb.persist).toHaveBeenCalledTimes(1)
    expect(cb.persist).toHaveBeenCalledWith('a1', expect.objectContaining({ score: 'clear' }))
  })

  it('discards a verdict after forget()', async () => {
    const cb = callbacks()
    const d = deferred<QualityCheck>()
    const runner = new QualityRunner({ check: vi.fn().mockReturnValue(d.promise) }, cb)
    runner.run('a1', input)
    runner.forget('a1')
    d.resolve(verdict('ambiguous'))
    await flush()
    expect(cb.persist).not.toHaveBeenCalled()
    expect(runner.isPending('a1')).toBe(false)
  })
})
