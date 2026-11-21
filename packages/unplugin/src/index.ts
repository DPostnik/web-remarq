import { createUnplugin } from 'unplugin'
import { relative } from 'path'
import { createFilter, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './filter'
import { CONFIG_ENDPOINT, readLocalConfig, resolveAgentRoot } from './local-config'
import { transformJSX, transformVueSFC } from './transform'
import { WIDGET_MODULE_ID, WIDGET_RESOLVED_ID, WIDGET_SCRIPT_SRC, canResolveWidgetPackage, widgetModuleSource, type WidgetOptions } from './widget'

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
  /**
   * Vite dev only: inject the widget into index.html so no manual `init` is needed.
   * `true` = simple mode with the local MCP server (`HttpStorageAdapter`).
   * Pass an object to set `simple`, `position` or `theme`. Default: false.
   * Never injected in builds, whatever `production` says. SPA index.html only (no SSR).
   */
  widget?: boolean | WidgetOptions
}

const unplugin = createUnplugin((options: Options = {}) => {
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const filter = createFilter(include, exclude)
  const widgetOn = (): boolean => !!options.widget && process.env.NODE_ENV !== 'production'
  let warnedMissing = false
  let viteRoot: string | undefined
  let agentRoot: string | undefined

  return {
    name: 'web-remarq',
    enforce: 'pre',

    transformInclude(id) {
      // Dev-only by default
      if (!options.production && process.env.NODE_ENV === 'production') return false
      return filter(id)
    },

    transform(code, id) {
      // Paths are relative to where the agent works (the `.remarq/` or git root),
      // not to where the bundler was launched, so they resolve in a monorepo too.
      agentRoot ??= resolveAgentRoot(viteRoot ?? process.cwd())
      const filePath = relative(agentRoot, id).split('\\').join('/')

      if (id.endsWith('.vue')) {
        return transformVueSFC(code, filePath) ?? undefined
      }

      return transformJSX(code, filePath) ?? undefined
    },

    vite: {
      configResolved(config: { root: string }) {
        viteRoot = config.root
      },

      resolveId(id: string) {
        return widgetOn() && id === WIDGET_MODULE_ID ? WIDGET_RESOLVED_ID : undefined
      },

      load(id: string) {
        return widgetOn() && id === WIDGET_RESOLVED_ID ? widgetModuleSource(options.widget) : undefined
      },

      // `ctx.server` exists only on the dev server, so a build never injects.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformIndexHtml(_html: string, ctx: any) {
        const server = ctx?.server
        if (!widgetOn() || !server) return undefined
        const root: string = server.config?.root ?? process.cwd()
        if (!canResolveWidgetPackage(root)) {
          if (!warnedMissing) {
            warnedMissing = true
            const message = '[web-remarq] widget: the "web-remarq" package is not installed in this project, so the widget was not injected. Run: npm install web-remarq'
            if (server.config?.logger?.warn) server.config.logger.warn(message)
            else console.warn(message)
          }
          return undefined
        }
        return [{ tag: 'script', attrs: { type: 'module', src: WIDGET_SCRIPT_SRC }, injectTo: 'body' as const }]
      },

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
export type { WidgetOptions } from './widget'
export { createFilter, DEFAULT_EXCLUDE, DEFAULT_INCLUDE } from './filter'
