import { describe, it, expect } from 'vitest';
import { transformJSX, transformVueSFC } from '../src/transform-entry';

describe('transform subpath entry', () => {
  it('re-exports transformJSX and stamps source attributes', () => {
    const out = transformJSX('export default function App() { return <div>hi</div> }', 'src/App.tsx');
    expect(out?.code).toContain('data-remarq-source');
    expect(out?.code).toContain('data-remarq-component="App"');
  });

  it('re-exports transformVueSFC', () => {
    const out = transformVueSFC('<template>\n  <div>hi</div>\n</template>', 'src/App.vue');
    expect(out?.code).toContain('data-remarq-source');
  });
});
