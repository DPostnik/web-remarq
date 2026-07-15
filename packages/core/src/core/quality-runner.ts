import type { QualityCheck, QualityCheckInput, QualityGateOptions } from './types'

export interface QualityRunnerCallbacks {
  /** Persist the fresh verdict on the annotation. */
  persist: (id: string, check: QualityCheck) => void
  /** A check started (show the pending chip). */
  onPending: (id: string) => void
  /** The run finished: the verdict on success, null on failure. */
  onSettled: (id: string, check: QualityCheck | null) => void
}

/**
 * Suggest-mode orchestrator. Never blocks the designer: a failing checker is
 * a silent no-op. A per-annotation sequence number discards verdicts that
 * went stale because the comment changed while the check was in flight.
 */
export class QualityRunner {
  private seqs = new Map<string, number>()
  private pending = new Set<string>()

  constructor(
    private gate: QualityGateOptions | undefined,
    private callbacks: QualityRunnerCallbacks,
  ) {}

  get enabled(): boolean {
    return !!this.gate && this.gate.mode !== 'off'
  }

  run(id: string, input: QualityCheckInput): void {
    if (!this.enabled) return
    const seq = (this.seqs.get(id) ?? 0) + 1
    this.seqs.set(id, seq)
    this.pending.add(id)
    this.callbacks.onPending(id)
    this.gate!.check(input).then(
      (check) => {
        if (this.seqs.get(id) !== seq) return
        this.pending.delete(id)
        this.callbacks.persist(id, check)
        this.callbacks.onSettled(id, check)
      },
      (err) => {
        console.debug('[web-remarq] quality check failed (ignored)', err)
        if (this.seqs.get(id) !== seq) return
        this.pending.delete(id)
        this.callbacks.onSettled(id, null)
      },
    )
  }

  isPending(id: string): boolean {
    return this.pending.has(id)
  }

  forget(id: string): void {
    this.seqs.delete(id)
    this.pending.delete(id)
  }

  clear(): void {
    this.seqs.clear()
    this.pending.clear()
  }
}
