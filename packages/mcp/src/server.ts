import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { StorageAdapter } from 'web-remarq'
import { parseEnv, ConfigError } from './config.js'
import { createStorage } from './storage-factory.js'
import { FileStorageAdapter } from './file-storage-adapter.js'
import { startHttpServer } from './http-server.js'
import { TaskFolder } from './task-folder.js'
import { registerPrompts } from './prompts.js'
import { registerTools, type WaitForChange } from './tools/index.js'

const CLOUD_POLL_MS = 3000

async function main(): Promise<void> {
  let config
  try {
    config = parseEnv(process.env)
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[web-remarq-mcp] config error: ${err.message}`)
      process.exit(1)
    }
    throw err
  }

  let storage: StorageAdapter
  let waitForChange: WaitForChange

  if (config.mode === 'local') {
    const adapter = new FileStorageAdapter(config.dataFile)
    const tasksDir = join(dirname(config.dataFile), 'tasks')
    const taskFolder = new TaskFolder(adapter, tasksDir)
    adapter.onChange(() => taskFolder.schedule())
    taskFolder.schedule() // project existing annotations on startup
    await startHttpServer(adapter, config.port)
    console.error(
      `[web-remarq-mcp] local mode — widget endpoint http://127.0.0.1:${config.port}, store ${config.dataFile}, tasks ${tasksDir}`,
    )
    storage = adapter
    waitForChange = (ms) => adapter.waitForChange(ms)
  } else {
    storage = createStorage(config)
    waitForChange = (ms) =>
      new Promise((resolve) => setTimeout(() => resolve(false), Math.min(ms, CLOUD_POLL_MS)))
  }

  const server = new McpServer({
    name: 'web-remarq',
    version: '0.2.0',
  })

  registerTools(server, storage, { waitForChange })
  registerPrompts(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[web-remarq-mcp] fatal:', err)
  process.exit(1)
})
