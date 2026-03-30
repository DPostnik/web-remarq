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
function withRemarq(
  nextConfig: Record<string, unknown> = {},
  options: RemarqOptions = {},
): Record<string, unknown> {
  const { production = false } = options

  // Don't add the plugin at all in production (avoids loading WASM for nothing)
  if (!production && process.env.NODE_ENV === 'production') {
    return nextConfig
  }

  const existingExperimental = (nextConfig.experimental ?? {}) as Record<string, unknown>
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
  }
}

export default withRemarq
export { withRemarq }
