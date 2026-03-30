import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    target: 'es2017',
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { 'web-remarq.global': 'src/index.ts' },
    format: ['iife'],
    target: 'es2017',
    globalName: 'WebRemarq',
    sourcemap: true,
  },
  {
    entry: { 'core/index': 'src/core/index.ts' },
    format: ['esm', 'cjs'],
    target: 'es2017',
    dts: true,
    sourcemap: true,
  },
])
