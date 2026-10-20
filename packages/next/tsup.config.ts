import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/loader.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // Provides `import.meta.url` in the CJS build so `createRequire` works in both formats.
  shims: true,
  external: ['@web-remarq/next/loader', '@swc/core', '@web-remarq/swc-plugin'],
})
