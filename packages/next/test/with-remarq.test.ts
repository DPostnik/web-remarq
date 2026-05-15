import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withRemarq } from '../src/index';

const require_ = createRequire(import.meta.url);
const nextPkgPath = require_.resolve('next/package.json');
const originalEnv = process.env.NODE_ENV;

function setNextVersion(version: string) {
  require_.cache[nextPkgPath] = {
    id: nextPkgPath,
    filename: nextPkgPath,
    loaded: true,
    exports: { version },
  } as NodeModule;
}

afterEach(() => {
  process.env.NODE_ENV = originalEnv;
  setNextVersion('16.2.1');
});

function mockNextVersion(version: string) {
  setNextVersion(version);
}

describe('withRemarq — production gating', () => {
  it('returns config unchanged in production by default', () => {
    process.env.NODE_ENV = 'production';
    const config = { distDir: 'out' };
    const result = withRemarq(config);
    expect(result).toBe(config);
  });

  it('adds webpack rule in production when production: true', () => {
    process.env.NODE_ENV = 'production';
    const result = withRemarq({}, { production: true });
    expect(result).toHaveProperty('webpack');
  });
});

describe('withRemarq — webpack rule injection', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('always returns a webpack function', () => {
    const result = withRemarq({});
    expect(typeof result.webpack).toBe('function');
  });

  it('webpack function adds a jsx/tsx rule', () => {
    const result = withRemarq({});
    const webpackConfig = { module: { rules: [] as unknown[] } };
    result.webpack(webpackConfig, {});
    const added = webpackConfig.module.rules.find(
      (r: unknown) => (r as { test?: RegExp }).test instanceof RegExp && (r as { test: RegExp }).test.source === '\\.(jsx|tsx)$',
    ) as { exclude: unknown; use: Array<{ loader: string }> };
    expect(added).toBeDefined();
    expect(added).toHaveProperty('exclude');
    expect(added.use).toHaveLength(1);
    expect(added.use[0]).toHaveProperty('loader');
  });

  it('webpack function initialises module.rules if absent', () => {
    const result = withRemarq({});
    const webpackConfig = {} as { module: { rules: unknown[] } };
    result.webpack(webpackConfig, {});
    expect(webpackConfig.module.rules).toHaveLength(1);
  });

  it('calls the existing webpack function and returns its result', () => {
    const sentinel = { module: { rules: ['original'] } };
    const existingWebpack = vi.fn(() => sentinel);
    const result = withRemarq({ webpack: existingWebpack });
    const webpackConfig = { module: { rules: [] } };
    const returned = result.webpack(webpackConfig, { ctx: true });
    expect(existingWebpack).toHaveBeenCalledWith(webpackConfig, { ctx: true });
    expect(returned).toBe(sentinel);
  });

  it('returns webpack config when no existing webpack function', () => {
    const result = withRemarq({});
    const webpackConfig = { module: { rules: [] } };
    const returned = result.webpack(webpackConfig, {});
    expect(returned).toBe(webpackConfig);
  });
});

describe('withRemarq — turbopack Next 16+ (top-level turbopack.rules)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    mockNextVersion('16.0.0');
  });

  it('adds turbopack.rules for *.{jsx,tsx}', () => {
    const result = withRemarq({});
    expect(result.turbopack).toBeDefined();
    expect(result.turbopack.rules['*.{jsx,tsx}']).toBeDefined();
    expect(result.turbopack.rules['*.{jsx,tsx}'].loaders).toHaveLength(1);
  });

  it('does not set experimental.turbo for Next 16+', () => {
    const result = withRemarq({});
    expect(result.experimental?.turbo).toBeUndefined();
  });

  it('preserves existing turbopack config', () => {
    const result = withRemarq({ turbopack: { resolveAlias: { foo: 'bar' } } });
    expect(result.turbopack.resolveAlias).toEqual({ foo: 'bar' });
    expect(result.turbopack.rules['*.{jsx,tsx}']).toBeDefined();
  });

  it('preserves existing turbopack rules', () => {
    const result = withRemarq({
      turbopack: { rules: { '*.svg': { loaders: [{ loader: 'raw' }] } } },
    });
    expect(result.turbopack.rules['*.svg']).toBeDefined();
    expect(result.turbopack.rules['*.{jsx,tsx}']).toBeDefined();
  });
});

describe('withRemarq — turbopack Next 14–15 (experimental.turbo.rules)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('adds experimental.turbo.rules for *.{jsx,tsx} on Next 14', () => {
    mockNextVersion('14.0.0');
    const result = withRemarq({});
    expect(result.experimental?.turbo?.rules['*.{jsx,tsx}']).toBeDefined();
    expect(result.experimental.turbo.rules['*.{jsx,tsx}'].loaders).toHaveLength(1);
  });

  it('adds experimental.turbo.rules on Next 15', () => {
    mockNextVersion('15.2.0');
    const result = withRemarq({});
    expect(result.experimental?.turbo?.rules['*.{jsx,tsx}']).toBeDefined();
  });

  it('does not set top-level turbopack for Next 14–15', () => {
    mockNextVersion('14.0.0');
    const result = withRemarq({});
    expect(result.turbopack).toBeUndefined();
  });

  it('preserves existing experimental properties', () => {
    mockNextVersion('14.0.0');
    const result = withRemarq({ experimental: { reactCompiler: true } });
    expect((result.experimental as { reactCompiler: boolean }).reactCompiler).toBe(true);
    expect(result.experimental.turbo.rules['*.{jsx,tsx}']).toBeDefined();
  });

  it('preserves existing experimental.turbo properties', () => {
    mockNextVersion('14.0.0');
    const result = withRemarq({
      experimental: { turbo: { resolveAlias: { lodash: 'lodash-es' } } },
    });
    expect(result.experimental.turbo.resolveAlias).toEqual({ lodash: 'lodash-es' });
    expect(result.experimental.turbo.rules['*.{jsx,tsx}']).toBeDefined();
  });

  it('preserves existing experimental.turbo.rules', () => {
    mockNextVersion('15.0.0');
    const result = withRemarq({
      experimental: { turbo: { rules: { '*.svg': { loaders: [] } } } },
    });
    expect(result.experimental.turbo.rules['*.svg']).toBeDefined();
    expect(result.experimental.turbo.rules['*.{jsx,tsx}']).toBeDefined();
  });
});

describe('withRemarq — no turbopack (Next 13 or detection failure)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('adds only webpack rule when version is unparseable', () => {
    mockNextVersion('invalid');
    const result = withRemarq({});
    expect(result).toHaveProperty('webpack');
    expect(result.turbopack).toBeUndefined();
    expect(result.experimental?.turbo).toBeUndefined();
  });

  it('adds only webpack rule for Next 13', () => {
    mockNextVersion('13.5.0');
    const result = withRemarq({});
    expect(result).toHaveProperty('webpack');
    expect(result.turbopack).toBeUndefined();
    expect(result.experimental?.turbo).toBeUndefined();
  });
});

describe('withRemarq — config preservation', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('preserves existing nextConfig properties', () => {
    const result = withRemarq({ distDir: 'build', output: 'standalone' });
    expect(result.distDir).toBe('build');
    expect(result.output).toBe('standalone');
  });

  it('does not mutate the original config object', () => {
    const original = { distDir: 'build' };
    withRemarq(original);
    expect(original).not.toHaveProperty('webpack');
  });

  it('loader config includes a loader path string', () => {
    const result = withRemarq({});
    const webpackConfig = { module: { rules: [] as unknown[] } };
    result.webpack(webpackConfig, {});
    const rule = webpackConfig.module.rules[0] as { use: Array<{ loader: string }> };
    expect(typeof rule.use[0].loader).toBe('string');
    expect(rule.use[0].loader).toContain('loader');
  });
});
