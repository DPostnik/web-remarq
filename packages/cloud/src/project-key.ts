const PREFIX = 'pk_'
const KEY_LENGTH = 32
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateProjectKey(): string {
  const bytes = new Uint8Array(KEY_LENGTH)
  crypto.getRandomValues(bytes)
  let key = PREFIX
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return key
}

export async function hashProjectKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
