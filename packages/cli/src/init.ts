import { detect } from './detect'
import { buildInstallCommand, packagesFor } from './install'
import { writeMcpConfig } from './mcp-config'
import { ensureLocalConfig } from './local-config'
import { buildEdits } from './snippets'
import { injectScriptTag } from './vanilla'
import type { Detection, Edit } from './types'

export interface InitOptions {
  app?: string
  /** Stdout carries a JSON payload: install output must go to stderr only. */
  quiet?: boolean
}

export interface InitDeps {
  /**
   * Run a shell command in `cwd`. Injected so tests never touch the network.
   * `quiet` asks for the command's stdout to be suppressed - set when the CLI's
   * own stdout is a machine-readable payload (`--json`) that a package
   * manager's progress output must not interleave with.
   */
  exec(cmd: string, cwd: string, quiet: boolean): void
}

export type InitResult =
  | {
      ok: true
      detected: Detection
      installed: string[]
      wroteMcpConfig: boolean
      /** True when .remarq/config.json (project id + local token) was created by this run. */
      wroteLocalConfig: boolean
      edits: Edit[]
      next: 'doctor'
    }
  | { ok: false; reason: string; hint: string; candidates?: string[] }

export function runInit(cwd: string, opts: InitOptions, deps: InitDeps): InitResult {
  const detection = detect(cwd, opts)
  if (!detection.ok) return detection

  const d = detection.detection
  const packages = packagesFor(d)
  if (packages.length > 0) {
    deps.exec(buildInstallCommand(d, packages), d.repoRoot, opts.quiet ?? false)
  }

  const wroteMcpConfig = writeMcpConfig(d.repoRoot)
  const wroteLocalConfig = ensureLocalConfig(d.repoRoot)

  // Plain HTML has no build config and no module entry: the CLI does the whole
  // job itself, because inserting a script tag before </body> is deterministic.
  if (d.framework === 'plain-html') {
    injectScriptTag(d)
  }

  return {
    ok: true,
    detected: d,
    installed: packages,
    wroteMcpConfig,
    wroteLocalConfig,
    edits: buildEdits(d),
    next: 'doctor',
  }
}
