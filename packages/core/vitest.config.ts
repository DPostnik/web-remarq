import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
