import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { entryCallsInit } from './checks'
import { SESSION_COMMAND, writeClaudeSettings } from './claude-settings'
import { detect } from './detect'
import { buildInstallCommand, missingPackages } from './install'
import { writeMcpConfig } from './mcp-config'
import { ensureLocalConfig, readLocalAgent } from './local-config'
import { repoRelative, viteConfigEdit } from './snippets'
import { setUpNextConfig } from './next-config'
import { injectScriptTag } from './vanilla'
import { editViteConfig } from './vite-config'
import type { Agent, Detection, Edit } from './types'

export const CODEX_SESSION_COMMAND = 'npx @web-remarq/cli start --agent codex'

export interface InitOptions {
  app?: string
  agent?: Agent
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

/** A file init changed on its own. */
export interface AutoEdit {
  /** Path relative to repoRoot. */
  file: string
  change: string
}

export type InitResult =
  | {
      ok: true
      detected: Detection
      /** Packages this run installed; ones already in package.json are skipped. */
      installed: string[]
      wroteMcpConfig: boolean
      /** True when .remarq/config.json was created or the active agent changed. */
      wroteLocalConfig: boolean
      /** App files this run edited itself. */
      edited: AutoEdit[]
      /** Edits init could not apply - only these are left to do by hand. */
      edits: Edit[]
      /** Run in the repo root to start an agent session that receives marks. */
      sessionCommand: string
      next: 'doctor'
    } & (
      | { agent: 'claude'; claudeSettings: ReturnType<typeof writeClaudeSettings> }
      | { agent: 'codex' }
    )
  | { ok: false; reason: string; hint: string; candidates?: string[] }

/** Register the plugin in the Vite config, or explain why that is left to do by hand. */
function setUpViteConfig(d: Detection): { edited: AutoEdit[]; edits: Edit[] } {
  // An entry that already calls WebRemarq.init starts the widget itself; widget: true would start a second one.
  const widget = !entryCallsInit(d)
  if (!d.configFile) return { edited: [], edits: [viteConfigEdit(d, widget, 'no Vite config file found')] }

  const path = join(d.appDir, d.configFile)
  const result = editViteConfig(readFileSync(path, 'utf8'), d.includeGlob ?? [], widget)
  if (result.kind === 'manual') return { edited: [], edits: [viteConfigEdit(d, widget, result.reason)] }
  if (result.kind === 'unchanged') return { edited: [], edits: [] }

  writeFileSync(path, result.content, 'utf8')
  const change =
    result.change === 'widget-added'
      ? 'added widget: true to the remarq() call'
      : widget
        ? 'registered remarq({ widget: true }) at the end of plugins'
        : `registered remarq() at the end of plugins, without widget: true because ${d.entry} already calls WebRemarq.init`
  return { edited: [{ file: repoRelative(d, d.configFile), change }], edits: [] }
}

export function runInit(cwd: string, opts: InitOptions, deps: InitDeps): InitResult {
  const detection = detect(cwd, opts)
  if (!detection.ok) return detection

  const d = detection.detection
  const agent = opts.agent ?? readLocalAgent(d.repoRoot) ?? 'claude'
  const packages = missingPackages(d)
  if (packages.length > 0) {
    deps.exec(buildInstallCommand(d, packages), d.repoRoot, opts.quiet ?? false)
  }

  const wroteMcpConfig = agent === 'claude' && writeMcpConfig(d.repoRoot)
  const wroteLocalConfig = ensureLocalConfig(d.repoRoot, opts.agent)

  let setup: { edited: AutoEdit[]; edits: Edit[] }
  if (d.framework === 'next') {
    setup = setUpNextConfig(d)
  } else if (d.framework === 'plain-html') {
    // Inserting a script tag before </body> is deterministic, so plain HTML needs no manual edit.
    setup = {
      edited: injectScriptTag(d, agent)
        ? [{ file: repoRelative(d, d.entry ?? 'index.html'), change: 'configured the widget script tag before </body>' }]
        : [],
      edits: [],
    }
  } else {
    setup = setUpViteConfig(d)
  }

  const result = {
    ok: true as const,
    detected: d,
    installed: packages,
    wroteMcpConfig,
    wroteLocalConfig,
    ...setup,
    sessionCommand: agent === 'codex' ? CODEX_SESSION_COMMAND : SESSION_COMMAND,
    next: 'doctor' as const,
  }
  return agent === 'claude' ? { ...result, agent, claudeSettings: writeClaudeSettings(d.repoRoot) } : { ...result, agent }
}
