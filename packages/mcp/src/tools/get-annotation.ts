import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { generateAgentExport } from 'web-remarq/core'
import { toolError, toolSuccess } from '../errors'

export const getAnnotationInputSchema = z.object({
  id: z.string(),
})

export type GetAnnotationInput = z.infer<typeof getAnnotationInputSchema>

export async function handleGetAnnotation(input: GetAnnotationInput, storage: StorageAdapter) {
  let store
  try {
    store = await storage.load()
  } catch (err) {
    return toolError('storage_error', err instanceof Error ? err.message : String(err))
  }
  const annotation = store?.annotations.find((a) => a.id === input.id)
  if (!annotation) {
    return toolError('annotation_not_found', `Annotation ${input.id} not found in this project`)
  }

  // Reuse core agent-export to build the rich shape (source + searchHints + lifecycle).
  // generateAgentExport takes an array — pass the single annotation, then extract.
  const agentExport = generateAgentExport([annotation], annotation.viewportBucket)
  const agentAnnotation = agentExport.annotations[0]

  return toolSuccess(agentAnnotation)
}
