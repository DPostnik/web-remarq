import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { operationIdSchema, runTransition } from './transition-tool.js'

export const acknowledgeInputSchema = z.object({
  id: z.string(),
  operationId: operationIdSchema,
})

export type AcknowledgeInput = z.infer<typeof acknowledgeInputSchema>

export async function handleAcknowledge(input: AcknowledgeInput, storage: StorageAdapter) {
  return runTransition(input, storage, 'acknowledge', 'acknowledge')
}
