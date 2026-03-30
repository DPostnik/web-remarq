import { createUnplugin } from 'unplugin'
import { relative } from 'path'
import { transformJSX, transformVueSFC } from './transform'

export interface Options {
  /** Glob patterns for files to include. Default: ['**\/*.jsx', '**\/*.tsx', '**\/*.vue'] */
  include?: string[]
  /** Glob patterns for files to exclude. Default: ['node_modules/**'] */
  exclude?: string[]
  /** Enable in production builds. Default: false */
  production?: boolean
}

const DEFAULT_INCLUDE = ['**/*.jsx', '**/*.tsx', '**/*.vue']
const DEFAULT_EXCLUDE = ['node_modules/**']

function createFilter(include: string[], exclude: string[]): (id: string) => boolean {
  // Simple glob matching without picomatch dependency
  function toRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '§GLOBSTAR§')
      .replace(/\*/g, '[^/]*')
      .replace(/§GLOBSTAR§/g, '.*')
      .replace(/\?/g, '[^/]')
    return new RegExp(`(?:^|/)${escaped}$`)
  }

  const includePatterns = include.map(toRegex)
  const excludePatterns = exclude.map(toRegex)

  return (id: string) => {
    const normalized = id.split('\\').join('/')
    if (excludePatterns.some(re => re.test(normalized))) return false
    return includePatterns.some(re => re.test(normalized))
  }
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
  }
})

export default unplugin

// Framework-specific exports
export const vitePlugin = unplugin.vite
export const rollupPlugin = unplugin.rollup
export const webpackPlugin = unplugin.webpack
export const esbuildPlugin = unplugin.esbuild
export const rspackPlugin = unplugin.rspack
