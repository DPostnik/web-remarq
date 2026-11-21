import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import unplugin from '../src/index';
import { WIDGET_MODULE_ID, WIDGET_RESOLVED_ID, WIDGET_SCRIPT_SRC, widgetModuleSource } from '../src/widget';

interface ViteHooks {
  resolveId(id: string): string | undefined;
  load(id: string): string | undefined;
  transformIndexHtml(html: string, ctx: unknown): unknown;
}

const originalEnv = process.env.NODE_ENV;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'remarq-unplugin-widget-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env.NODE_ENV = originalEnv;
  vi.restoreAllMocks();
});

function hooks(options: Parameters<typeof unplugin.raw>[0]): ViteHooks {
  return (unplugin.raw(options, { framework: 'vite' }) as { vite: ViteHooks }).vite;
}

/** A project directory in which `web-remarq` resolves (or not). */
function project(installed: boolean): string {
  if (installed) {
    const pkg = join(dir, 'node_modules', 'web-remarq');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'web-remarq', version: '0.0.0', main: 'index.cjs' }));
    writeFileSync(join(pkg, 'index.cjs'), 'module.exports = {}');
  }
  return dir;
}

const devCtx = (root: string, logger?: { warn(m: string): void }) => ({ server: { config: { root, logger } } });

describe('widget injection (Vite dev)', () => {
  it('injects one module script when widget is on and web-remarq resolves', () => {
    process.env.NODE_ENV = 'development';
    const tags = hooks({ widget: true }).transformIndexHtml('<html></html>', devCtx(project(true)));
    expect(tags).toEqual([{ tag: 'script', attrs: { type: 'module', src: WIDGET_SCRIPT_SRC }, injectTo: 'body' }]);
  });

  it('injects nothing without the option (default) or with widget: false', () => {
    process.env.NODE_ENV = 'development';
    const root = project(true);
    expect(hooks({}).transformIndexHtml('', devCtx(root))).toBeUndefined();
    expect(hooks({ widget: false }).transformIndexHtml('', devCtx(root))).toBeUndefined();
    expect(hooks({}).resolveId(WIDGET_MODULE_ID)).toBeUndefined();
    expect(hooks({}).load(WIDGET_RESOLVED_ID)).toBeUndefined();
  });

  it('injects and serves nothing in production, even with production: true', () => {
    process.env.NODE_ENV = 'production';
    const root = project(true);
    for (const options of [{ widget: true }, { widget: true, production: true }]) {
      const h = hooks(options);
      expect(h.transformIndexHtml('', devCtx(root))).toBeUndefined();
      expect(h.resolveId(WIDGET_MODULE_ID)).toBeUndefined();
      expect(h.load(WIDGET_RESOLVED_ID)).toBeUndefined();
    }
  });

  it('injects nothing outside the dev server (no ctx.server, e.g. vite build)', () => {
    process.env.NODE_ENV = 'development';
    expect(hooks({ widget: true }).transformIndexHtml('', { path: '/index.html' })).toBeUndefined();
  });

  it('warns once and skips injection when web-remarq cannot be resolved', () => {
    process.env.NODE_ENV = 'development';
    const warn = vi.fn();
    const h = hooks({ widget: true });
    const root = project(false);
    expect(h.transformIndexHtml('', devCtx(root, { warn }))).toBeUndefined();
    expect(h.transformIndexHtml('', devCtx(root, { warn }))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('"web-remarq"');
  });

  it('resolves and loads the virtual module only for its own id', () => {
    process.env.NODE_ENV = 'development';
    const h = hooks({ widget: true });
    expect(h.resolveId(WIDGET_MODULE_ID)).toBe(WIDGET_RESOLVED_ID);
    expect(h.resolveId('something-else')).toBeUndefined();
    expect(h.load(WIDGET_RESOLVED_ID)).toContain("from 'web-remarq'");
    expect(h.load('other')).toBeUndefined();
  });
});

describe('widget virtual module content', () => {
  it('defaults to simple mode with HttpStorageAdapter', () => {
    const src = widgetModuleSource(true);
    expect(src).toContain("import { WebRemarq, HttpStorageAdapter } from 'web-remarq'");
    expect(src).toContain('WebRemarq.init({ ...{"simple":true}, storage: new HttpStorageAdapter() })');
  });

  it('passes simple, position and theme through', () => {
    expect(widgetModuleSource({ simple: false, position: 'top-left', theme: 'dark' }))
      .toContain('{"simple":false,"position":"top-left","theme":"dark"}');
    expect(widgetModuleSource({ position: 'top-right' })).toContain('{"simple":true,"position":"top-right"}');
  });

  it('never turns option values into code: unknown keys and invalid values are dropped', () => {
    const evil = { simple: true, position: '");alert(1);//', theme: 'x', storage: 'bad', extra: '</script>' } as never;
    const src = widgetModuleSource(evil);
    expect(src).toContain('{"simple":true}');
    expect(src).not.toContain('alert');
    expect(src).not.toContain('</script>');
  });
});
