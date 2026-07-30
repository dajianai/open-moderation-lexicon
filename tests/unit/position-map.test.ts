import { describe, expect, it } from 'vitest';
import {
  codePointsToString,
  createCodePointText,
  identityNormalizedText,
  mapToOrigin,
  NormalizedTextBuilder,
  sliceCodePoints,
} from '../../src/core/position-map.js';

describe('createCodePointText', () => {
  it('counts astral characters as one code point', () => {
    const text = createCodePointText('a🎉b');
    expect(text.length).toBe(3);
    expect(text.codePoints[1]).toBe(0x1f389);
    // UTF-16 offsets still address the original string.
    expect([...text.utf16Offsets]).toEqual([0, 1, 3, 4]);
  });

  it('handles an empty string', () => {
    const text = createCodePointText('');
    expect(text.length).toBe(0);
    expect([...text.utf16Offsets]).toEqual([0]);
    expect(sliceCodePoints(text, 0, 5)).toBe('');
  });

  it('round-trips through codePointsToString', () => {
    const source = '中文 english 🎉🚀 ①ﬁ';
    const text = createCodePointText(source);
    expect(codePointsToString(text.codePoints)).toBe(source);
  });

  it('converts long inputs without exceeding the argument limit', () => {
    const source = '🎉'.repeat(20_000);
    const text = createCodePointText(source);
    expect(text.length).toBe(20_000);
    expect(codePointsToString(text.codePoints)).toBe(source);
  });

  it('slices by code point, not by UTF-16 unit', () => {
    const text = createCodePointText('🎉🎉法轮功');
    expect(sliceCodePoints(text, 2, 5)).toBe('法轮功');
    expect(sliceCodePoints(text, 0, 2)).toBe('🎉🎉');
  });

  it('clamps out-of-range slices instead of throwing', () => {
    const text = createCodePointText('abc');
    expect(sliceCodePoints(text, -5, 99)).toBe('abc');
    expect(sliceCodePoints(text, 2, 1)).toBe('');
    expect(sliceCodePoints(text, 5, 9)).toBe('');
  });

  it('slices a code point range', () => {
    const codePoints = createCodePointText('abcdef').codePoints;
    expect(codePointsToString(codePoints, 2, 4)).toBe('cd');
    expect(codePointsToString(codePoints, 4, 4)).toBe('');
  });
});

describe('identityNormalizedText', () => {
  it('maps every index to itself', () => {
    const origin = createCodePointText('🎉abc');
    const normalized = identityNormalizedText(origin);
    expect(normalized.length).toBe(4);
    expect(mapToOrigin(normalized, 1, 3)).toEqual({ start: 1, end: 3 });
    // No separator was dropped, so no position is marked.
    expect([...normalized.separatorBefore]).toEqual([0, 0, 0, 0, 0]);
  });

  it('handles an empty origin', () => {
    const normalized = identityNormalizedText(createCodePointText(''));
    expect(normalized.length).toBe(0);
    expect(mapToOrigin(normalized, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('NormalizedTextBuilder', () => {
  const origin = createCodePointText('abcdef');

  it('tracks origin ranges for pushed code points', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x41, 0, 1);
    builder.push(0x42, 1, 2);
    const normalized = builder.finish();
    expect(codePointsToString(normalized.codePoints)).toBe('AB');
    expect(mapToOrigin(normalized, 0, 2)).toEqual({ start: 0, end: 2 });
  });

  it('extends the last range when characters are merged', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x41, 0, 1);
    builder.extendLast(3);
    expect(mapToOrigin(builder.finish(), 0, 1)).toEqual({ start: 0, end: 3 });
  });

  it('ignores an extension that would shrink the range', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x41, 0, 4);
    builder.extendLast(2);
    expect(mapToOrigin(builder.finish(), 0, 1)).toEqual({ start: 0, end: 4 });
  });

  it('replaces the last code point, as when composing a combining mark', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x65, 0, 1); // e
    builder.replaceLast(0xe9, 2); // é, now covering two origin code points
    const normalized = builder.finish();
    expect(codePointsToString(normalized.codePoints)).toBe('é');
    expect(mapToOrigin(normalized, 0, 1)).toEqual({ start: 0, end: 2 });
  });

  it('ignores replaceLast and extendLast on an empty builder', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.replaceLast(0x41, 1);
    builder.extendLast(1);
    expect(builder.finish().length).toBe(0);
  });

  it('marks the position after a dropped separator', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x61, 0, 1);
    builder.markSeparator(); // a dropped space
    builder.push(0x62, 2, 3);
    const normalized = builder.finish();
    expect([...normalized.separatorBefore]).toEqual([0, 1, 0]);
  });

  it('marks the end position when the text ends with a separator', () => {
    const builder = new NormalizedTextBuilder(origin);
    builder.push(0x61, 0, 1);
    builder.markSeparator();
    const normalized = builder.finish();
    // Index 1 is the end sentinel, so a trailing separator is still a boundary.
    expect(normalized.length).toBe(1);
    expect(normalized.separatorBefore[1]).toBe(1);
  });

  it('reports its current length', () => {
    const builder = new NormalizedTextBuilder(origin);
    expect(builder.length).toBe(0);
    expect(builder.lastCodePoint).toBe(-1);
    builder.push(0x61, 0, 1);
    expect(builder.length).toBe(1);
    expect(builder.lastCodePoint).toBe(0x61);
  });

  it('grows past its initial capacity while preserving the mapping', () => {
    // A small capacity hint with many pushes is what NFKC expansion looks like:
    // one origin code point can produce several normalized ones.
    const builder = new NormalizedTextBuilder(createCodePointText('x'), 8);
    for (let i = 0; i < 5_000; i += 1) {
      if (i === 2_500) builder.markSeparator();
      builder.push(0x78, 0, 1);
    }
    const normalized = builder.finish();
    expect(normalized.length).toBe(5_000);
    expect(normalized.separatorBefore[2_500]).toBe(1);
    expect(normalized.separatorBefore[2_499]).toBe(0);
    expect(mapToOrigin(normalized, 4_000, 4_002)).toEqual({ start: 0, end: 1 });
    expect(codePointsToString(normalized.codePoints).length).toBe(5_000);
  });
});

describe('mapToOrigin', () => {
  const origin = createCodePointText('abcdef');

  function build(): ReturnType<NormalizedTextBuilder['finish']> {
    const builder = new NormalizedTextBuilder(origin);
    for (let i = 0; i < 3; i += 1) builder.push(0x61 + i, i, i + 1);
    return builder.finish();
  }

  it('clamps ranges that run past the end', () => {
    expect(mapToOrigin(build(), 1, 99)).toEqual({ start: 1, end: 3 });
  });

  it('clamps negative starts', () => {
    expect(mapToOrigin(build(), -5, 2)).toEqual({ start: 0, end: 2 });
  });

  it('treats an empty range as a single position', () => {
    expect(mapToOrigin(build(), 2, 2)).toEqual({ start: 2, end: 3 });
  });

  it('returns a zero range for an empty text', () => {
    const empty = new NormalizedTextBuilder(createCodePointText('')).finish();
    expect(mapToOrigin(empty, 3, 7)).toEqual({ start: 0, end: 0 });
  });
});
