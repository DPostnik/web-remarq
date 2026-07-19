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
  it('lists the remaining edits and points at doctor', () => {
    const text = renderInit({
      ok: true,
      detected: detection,
      installed: ['web-remarq', '@web-remarq/unplugin'],
      wroteMcpConfig: true,
      edits: [
        { file: 'packages/web/vite.config.ts', kind: 'build-config', snippet: 'plugins: []', note: 'after vue()' },
        { file: 'packages/web/src/main.ts', kind: 'entry', snippet: 'WebRemarq.init({})' },
      ],
      next: 'doctor',
    })
    expect(text).toContain('vue + vite')
    expect(text).toContain('Two edits remain')
    expect(text).toContain('[1] packages/web/vite.config.ts')
    expect(text).toContain('npx @web-remarq/cli doctor')
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
