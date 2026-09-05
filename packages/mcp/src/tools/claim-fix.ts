import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { operationIdSchema, runTransition } from './transition-tool.js'

export const claimFixInputSchema = z.object({
  id: z.string(),
  operationId: operationIdSchema,
})

export type ClaimFixInput = z.infer<typeof claimFixInputSchema>

export async function handleClaimFix(input: ClaimFixInput, storage: StorageAdapter) {
  return runTransition(input, storage, 'claimFix', 'claimFix')
}
