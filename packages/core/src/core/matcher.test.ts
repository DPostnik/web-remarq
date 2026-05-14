import { beforeEach, describe, expect, it } from 'vitest';
import { levenshteinSimilarity, matchElement } from './matcher';
import type { ElementFingerprint } from './types';

function fp(overrides: Partial<ElementFingerprint>): ElementFingerprint {
  return {
    dataAnnotate: null,
    dataTestId: null,
    id: null,
    tagName: 'button',
    textContent: null,
    role: null,
    ariaLabel: null,
    stableClasses: [],
    domPath: '',
    siblingIndex: 0,
    parentAnchor: null,
    sourceLocation: null,
    componentName: null,
    detectedSource: null,
    detectedComponent: null,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
  });

  it('returns 0 when either string is empty', () => {
    expect(levenshteinSimilarity('', 'abc')).toBe(0);
    expect(levenshteinSimilarity('abc', '')).toBe(0);
  });

  it('returns proportional similarity for partial matches', () => {
    const sim = levenshteinSimilarity('kitten', 'sitting');
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });

  it('treats single-char-diff as high similarity for long strings', () => {
    expect(levenshteinSimilarity('abcdefghij', 'abcdefghik')).toBeCloseTo(0.9, 1);
  });
});

describe('matchElement — exact match chain', () => {
  it('matches by data-annotate', () => {
    document.body.innerHTML = `
      <button>nope</button>
      <button data-annotate="save">yes</button>
    `;
    const el = matchElement(fp({ dataAnnotate: 'save' }));
    expect(el?.textContent).toBe('yes');
  });

  it('honors custom dataAttribute when matching by anchor', () => {
    document.body.innerHTML = '<button data-qa="save">yes</button>';
    const el = matchElement(fp({ dataAnnotate: 'save' }), { dataAttribute: 'data-qa' });
    expect(el?.textContent).toBe('yes');
  });

  it('matches by data-testid', () => {
    document.body.innerHTML = '<div data-testid="hero"></div>';
    expect(matchElement(fp({ dataTestId: 'hero', tagName: 'div' }))).not.toBeNull();
  });

  it('matches by data-test as fallback for dataTestId', () => {
    document.body.innerHTML = '<div data-test="legacy"></div>';
    expect(matchElement(fp({ dataTestId: 'legacy', tagName: 'div' }))).not.toBeNull();
  });

  it('matches by id when no testid/anchor', () => {
    document.body.innerHTML = '<div id="header"></div>';
    expect(matchElement(fp({ id: 'header', tagName: 'div' }))).not.toBeNull();
  });

  it('prefers data-annotate over data-testid', () => {
    document.body.innerHTML = `
      <button data-testid="foo">testid-match</button>
      <button data-annotate="bar">annotate-match</button>
    `;
    const el = matchElement(fp({ dataAnnotate: 'bar', dataTestId: 'foo' }));
    expect(el?.textContent).toBe('annotate-match');
  });
});

describe('matchElement — fuzzy match', () => {
  it('matches by combined text + parent anchor + classes when no exact anchor available', () => {
    document.body.innerHTML = `
      <section data-annotate="checkout">
        <button class="btn primary">Pay now</button>
        <button class="btn">other</button>
      </section>
      <button class="btn primary">Pay now</button>
    `;
    const target = fp({
      tagName: 'button',
      textContent: 'Pay now',
      stableClasses: ['btn', 'primary'],
      parentAnchor: 'checkout',
      domPath: 'section > button.btn.primary',
    });
    const el = matchElement(target);
    expect(el?.closest('section')?.getAttribute('data-annotate')).toBe('checkout');
  });

  it('returns null when no candidate clears the 50-point threshold', () => {
    document.body.innerHTML = `
      <button>completely different</button>
    `;
    const target = fp({
      tagName: 'button',
      textContent: 'Pay now',
      stableClasses: ['btn', 'primary'],
      domPath: 'div > main > button.btn.primary',
    });
    expect(matchElement(target)).toBeNull();
  });

  it('returns null when DOM has no element of matching tagName', () => {
    document.body.innerHTML = '<div>x</div>';
    expect(matchElement(fp({ tagName: 'button', textContent: 'whatever' }))).toBeNull();
  });

  it('picks highest-scoring candidate among multiple of same tagName', () => {
    document.body.innerHTML = `
      <button class="btn">weak match</button>
      <button class="btn primary" aria-label="Save" role="button">Save changes</button>
      <button class="btn">also weak</button>
    `;
    const target = fp({
      tagName: 'button',
      textContent: 'Save changes',
      stableClasses: ['btn', 'primary'],
      role: 'button',
      ariaLabel: 'Save',
      domPath: 'button.btn.primary',
    });
    expect(matchElement(target)?.getAttribute('aria-label')).toBe('Save');
  });

  it('rewards siblingIndex when other signals match', () => {
    document.body.innerHTML = `
      <ul>
        <li class="row">a</li>
        <li class="row">b</li>
        <li class="row">c</li>
      </ul>
    `;
    const target = fp({
      tagName: 'li',
      textContent: 'b',
      stableClasses: ['row'],
      siblingIndex: 1,
      domPath: 'ul > li.row',
    });
    expect(matchElement(target)?.textContent).toBe('b');
  });
});
