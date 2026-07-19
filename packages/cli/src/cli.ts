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

init    Install packages, write .mcp.json, print the remaining edits.
doctor  Check the setup and explain what is wrong.

Options:
  --app <dir>  App package to target inside a monorepo, relative to the repo root.
  --json       Machine-readable output.`

export interface CliDeps {
  /** Run a shell command in `cwd`. Injected so tests never touch the network. */
  exec: InitDeps['exec']
}

const defaultDeps: CliDeps = {
  exec: (cmd, cwd) => { execSync(cmd, { cwd, stdio: 'inherit' }) },
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
    // The install command is the one part of `runInit` that can throw
    // (network failure, registry error, nonzero exit) - everything else it
    // does is local file writes. Capture the attempted command so a failure
    // can point the user at it, then run `runInit` itself inside try/catch:
    // that call is what invokes `deps.exec` and is where the throw surfaces.
    let attemptedCommand: string | null = null
    const exec: InitDeps['exec'] = (cmd, cwd) => {
      attemptedCommand = cmd
      deps.exec(cmd, cwd)
    }

    try {
      const result = runInit(process.cwd(), { app }, { exec })
      console.log(json ? JSON.stringify(result, null, 2) : renderInit(result))
      return result.ok ? 0 : 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      // `attemptedCommand` stays null when `deps.exec` was never called - e.g.
      // plain-HTML has nothing to install, so a throw there must be a later
      // step (writeMcpConfig, injectScriptTag), not the install.
      if (attemptedCommand === null) {
        console.log(
          json ? JSON.stringify({ ok: false, reason: 'Setup failed', hint: message }, null, 2) : renderSetupFailure(message),
        )
        return 1
      }

      const failure: InstallFailure = { command: attemptedCommand, message }
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
