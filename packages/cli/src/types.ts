export type Framework = 'next' | 'vue' | 'react' | 'vanilla-vite' | 'plain-html'
export type Bundler = 'next' | 'vite' | null
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type PluginName = '@web-remarq/unplugin' | '@web-remarq/next'

export interface Detection {
  framework: Framework
  bundler: Bundler
  packageManager: PackageManager
  /** Absolute path to the git repository root (or cwd when there is no .git). */
  repoRoot: string
  /** Absolute path to the app package. Equals repoRoot outside a monorepo. */
  appDir: string
  /** Path to the build config, relative to appDir. Null in plain-html mode. */
  configFile: string | null
  /** Path to the entry point, relative to appDir. Null when not found. */
  entry: string | null
  plugin: PluginName | null
  includeGlob: string[] | null
}

export type DetectResult =
  | { ok: true; detection: Detection }
  | { ok: false; reason: string; hint: string; candidates?: string[] }

export type EditKind = 'build-config' | 'entry'

export interface Edit {
  /** Path relative to repoRoot, so the agent can open it directly. */
  file: string
  kind: EditKind
  snippet: string
  note?: string
}

export type CheckStatus = 'ok' | 'fail' | 'blocked' | 'skipped'

export interface CheckResult {
  id: 'packages' | 'build-plugin' | 'widget-init' | 'mcp-config' | 'mcp-server'
  status: CheckStatus
  detail: string
  hint?: string
}
