import { detect } from './detect'
import { checkBuildPlugin, checkMcpConfig, checkMcpServer, checkPackages, checkWidgetInit } from './checks'
import type { McpProbeResult } from './checks'
import { readLocalToken } from './local-config'
import type { CheckResult, Detection } from './types'

export const MCP_PORT = 1817

export interface DoctorOptions {
  app?: string
}

export interface DoctorDeps {
  probeMcpServer(port: number, token: string | null): Promise<McpProbeResult>
}

export type DoctorReport =
  | { ok: false; reason: string; hint: string; candidates?: string[] }
  | { ok: true; detected: Detection; checks: CheckResult[] }

/**
 * Live probe of the local MCP server. Injected in tests so they never open
 * sockets. Two requests, mirroring what the widget does (see
 * packages/mcp/src/http-server.ts and HttpStorageAdapter):
 *
 * 1. GET /health - unauthenticated liveness + protocol version. A 404 means an
 *    older server (protocol 1) that has no /health route.
 * 2. GET /store with the bearer token from .remarq/config.json - proves the
 *    credential pairs with THIS server, not merely that something listens.
 *    Never logs or prints the token.
 */
export async function probeMcpServer(port: number, token: string | null): Promise<McpProbeResult> {
  let health: Response
  try {
    health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })
  } catch {
    return 'down'
  }
  if (health.status === 404) return 'incompatible'
  if (!health.ok) return 'down'
  const body = (await health.json().catch(() => ({}))) as { protocol?: unknown }
  if (body.protocol !== 2) return 'incompatible'

  if (!token) return 'no-token'
  let store: Response
  try {
    store = await fetch(`http://127.0.0.1:${port}/store`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    })
  } catch {
    return 'down'
  }
  if (store.status === 401 || store.status === 403) return 'unauthorized'
  if (!store.ok) return 'down'
  const payload = (await store.json().catch(() => ({}))) as { projectId?: unknown }
  return typeof payload.projectId === 'string' ? 'ok' : 'incompatible'
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
    await checkMcpServer(MCP_PORT, (port) => deps.probeMcpServer(port, readLocalToken(d.repoRoot))),
  ]

  return { ok: true, detected: d, checks }
}

/** Exit 1 only on a real failure - `blocked` and `skipped` must not break the loop. */
export function exitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === 'fail') ? 1 : 0
}
