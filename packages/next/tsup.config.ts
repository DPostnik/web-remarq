import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/loader.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['@web-remarq/next/loader', '@swc/core', '@web-remarq/swc-plugin'],
})
