/**
 * Loads the generated lexicon artifact and the local override files.
 *
 * Loading happens once per process (or once per `reload()`); the returned entries are
 * shared by reference with the matcher, so no per-request copying occurs.
 */
import { readFile } from 'node:fs/promises';
import { normalize } from '../core/normalizer.js';
import { codePointsToString, createCodePointText } from '../core/position-map.js';
import {
  SEVERITIES,
  type CustomTerm,
  type Language,
  type LexiconEntry,
  type Severity,
  type SourceMetadata,
} from '../core/types.js';
import type { LexiconArtifact, BuiltCategory } from './builder.js';
import {
  allowlistFile as defaultAllowlistFile,
  customTermsFile as defaultCustomTermsFile,
  lexiconFile as defaultLexiconFile,
} from './paths.js';

/** Raised when the artifact is missing, unreadable or structurally invalid. */
export class LexiconLoadError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LexiconLoadError';
  }
}

/** Options controlling which terms end up in memory. */
export interface LoadLexiconOptions {
  /** Absolute path of `lexicon.json`. Defaults to the bundled artifact. */
  lexiconFile?: string;
  /** Absolute path of `allowlist.txt`. Defaults to the bundled override file. */
  allowlistFile?: string | null;
  /** Absolute path of `custom-terms.json`. Defaults to the bundled override file. */
  customTermsFile?: string | null;
  /**
   * Category selection.
   *
   * - omitted or `['all']`: every category whose `defaultEnabled` is not false.
   * - `['*']`: every category, including the broad, false-positive heavy lists.
   * - explicit ids: exactly those categories, broad lists included.
   */
  categories?: string[];
  /**
   * Include terms the build flagged for human review (single characters, terms with
   * whitespace, ...). Off by default because they cause many false positives.
   */
  includeNeedsReview?: boolean;
  /** Drop terms shorter than this many code points. Defaults to 2. */
  minTermLength?: number;
}

/** Everything the SDK needs after loading. */
export interface LoadedLexicon {
  entries: LexiconEntry[];
  categories: BuiltCategory[];
  sources: SourceMetadata[];
  version: string;
  upstreamCommit: string | null;
  syncedAt: string | null;
  builtAt: string;
  /** Terms present in the artifact, before runtime filtering. */
  totalTermCount: number;
  allowlist: string[];
  customTerms: CustomTerm[];
}

const LANGUAGES: readonly Language[] = ['zh', 'en', 'other'];

function parseIndexList(value: string, expected: number, field: string): Int32Array {
  if (expected === 0) return new Int32Array(0);
  const parts = value.split(',');
  if (parts.length !== expected) {
    throw new LexiconLoadError(
      `lexicon artifact field "${field}" has ${parts.length} values, expected ${expected}`,
    );
  }
  const out = new Int32Array(expected);
  for (let i = 0; i < expected; i += 1) {
    const parsed = Number.parseInt(parts[i]!, 10);
    if (!Number.isFinite(parsed)) {
      throw new LexiconLoadError(
        `lexicon artifact field "${field}" has a non-numeric value`,
      );
    }
    out[i] = parsed;
  }
  return out;
}

/** Validate the shape of a parsed artifact. */
export function assertArtifact(value: unknown): LexiconArtifact {
  if (typeof value !== 'object' || value === null) {
    throw new LexiconLoadError('lexicon artifact is not an object');
  }
  const artifact = value as Partial<LexiconArtifact>;
  if (artifact.formatVersion !== 1) {
    throw new LexiconLoadError(
      `unsupported lexicon format version: ${String(artifact.formatVersion)}`,
    );
  }
  for (const field of [
    'version',
    'builtAt',
    'terms',
    'categoryIndex',
    'severityIndex',
    'languageIndex',
    'flags',
  ] as const) {
    if (typeof artifact[field] !== 'string') {
      throw new LexiconLoadError(
        `lexicon artifact field "${field}" is missing or not a string`,
      );
    }
  }
  if (!Array.isArray(artifact.categories)) {
    throw new LexiconLoadError('lexicon artifact field "categories" is missing');
  }
  if (typeof artifact.termCount !== 'number') {
    throw new LexiconLoadError('lexicon artifact field "termCount" is missing');
  }
  return artifact as LexiconArtifact;
}

/** Read and parse the artifact plus overrides. */
export async function loadLexicon(
  options: LoadLexiconOptions = {},
): Promise<LoadedLexicon> {
  const file = options.lexiconFile ?? defaultLexiconFile;
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new LexiconLoadError(
      `cannot read lexicon artifact; run "npm run lexicon:build" first`,
      error,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LexiconLoadError('lexicon artifact is not valid JSON', error);
  }
  const artifact = assertArtifact(parsed);

  const terms = artifact.terms === '' ? [] : artifact.terms.split('\n');
  if (terms.length !== artifact.termCount) {
    throw new LexiconLoadError(
      `lexicon artifact declares ${artifact.termCount} terms but contains ${terms.length}`,
    );
  }
  const categoryIndex = parseIndexList(
    artifact.categoryIndex,
    terms.length,
    'categoryIndex',
  );
  const severityIndex = parseIndexList(
    artifact.severityIndex,
    terms.length,
    'severityIndex',
  );
  const languageIndex = parseIndexList(
    artifact.languageIndex,
    terms.length,
    'languageIndex',
  );
  const flags = parseIndexList(artifact.flags, terms.length, 'flags');

  const categoryFilter = resolveCategoryFilter(options.categories, artifact.categories);

  const includeNeedsReview = options.includeNeedsReview ?? false;
  const minTermLength = options.minTermLength ?? 2;
  const entries: LexiconEntry[] = [];
  const perCategoryCount = new Map<string, number>();

  for (let i = 0; i < terms.length; i += 1) {
    const category = artifact.categories[categoryIndex[i]!];
    if (category === undefined) {
      throw new LexiconLoadError(`term ${i} references an unknown category index`);
    }
    if (categoryFilter && !categoryFilter.has(category.id)) continue;
    const needsReview = (flags[i]! & 1) === 1;
    if (needsReview && !includeNeedsReview) continue;
    const term = terms[i]!;
    if (countCodePoints(term) < minTermLength) continue;
    const severity = SEVERITIES[severityIndex[i]!] ?? category.severity;
    const language = LANGUAGES[languageIndex[i]!] ?? 'other';
    // Normalized forms are computed here rather than stored in the artifact, so
    // improving the normalizer never requires re-syncing upstream data.
    const normalizedTerm = normalizeTermToString(term);
    if (normalizedTerm === '') continue;
    const also = artifact.alsoFoundIn?.[String(i)];
    entries.push({
      id: `${category.id}:${i}`,
      term,
      normalizedTerm,
      language,
      category: category.id,
      severity,
      source: category.source,
      sourcePath: category.sourcePath,
      upstreamCommit: artifact.upstreamCommit,
      needsReview,
      ...(also && also.length > 0 ? { alsoFoundIn: also } : {}),
    });
    perCategoryCount.set(category.id, (perCategoryCount.get(category.id) ?? 0) + 1);
  }

  const allowlist = await readAllowlist(
    options.allowlistFile === undefined ? defaultAllowlistFile : options.allowlistFile,
  );
  const customTerms = await readCustomTerms(
    options.customTermsFile === undefined
      ? defaultCustomTermsFile
      : options.customTermsFile,
  );

  // Every category the artifact knows about is reported, including the ones this load
  // filtered out (their `termCount` is 0). Hiding them would make it impossible for an
  // API or CLI user to discover which ids they can ask for.
  const categories = artifact.categories.map((category) => ({
    ...category,
    termCount: perCategoryCount.get(category.id) ?? 0,
  }));

  return {
    entries,
    categories,
    sources: Array.isArray(artifact.sources) ? artifact.sources : [],
    version: artifact.version,
    upstreamCommit: artifact.upstreamCommit ?? null,
    syncedAt: artifact.syncedAt ?? null,
    builtAt: artifact.builtAt,
    totalTermCount: terms.length,
    allowlist,
    customTerms,
  };
}

/** Read an allowlist file; missing files yield an empty list. */
export async function readAllowlist(file: string | null): Promise<string[]> {
  if (file === null) return [];
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.replace(/^\ufeff/, '').split('\n')) {
    const cleaned = line.replace(/\r$/, '').trim();
    if (cleaned === '' || cleaned.startsWith('#')) continue;
    out.push(cleaned);
  }
  return out;
}

/** Read a custom term file; missing files yield an empty list. */
export async function readCustomTerms(file: string | null): Promise<CustomTerm[]> {
  if (file === null) return [];
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.replace(/^\ufeff/, ''));
  } catch (error) {
    throw new LexiconLoadError(`custom terms file is not valid JSON: ${file}`, error);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { terms?: unknown }).terms)
      ? (parsed as { terms: unknown[] }).terms
      : [];
  const out: CustomTerm[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      if (item.trim() !== '') out.push({ term: item.trim() });
      continue;
    }
    if (typeof item !== 'object' || item === null) continue;
    const record = item as { term?: unknown; category?: unknown; severity?: unknown };
    if (typeof record.term !== 'string' || record.term.trim() === '') continue;
    const severity =
      typeof record.severity === 'string' &&
      SEVERITIES.includes(record.severity as Severity)
        ? (record.severity as Severity)
        : undefined;
    out.push({
      term: record.term.trim(),
      ...(typeof record.category === 'string' && record.category !== ''
        ? { category: record.category }
        : {}),
      ...(severity ? { severity } : {}),
    });
  }
  return out;
}

/** Sentinel selecting every category, including the broad lists. */
export const ALL_CATEGORIES_INCLUDING_BROAD = '*';
/** Sentinel selecting the default category set. */
export const DEFAULT_CATEGORY_SELECTOR = 'all';

/**
 * Resolve a requested selection into a concrete category set, or `null` when every
 * category in the artifact is selected.
 */
export function resolveCategoryFilter(
  requested: string[] | undefined,
  available: readonly BuiltCategory[],
): Set<string> | null {
  if (requested && requested.includes(ALL_CATEGORIES_INCLUDING_BROAD)) return null;
  if (
    requested === undefined ||
    requested.length === 0 ||
    requested.includes(DEFAULT_CATEGORY_SELECTOR)
  ) {
    const enabled = available.filter((category) => category.defaultEnabled !== false);
    if (enabled.length === available.length) return null;
    return new Set(enabled.map((category) => category.id));
  }
  const known = new Set(available.map((category) => category.id));
  for (const category of requested) {
    if (!known.has(category)) {
      throw new LexiconLoadError(`unknown category: ${category}`);
    }
  }
  return new Set(requested);
}

function normalizeTermToString(term: string): string {
  return codePointsToString(normalize(createCodePointText(term)).codePoints);
}

function countCodePoints(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i += 1;
    count += 1;
  }
  return count;
}
