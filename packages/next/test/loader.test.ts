import { describe, expect, it } from 'vitest';
import { parseSourceMap } from '../src/loader';

describe('loader source map', () => {
  it('hands webpack an object, not the JSON string SWC returns', () => {
    const map = parseSourceMap(JSON.stringify({ version: 3, sources: ['a.tsx'], mappings: 'AAAA' }));
    expect(map).toEqual({ version: 3, sources: ['a.tsx'], mappings: 'AAAA' });
  });

  it('drops a missing or unparseable map instead of failing the module', () => {
    expect(parseSourceMap(undefined)).toBeUndefined();
    expect(parseSourceMap('')).toBeUndefined();
    expect(parseSourceMap('{not json')).toBeUndefined();
    expect(parseSourceMap('"a string"')).toBeUndefined();
  });
});
