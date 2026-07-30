/**
 * The behavioural scenario matrix.
 *
 * Each test maps to one of the scenarios the project must handle, numbered so that a
 * failure points straight at the requirement it violates.
 */
import { describe, expect, it } from 'vitest';
import { createModeratorFromTerms, type Moderator } from '../../src/moderator.js';
import { TEST_TERMS } from '../fixtures/terms.js';

function moderator(
  options: Parameters<typeof createModeratorFromTerms>[1] = {},
): Moderator {
  return createModeratorFromTerms(TEST_TERMS, options);
}

const base = moderator();
const fuzzy = moderator({ mode: 'fuzzy' });
const fuzzyRepeats = moderator({ mode: 'fuzzy', fuzzy: { collapseRepeats: true } });

describe('scenario matrix', () => {
  it('01 clean text produces allow / none', () => {
    const result = base.check('今天天气很好，我们一起去公园散步。');
    expect(result.matched).toBe(false);
    expect(result.decision).toBe('allow');
    expect(result.riskLevel).toBe('none');
    expect(result.hitCount).toBe(0);
    expect(result.uniqueTermCount).toBe(0);
    expect(result.categories).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('02 Chinese term inside continuous text is found at the right offsets', () => {
    const result = base.check('这段文本里有违规词出现');
    expect(result.matched).toBe(true);
    expect(result.decision).toBe('review');
    expect(result.matches).toHaveLength(1);
    const match = result.matches[0]!;
    expect(match.term).toBe('违规词');
    expect(match.matchedText).toBe('违规词');
    expect(match.start).toBe(6);
    expect(match.end).toBe(9);
    expect('这段文本里有违规词出现'.slice(match.start, match.end)).toBe('违规词');
  });

  it('03 English matches regardless of case', () => {
    for (const text of ['badword', 'BADWORD', 'BadWord', 'bAdWoRd']) {
      const result = base.check(`text ${text} here`);
      expect(result.matched, text).toBe(true);
      expect(result.matches[0]!.matchedText).toBe(text);
    }
  });

  it('04 an English term inside a longer word is not a false positive', () => {
    for (const text of ['class', 'assets', 'passable', 'grass', 'assassin']) {
      const result = base.check(`this is a ${text} of things`);
      const assMatches = result.matches.filter((match) => match.term === 'ass');
      expect(assMatches, text).toEqual([]);
    }
    // The standalone word still matches.
    expect(base.check('what an ass').matched).toBe(true);
  });

  it('05 the same term occurring several times is counted once per occurrence', () => {
    const result = base.check('违规词 违规词 违规词');
    expect(result.hitCount).toBe(3);
    expect(result.uniqueTermCount).toBe(1);
    expect(result.matches.map((match) => match.start)).toEqual([0, 4, 8]);
  });

  it('06 several different terms are all reported', () => {
    const result = base.check('这里有违规词，也有 badword，还有台湾独立');
    expect(result.uniqueTermCount).toBe(3);
    expect(result.categories).toEqual(['test-basic', 'test-en', 'test-politics']);
  });

  it('07 overlapping short and long terms resolve to the longest match', () => {
    const result = base.check('这是敏感词汇的例子');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.term).toBe('敏感词汇');
    expect(result.matches[0]!.start).toBe(2);
    expect(result.matches[0]!.end).toBe(6);

    // `overlap: 'all'` exposes both occurrences instead.
    const all = base.check('这是敏感词汇的例子', { overlap: 'all' });
    expect(all.matches.map((match) => match.term).sort()).toEqual(['敏感', '敏感词汇']);
  });

  it('08 traditional Chinese matches a simplified term', () => {
    const result = base.check('主張臺灣獨立的內容');
    expect(result.matched).toBe(true);
    const match = result.matches[0]!;
    expect(match.term).toBe('台湾独立');
    expect(match.matchedText).toBe('臺灣獨立');
    expect(match.matchType).toBe('normalized');
  });

  it('09 full-width Latin characters match', () => {
    const result = base.check('ｂａｄｗｏｒｄ');
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.term).toBe('badword');
    expect(result.matches[0]!.matchedText).toBe('ｂａｄｗｏｒｄ');
    expect(result.matches[0]!.matchType).toBe('normalized');
  });

  it('10 NFKC compatibility characters match', () => {
    // U+FB01 LATIN SMALL LIGATURE FI decomposes to "fi" under NFKC.
    const result = base.check('quarterly \ufb01nance report');
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.term).toBe('finance');
    expect(result.matches[0]!.matchedText).toBe('\ufb01nance');
  });

  it('11 zero-width characters cannot be used to bypass matching', () => {
    const text = '违\u200b规\u200d词';
    const result = base.check(text, { mask: true });
    expect(result.matched).toBe(true);
    const match = result.matches[0]!;
    expect(match.start).toBe(0);
    expect(match.end).toBe(5);
    expect(match.matchedText).toBe(text);
    expect(result.maskedText).toBe('*****');
  });

  it('12 inserted spaces are only caught in fuzzy mode', () => {
    const text = '违 规 词';
    expect(base.check(text).matched).toBe(false);
    const result = fuzzy.check(text);
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.matchType).toBe('fuzzy');
    expect(result.matches[0]!.start).toBe(0);
    expect(result.matches[0]!.end).toBe(5);
  });

  it('13 inserted hyphens and dots are caught in fuzzy mode', () => {
    for (const text of [
      'b-a-d-w-o-r-d',
      'b.a.d.w.o.r.d',
      'b_a_d_w_o_r_d',
      'b·a·d·w·o·r·d',
    ]) {
      const result = fuzzy.check(text);
      expect(result.matched, text).toBe(true);
      expect(result.matches[0]!.term).toBe('badword');
      expect(result.matches[0]!.matchType).toBe('fuzzy');
    }
  });

  it('14 leetspeak is caught in fuzzy mode', () => {
    const result = fuzzy.check('b4dw0rd is here');
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.term).toBe('badword');
    expect(result.matches[0]!.matchType).toBe('fuzzy');
    expect(result.matches[0]!.matchedText).toBe('b4dw0rd');
  });

  it('15 repeated characters are collapsed only when configured', () => {
    const text = 'baaadwooord';
    expect(fuzzy.check(text).matched).toBe(false);
    const result = fuzzyRepeats.check(text);
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.term).toBe('badword');
    expect(result.matches[0]!.matchedText).toBe(text);
  });

  it('16 offsets stay correct when an emoji precedes the term', () => {
    const text = '😀违规词';
    const result = base.check(text, { mask: true });
    const match = result.matches[0]!;
    // One code point for the emoji, even though it is two UTF-16 code units.
    expect(match.start).toBe(1);
    expect(match.end).toBe(4);
    expect([...text].slice(match.start, match.end).join('')).toBe('违规词');
    expect(result.maskedText).toBe('😀***');
  });

  it('17 the allowlist suppresses matches, including by covering phrase', () => {
    // Exact allowlist entry.
    const exact = moderator({ allowlist: ['违规词'] });
    expect(exact.check('这里有违规词').matched).toBe(false);

    // A longer safe phrase rescues a short term inside it.
    const covering = moderator({ allowlist: ['冰岛'] });
    expect(covering.check('我想去冰岛旅游').matched).toBe(false);
    expect(covering.check('我想买冰').matched).toBe(true);

    // Per-call allowlist works too.
    expect(base.check('这里有违规词', { allowlist: ['违规词'] }).matched).toBe(false);
  });

  it('18 custom terms are matched with their own category and severity', () => {
    const custom = moderator({
      customTerms: [{ term: '业务禁词', category: 'custom', severity: 'high' }],
    });
    const result = custom.check('这是业务禁词');
    expect(result.matched).toBe(true);
    expect(result.matches[0]!.category).toBe('custom');
    expect(result.matches[0]!.severity).toBe('high');
    expect(result.decision).toBe('block');
    expect(result.riskLevel).toBe('high');
  });

  it('19 category filtering restricts the terms that can match', () => {
    const text = '这里有违规词，也有 badword';
    const chineseOnly = base.check(text, { categories: ['test-basic'] });
    expect(chineseOnly.categories).toEqual(['test-basic']);
    expect(chineseOnly.hitCount).toBe(1);

    const englishOnly = base.check(text, { categories: ['test-en'] });
    expect(englishOnly.categories).toEqual(['test-en']);

    const none = base.check(text, { categories: ['test-danger'] });
    expect(none.matched).toBe(false);
  });

  it('20 fuzzy rules are never applied when fuzzy mode is off', () => {
    for (const text of ['b4dw0rd', 'b-a-d-w-o-r-d', '违 规 词', 'baaadwooord']) {
      expect(base.check(text).matched, text).toBe(false);
      expect(base.check(text, { mode: 'exact' }).matched, text).toBe(false);
      expect(base.check(text, { mode: 'normalized' }).matched, text).toBe(false);
    }
    // And no result is ever labelled fuzzy outside fuzzy mode.
    const result = base.check('违规词 badword 敏感词汇');
    expect(result.matches.every((match) => match.matchType !== 'fuzzy')).toBe(true);
  });

  it('21 masking preserves everything that did not match', () => {
    const text = 'Hello 违规词 world!\nSecond line 😀 with badword.';
    const result = base.check(text, { mask: true });
    const masked = result.maskedText!;
    expect(masked).toBe('Hello *** world!\nSecond line 😀 with *******.');
    expect([...masked].length).toBe([...text].length);
    expect(masked.replace(/\*/g, 'X')).not.toContain('违规词');
  });

  it('22 overlapping matches do not corrupt the masked text', () => {
    const text = '这是敏感词汇的例子';
    const reduced = base.check(text, { mask: true });
    expect(reduced.maskedText).toBe('这是****的例子');

    const all = base.check(text, { mask: true, overlap: 'all' });
    expect(all.maskedText).toBe('这是****的例子');
    expect([...all.maskedText!].length).toBe([...text].length);
  });

  it('23 very long input is handled with correct offsets', () => {
    const filler = '正常内容'.repeat(12_500); // 50k code points
    const text = `${filler}违规词${filler}`;
    const result = base.check(text);
    expect(result.hitCount).toBe(1);
    expect(result.matches[0]!.start).toBe(50_000);
    expect(result.matches[0]!.end).toBe(50_003);
    expect([...text].length).toBe(100_003);
  });

  it('27 HTML markup is treated as plain text', () => {
    const text = '<p class="x">违规词</p>';
    const result = base.check(text, { mask: true });
    expect(result.hitCount).toBe(1);
    expect(result.matches[0]!.start).toBe(13);
    expect(result.maskedText).toBe('<p class="x">***</p>');
    // The tag itself never matches.
    expect(base.check('<p></p>').matched).toBe(false);
  });

  it('28 URLs, emails, digits and punctuation are handled', () => {
    const text =
      'Contact spam@example.com or visit https://evil.example.com/path?a=1 (42 times)';
    const result = base.check(text);
    const terms = result.matches.map((match) => match.term).sort();
    expect(terms).toEqual(['evil.example.com', 'spam@example.com']);
    const url = result.matches.find((match) => match.term === 'evil.example.com')!;
    expect(text.slice(url.start, url.end)).toBe('evil.example.com');
  });

  it('29 newlines and repeated spaces do not break matching or offsets', () => {
    const text = 'line one\n\n  违规词  \n\tfree money\r\nend';
    const result = base.check(text);
    expect(result.matches.map((match) => match.term).sort()).toEqual([
      'free money',
      '违规词',
    ]);
    for (const match of result.matches) {
      expect(text.slice(match.start, match.end).toLowerCase()).toContain(
        match.matchedText.toLowerCase(),
      );
    }
  });
});

describe('result contract', () => {
  it('exposes the documented fields', () => {
    const result = base.check('这是敏感词汇的例子', { mask: true });
    expect(Object.keys(result).sort()).toEqual([
      'categories',
      'decision',
      'hitCount',
      'lexicon',
      'maskedText',
      'matched',
      'matches',
      'riskLevel',
      'uniqueTermCount',
    ]);
    expect(result.lexicon).toEqual({ version: 'inline', upstreamCommit: null });
  });

  it('omits maskedText unless masking was requested', () => {
    expect(base.check('违规词').maskedText).toBeUndefined();
  });

  it('honours returnMatches while keeping the counts', () => {
    const result = base.check('违规词 违规词', { returnMatches: false });
    expect(result.matches).toEqual([]);
    expect(result.hitCount).toBe(2);
    expect(result.uniqueTermCount).toBe(1);
  });

  it('labels matchType as the weakest rule that was required', () => {
    expect(base.check('badword').matches[0]!.matchType).toBe('exact');
    expect(base.check('BADWORD').matches[0]!.matchType).toBe('normalized');
    expect(fuzzy.check('b4dw0rd').matches[0]!.matchType).toBe('fuzzy');
    // Terms that match literally stay `exact` even when fuzzy mode is enabled.
    expect(fuzzy.check('badword').matches[0]!.matchType).toBe('exact');
  });

  it('supports first-only, unique terms and match limits', () => {
    const text = '敏感词汇 违规词 敏感词汇';
    expect(base.contains(text)).toBe(true);
    expect(base.findFirst(text)!.term).toBe('敏感词汇');
    expect(base.findAll(text)).toHaveLength(3);
    expect(base.findUniqueTerms(text).sort()).toEqual(['敏感词汇', '违规词']);
    expect(base.findAll(text, { maxMatches: 2 })).toHaveLength(2);
    expect(base.contains('完全干净的文本')).toBe(false);
    expect(base.findFirst('完全干净的文本')).toBeUndefined();
  });

  it('applies the default policy: only high severity blocks', () => {
    expect(base.check('敏感').decision).toBe('review');
    expect(base.check('敏感').riskLevel).toBe('low');
    expect(base.check('违规词').decision).toBe('review');
    expect(base.check('违规词').riskLevel).toBe('medium');
    expect(base.check('爆炸物制造').decision).toBe('block');
    expect(base.check('爆炸物制造').riskLevel).toBe('high');
  });

  it('supports configurable policies', () => {
    const strict = moderator({ policy: { blockSeverities: ['medium', 'high'] } });
    expect(strict.check('违规词').decision).toBe('block');

    const lenient = moderator({ policy: { blockSeverities: [] } });
    expect(lenient.check('爆炸物制造').decision).toBe('review');

    const allowed = moderator({ policy: { allowCategories: ['test-basic'] } });
    expect(allowed.check('违规词').decision).toBe('allow');

    const byCategory = moderator({ policy: { blockCategories: ['test-basic'] } });
    expect(byCategory.check('违规词').decision).toBe('block');

    const threshold = moderator({
      policy: { blockSeverities: ['medium'], blockMinHitCount: 3 },
    });
    expect(threshold.check('违规词').decision).toBe('review');
    expect(threshold.check('违规词 违规词 违规词').decision).toBe('block');
  });

  it('supports a custom mask character, including astral symbols', () => {
    expect(base.mask('这里有违规词', { maskChar: '#' })).toBe('这里有###');
    expect(base.mask('这里有违规词', { maskChar: '🚫' })).toBe('这里有🚫🚫🚫');
  });

  it('rejects an invalid mask character', () => {
    expect(() => base.mask('违规词', { maskChar: '' })).toThrow(/non-empty/);
    expect(() => base.mask('违规词', { maskChar: '**' })).toThrow(
      /one Unicode code point/,
    );
  });

  it('rejects unknown categories and modes', () => {
    expect(() => base.check('x', { categories: ['does-not-exist'] })).toThrow(
      /unknown category/,
    );
    // @ts-expect-error deliberately invalid mode
    expect(() => base.check('x', { mode: 'semantic' })).toThrow(
      /unsupported match mode/,
    );
  });

  it('handles empty and whitespace-only input without matching', () => {
    expect(base.check('').matched).toBe(false);
    expect(base.check('   \n\t ').matched).toBe(false);
    expect(base.check('').decision).toBe('allow');
  });

  it('rejects non-string input', () => {
    // @ts-expect-error deliberately invalid input
    expect(() => base.check(42)).toThrow(/text must be a string/);
    // @ts-expect-error deliberately invalid input
    expect(() => base.check(null)).toThrow(/text must be a string/);
  });
});
