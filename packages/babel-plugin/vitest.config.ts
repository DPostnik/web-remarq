import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'babel-plugin',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
