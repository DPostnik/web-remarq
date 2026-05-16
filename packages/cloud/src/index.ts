import type { StorageAdapter } from 'web-remarq'
import type { CloudStorageOptions } from './types'

export { generateProjectKey, hashProjectKey } from './project-key'
export type { CloudStorageOptions } from './types'

export function createCloudStorage(opts: CloudStorageOptions): StorageAdapter {
  throw new Error('createCloudStorage: not implemented yet (Task 6)')
}
