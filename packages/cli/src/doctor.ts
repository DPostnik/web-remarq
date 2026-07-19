import { detect } from './detect'
import { checkBuildPlugin, checkMcpConfig, checkMcpServer, checkPackages, checkWidgetInit } from './checks'
import type { CheckResult, Detection } from './types'

export const MCP_PORT = 1817

export interface DoctorOptions {
  app?: string
}

export interface DoctorDeps {
  probeMcpServer(port: number): Promise<boolean>
}

export type DoctorReport =
  | { ok: false; reason: string; hint: string; candidates?: string[] }
  | { ok: true; detected: Detection; checks: CheckResult[] }

/**
 * Live probe of the local MCP server. Injected in tests so they never open sockets.
 * Hits GET /store - the same widget-facing endpoint HttpStorageAdapter itself polls
 * (see packages/mcp/src/http-server.ts and packages/core/src/core/http-storage-adapter.ts).
 * There is no /annotations GET route; probing it always 404s.
 */
export async function probeMcpServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/store`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function runDoctor(
  cwd: string,
  opts: DoctorOptions,
  deps: DoctorDeps,
): Promise<DoctorReport> {
  const detection = detect(cwd, opts)
  if (!detection.ok) return detection

  const d = detection.detection
  const checks: CheckResult[] = [
    checkPackages(d),
    await checkBuildPlugin(d),
    checkWidgetInit(d),
    checkMcpConfig(d),
    await checkMcpServer(MCP_PORT, deps.probeMcpServer),
  ]

  return { ok: true, detected: d, checks }
}

/** Exit 1 only on a real failure - `blocked` and `skipped` must not break the loop. */
export function exitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0
}
