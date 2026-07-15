import type { StorageAdapter } from 'web-remarq'
import { CloudStorageAdapter } from './cloud-storage-adapter'
import type { CloudStorageOptions } from './types'

export { generateProjectKey, hashProjectKey } from './project-key'
export { CloudStorageAdapter } from './cloud-storage-adapter'
export type { CloudStorageOptions } from './types'
export { preflightCheck, createPreflightChecker } from './preflight'
export type {
  PreflightInput,
  PreflightConfig,
  LLMClient,
  QualityCheck,
} from './preflight'

export function createCloudStorage(opts: CloudStorageOptions): StorageAdapter {
  return new CloudStorageAdapter(opts)
}
