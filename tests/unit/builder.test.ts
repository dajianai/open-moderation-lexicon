/**
 * Scenario 26: messy upstream data (duplicates, BOM, CRLF, blank lines) and the
 * reporting that must accompany it.
 */
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildLexicon,
  calendarVersion,
  deriveCategoryId,
  detectLanguage,
  inspectTerm,
  toArtifact,
  writeBuildOutput,
  type CategoryConfig,
} from '../../src/lexicon/builder.js';

async function fixtureDir(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oml-build-'));
  for (const [name, body] of Object.entries(files)) {
    const target = join(root, name);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, body);
  }
  return root;
}

const config: CategoryConfig = {
  defaultSeverity: 'low',
  sources: {
    'Vocabulary/messy.txt': {
      category: 'messy',
      displayName: '混乱词库',
      severity: 'medium',
    },
    'Vocabulary/danger.txt': {
      category: 'danger',
      displayName: '危险',
      severity: 'high',
    },
  },
};

describe('buildLexicon', () => {
  it('cleans BOM, CRLF, blank lines, comments and surrounding whitespace', async () => {
    const upstream = await fixtureDir({
      'Vocabulary/messy.txt': Buffer.from(
        '\ufeff第一词\r\n\r\n  第二词  \n# comment\n第三词\n\n',
        'utf8',
      ),
    });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: 'abc123',
      syncedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.entries.map((entry) => entry.term)).toEqual([
      '第一词',
      '第二词',
      '第三词',
    ]);
    expect(result.report.emptyLineCount).toBe(4);
    expect(result.report.perSource[0]!.bomStripped).toBe(true);
    expect(result.report.perSource[0]!.crlfLineCount).toBe(2);
    expect(result.report.upstreamCommit).toBe('abc123');
    expect(result.report.syncedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('de-duplicates while keeping every source path', async () => {
    const upstream = await fixtureDir({
      'Vocabulary/messy.txt': '重复词\n重复词\n独有词\n',
      'Vocabulary/danger.txt': '重复词\n危险词\n',
    });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: null,
      syncedAt: null,
    });

    expect(result.report.termCountBeforeDedupe).toBe(5);
    expect(result.report.termCountAfterDedupe).toBe(3);
    expect(result.report.duplicateCount).toBe(2);
    expect(result.report.crossSourceDuplicateCount).toBe(1);

    const duplicate = result.entries.find((entry) => entry.term === '重复词')!;
    expect(duplicate.alsoFoundIn).toContain('Vocabulary/messy.txt');
  });

  it('re-assigns a shared term to the higher-severity category', async () => {
    // `a-broad.txt` is read first, so without re-assignment the term would keep the
    // broad, low severity category even though a narrower list also contains it.
    const upstream = await fixtureDir({
      'Vocabulary/a-broad.txt': '共有词\n只在广泛表\n',
      'Vocabulary/b-specific.txt': '共有词\n',
    });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: {
        sources: {
          'Vocabulary/a-broad.txt': { category: 'broad', severity: 'low' },
          'Vocabulary/b-specific.txt': { category: 'specific', severity: 'high' },
        },
      },
      upstreamCommit: null,
      syncedAt: null,
    });

    const shared = result.entries.find((entry) => entry.term === '共有词')!;
    expect(shared.category).toBe('specific');
    expect(shared.severity).toBe('high');
    expect(shared.sourcePath).toBe('Vocabulary/b-specific.txt');
    expect(shared.alsoFoundIn).toEqual(['Vocabulary/a-broad.txt']);
    expect(result.report.reassignedCount).toBe(1);

    const counts = new Map(
      result.report.perCategory.map((category) => [
        category.category,
        category.termCount,
      ]),
    );
    expect(counts.get('broad')).toBe(1);
    expect(counts.get('specific')).toBe(1);
  });

  it('flags suspicious terms without silently dropping usable ones', async () => {
    const upstream = await fixtureDir({
      'Vocabulary/messy.txt': ['单', '1989', 'ok词', 'free money', '???', 'a\tb'].join(
        '\n',
      ),
    });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: null,
      syncedAt: null,
    });

    const kept = result.entries.map((entry) => entry.term);
    // Single characters and digit-only terms are kept but flagged.
    expect(kept).toContain('单');
    expect(kept).toContain('1989');
    expect(kept).toContain('ok词');
    expect(kept).toContain('free money');
    // Punctuation-only terms are unusable and dropped.
    expect(kept).not.toContain('???');

    const flagged = new Map(result.flagged.map((item) => [item.term, item.issues]));
    expect(flagged.get('单')).toEqual(['single-character']);
    expect(flagged.get('1989')).toEqual(['digits-only']);
    expect(flagged.get('???')).toEqual(['punctuation-only']);
    expect(flagged.get('a\tb')).toEqual(['contains-whitespace']);
    // A normal multi-word phrase is not flagged.
    expect(flagged.has('free money')).toBe(false);
    expect(result.report.singleCharacterTermCount).toBe(1);
    expect(result.entries.find((entry) => entry.term === '单')!.needsReview).toBe(true);
    expect(result.entries.find((entry) => entry.term === 'ok词')!.needsReview).toBe(
      false,
    );
  });

  it('derives a category id when a file is not configured', async () => {
    const upstream = await fixtureDir({
      'Vocabulary/Unconfigured File.txt': '词\n词二\n',
    });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: { sources: {} },
      upstreamCommit: null,
      syncedAt: null,
    });
    expect(result.categories[0]!.id).toBe('unconfigured-file');
    expect(result.categories[0]!.severity).toBe('low');
    expect(result.categories[0]!.defaultEnabled).toBe(true);
  });

  it('includes locally maintained term files', async () => {
    const upstream = await fixtureDir({ 'Vocabulary/messy.txt': '上游词\n' });
    const local = await fixtureDir({ 'house-rules.txt': '# comment\n本地词\n' });
    const result = await buildLexicon({
      upstreamDir: upstream,
      localTermsDir: local,
      categoryConfig: config,
      upstreamCommit: 'abc',
      syncedAt: null,
    });
    const localEntry = result.entries.find((entry) => entry.term === '本地词')!;
    expect(localEntry.sourcePath).toBe('local/house-rules.txt');
    expect(localEntry.category).toBe('house-rules');
  });

  it('produces an empty but valid artifact for an empty source tree', async () => {
    const upstream = await fixtureDir({ 'Vocabulary/messy.txt': '\n\n' });
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: null,
      syncedAt: null,
    });
    const artifact = toArtifact(result);
    expect(artifact.termCount).toBe(0);
    expect(artifact.terms).toBe('');
    expect(artifact.categoryIndex).toBe('');
  });

  it('writes artifact, metadata and reports', async () => {
    const upstream = await fixtureDir({ 'Vocabulary/messy.txt': '词一\n词二\n' });
    const out = await mkdtemp(join(tmpdir(), 'oml-out-'));
    const result = await buildLexicon({
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: 'sha',
      syncedAt: null,
      version: '2026.01.01',
    });
    await writeBuildOutput(result, {
      lexiconFile: join(out, 'generated', 'lexicon.json'),
      metadataFile: join(out, 'generated', 'metadata.json'),
      reportsDir: join(out, 'reports'),
    });

    const artifact = JSON.parse(
      await readFile(join(out, 'generated', 'lexicon.json'), 'utf8'),
    );
    expect(artifact.formatVersion).toBe(1);
    expect(artifact.version).toBe('2026.01.01');
    expect(artifact.terms).toBe('词一\n词二');
    expect(artifact.sources[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    const metadata = JSON.parse(
      await readFile(join(out, 'generated', 'metadata.json'), 'utf8'),
    );
    expect(metadata.termCount).toBe(2);

    const markdown = await readFile(join(out, 'reports', 'build-report.md'), 'utf8');
    expect(markdown).toContain('# Lexicon build report');
    expect(markdown).toContain('| Terms after de-duplication | 2 |');
    const review = JSON.parse(
      await readFile(join(out, 'reports', 'review-needed.json'), 'utf8'),
    );
    expect(review.count).toBe(0);
  });

  it('is deterministic', async () => {
    const upstream = await fixtureDir({ 'Vocabulary/messy.txt': '词一\n词二\n词三\n' });
    const options = {
      upstreamDir: upstream,
      categoryConfig: config,
      upstreamCommit: 'sha',
      syncedAt: null,
      version: '2026.01.01',
      now: new Date('2026-01-01T00:00:00.000Z'),
    };
    const first = toArtifact(await buildLexicon(options));
    const second = toArtifact(await buildLexicon(options));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('builder helpers', () => {
  it('derives slugs', () => {
    expect(deriveCategoryId('Vocabulary/Some Name.txt')).toBe('some-name');
    expect(deriveCategoryId('Vocabulary/政治类型.txt')).toBe('政治类型');
    expect(deriveCategoryId('Vocabulary/COVID-19词库.txt')).toBe('covid-19词库');
    expect(deriveCategoryId('Vocabulary/---.txt')).toBe('uncategorized');
  });

  it('detects the language bucket', () => {
    expect(detectLanguage('敏感词')).toBe('zh');
    expect(detectLanguage('badword')).toBe('en');
    expect(detectLanguage('bad word 2')).toBe('en');
    expect(detectLanguage('плохой')).toBe('other');
    expect(detectLanguage('中文english')).toBe('zh');
    expect(detectLanguage('123')).toBe('other');
  });

  it('inspects terms', () => {
    expect(inspectTerm('正常词', '正常词')).toEqual([]);
    expect(inspectTerm('a', 'a')).toEqual(['single-character']);
    expect(inspectTerm('x'.repeat(200), 'x'.repeat(200))).toEqual(['too-long']);
    expect(inspectTerm('<b>x</b>', '<b>x</b>')).toEqual(['html-like']);
    expect(inspectTerm('\u200b', '')).toEqual([
      'single-character',
      'normalizes-to-empty',
    ]);
  });

  it('formats calendar versions', () => {
    expect(calendarVersion(new Date('2026-07-29T12:00:00Z'))).toBe('2026.07.29');
    expect(calendarVersion(new Date('2026-01-05T00:00:00Z'))).toBe('2026.01.05');
  });
});
