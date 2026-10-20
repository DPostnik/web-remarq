import { transform } from '@swc/core'
import { createRequire } from 'node:module'
import path from 'node:path'

/** Source map in the object form webpack and Turbopack accept from a loader. */
export type LoaderSourceMap = Record<string, unknown>

interface LoaderContext {
  async(): (err: Error | null, code?: string, map?: LoaderSourceMap) => void
  resourcePath: string
  rootContext: string
}

// Works in both output formats; the ESM bundle has no `require.resolve`.
const nodeRequire = createRequire(import.meta.url)
const WASM_PATH = nodeRequire.resolve('@web-remarq/swc-plugin')

/**
 * SWC returns the map as a JSON string. Next 15 under webpack passes a loader
 * map straight to its own source-map handling and expects an object, so a
 * string made every page fail with a 500. Hand over an object (or nothing).
 */
export function parseSourceMap(map: string | undefined): LoaderSourceMap | undefined {
  if (!map) return undefined
  try {
    const parsed: unknown = JSON.parse(map)
    return parsed && typeof parsed === 'object' ? (parsed as LoaderSourceMap) : undefined
  } catch {
    return undefined
  }
}

export default function remarqLoader(this: LoaderContext, source: string) {
  const callback = this.async()

  const filePath = path.relative(this.rootContext, this.resourcePath).replace(/\\/g, '/')

  transform(source, {
    filename: this.resourcePath,
    sourceMaps: true,
    jsc: {
      target: 'esnext',
      parser: filePath.endsWith('.tsx')
        ? { syntax: 'typescript', tsx: true }
        : filePath.endsWith('.ts')
          ? { syntax: 'typescript', tsx: false }
          : { syntax: 'ecmascript', jsx: true },
      transform: {
        react: {
          runtime: 'automatic',
        },
      },
      experimental: {
        plugins: [[WASM_PATH, {}]],
      },
    },
  })
    .then((result) => callback(null, result.code, parseSourceMap(result.map)))
    .catch((err: Error) => callback(err))
}
