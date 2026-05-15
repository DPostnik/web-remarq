import { transformSync } from '@babel/core';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import plugin from '../src/index';

function transform(code: string, filename = '/project/src/App.tsx', options: Record<string, unknown> = {}) {
  const result = transformSync(code, {
    filename,
    plugins: [[plugin, options]],
    parserOpts: { plugins: ['jsx', 'typescript'] },
    configFile: false,
    babelrc: false,
  });
  return result?.code ?? null;
}

describe('component name detection', () => {
  it('detects function declaration name', () => {
    const code = `function Greeting() { return <div>hi</div>; }`;
    expect(transform(code)).toContain('data-remarq-component="Greeting"');
  });

  it('detects arrow component assigned to const', () => {
    const code = `const Card = () => <div>card</div>;`;
    expect(transform(code)).toContain('data-remarq-component="Card"');
  });

  it('detects memo-wrapped HOC name', () => {
    const code = `const Heavy = memo(() => <div>x</div>);`;
    expect(transform(code)).toContain('data-remarq-component="Heavy"');
  });

  it('detects class component name', () => {
    const code = `class Counter extends Component { render() { return <button>+</button>; } }`;
    expect(transform(code)).toContain('data-remarq-component="Counter"');
  });

  it('detects export class component name', () => {
    const code = `export class Counter extends Component { render() { return <button>+</button>; } }`;
    expect(transform(code)).toContain('data-remarq-component="Counter"');
  });

  it('detects export default function name', () => {
    const code = `export default function App() { return <main>x</main>; }`;
    expect(transform(code)).toContain('data-remarq-component="App"');
  });

  it('assigns each JSX element to its own closest enclosing component', () => {
    const code = `
      function Outer() {
        return <div><Inner /></div>;
      }
      function Inner() {
        return <span>inner</span>;
      }
    `;
    const result = transform(code)!;
    expect(result).toContain('data-remarq-component="Outer"');
    expect(result).toContain('data-remarq-component="Inner"');
  });
});

describe('source attribute', () => {
  it('injects data-remarq-source with line and column', () => {
    const code = `function F() { return <div>x</div>; }`;
    const result = transform(code, '/project/src/App.tsx')!;
    expect(result).toContain('data-remarq-source=');
    expect(result).toMatch(/data-remarq-source="[^"]+:\d+:\d+"/);
  });

  it('uses forward slashes in the relative path', () => {
    const cwd = process.cwd();
    const filename = `${cwd}/src/components/Form.tsx`;
    const code = `function F() { return <div>x</div>; }`;
    const result = transform(code, filename)!;
    expect(result).toContain('data-remarq-source="src/components/Form.tsx:');
  });
});

describe('skip conditions', () => {
  it('skips React.Fragment opening tag but transforms children', () => {
    const code = `function F() { return <React.Fragment><div>x</div></React.Fragment>; }`;
    const result = transform(code)!;
    expect(result).not.toContain('data-remarq-source="src/components/Form.tsx');
    expect(result).toContain('data-remarq-source=');
  });

  it('does not re-annotate elements with data-remarq-source', () => {
    const code = `function F() { return <div data-remarq-source="src/F.tsx:1:0">x</div>; }`;
    const result = transform(code)!;
    const matches = result.match(/data-remarq-source/g);
    expect(matches?.length).toBe(1);
  });

  it('transforms elements without existing annotation normally', () => {
    const code = `function F() { return <div>x</div>; }`;
    expect(transform(code)).toContain('data-remarq-source=');
  });
});

describe('production gating', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('skips transform in production by default', () => {
    const code = `function F() { return <div>x</div>; }`;
    expect(transform(code)).not.toContain('data-remarq-source');
  });

  it('transforms in production when production option is true', () => {
    const code = `function F() { return <div>x</div>; }`;
    expect(transform(code, '/project/src/App.tsx', { production: true })).toContain('data-remarq-source');
  });
});

describe('edge cases', () => {
  it('does not add data-remarq attrs when file has no JSX', () => {
    const code = `const x = 1 + 2;`;
    expect(transform(code)).not.toContain('data-remarq-source');
    expect(transform(code)).not.toContain('data-remarq-component');
  });

  it('omits data-remarq-component when JSX is outside any named function', () => {
    const code = `const el = <div>standalone</div>;`;
    const result = transform(code)!;
    expect(result).toContain('data-remarq-source=');
    expect(result).not.toContain('data-remarq-component');
  });
});
