import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformVueSFC } from '../src/transform';

const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('transformVueSFC', () => {
  it('injects attrs on HTML elements inside <template>', () => {
    const code = loadFixture('simple.input.vue');
    const result = transformVueSFC(code, 'src/Card.vue');
    expect(result?.code).toMatchSnapshot();
  });

  it('derives component name from filename (without .vue)', () => {
    const code = `<template><div>x</div></template>`;
    const result = transformVueSFC(code, 'src/components/Hero.vue');
    expect(result?.code).toContain('data-remarq-component="Hero"');
  });

  it('skips Vue built-in tags: template, slot, component, transition, transition-group, keep-alive, teleport, suspense', () => {
    const code = loadFixture('builtins.input.vue');
    const result = transformVueSFC(code, 'src/Builtins.vue');
    expect(result?.code).toMatchSnapshot();
  });

  it('annotates nested elements with correct line numbers', () => {
    const code = loadFixture('nested.input.vue');
    const result = transformVueSFC(code, 'src/Nested.vue');
    expect(result?.code).toMatchSnapshot();
  });

  it('returns null for SFC without <template> block', () => {
    const code = loadFixture('no-template.input.vue');
    const result = transformVueSFC(code, 'src/NoTemplate.vue');
    expect(result).toBeNull();
  });

  it('returns null when all elements are already annotated', () => {
    const code = `<template><div data-remarq-source="x:1:0">x</div></template>`;
    const result = transformVueSFC(code, 'src/X.vue');
    expect(result).toBeNull();
  });

  it('does not re-annotate elements that already have data-remarq-source', () => {
    const code = `<template>
  <div data-remarq-source="manual.vue:1:0">manual</div>
  <span>auto</span>
</template>`;
    const result = transformVueSFC(code, 'src/Mixed.vue');
    expect(result?.code).toContain('data-remarq-source="manual.vue:1:0"');
    // span should get auto-annotated
    expect(result?.code).toMatch(/<span\s+data-remarq-source="src\/Mixed\.vue:/);
  });

  it('emits forward-slash file paths', () => {
    const code = `<template><div>x</div></template>`;
    const result = transformVueSFC(code, 'src/components/Form.vue');
    expect(result?.code).toContain('data-remarq-source="src/components/Form.vue:');
  });
});
