import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { parseEnv, ConfigError } from './config'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  delete process.env.REMARQ_PROJECT_KEY
  delete process.env.REMARQ_SUPABASE_URL
  delete process.env.REMARQ_SUPABASE_ANON_KEY
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('parseEnv', () => {
  it('returns typed config when all three env vars are set', () => {
    process.env.REMARQ_PROJECT_KEY = 'pk_abcdef0123456789abcdef0123456789'
    process.env.REMARQ_SUPABASE_URL = 'https://example.supabase.co'
    process.env.REMARQ_SUPABASE_ANON_KEY = 'eyJanon'

    const config = parseEnv(process.env)

    expect(config).toEqual({
      projectKey: 'pk_abcdef0123456789abcdef0123456789',
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'eyJanon',
    })
  })

  it('throws ConfigError when REMARQ_PROJECT_KEY missing', () => {
    process.env.REMARQ_SUPABASE_URL = 'https://example.supabase.co'
    process.env.REMARQ_SUPABASE_ANON_KEY = 'eyJanon'

    expect(() => parseEnv(process.env)).toThrow(ConfigError)
    expect(() => parseEnv(process.env)).toThrow(/REMARQ_PROJECT_KEY/)
  })

  it('throws ConfigError when REMARQ_SUPABASE_URL missing', () => {
    process.env.REMARQ_PROJECT_KEY = 'pk_abcdef0123456789abcdef0123456789'
    process.env.REMARQ_SUPABASE_ANON_KEY = 'eyJanon'

    expect(() => parseEnv(process.env)).toThrow(/REMARQ_SUPABASE_URL/)
  })

  it('throws ConfigError when REMARQ_SUPABASE_ANON_KEY missing', () => {
    process.env.REMARQ_PROJECT_KEY = 'pk_abcdef0123456789abcdef0123456789'
    process.env.REMARQ_SUPABASE_URL = 'https://example.supabase.co'

    expect(() => parseEnv(process.env)).toThrow(/REMARQ_SUPABASE_ANON_KEY/)
  })

  it('throws ConfigError when project key does not start with pk_', () => {
    process.env.REMARQ_PROJECT_KEY = 'wrong_format_key'
    process.env.REMARQ_SUPABASE_URL = 'https://example.supabase.co'
    process.env.REMARQ_SUPABASE_ANON_KEY = 'eyJanon'

    expect(() => parseEnv(process.env)).toThrow(/must start with `pk_`/)
  })

  it('throws ConfigError when supabase URL is not https://', () => {
    process.env.REMARQ_PROJECT_KEY = 'pk_abcdef0123456789abcdef0123456789'
    process.env.REMARQ_SUPABASE_URL = 'http://insecure.example.com'
    process.env.REMARQ_SUPABASE_ANON_KEY = 'eyJanon'

    expect(() => parseEnv(process.env)).toThrow(/https/)
  })
})
