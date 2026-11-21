import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('server version', () => {
  it('server.ts reports the same version as package.json', () => {
    const pkg = JSON.parse(read('../package.json')) as { version: string }
    const match = read('./server.ts').match(/name: 'web-remarq', version: '([^']+)'/)
    expect(match?.[1]).toBe(pkg.version)
  })
})
