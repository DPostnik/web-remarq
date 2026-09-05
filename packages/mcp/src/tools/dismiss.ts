import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { operationIdSchema, runTransition } from './transition-tool.js'

export const dismissInputSchema = z.object({
  id: z.string(),
  reason: z.string().optional(),
  operationId: operationIdSchema,
})

export type DismissInput = z.infer<typeof dismissInputSchema>

export async function handleDismiss(input: DismissInput, storage: StorageAdapter) {
  return runTransition(input, storage, 'dismiss', 'dismiss')
}
