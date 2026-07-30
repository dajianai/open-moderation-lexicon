import { describe, expect, it } from 'vitest';
import { AhoCorasickBuilder } from '../../src/core/aho-corasick.js';
import { createCodePointText } from '../../src/core/position-map.js';

function build(patterns: string[]) {
  const builder = new AhoCorasickBuilder();
  patterns.forEach((pattern, index) => {
    builder.add(createCodePointText(pattern).codePoints, index);
  });
  return { automaton: builder.build(), duplicates: builder.duplicateCount };
}

function findAll(patterns: string[], text: string) {
  const { automaton } = build(patterns);
  return automaton.findAll(createCodePointText(text).codePoints).map((match) => ({
    pattern: patterns[match.patternId]!,
    start: match.start,
    end: match.end,
  }));
}

describe('AhoCorasick', () => {
  it('finds all occurrences of all patterns', () => {
    expect(findAll(['he', 'she', 'his', 'hers'], 'ushers')).toEqual([
      { pattern: 'she', start: 1, end: 4 },
      { pattern: 'he', start: 2, end: 4 },
      { pattern: 'hers', start: 2, end: 6 },
    ]);
  });

  it('reports overlapping and nested patterns', () => {
    expect(findAll(['ab', 'abc', 'bc'], 'xabcx')).toEqual([
      { pattern: 'ab', start: 1, end: 3 },
      { pattern: 'abc', start: 1, end: 4 },
      { pattern: 'bc', start: 2, end: 4 },
    ]);
  });

  it('handles repeated patterns in the text', () => {
    expect(findAll(['aa'], 'aaaa')).toEqual([
      { pattern: 'aa', start: 0, end: 2 },
      { pattern: 'aa', start: 1, end: 3 },
      { pattern: 'aa', start: 2, end: 4 },
    ]);
  });

  it('works with code points outside the BMP', () => {
    expect(findAll(['😀🎉'], 'x😀🎉y')).toEqual([
      { pattern: '😀🎉', start: 1, end: 3 },
    ]);
  });

  it('works with a large Unicode alphabet', () => {
    const patterns = ['习近平', '法轮功', '天安门事件', '门事'];
    expect(findAll(patterns, '天安门事件与法轮功')).toEqual([
      { pattern: '门事', start: 2, end: 4 },
      { pattern: '天安门事件', start: 0, end: 5 },
      { pattern: '法轮功', start: 6, end: 9 },
    ]);
  });

  it('ignores empty patterns and counts duplicates', () => {
    const builder = new AhoCorasickBuilder();
    expect(builder.add(new Int32Array(0), 0)).toBe(-1);
    builder.add(createCodePointText('ab').codePoints, 1);
    builder.add(createCodePointText('ab').codePoints, 2);
    expect(builder.duplicateCount).toBe(1);
    const automaton = builder.build();
    expect(automaton.patternCount).toBe(1);
    expect(automaton.findAll(createCodePointText('zab').codePoints)).toEqual([
      { patternId: 1, start: 1, end: 3 },
    ]);
  });

  it('supports early termination', () => {
    const { automaton } = build(['a', 'b', 'c']);
    const seen: number[] = [];
    automaton.search(createCodePointText('abc').codePoints, (patternId) => {
      seen.push(patternId);
      return false;
    });
    expect(seen).toEqual([0]);
    expect(automaton.test(createCodePointText('zzz').codePoints)).toBe(false);
    expect(automaton.test(createCodePointText('zzc').codePoints)).toBe(true);
  });

  it('exposes size diagnostics', () => {
    const { automaton } = build(['abc', 'abd']);
    expect(automaton.nodeCount).toBe(5);
    expect(automaton.edgeCount).toBe(4);
    expect(automaton.approximateByteSize).toBeGreaterThan(0);
  });

  it('handles a root with many children', () => {
    const patterns = Array.from({ length: 500 }, (_unused, index) =>
      String.fromCodePoint(0x4e00 + index * 3),
    );
    const { automaton } = build(patterns);
    const text = patterns.join('');
    const matches = automaton.findAll(createCodePointText(text).codePoints);
    expect(matches).toHaveLength(500);
    expect(matches[499]).toEqual({ patternId: 499, start: 499, end: 500 });
  });

  it('returns no matches for an empty automaton or empty text', () => {
    const empty = new AhoCorasickBuilder().build();
    expect(empty.findAll(createCodePointText('anything').codePoints)).toEqual([]);
    const { automaton } = build(['a']);
    expect(automaton.findAll(new Int32Array(0))).toEqual([]);
  });
});
