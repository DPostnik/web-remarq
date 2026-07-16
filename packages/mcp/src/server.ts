import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseEnv, ConfigError } from './config.js'
import { createStorage } from './storage-factory.js'
import { registerTools } from './tools/index.js'

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

  if (config.mode !== 'cloud') {
    console.error('[web-remarq-mcp] local mode not yet supported')
    process.exit(1)
  }

  const storage = createStorage(config)
  const server = new McpServer({
    name: 'web-remarq',
    version: '0.1.0',
  })

  registerTools(server, storage)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[web-remarq-mcp] fatal:', err)
  process.exit(1)
})
