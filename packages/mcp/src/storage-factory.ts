import { createCloudStorage } from '@web-remarq/cloud'
import type { StorageAdapter } from 'web-remarq'
import type { MCPConfig } from './config'

export function createStorage(config: MCPConfig): StorageAdapter {
  return createCloudStorage({
    projectKey: config.projectKey,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    onError: 'throw',
  })
}
