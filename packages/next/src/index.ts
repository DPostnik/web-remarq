export interface RemarqOptions {
  /** Enable in production builds. Default: false */
  production?: boolean;
}

/**
 * Detect the installed Next.js major version.
 * Returns 0 if detection fails.
 */
function getNextMajorVersion(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nextPkg = require("next/package.json");
    const major = parseInt(nextPkg.version.split(".")[0], 10);
    return isNaN(major) ? 0 : major;
  } catch {
    return 0;
  }
}

const LOADER_PATH = require.resolve("@web-remarq/next/loader");

const JSX_TEST = /\.(jsx|tsx)$/;

/**
 * Wrap your Next.js config to enable web-remarq source location injection.
 * Works across Next.js 13–16+ with automatic strategy detection.
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
  const { production = false } = options;

  // Skip in production unless explicitly opted in
  if (!production && process.env.NODE_ENV === "production") {
    return nextConfig;
  }

  const nextMajor = getNextMajorVersion();

  const loaderConfig = { loader: LOADER_PATH, options: {} };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Record<string, any> = { ...nextConfig };

  // Webpack config — works on Next 13–16
  const existingWebpack = nextConfig.webpack;
  result.webpack = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ctx: any,
  ) => {
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: JSX_TEST,
      exclude: /node_modules/,
      use: [loaderConfig],
    });

    if (typeof existingWebpack === "function") {
      return existingWebpack(config, ctx);
    }
    return config;
  };

  // Turbopack config — available from Next 14+
  if (nextMajor >= 16) {
    // Next 16+: top-level turbopack.rules (stable)
    const existingTurbopack = (nextConfig.turbopack ?? {}) as Record<
      string,
      unknown
    >;
    const existingRules = (existingTurbopack.rules ?? {}) as Record<
      string,
      unknown
    >;
    result.turbopack = {
      ...existingTurbopack,
      rules: {
        ...existingRules,
        "*.{jsx,tsx}": { loaders: [loaderConfig] },
      },
    };
  } else if (nextMajor >= 14) {
    // Next 14–15.x: experimental.turbo.rules
    const existingExperimental = (nextConfig.experimental ?? {}) as Record<
      string,
      unknown
    >;
    const existingTurbo = (existingExperimental.turbo ?? {}) as Record<
      string,
      unknown
    >;
    const existingRules = (existingTurbo.rules ?? {}) as Record<
      string,
      unknown
    >;
    result.experimental = {
      ...existingExperimental,
      turbo: {
        ...existingTurbo,
        rules: {
          ...existingRules,
          "*.{jsx,tsx}": { loaders: [loaderConfig] },
        },
      },
    };
  }
  // Next 13: no turbopack loader support — webpack only

  return result as T;
}

export default withRemarq;
export { withRemarq };
