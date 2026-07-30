import { describe, expect, it } from 'vitest';
import {
  assertValidMaskChar,
  InvalidMaskCharError,
  maskRanges,
  mergeRanges,
} from '../../src/core/masker.js';

describe('mergeRanges', () => {
  it('merges overlapping and adjacent ranges', () => {
    expect(
      mergeRanges([
        { start: 0, end: 3 },
        { start: 2, end: 5 },
      ]),
    ).toEqual([{ start: 0, end: 5 }]);
    expect(
      mergeRanges([
        { start: 0, end: 2 },
        { start: 2, end: 4 },
      ]),
    ).toEqual([{ start: 0, end: 4 }]);
    expect(
      mergeRanges([
        { start: 5, end: 7 },
        { start: 0, end: 2 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
  });

  it('handles nested ranges and empty input', () => {
    expect(
      mergeRanges([
        { start: 0, end: 10 },
        { start: 3, end: 4 },
      ]),
    ).toEqual([{ start: 0, end: 10 }]);
    expect(mergeRanges([])).toEqual([]);
  });
});

describe('maskRanges', () => {
  it('replaces exactly the requested code points', () => {
    expect(maskRanges('abcdef', [{ start: 1, end: 3 }])).toBe('a**def');
    expect(maskRanges('abcdef', [{ start: 0, end: 6 }])).toBe('******');
    expect(maskRanges('abcdef', [])).toBe('abcdef');
  });

  it('counts astral characters as one position', () => {
    expect(maskRanges('😀ab', [{ start: 0, end: 1 }])).toBe('*ab');
    expect(maskRanges('a😀b', [{ start: 1, end: 2 }])).toBe('a*b');
    expect(maskRanges('a😀b', [{ start: 0, end: 3 }])).toBe('***');
  });

  it('is not corrupted by overlapping ranges', () => {
    const masked = maskRanges('这是敏感词汇的例子', [
      { start: 2, end: 4 },
      { start: 2, end: 6 },
      { start: 3, end: 5 },
    ]);
    expect(masked).toBe('这是****的例子');
    expect([...masked].length).toBe(9);
  });

  it('clamps out-of-range values', () => {
    expect(maskRanges('abc', [{ start: -5, end: 99 }])).toBe('***');
    expect(maskRanges('abc', [{ start: 2, end: 1 }])).toBe('abc');
  });

  it('supports multi-code-unit mask characters', () => {
    expect(maskRanges('abc', [{ start: 0, end: 2 }], '🚫')).toBe('🚫🚫c');
  });

  it('rejects invalid mask characters', () => {
    expect(() => maskRanges('abc', [{ start: 0, end: 1 }], '')).toThrow(
      InvalidMaskCharError,
    );
    expect(() => maskRanges('abc', [{ start: 0, end: 1 }], 'ab')).toThrow(
      InvalidMaskCharError,
    );
    expect(() => assertValidMaskChar('*')).not.toThrow();
    expect(() => assertValidMaskChar('🚫')).not.toThrow();
  });
});
