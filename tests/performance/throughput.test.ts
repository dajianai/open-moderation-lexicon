/**
 * Performance guard rails.
 *
 * The bounds are deliberately loose (roughly 20x the numbers measured on a laptop) so
 * the suite stays green on slow CI machines while still catching an accidental switch
 * to a linear `includes()` scan or a per-call automaton rebuild.
 *
 * `npm run benchmark` is the tool for real numbers.
 */
import { describe, expect, it } from 'vitest';
import { Matcher } from '../../src/core/matcher.js';
import { createModeratorFromTerms } from '../../src/moderator.js';
import type { MatcherTerm } from '../../src/core/matcher.js';

function syntheticTerms(count: number): MatcherTerm[] {
  const alphabet = '零一二三四五六七八九十甲乙丙丁戊己庚辛壬癸';
  const terms: MatcherTerm[] = [];
  for (let i = 0; i < count; i += 1) {
    let value = '';
    let n = i;
    for (let position = 0; position < 4; position += 1) {
      value += alphabet[n % alphabet.length];
      n = Math.floor(n / alphabet.length);
    }
    terms.push({ term: `禁${value}`, category: 'synthetic', severity: 'medium' });
  }
  return terms;
}

function document(bytes: number): string {
  const filler = '这是一段普通的中文文本，用来构造压力测试语料。';
  return filler.repeat(Math.ceil(bytes / Buffer.byteLength(filler, 'utf8')));
}

describe('automaton construction', () => {
  it('builds 50k terms once, in a bounded time', () => {
    const terms = syntheticTerms(50_000);
    const started = performance.now();
    const matcher = new Matcher(terms, { precompileModes: ['normalized'] });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(10_000);

    const stats = matcher.stats().find((stat) => stat.mode === 'normalized')!;
    expect(stats.patternCount).toBe(50_000);
    expect(stats.nodeCount).toBeGreaterThan(50_000);
  });

  it('does not rebuild the automaton per call', () => {
    const buildStarted = performance.now();
    const matcher = new Matcher(syntheticTerms(20_000), {
      precompileModes: ['normalized'],
    });
    const buildElapsed = performance.now() - buildStarted;

    const before = matcher.stats();
    const text = document(4 * 1024);
    const scanStarted = performance.now();
    for (let i = 0; i < 200; i += 1) matcher.scan(text, {});
    const scanElapsed = performance.now() - scanStarted;

    expect(matcher.stats()).toEqual(before);
    // 200 scans must cost far less than 200 rebuilds would.
    expect(scanElapsed).toBeLessThan(buildElapsed * 20);
  });

  it('compiles a mode only on first use', () => {
    const matcher = new Matcher(syntheticTerms(1_000), {
      precompileModes: ['normalized'],
    });
    expect(matcher.stats().map((stat) => stat.mode)).toEqual(['normalized']);
    matcher.scan('禁零零零零', { mode: 'exact' });
    expect(
      matcher
        .stats()
        .map((stat) => stat.mode)
        .sort(),
    ).toEqual(['exact', 'normalized']);
  });
});

describe('scan throughput', () => {
  const matcher = new Matcher(syntheticTerms(50_000), {
    precompileModes: ['normalized'],
  });

  for (const kib of [1, 10, 100]) {
    it(`scans ${kib} KiB well under the linear-scan budget`, () => {
      const text = document(kib * 1024);
      // Warm the JIT so the measurement is not dominated by the first call.
      for (let i = 0; i < 5; i += 1) matcher.scan(text, {});
      const started = performance.now();
      const iterations = kib === 100 ? 10 : 50;
      for (let i = 0; i < iterations; i += 1) matcher.scan(text, {});
      const perCall = (performance.now() - started) / iterations;
      expect(perCall).toBeLessThan(kib * 20 + 100);
    });
  }

  it('is not quadratic in the number of matches', () => {
    const dense = `禁零零零零`.repeat(2_000);
    const started = performance.now();
    const hits = matcher.scan(dense, { overlap: 'all' });
    const elapsed = performance.now() - started;
    expect(hits.length).toBe(2_000);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('end to end SDK latency', () => {
  it('checks a 10 KiB document repeatedly without degrading', () => {
    const moderator = createModeratorFromTerms(syntheticTerms(10_000));
    const text = `${document(10 * 1024)}禁零零零零`;
    for (let i = 0; i < 10; i += 1) moderator.check(text);

    const measure = (): number => {
      const started = performance.now();
      for (let i = 0; i < 20; i += 1) moderator.check(text, { mask: true });
      return performance.now() - started;
    };
    const first = measure();
    const second = measure();
    expect(second).toBeLessThan(first * 5 + 100);
    expect(moderator.check(text).matched).toBe(true);
  });
});
