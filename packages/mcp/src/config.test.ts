import { describe, expect, it } from 'vitest'
import { parseEnv, ConfigError } from './config'

describe('parseEnv', () => {
  it('returns local mode with defaults when no cloud vars are set', () => {
    expect(parseEnv({})).toEqual({ mode: 'local', port: 1817, dataFile: '.remarq/annotations.json' })
  })

  it('respects REMARQ_PORT and REMARQ_DATA_FILE overrides', () => {
    expect(parseEnv({ REMARQ_PORT: '4000', REMARQ_DATA_FILE: 'tmp/a.json' }))
      .toEqual({ mode: 'local', port: 4000, dataFile: 'tmp/a.json' })
  })

  it('rejects a non-numeric or out-of-range port', () => {
    expect(() => parseEnv({ REMARQ_PORT: 'abc' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_PORT: '70000' })).toThrow(ConfigError)
  })

  it('returns cloud mode when all three cloud vars are set', () => {
    const config = parseEnv({
      REMARQ_PROJECT_KEY: 'pk_abc',
      REMARQ_SUPABASE_URL: 'https://x.supabase.co',
      REMARQ_SUPABASE_ANON_KEY: 'anon',
    })
    expect(config).toEqual({
      mode: 'cloud',
      projectKey: 'pk_abc',
      supabaseUrl: 'https://x.supabase.co',
      supabaseAnonKey: 'anon',
    })
  })

  it('errors when cloud vars are only partially set (no silent local fallback)', () => {
    expect(() => parseEnv({ REMARQ_PROJECT_KEY: 'pk_abc' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(ConfigError)
  })

  it('keeps cloud validation: pk_ prefix and https URL', () => {
    const base = { REMARQ_PROJECT_KEY: 'pk_abc', REMARQ_SUPABASE_URL: 'https://x.supabase.co', REMARQ_SUPABASE_ANON_KEY: 'anon' }
    expect(() => parseEnv({ ...base, REMARQ_PROJECT_KEY: 'nope' })).toThrow(ConfigError)
    expect(() => parseEnv({ ...base, REMARQ_SUPABASE_URL: 'http://x' })).toThrow(ConfigError)
  })
})
