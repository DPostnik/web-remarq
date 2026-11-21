import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { generateAgentExport } from 'web-remarq/core'
import type { ChannelConfig } from './config.js'

/**
 * Gated delivery of pending marks to a Claude Code channel.
 *
 * A channel event that STARTS a turn is acted on; one that arrives MID-TURN is
 * treated as untrusted and ignored. So at most one batch is in flight, and the
 * next one is sent only after every mark of the current batch is finished plus
 * a settle delay (so the agent's turn has ended). Channels give no ack: the
 * existing lifecycle is the completion signal - a mark is finished once it is
 * deleted or no longer pending/in_progress (claim_fix, dismiss, verify...).
 */

export type SendFn = (content: string, meta: Record<string, string>) => Promise<void>

export interface ChannelDeliveryOptions {
  storage: Pick<StorageAdapter, 'load'>
  send: SendFn
  /** Where the in-flight ledger lives, e.g. `.remarq/delivery.json`. */
  ledgerPath: string
  config: Pick<ChannelConfig, 'settleMs' | 'staleMs' | 'redeliverMs'>
  log?: (message: string) => void
}

interface Ledger {
  version: 1
  inFlight: string[]
  sentAt: number
  redelivered: boolean
}

const UNFINISHED = new Set(['pending', 'in_progress'])

export function readLedger(path: string): Ledger | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Ledger> | null
    if (!raw || !Array.isArray(raw.inFlight) || !raw.inFlight.every((x) => typeof x === 'string')) return null
    return {
      version: 1,
      inFlight: raw.inFlight,
      sentAt: typeof raw.sentAt === 'number' ? raw.sentAt : 0,
      redelivered: raw.redelivered === true,
    }
  } catch {
    return null // missing or corrupt: start empty
  }
}

function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(ledger, null, 2))
  renameSync(tmp, path)
}

/** Compact text for one batch: id, comment, route, source and search hints per mark. */
export function renderMarks(annotations: Annotation[]): string {
  const blocks = annotations.map((a) => {
    const agent = generateAgentExport([a], a.viewportBucket).annotations[0]
    const lines = [`Mark ${agent.id}`, `route: ${agent.route}`, `comment: ${agent.comment.trim()}`]
    if (agent.source) {
      const component = agent.source.component ? ` (component ${agent.source.component})` : ''
      lines.push(`source: ${agent.source.file}:${agent.source.line}:${agent.source.column}${component}`)
    }
    lines.push(`element: <${agent.searchHints.tagName}> ${agent.searchHints.domContext}`)
    for (const q of agent.searchHints.grepQueries.slice(0, 3)) {
      lines.push(`search [${q.confidence}]: ${q.query} in ${q.glob}`)
    }
    const qc = a.qualityCheck
    if (qc && qc.score !== 'clear') {
      lines.push(`note: comment rated ${qc.score}; if you cannot act on it confidently, dismiss with a reason`)
    }
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

export class ChannelDelivery {
  private inFlight: string[] = []
  private sentAt = 0
  private redelivered = false
  /** False until the MCP client finished initialization; nothing is sent before. */
  private ready = false
  private chain: Promise<void> = Promise.resolve()
  private gateTimer: ReturnType<typeof setTimeout> | undefined
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private startupTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly log: (message: string) => void

  constructor(private opts: ChannelDeliveryOptions) {
    this.log = opts.log ?? ((m) => console.error(`[web-remarq-mcp] ${m}`))
    const ledger = readLedger(opts.ledgerPath)
    if (ledger) {
      this.inFlight = ledger.inFlight
      this.sentAt = ledger.sentAt
      this.redelivered = ledger.redelivered
    }
  }

  /** Call on every store change. Never throws. */
  onChange(): void {
    void this.serialize(() => this.step(false))
  }

  /** Call once the MCP client finished initialization. Never throws. */
  onInitialized(): void {
    if (this.stopped || this.startupTimer) return
    this.startupTimer = setTimeout(() => {
      void this.serialize(() => this.step(true))
    }, this.opts.config.redeliverMs)
    this.startupTimer.unref?.()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.gateTimer)
    clearTimeout(this.watchdog)
    clearTimeout(this.startupTimer)
  }

  /** Resolves when every queued step finished. */
  idle(): Promise<void> {
    return this.chain
  }

  private serialize(fn: () => Promise<void>): Promise<void> {
    const job = this.chain.then(async () => {
      if (this.stopped) return
      try {
        await fn()
      } catch (err) {
        this.log(`channel delivery failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
    this.chain = job
    return job
  }

  private persist(): void {
    try {
      writeLedger(this.opts.ledgerPath, {
        version: 1,
        inFlight: this.inFlight,
        sentAt: this.sentAt,
        redelivered: this.redelivered,
      })
    } catch (err) {
      this.log(`channel ledger write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = undefined
    if (this.inFlight.length === 0 || this.redelivered) return
    this.watchdog = setTimeout(() => {
      void this.serialize(() => this.repush(true))
    }, this.opts.config.staleMs)
    this.watchdog.unref?.()
  }

  private startGate(): void {
    clearTimeout(this.gateTimer)
    this.gateTimer = setTimeout(() => {
      this.gateTimer = undefined
      void this.serialize(() => this.step(false))
    }, this.opts.config.settleMs)
    this.gateTimer.unref?.()
  }

  /** Re-evaluates in-flight progress against the store, then pumps if the gate is open. */
  private async step(startup: boolean): Promise<void> {
    const annotations = (await this.opts.storage.load())?.annotations ?? []
    const byId = new Map(annotations.map((a) => [a.id, a]))

    if (startup) this.ready = true

    if (this.inFlight.length > 0) {
      const unfinished = this.inFlight.filter((id) => UNFINISHED.has(byId.get(id)?.status ?? ''))
      if (unfinished.length < this.inFlight.length) {
        this.inFlight = unfinished
        this.sentAt = Date.now() // progress resets the stale clock
        this.persist()
        if (unfinished.length === 0) {
          clearTimeout(this.watchdog)
          this.watchdog = undefined
          this.redelivered = false
          this.persist()
          this.startGate()
        } else {
          this.armWatchdog()
        }
      }
    }

    if (startup && this.inFlight.length > 0) {
      this.redelivered = false
      await this.repush(false, byId)
      return
    }
    if (this.inFlight.length > 0 || !this.ready || this.gateTimer) return

    const batch = annotations.filter((a) => a.status === 'pending')
    if (batch.length === 0) return
    await this.sendBatch(batch, {})
    this.inFlight = batch.map((a) => a.id)
    this.sentAt = Date.now()
    this.redelivered = false
    this.persist()
    this.armWatchdog()
  }

  /** Re-sends the unfinished in-flight marks (watchdog or startup). */
  private async repush(fromWatchdog: boolean, known?: Map<string, Annotation>): Promise<void> {
    if (this.inFlight.length === 0 || (fromWatchdog && this.redelivered)) return
    const byId = known ?? new Map(((await this.opts.storage.load())?.annotations ?? []).map((a) => [a.id, a]))
    const batch = this.inFlight
      .map((id) => byId.get(id))
      .filter((a): a is Annotation => !!a && UNFINISHED.has(a.status))
    if (batch.length === 0) return
    if (fromWatchdog) this.log(`batch ${this.inFlight.join(',')} in flight over ${this.opts.config.staleMs}ms, re-pushing once`)
    await this.sendBatch(batch, { redelivered: 'true' })
    this.sentAt = Date.now()
    if (fromWatchdog) this.redelivered = true
    this.persist()
    this.armWatchdog()
  }

  private sendBatch(batch: Annotation[], extra: Record<string, string>): Promise<void> {
    return this.opts.send(renderMarks(batch), {
      kind: 'marks',
      count: String(batch.length),
      ids: batch.map((a) => a.id).join(','),
      ...extra,
    })
  }
}
