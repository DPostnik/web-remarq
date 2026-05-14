import { beforeEach, describe, expect, it } from 'vitest';
import { createFingerprint } from './fingerprint';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  const el = document.body.firstElementChild as HTMLElement;
  if (!el) throw new Error('mount: no element');
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createFingerprint — P1 stable anchors', () => {
  it('captures data-annotate', () => {
    const el = mount('<button data-annotate="save-btn">Save</button>');
    expect(createFingerprint(el).dataAnnotate).toBe('save-btn');
  });

  it('captures data-testid, data-test, data-cy in that fallback order', () => {
    expect(createFingerprint(mount('<div data-testid="t1"></div>')).dataTestId).toBe('t1');
    expect(createFingerprint(mount('<div data-test="t2"></div>')).dataTestId).toBe('t2');
    expect(createFingerprint(mount('<div data-cy="t3"></div>')).dataTestId).toBe('t3');
    expect(createFingerprint(mount('<div data-testid="t1" data-test="t2"></div>')).dataTestId).toBe('t1');
  });

  it('captures stable id, drops hashed id', () => {
    expect(createFingerprint(mount('<div id="header"></div>')).id).toBe('header');
    expect(createFingerprint(mount('<div id="css-1a2b3c"></div>')).id).toBeNull();
    expect(createFingerprint(mount('<div></div>')).id).toBeNull();
  });

  it('respects custom dataAttribute option', () => {
    const el = mount('<button data-qa="save">Save</button>');
    expect(createFingerprint(el, { dataAttribute: 'data-qa' }).dataAnnotate).toBe('save');
  });
});

describe('createFingerprint — P2 semantics', () => {
  it('captures lowercase tagName', () => {
    expect(createFingerprint(mount('<BUTTON></BUTTON>')).tagName).toBe('button');
  });

  it('captures direct text content', () => {
    expect(createFingerprint(mount('<button>Click me</button>')).textContent).toBe('Click me');
  });

  it('trims whitespace from text content', () => {
    expect(createFingerprint(mount('<button>   Click   </button>')).textContent).toBe('Click');
  });

  it('truncates long text at 50 chars', () => {
    const longText = 'a'.repeat(80);
    const result = createFingerprint(mount(`<p>${longText}</p>`)).textContent;
    expect(result).toHaveLength(50);
  });

  it('returns null when no text is present', () => {
    expect(createFingerprint(mount('<div></div>')).textContent).toBeNull();
  });

  it('falls back to nested text for shallow wrappers (≤3 children)', () => {
    const el = mount('<span><b>Bold</b></span>');
    expect(createFingerprint(el).textContent).toBe('Bold');
  });

  it('captures role and aria-label', () => {
    const el = mount('<div role="button" aria-label="Close dialog"></div>');
    const fp = createFingerprint(el);
    expect(fp.role).toBe('button');
    expect(fp.ariaLabel).toBe('Close dialog');
  });
});

describe('createFingerprint — P3 structure', () => {
  it('builds stableClasses (hash classes stripped/filtered)', () => {
    const el = mount('<button class="btn primary sc-bdvvtL css-1a2b3c"></button>');
    expect(createFingerprint(el).stableClasses).toEqual(['btn', 'primary']);
  });

  it('strips CSS Modules hash from stableClasses', () => {
    const el = mount('<button class="Button__abc123 flex"></button>');
    expect(createFingerprint(el).stableClasses).toEqual(['Button', 'flex']);
  });

  it('builds domPath up to 5 levels with first two stable classes per segment', () => {
    mount(`
      <div class="app">
        <main class="content area">
          <section>
            <button class="btn primary">Save</button>
          </section>
        </main>
      </div>
    `);
    const btn = document.querySelector('button')!;
    const path = createFingerprint(btn as HTMLElement).domPath;
    expect(path).toContain('button.btn.primary');
    expect(path).toContain('main.content.area');
    expect(path).toContain('section');
    expect(path.split(' > ').length).toBeLessThanOrEqual(5);
  });

  it('records siblingIndex among parent children', () => {
    mount(`
      <ul>
        <li>a</li>
        <li>b</li>
        <li>c</li>
      </ul>
    `);
    const items = document.querySelectorAll('li');
    expect(createFingerprint(items[0] as HTMLElement).siblingIndex).toBe(0);
    expect(createFingerprint(items[1] as HTMLElement).siblingIndex).toBe(1);
    expect(createFingerprint(items[2] as HTMLElement).siblingIndex).toBe(2);
  });
});

describe('createFingerprint — P4 parent context', () => {
  it('finds nearest ancestor with data-annotate', () => {
    mount(`
      <section data-annotate="checkout">
        <div>
          <button>Pay</button>
        </div>
      </section>
    `);
    const btn = document.querySelector('button')!;
    expect(createFingerprint(btn as HTMLElement).parentAnchor).toBe('checkout');
  });

  it('returns null when no ancestor has the anchor attribute', () => {
    mount('<div><button>x</button></div>');
    const btn = document.querySelector('button')!;
    expect(createFingerprint(btn as HTMLElement).parentAnchor).toBeNull();
  });

  it('respects custom dataAttribute when scanning ancestors', () => {
    mount(`
      <section data-qa="checkout">
        <button>Pay</button>
      </section>
    `);
    const btn = document.querySelector('button')!;
    expect(createFingerprint(btn as HTMLElement, { dataAttribute: 'data-qa' }).parentAnchor).toBe('checkout');
  });
});

describe('createFingerprint — P5 raw classes & CSS modules', () => {
  it('preserves rawClasses as-is, including hashed ones', () => {
    const el = mount('<button class="btn Button__abc123 sc-xyz"></button>');
    expect(createFingerprint(el).rawClasses).toEqual(['btn', 'Button__abc123', 'sc-xyz']);
  });

  it('decomposes 3-segment CSS Modules classes into cssModules', () => {
    const el = mount('<div class="lucky-banners__luckyBanners__cEqts"></div>');
    expect(createFingerprint(el).cssModules).toEqual([
      { raw: 'lucky-banners__luckyBanners__cEqts', moduleHint: 'lucky-banners', localName: 'luckyBanners' },
    ]);
  });

  it('returns empty cssModules when no 3-segment classes', () => {
    const el = mount('<div class="flex primary"></div>');
    expect(createFingerprint(el).cssModules).toEqual([]);
  });
});

describe('createFingerprint — P6 source location', () => {
  it('uses Level 1 plugin attrs (data-remarq-source) and clears detected fields', () => {
    const el = mount('<button data-remarq-source="src/Foo.tsx:10:2" data-remarq-component="Foo"></button>');
    const fp = createFingerprint(el);
    expect(fp.sourceLocation).toBe('src/Foo.tsx:10:2');
    expect(fp.componentName).toBe('Foo');
    expect(fp.detectedSource).toBeNull();
    expect(fp.detectedComponent).toBeNull();
  });

  it('falls back to Level 2 detection via data-source when no plugin attrs', () => {
    const el = mount('<button data-source="external/path.tsx:5:0"></button>');
    const fp = createFingerprint(el);
    expect(fp.sourceLocation).toBeNull();
    expect(fp.componentName).toBeNull();
    expect(fp.detectedSource).toBe('external/path.tsx:5:0');
  });

  it('returns null source fields when nothing is available', () => {
    const el = mount('<button>x</button>');
    const fp = createFingerprint(el);
    expect(fp.sourceLocation).toBeNull();
    expect(fp.componentName).toBeNull();
    expect(fp.detectedSource).toBeNull();
    expect(fp.detectedComponent).toBeNull();
  });
});
