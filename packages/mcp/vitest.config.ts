import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'mcp',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', '**/*.test.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
})
