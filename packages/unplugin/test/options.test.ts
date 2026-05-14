import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import unplugin from '../src/index';

interface RawHooks {
  name: string;
  transformInclude: (id: string) => boolean;
  transform: (code: string, id: string) => unknown;
}

function makeRaw(opts: Parameters<typeof unplugin.raw>[0] = {}): RawHooks {
  return unplugin.raw(opts, { framework: 'rollup' }) as RawHooks;
}

const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
});

describe('unplugin — include / exclude filters', () => {
  it('includes default JSX/TSX/Vue patterns', () => {
    const plugin = makeRaw();
    expect(plugin.transformInclude('src/App.jsx')).toBe(true);
    expect(plugin.transformInclude('src/App.tsx')).toBe(true);
    expect(plugin.transformInclude('src/App.vue')).toBe(true);
  });

  it('rejects files outside default include patterns', () => {
    const plugin = makeRaw();
    expect(plugin.transformInclude('src/utils.ts')).toBe(false);
    expect(plugin.transformInclude('src/styles.css')).toBe(false);
    expect(plugin.transformInclude('package.json')).toBe(false);
  });

  it('excludes node_modules by default', () => {
    const plugin = makeRaw();
    expect(plugin.transformInclude('node_modules/react/App.tsx')).toBe(false);
    expect(plugin.transformInclude('some/path/node_modules/lib/x.tsx')).toBe(false);
  });

  it('respects custom include patterns', () => {
    const plugin = makeRaw({ include: ['**/*.svelte'] });
    expect(plugin.transformInclude('src/App.svelte')).toBe(true);
    expect(plugin.transformInclude('deep/nested/dir/App.svelte')).toBe(true);
    expect(plugin.transformInclude('src/App.tsx')).toBe(false);
  });

  it('supports /**/ matching zero path segments (src/**/*.svelte → src/App.svelte)', () => {
    const plugin = makeRaw({ include: ['src/**/*.svelte'] });
    expect(plugin.transformInclude('src/App.svelte')).toBe(true);
    expect(plugin.transformInclude('src/components/App.svelte')).toBe(true);
    expect(plugin.transformInclude('src/a/b/c/App.svelte')).toBe(true);
    expect(plugin.transformInclude('lib/App.svelte')).toBe(false);
  });

  it('respects custom exclude patterns', () => {
    const plugin = makeRaw({ exclude: ['**/legacy/**'] });
    expect(plugin.transformInclude('src/App.tsx')).toBe(true);
    expect(plugin.transformInclude('src/legacy/Old.tsx')).toBe(false);
  });

  it('normalizes Windows backslash paths', () => {
    const plugin = makeRaw();
    expect(plugin.transformInclude('src\\components\\App.tsx')).toBe(true);
    expect(plugin.transformInclude('node_modules\\react\\App.tsx')).toBe(false);
  });
});

describe('unplugin — production gating', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  it('rejects all files in production by default (production: false)', () => {
    const plugin = makeRaw();
    expect(plugin.transformInclude('src/App.tsx')).toBe(false);
    expect(plugin.transformInclude('src/App.vue')).toBe(false);
  });

  it('allows files in production when production: true', () => {
    const plugin = makeRaw({ production: true });
    expect(plugin.transformInclude('src/App.tsx')).toBe(true);
    expect(plugin.transformInclude('src/App.vue')).toBe(true);
  });

  it('still applies include/exclude filters when production: true', () => {
    const plugin = makeRaw({ production: true });
    expect(plugin.transformInclude('src/utils.ts')).toBe(false);
    expect(plugin.transformInclude('node_modules/x/y.tsx')).toBe(false);
  });
});

describe('unplugin — transform dispatch', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('routes .vue files through Vue SFC transform', () => {
    const plugin = makeRaw();
    const result = plugin.transform(
      `<template><div>x</div></template>`,
      '/abs/path/src/Card.vue',
    ) as { code: string } | undefined;
    expect(result?.code).toContain('data-remarq-source=');
    expect(result?.code).toContain('data-remarq-component="Card"');
  });

  it('routes .tsx files through JSX transform', () => {
    const plugin = makeRaw();
    const result = plugin.transform(
      `function App() { return <div>x</div>; }`,
      '/abs/path/src/App.tsx',
    ) as { code: string } | undefined;
    expect(result?.code).toContain('data-remarq-component="App"');
  });

  it('returns undefined for files with no transformable content', () => {
    const plugin = makeRaw();
    const result = plugin.transform(
      `export const PI = 3.14;`,
      '/abs/path/src/utils.tsx',
    );
    expect(result).toBeUndefined();
  });
});
