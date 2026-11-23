import { execFile } from 'node:child_process'
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { isSafeAnnotationId } from 'web-remarq/core'
import { renderMarks } from './channel-delivery.js'
import { THREAD_UUID, type CodexConfig } from './config.js'

const QUEUE_TIMEOUT_MS = 15_000
const RECEIPT = /^Queued message (\S+) for thread ([0-9a-f-]+)\.$/im

interface Receipt {
  projectId: string
  thread: string
  annotationId: string
  cycle: number
  status: 'unknown' | 'accepted' | 'waiting_for_session'
  submissionId?: string
  stderr?: string
  exitCode?: string | number
}

interface CodexDeliveryOptions {
  storage: Pick<StorageAdapter, 'load'>
  projectId: string
  ledgerPath: string
  tasksDir: string
  config: CodexConfig
  log?: (message: string) => void
}

function readReceipts(path: string): Receipt[] {
  try {
    const ledger = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown; receipts?: unknown } | null
    if (ledger?.version === 1 && Array.isArray(ledger.receipts) && ledger.receipts.every((r: Partial<Receipt> | null) =>
      typeof r?.projectId === 'string' && typeof r.thread === 'string' && THREAD_UUID.test(r.thread) &&
      isSafeAnnotationId(r.annotationId) && typeof r.cycle === 'number' && Number.isSafeInteger(r.cycle) && r.cycle >= 0 &&
      (r.status === 'unknown' || (
        (r.status === 'accepted' || r.status === 'waiting_for_session') &&
        typeof r.submissionId === 'string' && r.submissionId.length > 0
      )),
    )) return ledger.receipts
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
  }
  throw new Error(`Cannot read Codex ledger ${path}. Recover the receipts before dispatching pending marks.`)
}

function writeReceipts(path: string, receipts: Receipt[]): void {
  const tmp = `${path}.tmp`
  const fd = openSync(tmp, 'w', 0o600)
  try {
    writeFileSync(fd, JSON.stringify({ version: 1, receipts }, null, 2) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, path)
}

function markCycle(mark: Annotation): number {
  // Regular edits keep the same cycle. Human rejection or reopening starts a new one.
  return mark.lifecycle?.filter((event) =>
    event.type === 'submitted' || event.type === 'rejected' || event.type === 'reopened',
  ).length ?? 0
}

function sendMark(config: CodexConfig, mark: Annotation, taskPath: string, signal: AbortSignal) {
  const message = [
    'The user submitted this browser mark for a code fix in this project.',
    'Call the web-remarq MCP acknowledge tool for this mark with a fresh operationId before editing.',
    'After fixing it, call claim_fix so a human can verify it. If you cannot act, call dismiss with a reason.',
    'Reuse the same operationId when retrying a lifecycle tool call. If acknowledge fails, check the current mark before acting.',
    `If this session is interrupted after acknowledging, read the current task file at ${JSON.stringify(taskPath)}. Continue only when the current acknowledgement matches the original successful call in this session. Inspect the working tree and finish only the remaining changes before claiming the fix.`,
    renderMarks([mark]).replace(/\0/g, '\uFFFD'),
  ].join('\n\n')
  const args = ['queue', ...(config.remote ? ['--remote', config.remote] : []),
    '--thread', config.thread, '--resume', '--message', message]
  return new Promise<{ started: boolean; stdout: string; stderr: string; exitCode?: string | number }>((resolve) => {
    let started = false
    const env = { ...process.env }
    delete env.OPENAI_API_KEY
    delete env.CODEX_API_KEY
    const child = execFile(config.executable, args, { env, signal, timeout: QUEUE_TIMEOUT_MS }, (error, stdout, stderr) => {
      resolve({ started, stdout, stderr, exitCode: error?.code ?? error?.signal ?? undefined })
    })
    child.once('spawn', () => { started = true })
  })
}

/** Delivers pending marks from the owning MCP process to the selected Codex thread. */
export class CodexDelivery {
  private ready = false
  private readonly controller = new AbortController()
  private chain: Promise<void> = Promise.resolve()
  private readonly log: (message: string) => void

  constructor(private readonly opts: CodexDeliveryOptions) {
    this.log = opts.log ?? ((message) => console.error(`[web-remarq-mcp] ${message}`))
  }

  onInitialized(): void {
    this.ready = true
    this.schedule(true)
  }

  onChange(): void {
    this.schedule(false)
  }

  stop(): void {
    this.controller.abort()
  }

  private schedule(startup: boolean): void {
    if (!this.ready || this.controller.signal.aborted) return
    this.chain = this.chain.then(() => this.deliver(startup)).catch((err: unknown) => {
      this.log(`Codex delivery failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  private async deliver(startup: boolean): Promise<void> {
    if (this.controller.signal.aborted) return
    const { projectId, config, ledgerPath, storage, tasksDir } = this.opts
    const receipts = readReceipts(ledgerPath)
    const sent = new Map(receipts.filter((r) => r.projectId === projectId)
      .map((r) => [`${r.annotationId}:${r.cycle}`, r]))
    while (!this.controller.signal.aborted) {
      const pending = ((await storage.load())?.annotations ?? [])
        .filter((mark) => mark.status === 'pending' && isSafeAnnotationId(mark.id))
      if (this.controller.signal.aborted) return

      if (startup) {
        for (const mark of pending) {
          const receipt = sent.get(`${mark.id}:${markCycle(mark)}`)
          if (receipt && (receipt.status !== 'accepted' || receipt.thread !== config.thread)) {
            this.log(`Pending mark ${mark.id} has a ${receipt.status} Codex submission for thread ${receipt.thread}. Inspect that thread or handle the mark through MCP.`)
          }
        }
        startup = false
      }

      const mark = pending.find((candidate) => !sent.has(`${candidate.id}:${markCycle(candidate)}`))
      if (!mark) return
      const receipt: Receipt = {
        projectId, thread: config.thread, annotationId: mark.id, cycle: markCycle(mark), status: 'unknown',
      }
      // A crash after spawning can leave the result unknown. Reserve before invoking the CLI.
      writeReceipts(ledgerPath, [...receipts, receipt])
      const result = await sendMark(config, mark, join(tasksDir, `${mark.id}.md`), this.controller.signal)
      if (!result.started) {
        writeReceipts(ledgerPath, receipts)
        this.log(`Could not start Codex for mark ${mark.id} (${result.exitCode ?? 'unknown error'}). Check REMARQ_CODEX_BIN and restart the MCP server.`)
        return
      }

      const match = RECEIPT.exec(result.stdout)
      if (match?.[2].toLowerCase() === config.thread) {
        receipt.status = /failed to resume|could not resume/i.test(result.stderr) ? 'waiting_for_session' : 'accepted'
        receipt.submissionId = match[1]
      }
      if (result.stderr) receipt.stderr = result.stderr
      if (result.exitCode !== undefined) receipt.exitCode = result.exitCode
      receipts.push(receipt)
      writeReceipts(ledgerPath, receipts)
      sent.set(`${receipt.annotationId}:${receipt.cycle}`, receipt)
      if (receipt.status !== 'accepted') {
        this.log(`Codex submission for mark ${mark.id}: ${receipt.status}. Check thread ${config.thread} and ${ledgerPath}.`)
      }
    }
  }
}
