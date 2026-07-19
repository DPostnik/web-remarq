import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vite: 'src/vite.ts',
    webpack: 'src/webpack.ts',
    rollup: 'src/rollup.ts',
    esbuild: 'src/esbuild.ts',
    rspack: 'src/rspack.ts',
    transform: 'src/transform-entry.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  external: ['@babel/parser'],
})
