import { z } from 'zod'
import type { StorageAdapter } from 'web-remarq'
import { toolError, toolSuccess } from '../errors'
import { toThin } from './list-annotations.js'

/** Waits up to timeoutMs for a backend change. Local mode resolves early on
 *  mutation events; cloud mode just sleeps a poll interval and returns false. */
export type WaitForChange = (timeoutMs: number) => Promise<boolean>

const DEFAULT_TIMEOUT_SECONDS = 25

export const watchAnnotationsInputSchema = z.object({
  timeoutSeconds: z.number().int().min(1).max(120).optional(),
})

export type WatchAnnotationsInput = z.infer<typeof watchAnnotationsInputSchema>

export async function handleWatchAnnotations(
  input: WatchAnnotationsInput,
  storage: StorageAdapter,
  waitForChange: WaitForChange,
) {
  const timeoutMs = (input.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const deadline = Date.now() + timeoutMs

  for (;;) {
    let store
    try {
      store = await storage.load()
    } catch (err) {
      return toolError('storage_error', err instanceof Error ? err.message : String(err))
    }

    const pending = (store?.annotations ?? []).filter((a) => a.status === 'pending')
    if (pending.length > 0) {
      return toolSuccess({ annotations: pending.map(toThin), total: pending.length, timedOut: false })
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return toolSuccess({ annotations: [], total: 0, timedOut: true })
    }

    await waitForChange(remaining)
  }
}
