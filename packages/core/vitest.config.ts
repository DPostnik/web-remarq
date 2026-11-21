import { defineConfig } from 'vitest/config';

// Standalone runs (cd packages/core && vitest) need the same Node 25 workaround
// as the root config: the experimental global localStorage shadows jsdom's.
const [major, minor] = process.versions.node.split('.').map(Number);
const hasWebStorage = major > 22 || (major === 22 && minor >= 4);
const execArgv = hasWebStorage ? ['--no-experimental-webstorage'] : [];

export default defineConfig({
  test: {
    poolOptions: {
      forks: { execArgv },
      threads: { execArgv },
    },
    name: 'core',
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: [
        'src/core/index.ts',
        'src/core/types.ts',
        'src/core/source-detect.ts', // out of scope for v0.5.0
        '**/*.test.ts',
        '**/dist/**',
        '**/target/**',
        '**/node_modules/**',
      ],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
  },
});
