import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { transition, InvalidTransitionError } from 'web-remarq/core'
import { toolError, toolSuccess } from '../errors'

export const acknowledgeInputSchema = z.object({
  id: z.string(),
})

export type AcknowledgeInput = z.infer<typeof acknowledgeInputSchema>

export async function handleAcknowledge(input: AcknowledgeInput, storage: StorageAdapter) {
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

  let result
  try {
    result = transition(annotation, 'acknowledge', { actor: 'agent' })
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return toolError('invalid_transition', err.message, {
        currentStatus: annotation.status,
        requestedTransition: 'acknowledge',
      })
    }
    throw err
  }

  const updated = {
    ...annotation,
    status: result.status,
    lifecycle: [...annotation.lifecycle, result.event],
  }

  try {
    await storage.save(updated)
  } catch (err) {
    return toolError('storage_error', err instanceof Error ? err.message : String(err))
  }

  return toolSuccess({ ok: true, status: result.status })
}
