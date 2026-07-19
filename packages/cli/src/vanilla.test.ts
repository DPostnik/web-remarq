import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { injectScriptTag } from './vanilla'
import type { Detection } from './types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'remarq-vanilla-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const detection = (): Detection => ({
  framework: 'plain-html',
  bundler: null,
  packageManager: 'npm',
  repoRoot: dir,
  appDir: dir,
  configFile: null,
  entry: 'index.html',
  plugin: null,
  includeGlob: null,
})

describe('injectScriptTag', () => {
  it('inserts the widget bootstrap before </body>', () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html>\n<html>\n  <body>\n    <h1>Hi</h1>\n  </body>\n</html>\n')
    expect(injectScriptTag(detection())).toBe(true)

    const html = readFileSync(join(dir, 'index.html'), 'utf8')
    expect(html).toContain('web-remarq.global.js')
    expect(html).toContain('HttpStorageAdapter')
    expect(html.indexOf('web-remarq.global.js')).toBeLessThan(html.indexOf('</body>'))
    expect(html).toContain('<h1>Hi</h1>')
  })

  it('is idempotent', () => {
    writeFileSync(join(dir, 'index.html'), '<html><body></body></html>')
    injectScriptTag(detection())
    const once = readFileSync(join(dir, 'index.html'), 'utf8')
    expect(injectScriptTag(detection())).toBe(false)
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(once)
  })

  it('leaves the file alone when there is no </body>', () => {
    writeFileSync(join(dir, 'index.html'), '<div>fragment</div>')
    expect(injectScriptTag(detection())).toBe(false)
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe('<div>fragment</div>')
  })
})
