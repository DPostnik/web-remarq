import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { entryCallsInit } from './checks'
import { SESSION_COMMAND, writeClaudeSettings } from './claude-settings'
import { detect } from './detect'
import { buildInstallCommand, missingPackages } from './install'
import { writeMcpConfig } from './mcp-config'
import { ensureLocalConfig } from './local-config'
import { repoRelative, viteConfigEdit } from './snippets'
import { setUpNextConfig } from './next-config'
import { injectScriptTag } from './vanilla'
import { editViteConfig } from './vite-config'
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
      /** True when .remarq/config.json (project id + local token) was created by this run. */
      wroteLocalConfig: boolean
      /** .claude/settings.local.json: changed by this run, and the permission mode sessions start in. */
      claudeSettings: { changed: boolean; defaultMode: string; defaultModeSet: boolean }
      /** App files this run edited itself. */
      edited: AutoEdit[]
      /** Edits init could not apply - only these are left to do by hand. */
      edits: Edit[]
      /** Run in the repo root to start a Claude Code session that receives marks. */
      sessionCommand: string
      next: 'doctor'
    }
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
  const packages = missingPackages(d)
  if (packages.length > 0) {
    deps.exec(buildInstallCommand(d, packages), d.repoRoot, opts.quiet ?? false)
  }

  const wroteMcpConfig = writeMcpConfig(d.repoRoot)
  const wroteLocalConfig = ensureLocalConfig(d.repoRoot)

  let setup: { edited: AutoEdit[]; edits: Edit[] }
  if (d.framework === 'next') {
    setup = setUpNextConfig(d)
  } else if (d.framework === 'plain-html') {
    // Inserting a script tag before </body> is deterministic, so plain HTML needs no manual edit.
    setup = {
      edited: injectScriptTag(d) ? [{ file: repoRelative(d, d.entry ?? 'index.html'), change: 'added the widget script tag before </body>' }] : [],
      edits: [],
    }
  } else {
    setup = setUpViteConfig(d)
  }

  const claudeSettings = writeClaudeSettings(d.repoRoot)

  return {
    ok: true,
    detected: d,
    installed: packages,
    wroteMcpConfig,
    wroteLocalConfig,
    claudeSettings,
    ...setup,
    sessionCommand: SESSION_COMMAND,
    next: 'doctor',
  }
}
