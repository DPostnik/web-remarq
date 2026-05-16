#!/usr/bin/env node
import('../dist/server.js').catch((err) => {
  console.error('[web-remarq-mcp] fatal:', err)
  process.exit(1)
})
