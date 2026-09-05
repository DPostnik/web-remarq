import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLocalToken, TOKEN_ENV, withRemarq } from '../src/index';

const originalEnv = process.env.NODE_ENV;
const originalCwd = process.cwd();
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remarq-next-token-'));
  mkdirSync(join(dir, '.remarq'), { recursive: true });
  writeFileSync(join(dir, '.remarq', 'config.json'), JSON.stringify({ projectId: 'prj_x', token: 'tok-abcdefghijklmnop' }));
});

afterEach(() => {
  process.chdir(originalCwd);
  process.env.NODE_ENV = originalEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('local token pairing', () => {
  it('readLocalToken walks up from an app dir to the repo-root config', () => {
    const app = join(dir, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    expect(readLocalToken(app)).toBe('tok-abcdefghijklmnop');
    expect(readLocalToken(mkdtempSync(join(tmpdir(), 'remarq-none-')))).toBeNull();
  });

  it('withRemarq exposes the token as a public env var in development only, without overriding a user value', () => {
    process.chdir(dir);
    process.env.NODE_ENV = 'development';
    expect(withRemarq({}).env).toEqual({ [TOKEN_ENV]: 'tok-abcdefghijklmnop' });
    expect(withRemarq({ env: { [TOKEN_ENV]: 'mine' } }).env).toEqual({ [TOKEN_ENV]: 'mine' });

    process.env.NODE_ENV = 'production';
    expect(withRemarq({}).env).toBeUndefined();
  });

  it('never adds the token to a production build, even with production: true (source instrumentation stays on)', () => {
    process.chdir(dir);
    process.env.NODE_ENV = 'production';

    const optedOut = withRemarq({});
    expect(optedOut.env).toBeUndefined();
    expect(optedOut.webpack).toBeUndefined();

    const optedIn = withRemarq({}, { production: true });
    expect(optedIn.env).toBeUndefined();
    expect(typeof optedIn.webpack).toBe('function');
    expect(JSON.stringify(optedIn)).not.toContain('tok-abcdefghijklmnop');

    const withUserEnv = withRemarq({ env: { [TOKEN_ENV]: 'mine', OTHER: '1' } }, { production: true });
    expect(withUserEnv.env).toEqual({ [TOKEN_ENV]: 'mine', OTHER: '1' });
  });

  it('keeps the token in development with production: true and without a config file', () => {
    process.chdir(dir);
    process.env.NODE_ENV = 'development';
    expect(withRemarq({}, { production: true }).env).toEqual({ [TOKEN_ENV]: 'tok-abcdefghijklmnop' });

    const bare = mkdtempSync(join(tmpdir(), 'remarq-none-'));
    process.chdir(bare);
    expect(withRemarq({}).env).toBeUndefined();
    expect(withRemarq({ env: { OTHER: '1' } }).env).toEqual({ OTHER: '1' });
  });
});
