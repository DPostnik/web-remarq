#!/usr/bin/env node

import { webcrypto } from 'node:crypto'

const PREFIX = 'pk_'
const KEY_LENGTH = 32
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generateProjectKey() {
  const bytes = new Uint8Array(KEY_LENGTH)
  webcrypto.getRandomValues(bytes)
  let key = PREFIX
  for (let i = 0; i < KEY_LENGTH; i++) {
    key += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return key
}

async function hashProjectKey(key) {
  const data = new TextEncoder().encode(key)
  const buf = await webcrypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function parseFlag(argv, flag) {
  const i = argv.indexOf(flag)
  if (i === -1) return undefined
  return argv[i + 1]
}

function sqlString(value) {
  return `'${value.replace(/'/g, "''")}'`
}

function printUsage(stream) {
  stream.write(
    [
      'Usage: web-remarq-cloud <command> [options]',
      '',
      'Commands:',
      '  gen-key --name "<project name>" [--origin "<url>"]',
      '      Generate a project key, print its sha256 hash and an',
      '      insert-snippet to register the project in Supabase.',
      '',
    ].join('\n')
  )
}

async function runGenKey(argv) {
  const name = parseFlag(argv, '--name')
  const origin = parseFlag(argv, '--origin')

  if (!name) {
    process.stderr.write('Error: --name is required.\n\n')
    printUsage(process.stderr)
    process.exit(1)
  }

  const key = generateProjectKey()
  const hash = await hashProjectKey(key)
  const originSql = origin ? sqlString(origin) : 'null'

  process.stdout.write(
    [
      `Project key:   ${key}`,
      `Hash (sha256): ${hash}`,
      '',
      'Store the project key securely — it will not be shown again.',
      '',
      'Run this in Supabase SQL Editor:',
      '',
      `  insert into projects (name, origin, secret_key_hash)`,
      `  values (${sqlString(name)}, ${originSql}, '${hash}');`,
      '',
    ].join('\n')
  )
}

async function main() {
  const [, , command, ...rest] = process.argv

  if (command === 'gen-key') {
    await runGenKey(rest)
    return
  }

  printUsage(process.stdout)
}

main()
