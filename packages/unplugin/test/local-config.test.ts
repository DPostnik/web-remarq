import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import unplugin from '../src/index';
import { CONFIG_ENDPOINT, readLocalConfig, resolveAgentRoot } from '../src/local-config';

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

const EXPECTED = { projectId: 'prj_x', token: 'tok-abcdefghijklmnop' };

describe('readLocalConfig', () => {
  it('finds .remarq/config.json at the git root from a monorepo app', () => {
    writeConfig(dir);
    mkdirSync(join(dir, '.git'));
    const app = join(dir, 'packages', 'web');
    mkdirSync(app, { recursive: true });
    expect(readLocalConfig(app)).toEqual(EXPECTED);
    expect(readLocalConfig(dir)).toEqual(EXPECTED);
  });

  it('never reads a .remarq above the git root (a .git file counts too)', () => {
    writeConfig(dir);
    const repo = join(dir, 'other-project');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, '.git'), 'gitdir: elsewhere\n');
    expect(readLocalConfig(join(repo, 'src'))).toBeNull();
    expect(readLocalConfig(repo)).toBeNull();
  });

  it('outside a git repository looks only in the start directory', () => {
    writeConfig(dir);
    const app = join(dir, 'app');
    mkdirSync(app);
    expect(readLocalConfig(app)).toBeNull();
    expect(readLocalConfig(dir)).toEqual(EXPECTED);
  });

  it('reports the running server port from server.lock, else the config port, and ignores invalid ones', () => {
    writeConfig(dir, { ...EXPECTED, port: 4100 });
    expect(readLocalConfig(dir)).toEqual({ ...EXPECTED, port: 4100 });
    writeFileSync(join(dir, '.remarq', 'server.lock'), JSON.stringify({ pid: 1, port: 4200 }));
    expect(readLocalConfig(dir)).toEqual({ ...EXPECTED, port: 4200 });
    writeFileSync(join(dir, '.remarq', 'server.lock'), JSON.stringify({ pid: 1, port: 'http://evil.example' }));
    expect(readLocalConfig(dir)).toEqual({ ...EXPECTED, port: 4100 });
    writeConfig(dir, { ...EXPECTED, port: 70000 });
    expect(readLocalConfig(dir)).toEqual(EXPECTED);
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

describe('resolveAgentRoot', () => {
  it('prefers the directory with .remarq, then the git root, then the current directory', () => {
    const app = join(dir, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    expect(resolveAgentRoot(app)).toBe(process.cwd());
    mkdirSync(join(dir, '.git'));
    expect(resolveAgentRoot(app)).toBe(dir);
    writeConfig(join(dir, 'apps'));
    expect(resolveAgentRoot(app)).toBe(join(dir, 'apps'));
  });
});

describe('transform paths', () => {
  it('are relative to the agent root resolved from the Vite root, not the launch directory', () => {
    mkdirSync(join(dir, '.git'));
    writeConfig(dir);
    const app = join(dir, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    const plugin = unplugin.raw({}, { framework: 'vite' }) as {
      transform: (code: string, id: string) => { code: string } | undefined;
      vite: { configResolved: (c: { root: string }) => void };
    };
    plugin.vite.configResolved({ root: app });
    const result = plugin.transform('export const A = () => <div>hi</div>;', join(app, 'src', 'A.tsx'));
    expect(result?.code).toContain('data-remarq-source="apps/web/src/A.tsx:1:');
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
    writeFileSync(join(dir, '.remarq', 'server.lock'), JSON.stringify({ pid: 1, port: 4300 }));
    expect(JSON.parse(server.call(CONFIG_ENDPOINT).body!)).toEqual({ projectId: 'prj_x', token: 'tok-abcdefghijklmnop', port: 4300 });
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
