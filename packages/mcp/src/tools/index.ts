import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { StorageAdapter } from 'web-remarq'

import { listAnnotationsInputSchema, handleListAnnotations } from './list-annotations.js'
import { getAnnotationInputSchema, handleGetAnnotation } from './get-annotation.js'
import { acknowledgeInputSchema, handleAcknowledge } from './acknowledge.js'
import { claimFixInputSchema, handleClaimFix } from './claim-fix.js'
import { dismissInputSchema, handleDismiss } from './dismiss.js'

// Cast helper: our tool results satisfy CallToolResult at runtime; the SDK's
// inferred type carries an index signature that our narrower types lack.
function cast(p: Promise<{ isError?: boolean; content: Array<{ type: 'text'; text: string }> }>): Promise<CallToolResult> {
  return p as Promise<CallToolResult>
}

export function registerTools(server: McpServer, storage: StorageAdapter): void {
  server.registerTool(
    'list_annotations',
    {
      description: 'List annotations in the project with optional filters (route, status, viewport, file). Each item carries a `quality` score (clear | ambiguous | unactionable) when an AI pre-flight check ran.',
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
}
