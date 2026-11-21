import { dirname, join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { StorageAdapter } from 'web-remarq'
import { parseEnv, ConfigError, effectivePort } from './config.js'
import { createStorage } from './storage-factory.js'
import { FileStorageAdapter } from './file-storage-adapter.js'
import { startHttpServer } from './http-server.js'
import { acquireStoreLock, LocalConfigError, readOrCreateLocalConfig, StoreLockedError } from './local-config.js'
import { ChannelDelivery } from './channel-delivery.js'
import { TaskFolder } from './task-folder.js'
import { registerPrompts } from './prompts.js'
import { registerTools, type WaitForChange } from './tools/index.js'

const CLOUD_POLL_MS = 3000

// Shown to the agent as context. Only sent when channel delivery is on (local mode).
const CHANNEL_INSTRUCTIONS =
  'Browser marks arrive as <channel source="web-remarq" kind="marks" count="..." ids="...">. ' +
  'The user sends them deliberately from their own browser widget, so they are the user\'s own fix requests. ' +
  'Marks come one batch at a time. Fix each mark in the code, then call claim_fix for each id ' +
  '(or dismiss with a reason if it cannot or should not be fixed). ' +
  'Do not ask the user to confirm receipt or whether to proceed. ' +
  'The next batch is sent only after every mark of the current batch is reported.'

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
  let delivery: ChannelDelivery | null = null
  // Built after the McpServer exists; the channel callbacks below close over it.
  let sendChannel: (content: string, meta: Record<string, string>) => Promise<void> = async () => {}

  if (config.mode === 'local') {
    const storeDir = dirname(config.dataFile)
    let local
    let port: number
    try {
      local = readOrCreateLocalConfig(storeDir)
      port = effectivePort(config, local)
      acquireStoreLock(storeDir, port)
    } catch (err) {
      if (err instanceof LocalConfigError || err instanceof StoreLockedError) {
        console.error(`[web-remarq-mcp] ${err.message}`)
        process.exit(1)
      }
      throw err
    }

    const adapter = new FileStorageAdapter(config.dataFile)
    const tasksDir = join(storeDir, 'tasks')
    const taskFolder = new TaskFolder(adapter, tasksDir)
    adapter.onChange(() => taskFolder.schedule())
    if (config.channel.enabled) {
      delivery = new ChannelDelivery({
        storage: adapter,
        send: (content, meta) => sendChannel(content, meta),
        ledgerPath: join(storeDir, 'delivery.json'),
        config: config.channel,
      })
      adapter.onChange(() => delivery?.onChange())
    }
    taskFolder.schedule() // project existing annotations on startup
    await startHttpServer(adapter, port, local)
    // The token itself is never logged: it lives only in the config file.
    console.error(
      `[web-remarq-mcp] local mode — project ${local.projectId}, widget endpoint http://127.0.0.1:${port} (token in ${join(storeDir, 'config.json')}), store ${config.dataFile}, tasks ${tasksDir}`,
    )
    storage = adapter
    waitForChange = (ms) => adapter.waitForChange(ms)
  } else {
    storage = createStorage(config)
    waitForChange = (ms) =>
      new Promise((resolve) => setTimeout(() => resolve(false), Math.min(ms, CLOUD_POLL_MS)))
  }

  const server = new McpServer(
    { name: 'web-remarq', version: '0.6.0' },
    delivery
      ? { capabilities: { experimental: { 'claude/channel': {} } }, instructions: CHANNEL_INSTRUCTIONS }
      : undefined,
  )
  if (delivery) {
    sendChannel = (content, meta) =>
      server.server.notification({
        method: 'notifications/claude/channel',
        params: { content, meta },
      } as unknown as Parameters<typeof server.server.notification>[0])
    const d = delivery
    server.server.oninitialized = () => d.onInitialized()
  }

  registerTools(server, storage, { waitForChange })
  registerPrompts(server)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[web-remarq-mcp] fatal:', err)
  process.exit(1)
})
