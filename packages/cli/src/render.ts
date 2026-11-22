import { CLAUDE_SETTINGS_PATH } from './claude-settings'
import type { InitResult } from './init'
import type { DoctorReport } from './doctor'
import type { Agent, CheckStatus } from './types'

const SYMBOL: Record<CheckStatus, string> = {
  ok: '✔',
  fail: '✖',
  blocked: '⏸',
  skipped: '–',
}

const NUMBER_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five']

function countWord(n: number): string {
  return NUMBER_WORD[n] ?? String(n)
}

/** Shared by `renderInit` and `renderDoctor` for their `ok: false` branches. */
function renderFailure(reason: string, hint: string, candidates?: string[]): string {
  const lines = [`✖ ${reason}`, `  ${hint}`]
  if (candidates?.length) {
    lines.push('', 'Candidates:', ...candidates.map((c) => `  ${c}`))
  }
  return lines.join('\n')
}

export function renderInit(result: InitResult): string {
  if (!result.ok) return renderFailure(result.reason, result.hint, result.candidates)

  const d = result.detected
  const stack = d.bundler ? `${d.framework} + ${d.bundler}` : d.framework
  const settings = result.agent === 'claude' ? result.claudeSettings : undefined
  const autoAccept = settings?.defaultMode === 'acceptEdits'
  const lines = [
    `✔ detected     ${stack} (${d.packageManager})`,
    result.installed.length > 0
      ? `✔ installed    ${result.installed.join(', ')}`
      : '– installed    nothing to install (already in package.json)',
    ...(result.agent === 'codex'
      ? ['✔ mcp config   loaded by the Codex launcher']
      : [result.wroteMcpConfig ? '✔ wrote        .mcp.json (repo root)' : '✔ mcp config   already up to date']),
    result.wroteLocalConfig
      ? '✔ wrote        .remarq/config.json (local project settings)'
      : '✔ local config already present (.remarq/config.json)',
    ...(settings ? [settings.changed
      ? `✔ wrote        ${CLAUDE_SETTINGS_PATH} (web-remarq tools allowed, server enabled)`
      : `✔ claude       ${CLAUDE_SETTINGS_PATH} already up to date`] : []),
    ...result.edited.map((edit) => `✔ edited       ${edit.file} - ${edit.change}`),
  ]
  if (settings && !settings.defaultModeSet && !autoAccept) {
    lines.push(`  kept your permissions.defaultMode "${settings.defaultMode}" - Claude Code will not accept fixes on its own`)
  }

  if (result.edits.length > 0) {
    lines.push('', `${countWord(result.edits.length)} ${result.edits.length === 1 ? 'edit remains' : 'edits remain'}:`, '')
    result.edits.forEach((edit, i) => {
      lines.push(`[${i + 1}] ${edit.file}`)
      lines.push(...edit.snippet.split('\n').map((l) => `    ${l}`))
      if (edit.note) lines.push(`    Note: ${edit.note}`)
      lines.push('')
    })
  }

  const steps = [
    ...(result.edits.length > 0 ? ['Apply the edits above.'] : []),
    d.bundler ? `Start your dev server (${d.packageManager} run dev).` : 'Serve the page locally and open it.',
    result.agent === 'codex' ? [
      'In the repository root, start a Codex session for this project.',
      `     ${result.sessionCommand}`,
      '   Use a Codex CLI with queue support and sign in with ChatGPT first.',
      '   Keep the launched terminal open while reviewing marks.',
    ].join('\n') : [
      'In the repository root, start Claude Code:',
      `     ${result.sessionCommand}`,
      '   The first start asks two questions:',
      `   - trust this folder (it pre-approves tool permissions in ${CLAUDE_SETTINGS_PATH}):`,
      '     the cursor starts on "No, exit" - select "Yes, I trust this folder" and press Enter;',
      '   - development channels warning: press Enter on "I am using this for local development".',
      autoAccept ? '   This mode accepts file edits without asking (acceptEdits).' : null,
    ]
      .filter((l) => l !== null)
      .join('\n'),
    ...(d.framework === 'plain-html'
      ? ["In the browser console, run WebRemarq.pair('<token>') once with the token from .remarq/config.json."]
      : []),
    result.agent === 'codex'
      ? 'Open the app, mark an element, and click Add to send feedback to this Codex session.'
      : 'Open the app, click an element and leave a mark - Claude Code receives it and fixes it.',
  ]
  lines.push('', 'Next:', ...steps.map((step, i) => `${i + 1}. ${step}`), '', 'Check the setup any time: npx @web-remarq/cli doctor')
  return lines.join('\n')
}

export function renderDoctor(report: DoctorReport): string {
  if (!report.ok) return renderFailure(report.reason, report.hint, report.candidates)

  const lines: string[] = []
  for (const check of report.checks) {
    lines.push(`${SYMBOL[check.status]} ${check.id.padEnd(14)} ${check.detail}`)
    if (check.hint) lines.push(`  ${' '.repeat(14)} → ${check.hint}`)
  }
  return lines.join('\n')
}

export interface InstallFailure {
  /** The install command that was attempted, so the user can run it themselves. */
  command: string
  /** The error message from the failed command. */
  message: string
}

/**
 * The install command runs before any files are written by init itself, so a
 * failure here means the package manager may have partially modified
 * package.json or the lockfile before erroring out.
 */
export function renderInstallFailure(failure: InstallFailure): string {
  return [
    '✖ Install failed',
    `  ${failure.message}`,
    '',
    'The following command did not complete - run it yourself to see the full output:',
    `  ${failure.command}`,
    '',
    'Your package.json and lockfile may have been partially modified.',
  ].join('\n')
}

/**
 * `runInit` does more than the install command: it writes .mcp.json and the
 * Claude Code settings and edits app files. None of those is an install, so a
 * failure there must not be blamed on an install command that succeeded or never ran.
 */
export function renderSetupFailure(message: string): string {
  return [`✖ Setup failed`, `  ${message}`].join('\n')
}

export function renderArgError(message: string): string {
  return [`✖ Argument error`, `  ${message}`].join('\n')
}

/** Recognized flags: --json, --app and --agent. */
export function parseArgs(
  argv: string[],
): { command: string | null; json: boolean; app?: string; agent?: Agent; error?: string } {
  // Computed up front, independent of the loop below: --json takes no value, so its
  // position relative to a malformed --app never changes whether it was passed.
  const json = argv.includes('--json')
  const positional: string[] = []
  let app: string | undefined
  let agent: Agent | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    if (arg === '--json') continue

    if (arg === '--agent' || arg.startsWith('--agent=')) {
      const value = arg === '--agent' ? argv[++i] : arg.slice('--agent='.length)
      if (value !== 'codex' && value !== 'claude') {
        return { command: positional[0] ?? null, json, error: '--agent requires codex or claude' }
      }
      agent = value
      continue
    }

    if (arg.startsWith('--app=')) {
      const value = arg.slice('--app='.length)
      if (value === '') {
        return { command: positional[0] ?? null, json, error: '--app requires a directory value' }
      }
      app = value
      continue
    }

    if (arg === '--app') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        return { command: positional[0] ?? null, json, error: '--app requires a directory value' }
      }
      app = value
      i++
      continue
    }

    if (arg.startsWith('--')) {
      return { command: positional[0] ?? null, json, error: `Unknown option: ${arg}` }
    }

    positional.push(arg)
  }

  return { command: positional[0] ?? null, json, app, ...(agent === undefined ? {} : { agent }) }
}
