import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findCodexBinary, runCodex } from './codex'
import { ensureLocalConfig } from './local-config'

const THREAD = '52a78a55-311b-4870-854b-a714b04bb7c7'

describe.skipIf(process.platform === 'win32')('Codex launcher', () => {
  let fixture: string
  let bin: string
  let project: string

  beforeEach(() => {
    fixture = mkdtempSync(join(tmpdir(), 'remarq-codex-test-'))
    project = join(fixture, 'project "quoted"')
    bin = join(fixture, 'bin', 'codex')
    mkdirSync(dirname(bin))
    mkdirSync(join(project, '.git'), { recursive: true })
    ensureLocalConfig(project)
    vi.stubEnv('PATH', dirname(bin))
    vi.stubEnv('OPENAI_API_KEY', 'api-key-env-test')
    vi.stubEnv('CODEX_API_KEY', 'codex-key-env-test')
    vi.stubEnv('CODEX_HOME', join(fixture, 'custom codex home'))
    vi.stubEnv('REMARQ_DATA_FILE', '/wrong-project/.remarq/annotations.json')
    writeFileSync(bin, `#!${process.execPath}
      const { appendFileSync } = require('node:fs');
      const { createServer } = require('node:net');
      const args = process.argv.slice(2);
      appendFileSync(${JSON.stringify(join(fixture, 'launch.jsonl'))}, JSON.stringify({
        args,
        cwd: process.cwd(),
        apiKeysPresent: Boolean(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY),
        wrongProject: Boolean(process.env.REMARQ_DATA_FILE),
        codexHome: process.env.CODEX_HOME,
      }) + '\\n');
      if (args.includes('--help')) console.log('--thread --message --resume --remote --listen --cd unix://');
      else if (args[0] === 'login') console.error('Logged in using ChatGPT');
      else if (args[0] === 'exec') {
        const thread = process.env.TEST_CODEX_CONCURRENT === '1'
          ? '52a78a55-311b-4870-854b-' + String(process.pid).padStart(12, '0')
          : ${JSON.stringify(THREAD)};
        console.log(JSON.stringify({ type: 'thread.started', thread_id: thread }));
        if (process.env.TEST_CODEX_INCOMPLETE !== '1') console.log(JSON.stringify({ type: 'turn.completed' }));
      } else if (args[0] === 'app-server') createServer().listen(args[2].slice('unix://'.length));
      else if (args[0] === 'resume') process.exitCode = 42;
    `, { mode: 0o700 })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(fixture, { recursive: true, force: true })
  })

  function launches(): { args: string[]; cwd: string; apiKeysPresent: boolean; wrongProject: boolean; codexHome: string }[] {
    return readFileSync(join(fixture, 'launch.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  }

  it('runs one fresh, project-scoped thread against a private server and cleans up its socket', async () => {
    const app = join(project, 'apps', 'site')
    mkdirSync(app, { recursive: true })
    expect(await runCodex(app)).toBe(42)
    const calls = launches()
    const cwd = calls[0].cwd
    expect(cwd.endsWith(project)).toBe(true)
    expect(calls.every((call) => call.cwd === cwd && !call.apiKeysPresent && !call.wrongProject)).toBe(true)
    const bootstrap = calls.find((call) => call.args[0] === 'exec')!.args
    const server = calls.find((call) => call.args[0] === 'app-server' && call.args[1] === '--listen')!.args
    const remote = server[2]
    expect(bootstrap).toContain('forced_login_method="chatgpt"')
    expect(bootstrap).toContain('sandbox_mode="workspace-write"')
    expect(bootstrap).toContain('mcp_servers={}')
    expect(server).toContain('forced_login_method="chatgpt"')
    expect(server).toContain('sandbox_mode="workspace-write"')
    const mcp = server.find((arg) => arg.startsWith('mcp_servers.web-remarq='))!
    expect(calls.map((call) => call.codexHome)).toEqual(calls.map(() => join(fixture, 'custom codex home')))
    expect(mcp).toContain('env_vars=["CODEX_HOME"]')
    expect(mcp).not.toContain('custom codex home')
    expect(mcp).toContain(`cwd=${JSON.stringify(cwd)}`)
    expect(mcp).toContain(`REMARQ_DATA_FILE=${JSON.stringify(join(cwd, '.remarq', 'annotations.json'))}`)
    expect(mcp).toContain(`REMARQ_CODEX_REMOTE=${JSON.stringify(remote)}`)
    expect(mcp).toContain(`REMARQ_CODEX_THREAD="${THREAD}"`)
    expect(calls.at(-1)?.args).toEqual(['resume', '--remote', remote, '--cd', cwd, THREAD])
    expect(statSync(dirname(remote.slice('unix://'.length)), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('reopens the same project thread over a new socket without another bootstrap turn', async () => {
    vi.stubEnv('CODEX_HOME', undefined)
    expect(await runCodex(project)).toBe(42)
    expect(await runCodex(project)).toBe(42)
    const calls = launches()
    const saved = JSON.parse(readFileSync(join(project, '.remarq', 'codex-session.json'), 'utf8'))
    const resumes = calls.filter((call) => call.args[0] === 'resume' && call.args[1] === '--remote')
    expect(saved).toMatchObject({ cwd: resumes[0].cwd, thread: THREAD })
    expect(calls.filter((call) => call.args[0] === 'exec')).toHaveLength(1)
    expect(calls.some((call) => call.args.some((arg) => arg.includes('env_vars=')))).toBe(false)
    expect(resumes.map(({ args }) => args.at(-1))).toEqual([THREAD, THREAD])
    expect(resumes[0].args[2]).not.toBe(resumes[1].args[2])
    expect(statSync(join(project, '.remarq', 'codex-session.json')).mode & 0o777).toBe(0o600)
  })

  it('adopts one binding when two first launches race', async () => {
    vi.stubEnv('TEST_CODEX_CONCURRENT', '1')
    expect(await Promise.all([runCodex(project), runCodex(project)])).toEqual([42, 42])
    const calls = launches()
    const saved = JSON.parse(readFileSync(join(project, '.remarq', 'codex-session.json'), 'utf8'))
    expect(calls.filter((call) => call.args[0] === 'exec')).toHaveLength(2)
    expect(calls.filter((call) => call.args[0] === 'resume' && call.args[1] === '--remote')
      .map(({ args }) => args.at(-1))).toEqual([saved.thread, saved.thread])
  })

  it.each(['{"projectId":"other"}', 'not JSON'])('rejects an invalid project binding before launching Codex', async (content) => {
    writeFileSync(join(project, '.remarq', 'codex-session.json'), content)
    await expect(runCodex(project)).rejects.toThrow('Restore the matching file and project location')
    expect(statSync(join(fixture, 'launch.jsonl'), { throwIfNoEntry: false })).toBeUndefined()
  })

  it('stops before opening a server or resuming when the bootstrap turn did not complete', async () => {
    vi.stubEnv('TEST_CODEX_INCOMPLETE', '1')
    await expect(runCodex(project)).rejects.toThrow('did not confirm a completed startup turn')
    expect(launches().at(-1)?.args[0]).toBe('exec')
  })

  it('skips a non-executable PATH entry and returns the canonical executable', () => {
    const candidate = join(fixture, 'codex')
    writeFileSync(candidate, 'not executable')
    chmodSync(candidate, 0o600)
    expect(findCodexBinary({ PATH: ['.', fixture, dirname(bin)].join(delimiter) })?.endsWith(bin))
      .toBe(true)
  })
})
