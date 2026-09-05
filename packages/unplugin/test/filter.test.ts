import { describe, expect, it } from 'vitest';
import { createFilter, DEFAULT_INCLUDE, expandBraces } from '../src/filter';

describe('expandBraces', () => {
  it('expands a single brace group into one pattern per alternative', () => {
    expect(expandBraces('src/**/*.{jsx,tsx}')).toEqual(['src/**/*.jsx', 'src/**/*.tsx']);
  });

  it('expands multiple groups as a cartesian product', () => {
    expect(expandBraces('{src,lib}/*.{js,ts}')).toEqual([
      'src/*.js',
      'src/*.ts',
      'lib/*.js',
      'lib/*.ts',
    ]);
  });

  it('returns brace-free patterns unchanged', () => {
    expect(expandBraces('src/**/*.vue')).toEqual(['src/**/*.vue']);
  });
});

describe('createFilter — brace patterns (regression: CLI-generated include)', () => {
  // `npx @web-remarq/cli init` used to print `include: ['src/**/*.{jsx,tsx}']` for
  // React apps. The filter escaped `{` and `}` literally, so App.tsx never matched and
  // annotations shipped without file:line:col. Brace groups must expand for real.
  it('matches src/App.tsx against src/**/*.{jsx,tsx}', () => {
    const filter = createFilter(['src/**/*.{jsx,tsx}']);
    expect(filter('src/App.tsx')).toBe(true);
    expect(filter('src/App.jsx')).toBe(true);
    expect(filter('src/components/deep/Button.tsx')).toBe(true);
    expect(filter('src/utils.ts')).toBe(false);
    expect(filter('lib/App.tsx')).toBe(false);
  });

  it('matches the vanilla-vite pattern **/*.{jsx,tsx,vue} anywhere in the tree', () => {
    const filter = createFilter(['**/*.{jsx,tsx,vue}']);
    expect(filter('src/App.vue')).toBe(true);
    expect(filter('islands/Counter.tsx')).toBe(true);
    expect(filter('src/main.ts')).toBe(false);
  });
});

describe('createFilter — path shapes a bundler actually passes', () => {
  it('matches absolute ids the way Vite passes them', () => {
    const filter = createFilter(['src/**/*.tsx']);
    expect(filter('/Users/me/projects/app/src/App.tsx')).toBe(true);
    expect(filter('/Users/me/projects/app/src/pages/Home.tsx')).toBe(true);
    expect(filter('/Users/me/projects/app/vite.config.ts')).toBe(false);
  });

  it('handles directories with spaces', () => {
    const filter = createFilter(['src/**/*.tsx']);
    expect(filter('/Users/me/my app/src/App.tsx')).toBe(true);
    expect(filter('/Users/me/my app/src/my components/Card.tsx')).toBe(true);
  });

  it('normalizes Windows drive paths and backslashes', () => {
    const filter = createFilter(['src/**/*.{jsx,tsx}']);
    expect(filter('C:\\proj\\src\\App.tsx')).toBe(true);
    expect(filter('C:\\proj\\src\\nested\\Comp.jsx')).toBe(true);
    expect(filter('C:\\proj\\node_modules\\lib\\src\\App.tsx')).toBe(false);
  });

  it('applies the default exclude to brace-expanded includes', () => {
    const filter = createFilter(['**/*.{jsx,tsx}']);
    expect(filter('/app/node_modules/react/index.tsx')).toBe(false);
  });

  it('uses the default include when called without arguments', () => {
    const filter = createFilter();
    expect(DEFAULT_INCLUDE).toEqual(['**/*.jsx', '**/*.tsx', '**/*.vue']);
    expect(filter('/app/src/App.vue')).toBe(true);
    expect(filter('/app/src/App.ts')).toBe(false);
  });
});
