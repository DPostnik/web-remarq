import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Annotation, StorageAdapter } from 'web-remarq'
import { actionableOnly, generateAgentExport } from 'web-remarq/core'

/** Double-quoted YAML scalar; JSON string escaping is valid YAML. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * Renders one annotation as a ticket file for .remarq/tasks/.
 * Deterministic: TaskFolder diffs the output against the file on disk
 * to skip no-op rewrites.
 */
export function renderTaskFile(annotation: Annotation): string {
  // Reuse core agent-export for source resolution + search hints (same pattern as get_annotation).
  const agent = generateAgentExport([annotation], annotation.viewportBucket).annotations[0]
  const lines: string[] = []

  lines.push('---')
  lines.push(`id: ${yamlString(agent.id)}`)
  lines.push(`route: ${yamlString(agent.route)}`)
  lines.push(`status: ${agent.status}`)
  lines.push(`viewportBucket: ${annotation.viewportBucket}`)
  if (annotation.qualityCheck) lines.push(`quality: ${annotation.qualityCheck.score}`)
  lines.push('---', '')

  lines.push(`# web-remarq annotation ${agent.id}`, '')
  lines.push('## Comment', '', agent.comment.trim(), '')

  lines.push('## Element', '')
  lines.push(`- Tag: \`${agent.searchHints.tagName}\``)
  lines.push(`- DOM: \`${agent.searchHints.domContext}\``)
  if (agent.source) {
    const component = agent.source.component ? ` (component \`${agent.source.component}\`)` : ''
    lines.push(`- Source: \`${agent.source.file}:${agent.source.line}:${agent.source.column}\`${component}`)
  }
  if (agent.searchHints.classes.length) {
    lines.push(`- Classes: ${agent.searchHints.classes.map((c) => `\`${c}\``).join(' ')}`)
  }
  lines.push('')

  if (agent.searchHints.grepQueries.length) {
    lines.push('## Search hints', '')
    for (const q of agent.searchHints.grepQueries) {
      lines.push(`- [${q.confidence}] \`${q.query}\` in \`${q.glob}\``)
    }
    lines.push('')
  }

  const qc = annotation.qualityCheck
  if (qc && qc.score !== 'clear') {
    lines.push('## Quality check', '')
    lines.push(`Verdict: **${qc.score}** - this comment may need designer clarification; if you cannot act on it confidently, dismiss with a reason instead of guessing.`, '')
    for (const issue of qc.issues) lines.push(`- Issue: ${issue}`)
    for (const q of qc.clarifyingQuestions) lines.push(`- Open question: ${q}`)
    if (qc.suggestedRewrite) lines.push(`- Suggested rewrite: ${qc.suggestedRewrite}`)
    lines.push('')
  }

  lines.push('## Agent instructions', '')
  lines.push(`1. BEFORE touching code, call the web-remarq MCP tool \`acknowledge\` with \`{ "id": ${yamlString(agent.id)} }\`. If it errors, another agent already owns this task - skip this file.`)
  lines.push('2. Apply the fix described in the comment.')
  lines.push(`3. When the fix is committed to the working tree, call \`claim_fix\` with \`{ "id": ${yamlString(agent.id)} }\`. A human verifies afterwards - never mark anything as done yourself.`)
  lines.push('')
  lines.push('This file is a live projection maintained by the web-remarq MCP server: it updates when the annotation changes and disappears once the annotation is verified or dismissed. Do not edit or delete it.')
  lines.push('')

  return lines.join('\n')
}

/**
 * Live projection of actionable annotations (pending/in_progress) into a
 * folder of <id>.md ticket files. The folder is server-owned: every *.md in
 * it is managed - stale ones are deleted on sync. Non-md files are ignored.
 */
export class TaskFolder {
  private syncing = false
  private dirty = false

  constructor(
    private storage: Pick<StorageAdapter, 'load'>,
    private dir: string,
  ) {}

  /** Full idempotent resync: folder contents converge to the actionable set. */
  async sync(): Promise<void> {
    const store = await this.storage.load()
    const actionable = actionableOnly(store?.annotations ?? [])
    const desired = new Map(actionable.map((a) => [`${a.id}.md`, renderTaskFile(a)]))

    mkdirSync(this.dir, { recursive: true })
    for (const name of readdirSync(this.dir)) {
      if (name.endsWith('.md') && !desired.has(name)) unlinkSync(join(this.dir, name))
    }
    for (const [name, content] of desired) {
      const path = join(this.dir, name)
      if (existsSync(path) && readFileSync(path, 'utf8') === content) continue
      writeFileSync(path, content)
    }
  }

  /** Coalesces change bursts: at most one sync in flight, one more queued. Never throws. */
  schedule(): void {
    this.dirty = true
    void this.run()
  }

  private async run(): Promise<void> {
    if (this.syncing) return
    this.syncing = true
    while (this.dirty) {
      this.dirty = false
      try {
        await this.sync()
      } catch (err) {
        console.error('[web-remarq-mcp] task folder sync failed:', err)
      }
    }
    this.syncing = false
  }
}
