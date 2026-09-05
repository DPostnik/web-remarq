import { createUnplugin } from 'unplugin'
import { relative } from 'path'
import { createFilter, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './filter'
import { CONFIG_ENDPOINT, readLocalConfig } from './local-config'
import { transformJSX, transformVueSFC } from './transform'

export interface Options {
  /**
   * Glob patterns for files to include. Supports `**`, `*`, `?` and brace groups
   * (`src/**\/*.{jsx,tsx}`). Default: ['**\/*.jsx', '**\/*.tsx', '**\/*.vue']
   */
  include?: string[]
  /** Glob patterns for files to exclude. Default: ['node_modules/**'] */
  exclude?: string[]
  /** Enable in production builds. Default: false */
  production?: boolean
}

const unplugin = createUnplugin((options: Options = {}) => {
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const filter = createFilter(include, exclude)

  return {
    name: 'web-remarq',
    enforce: 'pre',

    transformInclude(id) {
      // Dev-only by default
      if (!options.production && process.env.NODE_ENV === 'production') return false
      return filter(id)
    },

    transform(code, id) {
      const cwd = process.cwd()
      const filePath = relative(cwd, id).split('\\').join('/')

      if (id.endsWith('.vue')) {
        return transformVueSFC(code, filePath) ?? undefined
      }

      return transformJSX(code, filePath) ?? undefined
    },

    vite: {
      /**
       * Development-only pairing endpoint. The widget (HttpStorageAdapter) asks
       * the dev server for the local MCP token at GET /__web-remarq/config.json
       * so the credential never has to appear in source. Same-origin only: any
       * code running in the dev app could read it, which is the app itself.
       * The token is useless remotely - the MCP endpoint listens on 127.0.0.1.
       * Never registered in production builds (no dev server there anyway).
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configureServer(server: any) {
        if (!options.production && process.env.NODE_ENV === 'production') return
        const root: string = server.config?.root ?? process.cwd()
        server.middlewares.use(
          CONFIG_ENDPOINT,
          (req: { method?: string }, res: { statusCode: number; setHeader(n: string, v: string): void; end(b?: string): void }, next: () => void) => {
            if (req.method !== 'GET') return next()
            const config = readLocalConfig(root)
            res.setHeader('cache-control', 'no-store')
            if (!config) {
              res.statusCode = 404
              res.end()
              return
            }
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(config))
          },
        )
      },
    },
  }
})

export default unplugin

// Framework-specific exports
export const vitePlugin = unplugin.vite
export const rollupPlugin = unplugin.rollup
export const webpackPlugin = unplugin.webpack
export const esbuildPlugin = unplugin.esbuild
export const rspackPlugin = unplugin.rspack

export { transformJSX, transformVueSFC } from './transform'
export { createFilter, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './filter'
