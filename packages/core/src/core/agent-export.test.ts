import { describe, expect, it } from 'vitest';
import type { Annotation, ElementFingerprint } from './types';
import { generateAgentExport } from './agent-export';

function ann(id: string, fp: Partial<ElementFingerprint>, overrides: Partial<Annotation> = {}): Annotation {
  return {
    id,
    comment: `Comment ${id}`,
    route: '/page',
    viewport: '1280x720',
    viewportBucket: 1200,
    timestamp: 1_700_000_000_000,
    status: 'pending',
    lifecycle: [{ type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 }],
    fingerprint: {
      dataAnnotate: null,
      dataTestId: null,
      id: null,
      tagName: 'div',
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
      ...fp,
    },
    ...overrides,
  };
}

describe('generateAgentExport — top-level envelope', () => {
  it('returns version 1, format "agent", and the supplied viewportBucket', () => {
    const result = generateAgentExport([], 1200);
    expect(result).toMatchInlineSnapshot(`
      {
        "annotations": [],
        "format": "agent",
        "version": 1,
        "viewportBucket": 1200,
      }
    `);
  });

  it('maps all annotations preserving order', () => {
    const result = generateAgentExport(
      [ann('a1', {}), ann('a2', {}), ann('a3', {})],
      1200,
    );
    expect(result.annotations.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('generateAgentExport — source resolution', () => {
  it('parses sourceLocation (Level 1) with component name', () => {
    const result = generateAgentExport(
      [ann('a1', { sourceLocation: 'src/Foo.tsx:24:6', componentName: 'Foo' })],
      1200,
    );
    expect(result.annotations[0].source).toEqual({
      file: 'src/Foo.tsx',
      line: 24,
      column: 6,
      component: 'Foo',
    });
  });

  it('falls back to detectedSource (Level 2) when sourceLocation absent', () => {
    const result = generateAgentExport(
      [ann('a1', { detectedSource: 'src/Bar.tsx:10:0', detectedComponent: 'Bar' })],
      1200,
    );
    expect(result.annotations[0].source).toEqual({
      file: 'src/Bar.tsx',
      line: 10,
      column: 0,
      component: 'Bar',
    });
  });

  it('handles Windows paths with colon after drive letter', () => {
    const result = generateAgentExport(
      [ann('a1', { sourceLocation: 'C:\\proj\\src\\Foo.tsx:10:5' })],
      1200,
    );
    expect(result.annotations[0].source).toEqual({
      file: 'C:\\proj\\src\\Foo.tsx',
      line: 10,
      column: 5,
      component: null,
    });
  });

  it('returns null source when no location is available', () => {
    const result = generateAgentExport([ann('a1', {})], 1200);
    expect(result.annotations[0].source).toBeNull();
  });

  it('returns null source when location is malformed', () => {
    const result = generateAgentExport(
      [ann('a1', { sourceLocation: 'not-a-location' })],
      1200,
    );
    expect(result.annotations[0].source).toBeNull();
  });
});

describe('generateAgentExport — search hints', () => {
  it('builds full hint set for richly-annotated element', () => {
    const result = generateAgentExport(
      [ann('a1', {
        dataAnnotate: 'save-btn',
        dataTestId: 'save',
        id: 'save-action',
        ariaLabel: 'Save changes',
        textContent: 'Save',
        role: 'button',
        tagName: 'button',
        stableClasses: ['btn', 'primary'],
        rawClasses: ['btn', 'primary', 'sc-xyz'],
        cssModules: [{ raw: 'Button__save__abc', moduleHint: 'Button', localName: 'save' }],
        domPath: 'section > button.btn.primary',
      })],
      1200,
    );
    expect(result.annotations[0].searchHints).toMatchSnapshot();
  });

  it('builds minimal hints for sparsely-annotated element', () => {
    const result = generateAgentExport(
      [ann('a1', { tagName: 'div', domPath: 'div' })],
      1200,
    );
    expect(result.annotations[0].searchHints).toMatchSnapshot();
  });

  it('orders confidence levels: high anchors before medium text before low classes', () => {
    const result = generateAgentExport(
      [ann('a1', {
        dataTestId: 'cta',
        textContent: 'Buy now',
        stableClasses: ['button', 'large'],
        tagName: 'button',
      })],
      1200,
    );
    const confidences = result.annotations[0].searchHints.grepQueries.map((q) => q.confidence);
    const high = confidences.indexOf('high');
    const medium = confidences.indexOf('medium');
    const low = confidences.indexOf('low');
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
  });

  it('caps low-confidence class hints at 3', () => {
    const result = generateAgentExport(
      [ann('a1', { stableClasses: ['a', 'b', 'c', 'd', 'e'], tagName: 'div' })],
      1200,
    );
    const lowQueries = result.annotations[0].searchHints.grepQueries.filter((q) => q.confidence === 'low');
    expect(lowQueries).toHaveLength(3);
    expect(lowQueries.map((q) => q.query)).toEqual(['"a"', '"b"', '"c"']);
  });

  it('falls back classes field to stableClasses when rawClasses missing', () => {
    const result = generateAgentExport(
      [ann('a1', { stableClasses: ['btn'], rawClasses: undefined, tagName: 'button' })],
      1200,
    );
    expect(result.annotations[0].searchHints.classes).toEqual(['btn']);
  });
});

describe('generateAgentExport — full snapshot', () => {
  it('matches full snapshot for representative annotation', () => {
    const result = generateAgentExport(
      [ann('a1', {
        dataTestId: 'cta-buy',
        textContent: 'Buy now',
        tagName: 'button',
        stableClasses: ['btn', 'primary'],
        sourceLocation: 'src/components/Cta.tsx:42:10',
        componentName: 'Cta',
        domPath: 'section.checkout > button.btn.primary',
      }, {
        comment: 'Increase padding',
        route: '/checkout',
        status: 'fixed_unverified',
        lifecycle: [
          { type: 'created', actor: 'designer', timestamp: 1_700_000_000_000 },
          { type: 'acknowledged', actor: 'developer', timestamp: 1_700_000_010_000 },
          { type: 'fix_claimed', actor: 'agent', actorName: 'claude-agent', timestamp: 1_700_000_020_000 },
        ],
      })],
      1200,
    );
    expect(result).toMatchSnapshot();
  });
});

describe('generateAgentExport — lifecycle pass-through', () => {
  it('includes lifecycle events with type, actor, timestamp, reason', () => {
    const result = generateAgentExport(
      [ann('a1', {}, {
        lifecycle: [
          { type: 'created', actor: 'designer', timestamp: 100 },
          { type: 'rejected', actor: 'developer', timestamp: 200, reason: 'still broken' },
        ],
      })],
      1200,
    );
    expect(result.annotations[0].lifecycle).toEqual([
      { type: 'created', actor: 'designer', timestamp: 100 },
      { type: 'rejected', actor: 'developer', timestamp: 200, reason: 'still broken' },
    ]);
  });

  it('drops actorName from output (agent does not need display name)', () => {
    const result = generateAgentExport(
      [ann('a1', {}, {
        lifecycle: [
          { type: 'created', actor: 'designer', actorName: 'Alice', timestamp: 1 },
        ],
      })],
      1200,
    );
    expect('actorName' in result.annotations[0].lifecycle[0]).toBe(false);
  });
});
