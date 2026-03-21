import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { 'web-remarq.global': 'src/index.ts' },
    format: ['iife'],
    globalName: 'WebRemarq',
    sourcemap: true,
  },
  {
    entry: { 'core/index': 'src/core/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
  },
])
