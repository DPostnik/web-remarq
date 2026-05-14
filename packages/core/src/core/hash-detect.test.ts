import { describe, expect, it } from 'vitest';
import {
  decomposeCSSModules,
  filterClasses,
  isHashedClass,
  stripHash,
} from './hash-detect';

describe('isHashedClass', () => {
  it('detects styled-components classes', () => {
    expect(isHashedClass('sc-bdvvtL')).toBe(true);
    expect(isHashedClass('sc-fGqzlH')).toBe(true);
    expect(isHashedClass('sc-')).toBe(true);
  });

  it('detects Emotion classes', () => {
    expect(isHashedClass('css-1a2b3c')).toBe(true);
    expect(isHashedClass('css-ABC123xyz')).toBe(true);
  });

  it('detects CSS Modules classes', () => {
    expect(isHashedClass('Button__abc123')).toBe(true);
    expect(isHashedClass('Form_input__hash99')).toBe(true);
  });

  it('detects pure hash classes (alphanumeric, 8+ chars, mix of letters and digits)', () => {
    expect(isHashedClass('a1b2c3d4')).toBe(true);
    expect(isHashedClass('xK7mPq2Lz')).toBe(true);
  });

  it('returns false for plain semantic class names', () => {
    expect(isHashedClass('button')).toBe(false);
    expect(isHashedClass('flex')).toBe(false);
    expect(isHashedClass('items-center')).toBe(false);
    expect(isHashedClass('primary')).toBe(false);
  });

  it('returns false for short strings without hash markers', () => {
    expect(isHashedClass('abc')).toBe(false);
    expect(isHashedClass('btn')).toBe(false);
  });

  it('returns false for letters-only long strings (no digit → not a pure hash)', () => {
    expect(isHashedClass('abcdefghij')).toBe(false);
  });

  it('returns false for digits-only strings', () => {
    expect(isHashedClass('12345678')).toBe(false);
  });
});

describe('stripHash', () => {
  it('strips CSS Modules hash suffix', () => {
    expect(stripHash('Button__abc123')).toBe('Button');
    expect(stripHash('Form_input__xyz99')).toBe('Form_input');
  });

  it('returns class unchanged when no CSS Modules pattern present', () => {
    expect(stripHash('button')).toBe('button');
    expect(stripHash('sc-bdvvtL')).toBe('sc-bdvvtL');
    expect(stripHash('css-1a2b3c')).toBe('css-1a2b3c');
  });
});

describe('filterClasses', () => {
  it('removes styled-components, Emotion, and pure-hash classes', () => {
    const input = [
      'button',
      'sc-bdvvtL',
      'css-1a2b3c',
      'a1b2c3d4',
      'primary',
    ];
    expect(filterClasses(input)).toEqual(['button', 'primary']);
  });

  it('strips CSS Modules hash suffix before keeping', () => {
    expect(filterClasses(['Button__abc123', 'flex'])).toEqual(['Button', 'flex']);
  });

  it('applies user-supplied classFilter after stripping', () => {
    const result = filterClasses(
      ['Button__abc', 'flex', 'tw-prefix-class'],
      (cls) => !cls.startsWith('tw-'),
    );
    expect(result).toEqual(['Button', 'flex']);
  });

  it('returns empty array for all-hashed input', () => {
    expect(filterClasses(['sc-aaa', 'css-bbb', 'a1b2c3d4'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(filterClasses([])).toEqual([]);
  });
});

describe('decomposeCSSModules', () => {
  it('decomposes 3-segment CSS Modules classes into module + localName', () => {
    const result = decomposeCSSModules(['Button__primary__abc123']);
    expect(result).toEqual([
      { raw: 'Button__primary__abc123', moduleHint: 'Button', localName: 'primary' },
    ]);
  });

  it('skips classes that are not 3-segment CSS Modules', () => {
    const result = decomposeCSSModules([
      'plain-class',
      'Button__abc123', // 2-segment, not the 3-segment pattern
      'Form_input__primary__hash99', // 3-segment with underscore in module
    ]);
    expect(result).toEqual([
      { raw: 'Form_input__primary__hash99', moduleHint: 'Form_input', localName: 'primary' },
    ]);
  });

  it('returns empty array for input without any 3-segment matches', () => {
    expect(decomposeCSSModules(['flex', 'primary', 'sc-bdvvtL'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(decomposeCSSModules([])).toEqual([]);
  });
});
