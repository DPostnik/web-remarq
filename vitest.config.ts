import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core/vitest.config.ts',
      'packages/unplugin/vitest.config.ts',
      'packages/babel-plugin/vitest.config.ts',
      'packages/next/vitest.config.ts',
      'packages/cloud/vitest.config.ts',
      'packages/mcp/vitest.config.ts',
    ],
  },
});
