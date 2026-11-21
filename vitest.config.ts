import { defineConfig } from 'vitest/config';

// Node 22.4+ ships an experimental global `localStorage` that shadows the jsdom
// one (`localStorage.clear` is missing). Disable it in the test workers; the
// flag only exists on Node versions that have the feature, so gate on version.
const [major, minor] = process.versions.node.split('.').map(Number);
const hasWebStorage = major > 22 || (major === 22 && minor >= 4);
const execArgv = hasWebStorage ? ['--no-experimental-webstorage'] : [];

export default defineConfig({
  test: {
    poolOptions: {
      forks: { execArgv },
      threads: { execArgv },
    },
    projects: [
      'packages/core/vitest.config.ts',
      'packages/unplugin/vitest.config.ts',
      'packages/babel-plugin/vitest.config.ts',
      'packages/next/vitest.config.ts',
      'packages/cloud/vitest.config.ts',
      'packages/mcp/vitest.config.ts',
      'packages/cli/vitest.config.ts',
    ],
  },
});
