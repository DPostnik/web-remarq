import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    name: 'next',
    include: [resolve(__dirname, 'test/**/*.test.ts')],
    environment: 'node',
  },
});
