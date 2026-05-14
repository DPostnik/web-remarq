import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformJSX } from '../src/transform';

const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

describe('transformJSX — component name detection via snapshots', () => {
  it('detects function declaration name', () => {
    const code = loadFixture('function-component.input.tsx');
    const result = transformJSX(code, 'src/Greeting.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('detects arrow component assigned to const', () => {
    const code = loadFixture('arrow-component.input.tsx');
    const result = transformJSX(code, 'src/Card.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('detects const Foo = memo(() => ...) (HOC wrapped)', () => {
    const code = loadFixture('hoc-memo.input.tsx');
    const result = transformJSX(code, 'src/HeavyList.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('detects class component name', () => {
    const code = loadFixture('class-component.input.tsx');
    const result = transformJSX(code, 'src/Counter.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('detects export default function name', () => {
    const code = loadFixture('export-default-function.input.tsx');
    const result = transformJSX(code, 'src/App.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('assigns each JSX element to its own enclosing component', () => {
    const code = loadFixture('nested-components.input.tsx');
    const result = transformJSX(code, 'src/Page.tsx');
    expect(result?.code).toMatchSnapshot();
  });
});

describe('transformJSX — skip conditions', () => {
  it('skips JSX fragments (<>...</>) but still transforms children', () => {
    const code = loadFixture('fragment.input.tsx');
    const result = transformJSX(code, 'src/List.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('does not re-annotate elements that already have data-remarq-source', () => {
    const code = loadFixture('already-annotated.input.tsx');
    const result = transformJSX(code, 'src/Already.tsx');
    expect(result?.code).toMatchSnapshot();
  });

  it('returns null for files with no JSX', () => {
    const code = loadFixture('no-jsx.input.tsx');
    const result = transformJSX(code, 'src/utils.tsx');
    expect(result).toBeNull();
  });

  it('returns null for unparseable code', () => {
    const result = transformJSX('const x = (', 'src/broken.tsx');
    expect(result).toBeNull();
  });

  it('returns null when every JSX element is already annotated (modified=false)', () => {
    const code = `function X() { return <div data-remarq-source="x:1:0">y</div>; }`;
    const result = transformJSX(code, 'src/X.tsx');
    expect(result).toBeNull();
  });
});

describe('transformJSX — output sanity', () => {
  it('produces a sourcemap object', () => {
    const code = loadFixture('function-component.input.tsx');
    const result = transformJSX(code, 'src/Greeting.tsx');
    expect(result?.map).toBeDefined();
    expect(typeof result?.map.toString).toBe('function');
  });

  it('encodes file path with forward slashes in injected attr', () => {
    const code = `function F() { return <div>x</div>; }`;
    const result = transformJSX(code, 'src/components/Form.tsx');
    expect(result?.code).toContain('data-remarq-source="src/components/Form.tsx:');
  });
});
