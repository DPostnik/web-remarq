import { execSync } from 'node:child_process'
import { runInit } from './init'
import type { InitDeps } from './init'
import { exitCode, probeMcpServer, runDoctor } from './doctor'
import { parseArgs, renderArgError, renderDoctor, renderInit, renderInstallFailure, renderSetupFailure } from './render'
import type { InstallFailure } from './render'

const USAGE = `web-remarq installer

Usage:
  npx @web-remarq/cli init [--app <dir>] [--json]
  npx @web-remarq/cli doctor [--app <dir>] [--json]

init    Install missing packages, write .mcp.json, .remarq/config.json and
        .claude/settings.local.json, register the build plugin in the Vite
        config, and print the command that starts a Claude Code session.
doctor  Check the setup and explain what is wrong.

Options:
  --app <dir>  App package to target inside a monorepo, relative to the repo root.
  --json       Machine-readable output.`

export interface CliDeps {
  /** Run a shell command in `cwd`. Injected so tests never touch the network. */
  exec: InitDeps['exec']
}

const defaultDeps: CliDeps = {
  // With --json the CLI's stdout IS the payload an agent parses: the package
  // manager's progress lines must not interleave with it. Its stderr stays
  // visible either way, so a failing install is still explained.
  exec: (cmd, cwd, quiet) => {
    execSync(cmd, { cwd, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit' })
  },
}

export async function main(argv: string[], deps: CliDeps = defaultDeps): Promise<number> {
  const { command, json, app, error } = parseArgs(argv)

  if (error) {
    console.log(
      json ? JSON.stringify({ ok: false, reason: 'Argument error', hint: error }, null, 2) : renderArgError(error),
    )
    return 1
  }

  if (command === 'init') {
    // A failure inside the install command (network, registry, nonzero exit)
    // must point the user at that command; any later failure (a malformed
    // .mcp.json or settings file) is a setup failure, not an install failure.
    let failedCommand: string | null = null
    const exec: InitDeps['exec'] = (cmd, cwd, quiet) => {
      try {
        deps.exec(cmd, cwd, quiet)
      } catch (err) {
        failedCommand = cmd
        throw err
      }
    }

    try {
      const result = runInit(process.cwd(), { app, quiet: json }, { exec })
      console.log(json ? JSON.stringify(result, null, 2) : renderInit(result))
      return result.ok ? 0 : 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      if (failedCommand === null) {
        console.log(
          json ? JSON.stringify({ ok: false, reason: 'Setup failed', hint: message }, null, 2) : renderSetupFailure(message),
        )
        return 1
      }

      const failure: InstallFailure = { command: failedCommand, message }
      console.log(
        json
          ? JSON.stringify({ ok: false, reason: 'Install failed', hint: failure.message, command: failure.command }, null, 2)
          : renderInstallFailure(failure),
      )
      return 1
    }
  }

  if (command === 'doctor') {
    const report = await runDoctor(process.cwd(), { app }, { probeMcpServer })
    console.log(json ? JSON.stringify(report, null, 2) : renderDoctor(report))
    if (!report.ok) return 1
    return exitCode(report.checks)
  }

  if (command !== null) {
    console.log(`Unknown command: ${command}`)
  }
  console.log(USAGE)
  return command === null ? 0 : 1
}
