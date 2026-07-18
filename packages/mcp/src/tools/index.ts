import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { StorageAdapter } from 'web-remarq'

import { listAnnotationsInputSchema, handleListAnnotations } from './list-annotations.js'
import { getAnnotationInputSchema, handleGetAnnotation } from './get-annotation.js'
import { acknowledgeInputSchema, handleAcknowledge } from './acknowledge.js'
import { claimFixInputSchema, handleClaimFix } from './claim-fix.js'
import { dismissInputSchema, handleDismiss } from './dismiss.js'
import { watchAnnotationsInputSchema, handleWatchAnnotations, type WaitForChange } from './watch-annotations.js'

export type { WaitForChange } from './watch-annotations.js'

// Cast helper: our tool results satisfy CallToolResult at runtime; the SDK's
// inferred type carries an index signature that our narrower types lack.
function cast(p: Promise<{ isError?: boolean; content: Array<{ type: 'text'; text: string }> }>): Promise<CallToolResult> {
  return p as Promise<CallToolResult>
}

export function registerTools(
  server: McpServer,
  storage: StorageAdapter,
  opts: { waitForChange: WaitForChange },
): void {
  server.registerTool(
    'list_annotations',
    {
      description: 'List annotations in the project with optional filters (route, status, viewport, file). Each item carries a `quality` score (clear | ambiguous | unactionable) when an AI pre-flight check ran. In local mode, actionable annotations (pending / in_progress) are also mirrored as ticket files in .remarq/tasks/.',
      inputSchema: listAnnotationsInputSchema.shape,
    },
    (input) => cast(handleListAnnotations(input, storage)),
  )

  server.registerTool(
    'get_annotation',
    {
      description: 'Get full annotation details including source file:line:col, grep search hints, and the AI quality verdict (`qualityCheck`). If qualityCheck.score is "ambiguous" or "unactionable", the comment may need designer clarification before fixing — consider dismissing with a reason instead of guessing.',
      inputSchema: getAnnotationInputSchema.shape,
    },
    (input) => cast(handleGetAnnotation(input, storage)),
  )

  server.registerTool(
    'acknowledge',
    {
      description: 'Mark an annotation as in-progress (pending → in_progress).',
      inputSchema: acknowledgeInputSchema.shape,
    },
    (input) => cast(handleAcknowledge(input, storage)),
  )

  server.registerTool(
    'claim_fix',
    {
      description: 'Claim a fix for an annotation (→ fixed_unverified). Human verification still required.',
      inputSchema: claimFixInputSchema.shape,
    },
    (input) => cast(handleClaimFix(input, storage)),
  )

  server.registerTool(
    'dismiss',
    {
      description: 'Dismiss an annotation with an optional reason (terminal state).',
      inputSchema: dismissInputSchema.shape,
    },
    (input) => cast(handleDismiss(input, storage)),
  )

  server.registerTool(
    'watch_annotations',
    {
      description:
        'Wait for pending annotations (long-poll). Returns immediately if pending annotations exist; otherwise blocks until one appears or timeoutSeconds (default 25) elapses, then returns {"annotations": [], "timedOut": true}. Call this in a loop to continuously pick up designer feedback. If your environment can run background subagents (e.g. a Task tool), act as a dispatcher: for each returned annotation call acknowledge first (so it stops being redelivered), hand the fix to a background subagent that will claim_fix when done, and return to watch_annotations immediately instead of fixing inline - new feedback must never wait on a fix in progress. Without subagents, acknowledge each annotation before you start fixing it.',
      inputSchema: watchAnnotationsInputSchema.shape,
    },
    (input) => cast(handleWatchAnnotations(input, storage, opts.waitForChange)),
  )
}
