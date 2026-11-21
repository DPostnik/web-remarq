import { describe, it, expect } from 'vitest'
import { renderInit, renderDoctor, renderInstallFailure, parseArgs } from './render'
import type { Detection } from './types'

const detection: Detection = {
  framework: 'vue',
  bundler: 'vite',
  packageManager: 'pnpm',
  repoRoot: '/repo',
  appDir: '/repo/packages/web',
  appPackageName: 'web',
  configFile: 'vite.config.ts',
  entry: 'src/main.ts',
  plugin: '@web-remarq/unplugin',
  includeGlob: ['src/**/*.vue'],
}

describe('renderInit', () => {
  const base = {
    ok: true as const,
    detected: detection,
    installed: ['web-remarq', '@web-remarq/unplugin'],
    wroteMcpConfig: true,
    wroteLocalConfig: true,
    claudeSettings: { changed: true, defaultMode: 'acceptEdits', defaultModeSet: true },
    edited: [{ file: 'packages/web/vite.config.ts', change: 'registered remarq({ widget: true }) at the end of plugins' }],
    edits: [],
    sessionCommand: 'claude --dangerously-load-development-channels server:web-remarq',
    next: 'doctor' as const,
  }

  it('reports what was done, then the ordered next steps with the session command', () => {
    const text = renderInit(base)
    expect(text).toContain('vue + vite')
    expect(text).toContain('✔ edited       packages/web/vite.config.ts - registered')
    expect(text).toContain('.claude/settings.local.json')
    expect(text).not.toContain('remain')
    expect(text).toContain('1. Start your dev server (pnpm run dev).')
    expect(text).toContain('2. In the repository root, start Claude Code:\n     claude --dangerously-load-development-channels server:web-remarq')
    expect(text).toContain('select "Yes, I trust this folder"')
    expect(text).toContain('press Enter on "I am using this for local development"')
    expect(text).toContain('accepts file edits without asking')
    expect(text).toContain('3. Open the app')
    expect(text).toContain('npx @web-remarq/cli doctor')
  })

  it('lists only the manual edits left, puts them first in the steps, and says when a defaultMode was kept', () => {
    const text = renderInit({
      ...base,
      installed: [],
      edited: [],
      claudeSettings: { changed: false, defaultMode: 'plan', defaultModeSet: false },
      edits: [{ file: 'packages/web/vite.config.ts', kind: 'build-config', snippet: 'plugins: []', note: 'Not edited automatically: x' }],
    })
    expect(text).toContain('nothing to install')
    expect(text).toContain('One edit remains')
    expect(text).toContain('[1] packages/web/vite.config.ts')
    expect(text).toContain('1. Apply the edits above.')
    expect(text).toContain('kept your permissions.defaultMode "plan"')
    expect(text).not.toContain('accepts file edits without asking')
  })

  it('reports a stop without pretending anything was installed', () => {
    const text = renderInit({ ok: false, reason: 'No supported stack found', hint: 'Run from your app directory' })
    expect(text).toContain('No supported stack found')
    expect(text).toContain('Run from your app directory')
    expect(text).not.toContain('edits remain')
  })
})

describe('renderDoctor', () => {
  it('marks statuses distinctly and prints hints for non-ok checks', () => {
    const text = renderDoctor({
      ok: true,
      detected: detection,
      checks: [
        { id: 'packages', status: 'ok', detail: 'web-remarq@0.8.1' },
        { id: 'build-plugin', status: 'skipped', detail: 'no bundler' },
        { id: 'mcp-server', status: 'blocked', detail: 'no response', hint: 'restart Claude Code' },
        { id: 'mcp-config', status: 'fail', detail: 'missing entry', hint: 'run init again' },
      ],
    })
    expect(text).toContain('✔ packages')
    expect(text).toContain('– build-plugin')
    expect(text).toContain('⏸ mcp-server')
    expect(text).toContain('✖ mcp-config')
    expect(text).toContain('restart Claude Code')
    expect(text).toContain('run init again')
  })

  it('prints candidates on failure, same as renderInit', () => {
    const text = renderDoctor({
      ok: false,
      reason: 'Found 2 apps in this workspace',
      hint: 'Pick one with --app',
      candidates: ['apps/web', 'apps/admin'],
    })
    expect(text).toContain('Found 2 apps in this workspace')
    expect(text).toContain('Candidates:')
    expect(text).toContain('apps/web')
    expect(text).toContain('apps/admin')
  })
})

describe('parseArgs', () => {
  it('reads the command, --json and --app', () => {
    expect(parseArgs(['init', '--json', '--app', 'apps/web'])).toEqual({
      command: 'init',
      json: true,
      app: 'apps/web',
    })
  })

  it('returns a null command when none is given', () => {
    expect(parseArgs([])).toEqual({ command: null, json: false, app: undefined })
  })

  it('reports an argument error when --app has no following value', () => {
    const result = parseArgs(['init', '--app'])
    expect(result.error).toBeTruthy()
    expect(result.app).toBeUndefined()
  })

  it('reports an argument error when --app is followed by another flag, instead of swallowing it', () => {
    const result = parseArgs(['init', '--app', '--json'])
    expect(result.error).toBeTruthy()
    expect(result.app).toBeUndefined()
  })

  it('parses the --app=value equals form', () => {
    expect(parseArgs(['doctor', '--app=apps/web'])).toEqual({
      command: 'doctor',
      json: false,
      app: 'apps/web',
    })
  })

  it('parses --app before the command, without leaking the value into positionals', () => {
    expect(parseArgs(['--app', 'apps/web', 'init'])).toEqual({
      command: 'init',
      json: false,
      app: 'apps/web',
    })
  })

  it('reports an argument error for an unrecognized flag', () => {
    const result = parseArgs(['init', '--apps', 'apps/web'])
    expect(result.error).toBeTruthy()
  })
})

describe('renderInstallFailure', () => {
  it('reports the failed command and warns about partial modification', () => {
    const text = renderInstallFailure({
      command: 'npm install -D web-remarq @web-remarq/unplugin',
      message: 'Command failed with exit code 1',
    })
    expect(text).toContain('npm install -D web-remarq @web-remarq/unplugin')
    expect(text).toContain('Command failed with exit code 1')
    expect(text).toContain('package.json')
  })
})
