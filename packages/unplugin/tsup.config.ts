import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/vite.ts',
    'src/webpack.ts',
    'src/rollup.ts',
    'src/esbuild.ts',
    'src/rspack.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  external: ['@babel/parser'],
})
