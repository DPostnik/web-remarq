import { transform } from '@swc/core'
import path from 'path'

interface LoaderContext {
  async(): (err: Error | null, code?: string, map?: string) => void
  resourcePath: string
  rootContext: string
}

const WASM_PATH = require.resolve('@web-remarq/swc-plugin')

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
    .then((result) => callback(null, result.code, result.map))
    .catch((err) => callback(err))
}
