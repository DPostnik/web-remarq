import { detect } from './detect'
import { buildInstallCommand, packagesFor } from './install'
import { writeMcpConfig } from './mcp-config'
import { buildEdits } from './snippets'
import { injectScriptTag } from './vanilla'
import type { Detection, Edit } from './types'

export interface InitOptions {
  app?: string
}

export interface InitDeps {
  /** Run a shell command in `cwd`. Injected so tests never touch the network. */
  exec(cmd: string, cwd: string): void
}

export type InitResult =
  | {
      ok: true
      detected: Detection
      installed: string[]
      wroteMcpConfig: boolean
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
    deps.exec(buildInstallCommand(d, packages), d.repoRoot)
  }

  const wroteMcpConfig = writeMcpConfig(d.repoRoot)

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
    edits: buildEdits(d),
    next: 'doctor',
  }
}
