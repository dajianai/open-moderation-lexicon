import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FUZZY_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  foldFuzzy,
  fuzzyFoldString,
  normalize,
  normalizeString,
} from '../../src/core/normalizer.js';
import {
  codePointsToString,
  createCodePointText,
  mapToOrigin,
  sliceCodePoints,
} from '../../src/core/position-map.js';

describe('normalize', () => {
  it('lowercases Latin text', () => {
    expect(normalizeString('HeLLo World')).toBe('hello world');
  });

  it('folds full-width forms to half-width', () => {
    expect(normalizeString('ＡＢＣ１２３')).toBe('abc123');
    expect(normalizeString('ｈｅｌｌｏ')).toBe('hello');
  });

  it('applies NFKC compatibility mappings', () => {
    expect(normalizeString('\ufb01le')).toBe('file');
    expect(normalizeString('①②③')).toBe('123');
    expect(normalizeString('㈱')).toBe('(株)');
  });

  it('removes zero-width and invisible characters', () => {
    expect(normalizeString('a\u200bb\u200cc\u200dd\ufeffe\u00ade')).toBe('abcdee');
    expect(normalizeString('a\u2060b')).toBe('ab');
    expect(normalizeString('a\ufe0fb')).toBe('ab');
  });

  it('converts traditional Chinese to simplified', () => {
    expect(normalizeString('臺灣獨立')).toBe('台湾独立');
    expect(normalizeString('習近平')).toBe('习近平');
    expect(normalizeString('簡體字')).toBe('简体字');
  });

  it('unifies whitespace without collapsing it', () => {
    expect(normalizeString('a\tb\nc\u3000d\u00a0e')).toBe('a b c d e');
    expect(normalizeString('a  b')).toBe('a  b');
  });

  it('composes or drops combining marks', () => {
    expect(normalizeString('e\u0301')).toBe('é');
    expect(normalizeString('cafe\u0301')).toBe('café');
    // A mark with no composition partner is dropped rather than left dangling.
    expect(normalizeString('\u0301abc')).toBe('abc');
  });

  it('can be configured', () => {
    expect(
      normalizeString('ABC', { ...DEFAULT_NORMALIZE_OPTIONS, lowercase: false }),
    ).toBe('ABC');
    expect(
      normalizeString('臺灣', { ...DEFAULT_NORMALIZE_OPTIONS, simplifyChinese: false }),
    ).toBe('臺灣');
    expect(
      normalizeString('a\u200bb', {
        ...DEFAULT_NORMALIZE_OPTIONS,
        stripInvisible: false,
      }),
    ).toBe('a\u200bb');
  });

  it('keeps an exact position map through expansions and deletions', () => {
    const origin = createCodePointText('a\u200b①ＢC');
    const normalized = normalize(origin);
    expect(codePointsToString(normalized.codePoints)).toBe('a1bc');

    // 'a' maps to origin [0,1)
    expect(mapToOrigin(normalized, 0, 1)).toEqual({ start: 0, end: 1 });
    // '1' comes from '①' at origin index 2
    expect(mapToOrigin(normalized, 1, 2)).toEqual({ start: 2, end: 3 });
    // 'bc' comes from 'ＢC' at origin indices 3..5
    expect(mapToOrigin(normalized, 2, 4)).toEqual({ start: 3, end: 5 });
    // The whole normalized text maps back to the whole original text.
    expect(mapToOrigin(normalized, 0, normalized.length)).toEqual({ start: 0, end: 5 });
  });

  it('maps multi-code-point expansions back to a single origin position', () => {
    const origin = createCodePointText('x㈱y');
    const normalized = normalize(origin);
    expect(codePointsToString(normalized.codePoints)).toBe('x(株)y');
    // All three expanded code points come from origin index 1.
    expect(mapToOrigin(normalized, 1, 4)).toEqual({ start: 1, end: 2 });
    expect(sliceCodePoints(origin, 1, 2)).toBe('㈱');
  });

  it('does not include characters that were dropped outside the range', () => {
    const origin = createCodePointText('ab\u200bcd');
    const normalized = normalize(origin);
    // "ab" must not swallow the zero-width space that follows it.
    expect(mapToOrigin(normalized, 0, 2)).toEqual({ start: 0, end: 2 });
    // But a range spanning the deletion does cover it.
    expect(mapToOrigin(normalized, 0, 3)).toEqual({ start: 0, end: 4 });
  });

  it('handles astral code points as single positions', () => {
    const origin = createCodePointText('😀AB');
    expect(origin.length).toBe(3);
    const normalized = normalize(origin);
    expect(codePointsToString(normalized.codePoints)).toBe('😀ab');
    expect(mapToOrigin(normalized, 1, 3)).toEqual({ start: 1, end: 3 });
  });

  it('is stable on empty input', () => {
    const normalized = normalize(createCodePointText(''));
    expect(normalized.length).toBe(0);
    expect(mapToOrigin(normalized, 0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('foldFuzzy', () => {
  it('removes separators and records them as boundaries', () => {
    const normalized = normalize(createCodePointText('b-a-d w.o_r/d'));
    const folded = foldFuzzy(normalized);
    expect(codePointsToString(folded.codePoints)).toBe('badword');
    // A separator was dropped before the 'w'.
    expect(folded.separatorBefore[3]).toBe(1);
    expect(folded.separatorBefore[1]).toBe(1);
  });

  it('folds leetspeak', () => {
    expect(fuzzyFoldString('b4dw0rd')).toBe('badword');
    expect(fuzzyFoldString('l33t5p34k')).toBe('leetspeak');
    expect(fuzzyFoldString('@ss')).toBe('ass');
  });

  it('collapses repeats only when enabled', () => {
    expect(fuzzyFoldString('baaad')).toBe('baaad');
    expect(
      fuzzyFoldString('baaad', DEFAULT_NORMALIZE_OPTIONS, {
        ...DEFAULT_FUZZY_OPTIONS,
        collapseRepeats: true,
      }),
    ).toBe('bad');
  });

  it('keeps the mapping back to the original text', () => {
    const origin = createCodePointText('xx b-a-d yy');
    const folded = foldFuzzy(normalize(origin));
    expect(codePointsToString(folded.codePoints)).toBe('xxbadyy');
    // "bad" occupies folded indices 2..5 and origin indices 3..8.
    expect(mapToOrigin(folded, 2, 5)).toEqual({ start: 3, end: 8 });
    expect(sliceCodePoints(origin, 3, 8)).toBe('b-a-d');
  });

  it('can disable individual heuristics', () => {
    expect(
      fuzzyFoldString('b4d-word', DEFAULT_NORMALIZE_OPTIONS, {
        ...DEFAULT_FUZZY_OPTIONS,
        leetspeak: false,
      }),
    ).toBe('b4dword');
    expect(
      fuzzyFoldString('b4d-word', DEFAULT_NORMALIZE_OPTIONS, {
        ...DEFAULT_FUZZY_OPTIONS,
        stripSeparators: false,
      }),
    ).toBe('bad-word');
  });
});
