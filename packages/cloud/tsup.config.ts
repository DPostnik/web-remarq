import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  target: 'es2017',
  dts: true,
  sourcemap: true,
  clean: true,
})
