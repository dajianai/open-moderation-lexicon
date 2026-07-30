/**
 * Turns the vendored upstream word lists into one reproducible artifact.
 *
 * The build is deterministic: same inputs, byte-identical `lexicon.json`. Nothing is
 * fetched from the network here; {@link ../../scripts/sync-upstream.ts} is the only
 * component that talks to GitHub.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, posix, relative, sep } from 'node:path';
import { normalize } from '../core/normalizer.js';
import { codePointsToString, createCodePointText } from '../core/position-map.js';
import { compareSeverity } from '../core/policy.js';
import {
  SEVERITIES,
  type Language,
  type Severity,
  type SourceMetadata,
} from '../core/types.js';

/** Configuration of one source file. */
export interface SourceConfig {
  category: string;
  displayName?: string;
  severity?: Severity;
  description?: string;
  /**
   * When false the category stays out of the default `categories: ['all']` selection.
   * Used for broad upstream lists that contain many ordinary words.
   */
  defaultEnabled?: boolean;
}

/** Contents of `data/overrides/category-config.json`. */
export interface CategoryConfig {
  defaultSeverity?: Severity;
  sources?: Record<string, SourceConfig>;
}

/** One raw term as read from a source file, before de-duplication. */
interface RawTerm {
  term: string;
  sourcePath: string;
  lineNumber: number;
}

/** Reason a term was rejected or flagged. */
export type TermIssue =
  | 'empty'
  | 'single-character'
  | 'too-long'
  | 'contains-whitespace'
  | 'control-character'
  | 'digits-only'
  | 'punctuation-only'
  | 'html-like'
  | 'normalizes-to-empty';

/** A flagged term that a human should look at. */
export interface FlaggedTerm {
  term: string;
  sourcePath: string;
  lineNumber: number;
  issues: TermIssue[];
}

/** Per-category totals inside a {@link BuildReport}. */
export interface CategoryReport {
  category: string;
  displayName: string;
  severity: Severity;
  termCount: number;
}

/** Statistics of one build. */
export interface BuildReport {
  builtAt: string;
  version: string;
  upstreamCommit: string | null;
  syncedAt: string | null;
  /** Raw non-empty lines read from all source files. */
  rawLineCount: number;
  /** Lines that were empty or comment-only. */
  emptyLineCount: number;
  /** Terms before de-duplication. */
  termCountBeforeDedupe: number;
  /** Terms after de-duplication. */
  termCountAfterDedupe: number;
  /** Number of duplicates removed. */
  duplicateCount: number;
  /** Duplicates that appeared in more than one source file. */
  crossSourceDuplicateCount: number;
  /**
   * Duplicates that moved to a higher-severity category because a narrower source
   * file also contained them.
   */
  reassignedCount: number;
  /** Terms whose normalized form collides with another term's normalized form. */
  normalizedCollisionCount: number;
  singleCharacterTermCount: number;
  suspiciousTermCount: number;
  needsReviewTermCount: number;
  perCategory: CategoryReport[];
  perSource: {
    path: string;
    name: string;
    category: string;
    rawLineCount: number;
    emptyLineCount: number;
    termCount: number;
    sha256: string;
    bomStripped: boolean;
    crlfLineCount: number;
  }[];
  issueCounts: Record<string, number>;
}

/** A fully processed lexicon entry, in artifact order. */
export interface BuiltEntry {
  term: string;
  normalizedTerm: string;
  category: string;
  severity: Severity;
  language: Language;
  needsReview: boolean;
  sourcePath: string;
  alsoFoundIn: string[];
}

/** Everything a build produces. */
export interface BuildResult {
  entries: BuiltEntry[];
  categories: BuiltCategory[];
  report: BuildReport;
  flagged: FlaggedTerm[];
}

/** Category descriptor in the artifact. */
export interface BuiltCategory {
  id: string;
  displayName: string;
  severity: Severity;
  description?: string;
  sourcePath: string;
  source: string;
  termCount: number;
  /** False for broad lists that are excluded from the default selection. */
  defaultEnabled: boolean;
}

/** Input paths and provenance for a build. */
export interface BuildOptions {
  upstreamDir: string;
  localTermsDir?: string;
  categoryConfig: CategoryConfig;
  upstreamCommit: string | null;
  syncedAt: string | null;
  /** Overrides the calendar version, mainly for reproducible tests. */
  version?: string;
  now?: Date;
}

const MAX_TERM_LENGTH = 128;
const TEXT_EXTENSIONS = new Set(['.txt']);

/** Recursively list the term files of a directory, sorted for determinism. */
export async function listTermFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (TEXT_EXTENSIONS.has(extname(item.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

/** Normalize a path for use inside the artifact, always with `/` separators. */
function toPosixRelative(root: string, file: string): string {
  return relative(root, file).split(sep).join(posix.sep);
}

/** Derive a category id from a file path when the config has no entry for it. */
export function deriveCategoryId(relativePath: string): string {
  const name = basename(relativePath, extname(relativePath));
  const slug = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? 'uncategorized' : slug;
}

/** Rough language bucket of a term. */
export function detectLanguage(term: string): Language {
  let hasCjk = false;
  let hasLatin = false;
  let hasOther = false;
  for (const char of term) {
    const cp = char.codePointAt(0)!;
    if (
      (cp >= 0x3400 && cp <= 0x9fff) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0x20000 && cp <= 0x3ffff) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      hasCjk = true;
    } else if (
      (cp >= 0x41 && cp <= 0x5a) ||
      (cp >= 0x61 && cp <= 0x7a) ||
      (cp >= 0xc0 && cp <= 0x24f)
    ) {
      hasLatin = true;
    } else if (cp > 0x7f) {
      hasOther = true;
    }
  }
  if (hasCjk) return 'zh';
  if (hasLatin && !hasOther) return 'en';
  if (hasLatin || hasOther) return 'other';
  return 'other';
}

// Matching control characters is the point here: a term containing one came from a
// malformed upstream line and has to be flagged for review.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const HTML_LIKE = /<[^>]{1,20}>|&[a-z]{2,10};/i;
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

/** Classify a cleaned term. An empty list means the term looks fine. */
export function inspectTerm(term: string, normalizedTerm: string): TermIssue[] {
  const issues: TermIssue[] = [];
  const length = [...term].length;
  if (length === 0) {
    issues.push('empty');
    return issues;
  }
  if (length === 1) issues.push('single-character');
  if (length > MAX_TERM_LENGTH) issues.push('too-long');
  // A single inner space is normal for multi-word phrases ("falun gong"); tabs,
  // newlines and runs of spaces indicate a malformed source line.
  if (/[\t\n\r\v\f]/.test(term) || /\s{2,}/.test(term))
    issues.push('contains-whitespace');
  if (CONTROL_CHARACTERS.test(term)) issues.push('control-character');
  if (/^\d+$/.test(term)) issues.push('digits-only');
  if (PUNCTUATION_ONLY.test(term)) issues.push('punctuation-only');
  if (HTML_LIKE.test(term)) issues.push('html-like');
  if (normalizedTerm === '') issues.push('normalizes-to-empty');
  return issues;
}

/** Issues that make a term unusable; such terms are dropped entirely. */
const FATAL_ISSUES = new Set<TermIssue>([
  'empty',
  'normalizes-to-empty',
  'control-character',
  'punctuation-only',
  'too-long',
]);

function normalizeTerm(term: string): string {
  return codePointsToString(normalize(createCodePointText(term)).codePoints);
}

/** Strip BOM, trim and drop comment lines from a raw file body. */
function parseTermFile(
  body: string,
  sourcePath: string,
): {
  terms: RawTerm[];
  emptyLines: number;
  bomStripped: boolean;
  crlfLineCount: number;
} {
  const bomStripped = body.charCodeAt(0) === 0xfeff;
  const text = bomStripped ? body.slice(1) : body;
  const lines = text.split('\n');
  const terms: RawTerm[] = [];
  let emptyLines = 0;
  let crlfLineCount = 0;
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    if (line.endsWith('\r')) {
      crlfLineCount += 1;
      line = line.slice(0, -1);
    }
    // Strip a stray BOM that can appear after concatenated files, plus surrounding
    // whitespace of any width.
    const cleaned = line.replace(/^\ufeff/, '').trim();
    if (cleaned === '' || cleaned.startsWith('#')) {
      emptyLines += 1;
      continue;
    }
    terms.push({ term: cleaned, sourcePath, lineNumber: i + 1 });
  }
  return { terms, emptyLines, bomStripped, crlfLineCount };
}

/** Build the lexicon artifact from the vendored sources. */
export async function buildLexicon(options: BuildOptions): Promise<BuildResult> {
  const now = options.now ?? new Date();
  const defaultSeverity = options.categoryConfig.defaultSeverity ?? 'low';
  const configuredSources = options.categoryConfig.sources ?? {};

  const files: { absolute: string; relative: string; upstream: boolean }[] = [];
  for (const file of await listTermFiles(options.upstreamDir)) {
    files.push({
      absolute: file,
      relative: toPosixRelative(options.upstreamDir, file),
      upstream: true,
    });
  }
  if (options.localTermsDir) {
    for (const file of await listTermFiles(options.localTermsDir)) {
      files.push({
        absolute: file,
        relative: `local/${toPosixRelative(options.localTermsDir, file)}`,
        upstream: false,
      });
    }
  }

  const categories = new Map<string, BuiltCategory>();
  const entries: BuiltEntry[] = [];
  const flagged: FlaggedTerm[] = [];
  const byTerm = new Map<string, number>();
  const normalizedSeen = new Map<string, number>();
  const perSource: BuildReport['perSource'] = [];
  const issueCounts: Record<string, number> = {};

  let rawLineCount = 0;
  let emptyLineCount = 0;
  let termCountBeforeDedupe = 0;
  let duplicateCount = 0;
  let crossSourceDuplicateCount = 0;
  let reassignedCount = 0;
  let singleCharacterTermCount = 0;
  let suspiciousTermCount = 0;
  let needsReviewTermCount = 0;
  let normalizedCollisionCount = 0;

  for (const file of files) {
    const buffer = await readFile(file.absolute);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const parsed = parseTermFile(buffer.toString('utf8'), file.relative);
    const config = configuredSources[file.relative];
    const categoryId = config?.category ?? deriveCategoryId(file.relative);
    const sourceName = basename(file.relative);

    if (!categories.has(categoryId)) {
      categories.set(categoryId, {
        id: categoryId,
        displayName:
          config?.displayName ?? basename(file.relative, extname(file.relative)),
        severity: config?.severity ?? defaultSeverity,
        ...(config?.description ? { description: config.description } : {}),
        sourcePath: file.relative,
        source: sourceName,
        termCount: 0,
        defaultEnabled: config?.defaultEnabled ?? true,
      });
    }
    const category = categories.get(categoryId)!;

    rawLineCount += parsed.terms.length;
    emptyLineCount += parsed.emptyLines;
    termCountBeforeDedupe += parsed.terms.length;
    let acceptedInSource = 0;

    for (const raw of parsed.terms) {
      const normalizedTerm = normalizeTerm(raw.term);
      const issues = inspectTerm(raw.term, normalizedTerm);
      if (issues.length > 0) {
        flagged.push({
          term: raw.term,
          sourcePath: raw.sourcePath,
          lineNumber: raw.lineNumber,
          issues,
        });
        for (const issue of issues) {
          issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
        }
        if (issues.includes('single-character')) singleCharacterTermCount += 1;
        suspiciousTermCount += 1;
      }
      if (issues.some((issue) => FATAL_ISSUES.has(issue))) continue;

      const existingIndex = byTerm.get(raw.term);
      if (existingIndex !== undefined) {
        duplicateCount += 1;
        const existing = entries[existingIndex]!;
        // Counted once per additional source file, not once per duplicated line.
        if (
          existing.sourcePath !== raw.sourcePath &&
          !existing.alsoFoundIn.includes(raw.sourcePath)
        ) {
          crossSourceDuplicateCount += 1;
          existing.alsoFoundIn.push(raw.sourcePath);
          // Several upstream files overlap heavily (`非法网址` is a subset of
          // `零时-Tencent`). Attribute the term to the most specific source, which we
          // approximate by the higher configured severity, so category filters and the
          // policy keep working for the narrower list.
          if (compareSeverity(category.severity, existing.severity) > 0) {
            const previousCategory = categories.get(existing.category);
            if (previousCategory) previousCategory.termCount -= 1;
            // `alsoFoundIn` always holds the sources other than `sourcePath`.
            existing.alsoFoundIn = existing.alsoFoundIn.filter(
              (path) => path !== file.relative,
            );
            existing.alsoFoundIn.push(existing.sourcePath);
            existing.category = categoryId;
            existing.severity = category.severity;
            existing.sourcePath = file.relative;
            category.termCount += 1;
            reassignedCount += 1;
          }
        }
        continue;
      }

      const collision = normalizedSeen.get(normalizedTerm);
      if (collision !== undefined) normalizedCollisionCount += 1;
      else normalizedSeen.set(normalizedTerm, entries.length);

      const needsReview = issues.length > 0;
      if (needsReview) needsReviewTermCount += 1;

      byTerm.set(raw.term, entries.length);
      entries.push({
        term: raw.term,
        normalizedTerm,
        category: categoryId,
        severity: category.severity,
        language: detectLanguage(raw.term),
        needsReview,
        sourcePath: file.relative,
        alsoFoundIn: [],
      });
      acceptedInSource += 1;
      category.termCount += 1;
    }

    perSource.push({
      path: file.relative,
      name: sourceName,
      category: categoryId,
      rawLineCount: parsed.terms.length,
      emptyLineCount: parsed.emptyLines,
      termCount: acceptedInSource,
      sha256,
      bomStripped: parsed.bomStripped,
      crlfLineCount: parsed.crlfLineCount,
    });
  }

  const version = options.version ?? calendarVersion(now);
  const categoryList = [...categories.values()].sort((a, b) =>
    a.id.localeCompare(b.id, 'en'),
  );

  const report: BuildReport = {
    builtAt: now.toISOString(),
    version,
    upstreamCommit: options.upstreamCommit,
    syncedAt: options.syncedAt,
    rawLineCount,
    emptyLineCount,
    termCountBeforeDedupe,
    termCountAfterDedupe: entries.length,
    duplicateCount,
    crossSourceDuplicateCount,
    reassignedCount,
    normalizedCollisionCount,
    singleCharacterTermCount,
    suspiciousTermCount,
    needsReviewTermCount,
    perCategory: categoryList.map((category) => ({
      category: category.id,
      displayName: category.displayName,
      severity: category.severity,
      termCount: category.termCount,
    })),
    perSource,
    issueCounts,
  };

  return { entries, categories: categoryList, report, flagged };
}

/** `YYYY.MM.DD` calendar version. */
export function calendarVersion(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
}

/** Compact, column oriented on-disk format. */
export interface LexiconArtifact {
  formatVersion: 1;
  version: string;
  upstreamCommit: string | null;
  syncedAt: string | null;
  builtAt: string;
  termCount: number;
  categories: BuiltCategory[];
  /** Source files the artifact was generated from, including their checksums. */
  sources: SourceMetadata[];
  /** All terms, separated by `\n` (terms can never contain a newline). */
  terms: string;
  /** Category index per term, comma separated. */
  categoryIndex: string;
  /** Severity index per term (0=low, 1=medium, 2=high), comma separated. */
  severityIndex: string;
  /** Language index per term (0=zh, 1=en, 2=other), comma separated. */
  languageIndex: string;
  /** Bit flags per term (bit 0 = needsReview), comma separated. */
  flags: string;
  /** Term index -> additional source paths the identical term was found in. */
  alsoFoundIn: Record<string, string[]>;
}

const LANGUAGES: readonly Language[] = ['zh', 'en', 'other'];

/** Serialize a build result into the artifact format. */
export function toArtifact(result: BuildResult): LexiconArtifact {
  const categoryIds = result.categories.map((category) => category.id);
  const categoryPosition = new Map(categoryIds.map((id, index) => [id, index]));
  const terms: string[] = [];
  const categoryIndex: number[] = [];
  const severityIndex: number[] = [];
  const languageIndex: number[] = [];
  const flags: number[] = [];
  const alsoFoundIn: Record<string, string[]> = {};

  for (let i = 0; i < result.entries.length; i += 1) {
    const entry = result.entries[i]!;
    terms.push(entry.term);
    categoryIndex.push(categoryPosition.get(entry.category) ?? 0);
    severityIndex.push(SEVERITIES.indexOf(entry.severity));
    languageIndex.push(LANGUAGES.indexOf(entry.language));
    flags.push(entry.needsReview ? 1 : 0);
    if (entry.alsoFoundIn.length > 0)
      alsoFoundIn[String(i)] = [...entry.alsoFoundIn].sort();
  }

  return {
    formatVersion: 1,
    version: result.report.version,
    upstreamCommit: result.report.upstreamCommit,
    syncedAt: result.report.syncedAt,
    builtAt: result.report.builtAt,
    termCount: result.entries.length,
    categories: result.categories,
    sources: result.report.perSource.map((source) => ({
      path: source.path,
      name: source.name,
      category: source.category,
      termCount: source.termCount,
      sha256: source.sha256,
    })),
    terms: terms.join('\n'),
    categoryIndex: categoryIndex.join(','),
    severityIndex: severityIndex.join(','),
    languageIndex: languageIndex.join(','),
    flags: flags.join(','),
    alsoFoundIn,
  };
}

/** Write artifact, metadata and reports to disk. */
export async function writeBuildOutput(
  result: BuildResult,
  paths: { lexiconFile: string; metadataFile: string; reportsDir: string },
): Promise<void> {
  const artifact = toArtifact(result);
  await mkdir(dirname(paths.lexiconFile), { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await writeFile(paths.lexiconFile, `${JSON.stringify(artifact)}\n`, 'utf8');

  const metadata = {
    version: artifact.version,
    upstreamCommit: artifact.upstreamCommit,
    syncedAt: artifact.syncedAt,
    builtAt: artifact.builtAt,
    termCount: artifact.termCount,
    categories: result.categories.map((category) => ({
      id: category.id,
      displayName: category.displayName,
      severity: category.severity,
      termCount: category.termCount,
      defaultEnabled: category.defaultEnabled,
      ...(category.description ? { description: category.description } : {}),
    })),
    sources: artifact.sources,
  };
  await writeFile(paths.metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  await writeFile(
    join(paths.reportsDir, 'build-report.json'),
    `${JSON.stringify(result.report, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(paths.reportsDir, 'review-needed.json'),
    `${JSON.stringify(
      {
        generatedAt: result.report.builtAt,
        note: 'Terms flagged during the build. Single-character terms are kept in the artifact but excluded at load time by default.',
        count: result.flagged.length,
        terms: result.flagged,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    join(paths.reportsDir, 'build-report.md'),
    renderReportMarkdown(result.report),
    'utf8',
  );
}

/** Human readable build summary. */
export function renderReportMarkdown(report: BuildReport): string {
  const lines: string[] = [];
  lines.push('# Lexicon build report');
  lines.push('');
  lines.push(`- Built at: ${report.builtAt}`);
  lines.push(`- Lexicon version: ${report.version}`);
  lines.push(`- Upstream commit: ${report.upstreamCommit ?? '(none)'}`);
  lines.push(`- Upstream synced at: ${report.syncedAt ?? '(unknown)'}`);
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Raw term lines | ${report.rawLineCount} |`);
  lines.push(`| Empty or comment lines | ${report.emptyLineCount} |`);
  lines.push(`| Terms before de-duplication | ${report.termCountBeforeDedupe} |`);
  lines.push(`| Terms after de-duplication | ${report.termCountAfterDedupe} |`);
  lines.push(`| Duplicates removed | ${report.duplicateCount} |`);
  lines.push(
    `| Duplicates across source files | ${report.crossSourceDuplicateCount} |`,
  );
  lines.push(
    `| Terms re-assigned to a higher-severity category | ${report.reassignedCount} |`,
  );
  lines.push(`| Normalized-form collisions | ${report.normalizedCollisionCount} |`);
  lines.push(`| Single-character terms | ${report.singleCharacterTermCount} |`);
  lines.push(`| Suspicious terms (flagged) | ${report.suspiciousTermCount} |`);
  lines.push(`| Terms kept but flagged for review | ${report.needsReviewTermCount} |`);
  lines.push('');
  lines.push('## Per category');
  lines.push('');
  lines.push('| Category | Display name | Severity | Terms |');
  lines.push('| --- | --- | --- | --- |');
  for (const category of report.perCategory) {
    lines.push(
      `| \`${category.category}\` | ${category.displayName} | ${category.severity} | ${category.termCount} |`,
    );
  }
  lines.push('');
  lines.push('## Per source file');
  lines.push('');
  lines.push(
    'Kept terms counts the terms a file contributed *first*. Terms an earlier file already',
  );
  lines.push(
    'contributed are counted there, unless they were re-assigned by severity.',
  );
  lines.push('');
  lines.push('| Source | Category | Raw lines | Skipped lines | Kept terms |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const source of report.perSource) {
    lines.push(
      `| \`${source.path}\` | \`${source.category}\` | ${source.rawLineCount} | ${source.emptyLineCount} | ${source.termCount} |`,
    );
  }
  lines.push('');
  lines.push('## Flagged term issues');
  lines.push('');
  const issues = Object.entries(report.issueCounts).sort((a, b) => b[1] - a[1]);
  if (issues.length === 0) {
    lines.push('No issues detected.');
  } else {
    lines.push('| Issue | Count |');
    lines.push('| --- | --- |');
    for (const [issue, count] of issues) lines.push(`| ${issue} | ${count} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
