/**
 * Scenario 25: an empty or corrupt lexicon must fail loudly and never crash the
 * matcher with half-loaded data.
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LexiconLoadError,
  loadLexicon,
  readAllowlist,
  readCustomTerms,
  resolveCategoryFilter,
} from '../../src/lexicon/loader.js';
import {
  buildLexicon,
  toArtifact,
  type BuiltCategory,
} from '../../src/lexicon/builder.js';
import { createModerator } from '../../src/moderator.js';

async function writeArtifact(artifact: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'oml-load-'));
  const file = join(dir, 'lexicon.json');
  await writeFile(
    file,
    typeof artifact === 'string' ? artifact : JSON.stringify(artifact),
    'utf8',
  );
  return file;
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    version: '2026.01.01',
    upstreamCommit: 'sha',
    syncedAt: null,
    builtAt: '2026-01-01T00:00:00.000Z',
    termCount: 2,
    categories: [
      {
        id: 'test',
        displayName: 'test',
        severity: 'medium',
        sourcePath: 'a.txt',
        source: 'a.txt',
        termCount: 2,
        defaultEnabled: true,
      },
    ],
    sources: [],
    terms: '词一\n词二',
    categoryIndex: '0,0',
    severityIndex: '1,1',
    languageIndex: '0,0',
    flags: '0,0',
    alsoFoundIn: {},
    ...overrides,
  };
}

describe('loadLexicon', () => {
  it('loads a well formed artifact', async () => {
    const file = await writeArtifact(artifact());
    const lexicon = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
    });
    expect(lexicon.entries.map((entry) => entry.term)).toEqual(['词一', '词二']);
    expect(lexicon.entries[0]!.normalizedTerm).toBe('词一');
    expect(lexicon.entries[0]!.upstreamCommit).toBe('sha');
    expect(lexicon.version).toBe('2026.01.01');
    expect(lexicon.totalTermCount).toBe(2);
  });

  it('rejects a missing file', async () => {
    await expect(
      loadLexicon({ lexiconFile: '/nonexistent/lexicon.json', allowlistFile: null }),
    ).rejects.toThrow(LexiconLoadError);
  });

  it('rejects malformed JSON', async () => {
    const file = await writeArtifact('{ not json');
    await expect(
      loadLexicon({ lexiconFile: file, allowlistFile: null }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('rejects an unsupported format version', async () => {
    const file = await writeArtifact(artifact({ formatVersion: 99 }));
    await expect(
      loadLexicon({ lexiconFile: file, allowlistFile: null }),
    ).rejects.toThrow(/unsupported lexicon format version/);
  });

  it('rejects inconsistent columns', async () => {
    const short = await writeArtifact(artifact({ categoryIndex: '0' }));
    await expect(
      loadLexicon({ lexiconFile: short, allowlistFile: null }),
    ).rejects.toThrow(/categoryIndex/);

    const mismatched = await writeArtifact(artifact({ termCount: 5 }));
    await expect(
      loadLexicon({ lexiconFile: mismatched, allowlistFile: null }),
    ).rejects.toThrow(/declares 5 terms/);
  });

  it('rejects a missing field', async () => {
    const file = await writeArtifact(artifact({ terms: undefined }));
    await expect(
      loadLexicon({ lexiconFile: file, allowlistFile: null }),
    ).rejects.toThrow(/"terms" is missing/);
  });

  it('rejects a term pointing at an unknown category', async () => {
    const file = await writeArtifact(artifact({ categoryIndex: '0,7' }));
    await expect(
      loadLexicon({ lexiconFile: file, allowlistFile: null }),
    ).rejects.toThrow(/unknown category index/);
  });

  it('loads an empty artifact without matching anything', async () => {
    const file = await writeArtifact(
      artifact({
        termCount: 0,
        terms: '',
        categoryIndex: '',
        severityIndex: '',
        languageIndex: '',
        flags: '',
      }),
    );
    const moderator = await createModerator({
      lexicon: { lexiconFile: file, allowlistFile: null, customTermsFile: null },
    });
    const result = moderator.check('任何内容 anything');
    expect(result.matched).toBe(false);
    expect(result.decision).toBe('allow');
    expect(moderator.getMetadata().termCount).toBe(0);
  });

  it('filters by category and rejects unknown ones', async () => {
    const file = await writeArtifact(artifact());
    await expect(
      loadLexicon({ lexiconFile: file, allowlistFile: null, categories: ['nope'] }),
    ).rejects.toThrow(/unknown category: nope/);
    const filtered = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
      categories: ['test'],
    });
    expect(filtered.entries).toHaveLength(2);
  });

  it('excludes terms flagged for review unless asked', async () => {
    const file = await writeArtifact(artifact({ flags: '1,0' }));
    const strict = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
    });
    expect(strict.entries.map((entry) => entry.term)).toEqual(['词二']);

    const permissive = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
      includeNeedsReview: true,
    });
    expect(permissive.entries).toHaveLength(2);
  });

  it('applies the minimum term length', async () => {
    const file = await writeArtifact(
      artifact({ termCount: 2, terms: '单\n两字', categoryIndex: '0,0' }),
    );
    const loaded = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
    });
    expect(loaded.entries.map((entry) => entry.term)).toEqual(['两字']);

    const permissive = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
      minTermLength: 1,
    });
    expect(permissive.entries).toHaveLength(2);
  });

  it('round-trips a real build', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oml-rt-'));
    await writeFile(join(dir, 'terms.txt'), '往返词\n第二词\n', 'utf8');
    const result = await buildLexicon({
      upstreamDir: dir,
      categoryConfig: {
        sources: { 'terms.txt': { category: 'rt', severity: 'high' } },
      },
      upstreamCommit: 'sha',
      syncedAt: null,
    });
    const file = await writeArtifact(toArtifact(result));
    const lexicon = await loadLexicon({
      lexiconFile: file,
      allowlistFile: null,
      customTermsFile: null,
    });
    expect(lexicon.entries.map((entry) => entry.term)).toEqual(['往返词', '第二词']);
    expect(lexicon.entries[0]!.severity).toBe('high');
    expect(lexicon.entries[0]!.category).toBe('rt');
  });
});

describe('override files', () => {
  it('parses an allowlist, ignoring comments and blank lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oml-allow-'));
    const file = join(dir, 'allowlist.txt');
    await writeFile(file, '\ufeff# comment\n\n  允许词  \r\n第二个\n', 'utf8');
    expect(await readAllowlist(file)).toEqual(['允许词', '第二个']);
    expect(await readAllowlist('/nonexistent')).toEqual([]);
    expect(await readAllowlist(null)).toEqual([]);
  });

  it('parses custom terms in both supported shapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oml-custom-'));
    const object = join(dir, 'object.json');
    await writeFile(
      object,
      JSON.stringify({
        terms: [
          { term: '禁词', category: 'biz', severity: 'high' },
          { term: ' 空白 ' },
          { term: '', category: 'x' },
          'plain string',
          { severity: 'high' },
          42,
        ],
      }),
      'utf8',
    );
    expect(await readCustomTerms(object)).toEqual([
      { term: '禁词', category: 'biz', severity: 'high' },
      { term: '空白' },
      { term: 'plain string' },
    ]);

    const array = join(dir, 'array.json');
    await writeFile(array, JSON.stringify([{ term: 'x', severity: 'bogus' }]), 'utf8');
    expect(await readCustomTerms(array)).toEqual([{ term: 'x' }]);

    const broken = join(dir, 'broken.json');
    await writeFile(broken, '{oops', 'utf8');
    await expect(readCustomTerms(broken)).rejects.toThrow(/not valid JSON/);
  });
});

describe('resolveCategoryFilter', () => {
  const categories: BuiltCategory[] = [
    {
      id: 'narrow',
      displayName: 'narrow',
      severity: 'high',
      sourcePath: 'a',
      source: 'a',
      termCount: 1,
      defaultEnabled: true,
    },
    {
      id: 'broad',
      displayName: 'broad',
      severity: 'low',
      sourcePath: 'b',
      source: 'b',
      termCount: 1,
      defaultEnabled: false,
    },
  ];

  it('defaults to the categories marked as enabled', () => {
    expect(resolveCategoryFilter(undefined, categories)).toEqual(new Set(['narrow']));
    expect(resolveCategoryFilter(['all'], categories)).toEqual(new Set(['narrow']));
  });

  it('selects everything for the wildcard', () => {
    expect(resolveCategoryFilter(['*'], categories)).toBeNull();
  });

  it('allows explicitly requesting a broad category', () => {
    expect(resolveCategoryFilter(['broad'], categories)).toEqual(new Set(['broad']));
  });

  it('returns null when every category is enabled by default', () => {
    const allEnabled = categories.map((category) => ({
      ...category,
      defaultEnabled: true,
    }));
    expect(resolveCategoryFilter(['all'], allEnabled)).toBeNull();
  });
});
