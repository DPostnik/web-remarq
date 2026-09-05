import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import unplugin from '../src/index';
import { CONFIG_ENDPOINT, readLocalConfig } from '../src/local-config';

let dir: string;
const originalEnv = process.env.NODE_ENV;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remarq-unplugin-cfg-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.NODE_ENV = originalEnv;
});

function writeConfig(root: string, body: unknown = { projectId: 'prj_x', token: 'tok-abcdefghijklmnop', allowedOrigins: [] }) {
  mkdirSync(join(root, '.remarq'), { recursive: true });
  writeFileSync(join(root, '.remarq', 'config.json'), JSON.stringify(body));
}

describe('readLocalConfig', () => {
  it('finds .remarq/config.json at the given dir or any parent (monorepo app inside a repo)', () => {
    writeConfig(dir);
    const app = join(dir, 'packages', 'web');
    mkdirSync(app, { recursive: true });
    expect(readLocalConfig(app)).toEqual({ projectId: 'prj_x', token: 'tok-abcdefghijklmnop' });
    expect(readLocalConfig(dir)).toEqual({ projectId: 'prj_x', token: 'tok-abcdefghijklmnop' });
  });

  it('returns null when absent or malformed, and only exposes projectId + token', () => {
    expect(readLocalConfig(dir)).toBeNull();
    writeConfig(dir, { projectId: 'p' });
    expect(readLocalConfig(dir)).toBeNull();
    mkdirSync(join(dir, '.remarq'), { recursive: true });
    writeFileSync(join(dir, '.remarq', 'config.json'), '{ nope');
    expect(readLocalConfig(dir)).toBeNull();
  });
});

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
  setHeader(n: string, v: string): void;
  end(b?: string): void;
}

function fakeServer(root: string) {
  const routes = new Map<string, (req: { method: string }, res: FakeRes, next: () => void) => void>();
  return {
    config: { root },
    middlewares: { use: (path: string, fn: (req: { method: string }, res: FakeRes, next: () => void) => void) => routes.set(path, fn) },
    routes,
    call(path: string, method = 'GET'): FakeRes & { nextCalled: boolean } {
      const res = { statusCode: 200, headers: {}, body: undefined, nextCalled: false } as FakeRes & { nextCalled: boolean };
      res.setHeader = (n, v) => { res.headers[n] = v };
      res.end = (b) => { res.body = b };
      routes.get(path)!({ method }, res, () => { res.nextCalled = true });
      return res;
    },
  };
}

describe('vite configureServer pairing endpoint', () => {
  it('serves the token from .remarq/config.json to the dev app, with no-store caching', () => {
    process.env.NODE_ENV = 'development';
    writeConfig(dir);
    const plugin = unplugin.raw({}, { framework: 'vite' }) as { vite?: { configureServer?: (s: unknown) => void } };
    const server = fakeServer(dir);
    plugin.vite!.configureServer!(server);
    const res = server.call(CONFIG_ENDPOINT);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body!)).toEqual({ projectId: 'prj_x', token: 'tok-abcdefghijklmnop' });
    expect(server.call(CONFIG_ENDPOINT, 'POST').nextCalled).toBe(true);
  });

  it('answers 404 when no config exists, and registers nothing in production', () => {
    process.env.NODE_ENV = 'development';
    const plugin = unplugin.raw({}, { framework: 'vite' }) as { vite?: { configureServer?: (s: unknown) => void } };
    const server = fakeServer(dir);
    plugin.vite!.configureServer!(server);
    expect(server.call(CONFIG_ENDPOINT).statusCode).toBe(404);

    process.env.NODE_ENV = 'production';
    const prodServer = fakeServer(dir);
    plugin.vite!.configureServer!(prodServer);
    expect(prodServer.routes.size).toBe(0);
  });
});
