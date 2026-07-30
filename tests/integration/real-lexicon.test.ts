/**
 * Tests against the lexicon artifact that actually ships with the package.
 *
 * These assertions stay deliberately loose about individual terms (upstream data
 * changes) but strict about structure, provenance and the false-positive guard rails.
 */
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createModerator } from '../../src/moderator.js';
import { loadLexicon } from '../../src/lexicon/loader.js';
import { upstreamLockFile } from '../../src/lexicon/paths.js';

const moderator = await createModerator();
const metadata = moderator.getMetadata();

describe('bundled lexicon', () => {
  it('is loaded with provenance', () => {
    expect(metadata.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
    expect(metadata.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(metadata.termCount).toBeGreaterThan(1_000);
    expect(metadata.totalTermCount).toBeGreaterThanOrEqual(metadata.termCount);
    expect(metadata.categories.length).toBeGreaterThan(5);
  });

  it('matches the commit recorded in UPSTREAM.lock.json', async () => {
    const lock = JSON.parse(await readFile(upstreamLockFile, 'utf8')) as {
      upstream: { commit: string; license: string; url: string };
    };
    expect(metadata.upstreamCommit).toBe(lock.upstream.commit);
    expect(lock.upstream.license).toBe('MIT');
    expect(lock.upstream.url).toContain('konsheng/Sensitive-lexicon');
  });

  it('excludes broad categories from the default selection', () => {
    const broad = metadata.categories.filter((category) => !category.defaultEnabled);
    expect(broad.length).toBeGreaterThan(0);
    expect(broad.every((category) => category.termCount === 0)).toBe(true);

    const enabled = metadata.categories.filter((category) => category.defaultEnabled);
    expect(enabled.some((category) => category.termCount > 0)).toBe(true);
  });

  it('does not flag ordinary Chinese prose', () => {
    const samples = [
      '今天的天气非常好，我们打算去公园散步，然后去吃一顿午饭。',
      '这个季度的营收增长了百分之十二，主要来自海外市场。',
      '请在周五之前把设计稿发给我，谢谢。',
      '我最近在学习一门新的编程语言，感觉很有意思。',
      '孩子的学校下周举办运动会，家长可以到场观看。',
    ];
    for (const sample of samples) {
      const result = moderator.check(sample);
      expect(result.matched, `${sample} -> ${JSON.stringify(result.matches)}`).toBe(
        false,
      );
      expect(result.decision).toBe('allow');
    }
  });

  it('does not flag ordinary English prose', () => {
    const samples = [
      'The quarterly report shows a class of assets that outperformed the market.',
      'Please assess the passable quality of the grass before the assembly.',
      'We finished the analysis of the finance department documents last night.',
      'This is a normal sentence about software engineering and unit testing.',
    ];
    for (const sample of samples) {
      const result = moderator.check(sample);
      expect(result.matched, `${sample} -> ${JSON.stringify(result.matches)}`).toBe(
        false,
      );
    }
  });

  it('detects a known upstream term with correct offsets', () => {
    const text = '这段文本提到了法轮功组织';
    const result = moderator.check(text, { mask: true });
    expect(result.matched).toBe(true);
    const match = result.matches[0]!;
    expect(text.slice(match.start, match.end)).toBe(match.matchedText);
    expect(result.maskedText).toBe('这段文本提到了***组织');
    expect(result.lexicon.upstreamCommit).toBe(metadata.upstreamCommit);
  });

  it('escalates high severity categories to block', () => {
    const result = moderator.check('出售雷管炸药');
    expect(result.riskLevel).toBe('high');
    expect(result.decision).toBe('block');
    expect(result.categories).toContain('weapons-explosives');
  });

  it('keeps every entry structurally valid', async () => {
    const lexicon = await loadLexicon({ categories: ['*'], includeNeedsReview: true });
    expect(lexicon.entries.length).toBeGreaterThan(10_000);
    const categoryIds = new Set(lexicon.categories.map((category) => category.id));
    const seen = new Set<string>();
    for (const entry of lexicon.entries) {
      expect(entry.term).not.toBe('');
      expect(entry.term).not.toContain('\n');
      expect(entry.term.trim()).toBe(entry.term);
      expect(entry.normalizedTerm).not.toBe('');
      expect(categoryIds.has(entry.category)).toBe(true);
      expect(['low', 'medium', 'high']).toContain(entry.severity);
      expect(['zh', 'en', 'other']).toContain(entry.language);
      expect(seen.has(entry.term)).toBe(false);
      seen.add(entry.term);
    }
  });

  it('can compile every mode and reports automaton statistics', () => {
    moderator.warmup('exact');
    moderator.warmup('fuzzy');
    const stats = moderator.getMatcherStats();
    expect(stats.map((stat) => stat.mode).sort()).toEqual([
      'exact',
      'fuzzy',
      'normalized',
    ]);
    for (const stat of stats) {
      expect(stat.patternCount).toBeGreaterThan(0);
      expect(stat.nodeCount).toBeGreaterThan(stat.patternCount);
      expect(stat.approximateByteSize).toBeGreaterThan(0);
    }
    // Fuzzy folding drops terms that become too short to be safe.
    expect(stats.find((stat) => stat.mode === 'fuzzy')!.skippedTerms).toBeGreaterThan(
      0,
    );
  });

  it('reloads without changing behaviour', async () => {
    const before = moderator.check('这段文本提到了法轮功组织');
    await moderator.reload();
    const after = moderator.check('这段文本提到了法轮功组织');
    expect(after).toEqual(before);
    expect(moderator.getMetadata().termCount).toBe(metadata.termCount);
  });

  it('scans a 100 KiB document quickly and with correct offsets', () => {
    const filler = '这是一段用于压力测试的普通文本内容。';
    const repeats = Math.ceil((100 * 1024) / Buffer.byteLength(filler, 'utf8'));
    const text = `${filler.repeat(repeats)}法轮功`;
    const started = performance.now();
    const result = moderator.check(text);
    const elapsed = performance.now() - started;
    expect(result.matched).toBe(true);
    const match = result.matches.at(-1)!;
    expect([...text].slice(match.start, match.end).join('')).toBe('法轮功');
    // Generous bound: this is a regression guard, not a benchmark.
    expect(elapsed).toBeLessThan(2_000);
  });
});
