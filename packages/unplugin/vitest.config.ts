import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'unplugin',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/{vite,webpack,rollup,esbuild,rspack}.ts', 'src/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
