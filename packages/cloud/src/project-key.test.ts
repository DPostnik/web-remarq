import { describe, it, expect } from 'vitest'
import { generateProjectKey, hashProjectKey } from './project-key'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

describe('generateProjectKey', () => {
  it('returns a string starting with "pk_"', () => {
    expect(generateProjectKey().startsWith('pk_')).toBe(true)
  })

  it('returns a string of length 35 (prefix + 32 chars)', () => {
    expect(generateProjectKey()).toHaveLength(35)
  })

  it('uses only characters from the alphabet after the prefix', () => {
    const key = generateProjectKey().slice(3)
    for (const ch of key) {
      expect(ALPHABET.includes(ch)).toBe(true)
    }
  })

  it('produces different keys on consecutive calls', () => {
    expect(generateProjectKey()).not.toBe(generateProjectKey())
  })
})

describe('hashProjectKey', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const hash = await hashProjectKey('pk_test')
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same input', async () => {
    const a = await hashProjectKey('pk_test')
    const b = await hashProjectKey('pk_test')
    expect(a).toBe(b)
  })

  it('produces different outputs for different inputs', async () => {
    const a = await hashProjectKey('pk_one')
    const b = await hashProjectKey('pk_two')
    expect(a).not.toBe(b)
  })

  it('matches the known SHA-256 vector for "abc"', async () => {
    expect(await hashProjectKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})
