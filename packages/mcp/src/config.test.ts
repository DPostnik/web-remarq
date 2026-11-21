import { describe, expect, it } from 'vitest'
import { effectivePort, parseEnv, ConfigError, type LocalConfig } from './config'

describe('parseEnv', () => {
  it('returns local mode with defaults when no cloud vars are set', () => {
    expect(parseEnv({})).toEqual({
      mode: 'local',
      port: null,
      dataFile: '.remarq/annotations.json',
      channel: { enabled: true, settleMs: 3000, staleMs: 180000, redeliverMs: 2000 },
    })
  })

  it('respects REMARQ_PORT and REMARQ_DATA_FILE overrides', () => {
    expect(parseEnv({ REMARQ_PORT: '4000', REMARQ_DATA_FILE: 'tmp/a.json' }))
      .toMatchObject({ mode: 'local', port: 4000, dataFile: 'tmp/a.json' })
  })

  it('parses the channel switches', () => {
    expect(parseEnv({
      REMARQ_CHANNEL: 'off',
      REMARQ_CHANNEL_SETTLE_MS: '0',
      REMARQ_CHANNEL_STALE_MS: '500',
      REMARQ_CHANNEL_REDELIVER_MS: '10',
    })).toMatchObject({ channel: { enabled: false, settleMs: 0, staleMs: 500, redeliverMs: 10 } })
    expect(parseEnv({ REMARQ_CHANNEL: 'ON' })).toMatchObject({ channel: { enabled: true } })
  })

  it('rejects invalid channel values', () => {
    expect(() => parseEnv({ REMARQ_CHANNEL: 'maybe' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_CHANNEL_SETTLE_MS: '-1' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_CHANNEL_STALE_MS: '0' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_CHANNEL_REDELIVER_MS: '1.5' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_CHANNEL_SETTLE_MS: 'abc' })).toThrow(ConfigError)
  })

  it('rejects a non-numeric or out-of-range port', () => {
    expect(() => parseEnv({ REMARQ_PORT: 'abc' })).toThrow(ConfigError)
    expect(() => parseEnv({ REMARQ_PORT: '70000' })).toThrow(ConfigError)
  })

  it('effective port: REMARQ_PORT, then port from .remarq/config.json, then 1817', () => {
    const local = (env: NodeJS.ProcessEnv) => parseEnv(env) as LocalConfig
    expect(effectivePort(local({ REMARQ_PORT: '4000' }), { port: 5000 })).toBe(4000)
    expect(effectivePort(local({}), { port: 5000 })).toBe(5000)
    expect(effectivePort(local({}), {})).toBe(1817)
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
