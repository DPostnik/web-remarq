import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { server: 'src/server.ts' },
  format: ['esm'],
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
