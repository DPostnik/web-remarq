export interface RemarqOptions {
  /** Enable in production builds. Default: false */
  production?: boolean
}

/**
 * Wrap your Next.js config to enable web-remarq source location injection.
 *
 * @example
 * ```ts
 * // next.config.ts
 * import withRemarq from '@web-remarq/next'
 * export default withRemarq({})
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withRemarq<T extends Record<string, any>>(
  nextConfig: T = {} as T,
  options: RemarqOptions = {},
): T {
  const { production = false } = options

  // Don't add the plugin at all in production (avoids loading WASM for nothing)
  if (!production && process.env.NODE_ENV === 'production') {
    return nextConfig
  }

  const existingExperimental = (nextConfig.experimental ?? {}) as Record<string, any>
  const existingPlugins = (existingExperimental.swcPlugins ?? []) as unknown[]

  return {
    ...nextConfig,
    experimental: {
      ...existingExperimental,
      swcPlugins: [
        ...existingPlugins,
        ['@web-remarq/swc-plugin', {}],
      ],
    },
  } as T
}

export default withRemarq
export { withRemarq }
