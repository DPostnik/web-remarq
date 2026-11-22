import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, linkSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { findRepoRoot, readJson } from './fs-utils'
import { LOCAL_CONFIG_PATH } from './local-config'
import { MCP_CODEX_ENTRY } from './mcp-config'

const BUNDLE_CLI = 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_CONFIG = [
  '-c', 'forced_login_method="chatgpt"',
  '-c', 'model_provider="openai"',
  '-c', 'sandbox_mode="workspace-write"',
]

export function findCodexBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = (env.PATH ?? '').split(delimiter).filter(isAbsolute).map((dir) => join(dir, 'codex'))
  if (process.platform === 'darwin') {
    candidates.push(join('/Applications', BUNDLE_CLI), join(homedir(), 'Applications', BUNDLE_CLI))
  }

  for (const candidate of candidates) {
    try {
      const executable = realpathSync(candidate)
      if (!statSync(executable).isFile()) continue
      accessSync(executable, constants.X_OK)
      return executable
    } catch {
      // Keep looking if the candidate is missing or cannot be executed.
    }
  }
  return null
}

function codexEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const name of Object.keys(env)) {
    if (name.startsWith('REMARQ_')) delete env[name]
  }
  delete env.OPENAI_API_KEY
  delete env.OPENAI_BASE_URL
  delete env.CODEX_API_KEY
  delete env.CODEX_ACCESS_TOKEN
  delete env.CODEX_EXEC_SERVER_URL
  return env
}

function capture(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd, env, timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve(stdout + '\n' + stderr)
    })
    child.stdin?.end()
  })
}

async function compatibleCodex(cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (process.platform === 'win32') throw new Error('web-remarq requires a Unix Codex CLI session. On Windows, run it in WSL.')
  const bin = findCodexBinary(env)
  if (!bin) throw new Error('Install the Codex CLI and make it available on PATH.')
  const checks = [
    { args: ['queue', '--help'], flags: ['--thread', '--message', '--resume', '--remote', 'unix://'] },
    { args: ['app-server', '--help'], flags: ['--listen', 'unix://'] },
    { args: ['resume', '--help'], flags: ['--remote', '--cd'] },
  ]
  for (const { args, flags } of checks) {
    const help = await capture(bin, args, cwd, env, 5000).catch(() => '')
    if (!flags.every((flag) => help.includes(flag))) {
      throw new Error(`Update the Codex CLI at ${bin}. web-remarq needs queue, resume and Unix app-server support.`)
    }
  }
  const login = await capture(bin, ['login', 'status'], cwd, env, 5000).catch(() => '')
  if (!login.includes('Logged in using ChatGPT')) {
    throw new Error('Sign in to the Codex CLI with your ChatGPT account, then start web-remarq again.')
  }
  return bin
}

export async function checkCodex(cwd: string): Promise<void> {
  await compatibleCodex(cwd, codexEnv())
}

function startedThread(output: string): string {
  const events = output.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as { type?: string; thread_id?: string } | null]
    } catch {
      return []
    }
  })
  const thread = events.find((event) => event?.type === 'thread.started')?.thread_id
  if (!thread || !UUID.test(thread) || !events.some((event) => event?.type === 'turn.completed')) {
    throw new Error('Codex did not confirm a completed startup turn in a fresh thread.')
  }
  return thread
}

function mcpOverride(cwd: string, bin: string, remote: string, thread: string, codexHome: string | undefined): string {
  const quote = (value: string): string => JSON.stringify(value).replace(/\x7f/g, '\\u007f')
  const env = {
    REMARQ_DATA_FILE: join(cwd, '.remarq', 'annotations.json'),
    REMARQ_CODEX_BIN: bin,
    REMARQ_CODEX_REMOTE: remote,
    REMARQ_CODEX_THREAD: thread,
    REMARQ_CHANNEL: 'off',
  }
  const settings = [
    `command=${quote(MCP_CODEX_ENTRY.command)}`,
    `args=[${MCP_CODEX_ENTRY.args.map(quote).join(', ')}]`,
    `cwd=${quote(cwd)}`,
    `env={${Object.entries(env).map(([name, value]) => `${name}=${quote(value)}`).join(', ')}}`,
    // Codex filters the stdio server environment, and its queue command needs the same configuration.
    ...(codexHome ? ['env_vars=["CODEX_HOME"]'] : []),
    'required=true',
    'startup_readiness="connection"',
    'default_tools_approval_mode="approve"',
  ]
  return `mcp_servers.web-remarq={${settings.join(', ')}}`
}

const SESSION_PATH = '.remarq/codex-session.json'

interface ProjectSession {
  projectId: string
  cwd: string
  thread: string
}

function readSession(cwd: string, projectId: string): ProjectSession | null {
  let content: string
  try {
    content = readFileSync(join(cwd, SESSION_PATH), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let session: Partial<ProjectSession> | null = null
  try {
    session = JSON.parse(content) as Partial<ProjectSession> | null
  } catch {
    // Report malformed JSON and a mismatching project with the same recovery path.
  }
  if (session?.projectId !== projectId || session.cwd !== cwd || typeof session.thread !== 'string' ||
    !UUID.test(session.thread)) {
    throw new Error(`Cannot use ${SESSION_PATH} for this project. Restore the matching file and project location before launching.`)
  }
  return { projectId, cwd, thread: session.thread }
}

function bindSession(session: ProjectSession): void {
  const draft = mkdtempSync(join(session.cwd, '.remarq', '.codex-session-'))
  const file = join(draft, 'session.json')
  try {
    writeFileSync(file, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 })
    // Publish the complete binding once, even if a concurrent launch finishes first.
    linkSync(file, join(session.cwd, SESSION_PATH))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  } finally {
    rmSync(file, { force: true })
    rmdirSync(draft)
  }
}

/** Start or reopen the local Codex session dedicated to the installed web-remarq project. */
export async function runCodex(from: string): Promise<number> {
  const cwd = realpathSync(findRepoRoot(realpathSync(from)))
  const config = readJson<{ projectId?: unknown; token?: unknown }>(join(cwd, LOCAL_CONFIG_PATH))
  if (typeof config?.token !== 'string' || !config.token || typeof config.projectId !== 'string' || !config.projectId) {
    throw new Error('Run web-remarq init --agent codex in this project first.')
  }
  const { projectId } = config
  let session = readSession(cwd, projectId)
  const env = codexEnv()
  const bin = await compatibleCodex(cwd, env)
  if (!session) {
    console.log('Starting a fresh Codex session for web-remarq…')
    const bootstrap = await capture(bin, [
      'exec', '--json', '--cd', cwd, '--skip-git-repo-check',
      ...SESSION_CONFIG, '-c', 'mcp_servers={}',
      'Reply exactly WEB_REMARQ_READY. Do not use tools or inspect files.',
    ], cwd, env, 120000).catch(() => {
      throw new Error('Codex could not create a session. Check your ChatGPT login and Codex configuration in this project.')
    })
    bindSession({ projectId, cwd, thread: startedThread(bootstrap) })
    session = readSession(cwd, projectId)
    if (!session) throw new Error(`${SESSION_PATH} disappeared before launch. Start web-remarq again.`)
  }
  const { thread } = session

  // Unix socket paths have a short OS limit. Keep this path independent of the project.
  const privateDir = mkdtempSync('/tmp/web-remarq-')
  const socket = join(privateDir, 'codex.sock')
  const remote = `unix://${socket}`
  const server = spawn(bin, [
    'app-server', '--listen', remote,
    ...SESSION_CONFIG, '-c', mcpOverride(cwd, bin, remote, thread, env.CODEX_HOME),
  ], { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'inherit'] })
  const serverDone = new Promise<void>((resolve) => {
    server.once('error', () => resolve())
    server.once('exit', () => resolve())
  })

  let tui: ReturnType<typeof spawn> | undefined
  let signalCode: number | undefined
  function stopOnSignal(signal: NodeJS.Signals): void {
    signalCode = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal as 'SIGHUP' | 'SIGINT' | 'SIGTERM']
    tui?.kill(signal)
  }
  const signals = ['SIGHUP', 'SIGINT', 'SIGTERM'] as const
  for (const signal of signals) process.on(signal, stopOnSignal)
  function stopServer(signal: NodeJS.Signals): void {
    if (!server.pid) return
    try {
      // The dedicated process group also contains the app-server's MCP subprocesses.
      process.kill(-server.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }

  try {
    const ready = await Promise.race([
      serverDone.then(() => false),
      (async () => {
        for (let attempt = 0; attempt < 100 && !signalCode; attempt++) {
          if (statSync(socket, { throwIfNoEntry: false })?.isSocket()) return true
          await delay(100, undefined, { ref: false })
        }
        return false
      })(),
    ])
    if (signalCode) return signalCode
    if (!ready) throw new Error('The dedicated Codex app-server did not open its Unix socket.')

    tui = spawn(bin, ['resume', '--remote', remote, '--cd', cwd, thread], {
      cwd, env, stdio: 'inherit',
    })
    const tuiDone = new Promise<number | null>((resolve, reject) => {
      tui!.once('error', reject)
      tui!.once('exit', resolve)
    })
    const code = await Promise.race([tuiDone, serverDone.then(() => {
      throw new Error('The dedicated Codex app-server exited while the session was open.')
    })])
    return signalCode ?? code ?? 1
  } finally {
    for (const signal of signals) process.off(signal, stopOnSignal)
    if (tui && tui.exitCode === null && tui.signalCode === null) tui.kill()
    stopServer('SIGTERM')
    await Promise.race([serverDone, delay(1500, undefined, { ref: false })])
    stopServer('SIGKILL')
    try {
      unlinkSync(socket)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    rmdirSync(privateDir)
  }
}
