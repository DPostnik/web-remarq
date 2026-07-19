import type { InitResult } from './init'
import type { DoctorReport } from './doctor'
import type { CheckStatus } from './types'

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
  const lines = [
    `✔ detected     ${stack} (${d.packageManager})`,
    result.installed.length > 0
      ? `✔ installed    ${result.installed.join(', ')}`
      : '– installed    nothing to install',
    result.wroteMcpConfig
      ? '✔ wrote        .mcp.json (repo root)'
      : '✔ mcp config   already up to date',
  ]

  if (result.edits.length === 0) {
    lines.push('', 'Setup is complete - no manual edits needed.')
  } else {
    lines.push('', `${countWord(result.edits.length)} edits remain:`, '')
    result.edits.forEach((edit, i) => {
      lines.push(`[${i + 1}] ${edit.file}`)
      lines.push(...edit.snippet.split('\n').map((l) => `    ${l}`))
      if (edit.note) lines.push(`    Note: ${edit.note}`)
      lines.push('')
    })
  }

  lines.push('Then: npx @web-remarq/cli doctor')
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
 * `runInit` does more than the install command: it always writes .mcp.json, and
 * for plain-HTML apps also injects the script tag. Neither of those is an
 * install, so a failure there must not be blamed on a command that never ran.
 */
export function renderSetupFailure(message: string): string {
  return [`✖ Setup failed`, `  ${message}`].join('\n')
}

export function renderArgError(message: string): string {
  return [`✖ Argument error`, `  ${message}`].join('\n')
}

export function parseArgs(
  argv: string[],
): { command: string | null; json: boolean; app?: string; error?: string } {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const appIndex = argv.indexOf('--app')
  const json = argv.includes('--json')

  if (appIndex === -1) {
    return { command: positional[0] ?? null, json }
  }

  const value = argv[appIndex + 1]
  if (value === undefined || value.startsWith('--')) {
    return { command: positional[0] ?? null, json, error: '--app requires a directory value' }
  }

  return { command: positional[0] ?? null, json, app: value }
}
