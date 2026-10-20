import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression for 0.3.0: `import withRemarq from "@web-remarq/next"` from a
// next.config.mjs crashed on `__require.resolve` and detected Next major 0.
// Runs against the built output, so `npm run build -w packages/next` first.
const distDir = resolve(__dirname, '..', 'dist');
const esmEntry = resolve(distDir, 'index.js');
const cjsEntry = resolve(distDir, 'index.cjs');
const require_ = createRequire(import.meta.url);

describe.skipIf(!existsSync(esmEntry))('built package', () => {
  it('ESM entry loads, resolves the loader and detects the Next version', async () => {
    process.env.NODE_ENV = 'development';
    const mod = (await import(pathToFileURL(esmEntry).href)) as {
      default: (c: Record<string, unknown>) => Record<string, any>;
    };
    const result = mod.default({});
    const webpackConfig = { module: { rules: [] as Array<{ use: Array<{ loader: string }> }> } };
    result.webpack(webpackConfig, {});
    expect(webpackConfig.module.rules[0].use[0].loader).toMatch(/dist[\\/]loader\.(cjs|js)$/);
    // Installed Next is 16+: a failed version probe would leave this undefined.
    expect(result.turbopack ?? result.experimental?.turbo).toBeDefined();
  });

  it('CJS entry still works', () => {
    process.env.NODE_ENV = 'development';
    const mod = require_(cjsEntry) as { default: (c: Record<string, unknown>) => Record<string, any> };
    const result = mod.default({});
    expect(typeof result.webpack).toBe('function');
    expect(result.turbopack ?? result.experimental?.turbo).toBeDefined();
  });
});
