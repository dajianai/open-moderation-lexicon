/**
 * The public SDK surface.
 *
 * A {@link Moderator} owns one loaded lexicon and its compiled automata. Building is
 * done once in {@link createModerator} (or in {@link Moderator.reload}); `check` and
 * friends are pure, synchronous and safe to call concurrently.
 */
import {
  Matcher,
  type MatcherOptions,
  type MatcherTerm,
  type ScanOptions,
} from './core/matcher.js';
import { assertValidMaskChar, maskMatches } from './core/masker.js';
import type { FuzzyOptions, NormalizeOptions } from './core/normalizer.js';
import { decide, resolvePolicy, riskLevelOf } from './core/policy.js';
import { createCodePointText } from './core/position-map.js';
import type {
  CheckOptions,
  CustomTerm,
  LexiconEntry,
  LexiconMetadata,
  MatchMode,
  Match,
  ModerationResult,
  OverlapStrategy,
  PolicyConfig,
  Severity,
} from './core/types.js';
import {
  loadLexicon,
  type LoadLexiconOptions,
  type LoadedLexicon,
} from './lexicon/loader.js';
import { buildMetadata } from './lexicon/metadata.js';

/** Options for {@link createModerator}. */
export interface ModeratorOptions {
  /** Default match mode. Defaults to `normalized`. */
  mode?: MatchMode;
  /** Categories to load. `['all']` (default) loads every category. */
  categories?: string[];
  /** Terms that suppress matches. Merged with `data/overrides/allowlist.txt`. */
  allowlist?: string[];
  /** Extra terms. Merged with `data/overrides/custom-terms.json`. */
  customTerms?: CustomTerm[];
  /** Default category for custom terms without one. Defaults to `custom`. */
  customTermCategory?: string;
  /** Default severity for custom terms without one. Defaults to `medium`. */
  customTermSeverity?: Severity;
  /** Default overlap strategy. Defaults to `leftmost-longest`. */
  overlap?: OverlapStrategy;
  /** Default mask character. Defaults to `*`. */
  maskChar?: string;
  /** Decision policy overrides. */
  policy?: Partial<PolicyConfig>;
  /** Normalization tweaks. */
  normalize?: Partial<NormalizeOptions>;
  /** Fuzzy folding tweaks. Fuzzy matching itself stays opt-in per call or via `mode`. */
  fuzzy?: Partial<FuzzyOptions>;
  /** Require word boundaries for Latin terms. Defaults to true. */
  wordBoundary?: boolean;
  /** Modes to compile up front. Defaults to the effective default mode. */
  precompileModes?: MatchMode[];
  /** Lexicon loading options (paths, review terms, minimum term length). */
  lexicon?: LoadLexiconOptions;
  /**
   * Use these entries instead of reading the bundled artifact. Intended for tests and
   * for hosts that manage their own lexicon.
   */
  entries?: LexiconEntry[];
}

/** Thrown for invalid SDK input. */
export class ModerationInputError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ModerationInputError';
  }
}

const DEFAULT_CUSTOM_CATEGORY = 'custom';
const DEFAULT_CUSTOM_SEVERITY: Severity = 'medium';

/** Keyword-based moderator over a fixed lexicon. */
export class Moderator {
  private matcher: Matcher;
  private lexicon: LoadedLexicon;
  private metadataCache: LexiconMetadata;
  private readonly options: ModeratorOptions;
  private readonly policy: PolicyConfig;
  private readonly defaultMode: MatchMode;
  private readonly defaultOverlap: OverlapStrategy;
  private readonly defaultMaskChar: string;

  /** @internal Use {@link createModerator}. */
  constructor(lexicon: LoadedLexicon, options: ModeratorOptions) {
    this.options = options;
    this.lexicon = lexicon;
    this.policy = resolvePolicy(options.policy);
    this.defaultMode = options.mode ?? 'normalized';
    this.defaultOverlap = options.overlap ?? 'leftmost-longest';
    this.defaultMaskChar = options.maskChar ?? '*';
    assertValidMaskChar(this.defaultMaskChar);
    this.matcher = buildMatcher(lexicon, options, this.defaultMode);
    this.metadataCache = buildMetadata(lexicon);
  }

  /** Full moderation result, including decision and risk level. */
  check(text: string, options: CheckOptions = {}): ModerationResult {
    assertText(text);
    const maskChar = options.maskChar ?? this.defaultMaskChar;
    if (options.mask === true) assertValidMaskChar(maskChar);
    const mode = this.resolveMode(options.mode);
    this.assertCategories(options.categories);

    const scanOptions: ScanOptions = {
      mode,
      overlap: options.overlap ?? this.defaultOverlap,
      ...(options.categories ? { categories: options.categories } : {}),
      ...(options.maxMatches !== undefined ? { maxMatches: options.maxMatches } : {}),
      ...(options.allowlist ? { allowlist: options.allowlist } : {}),
    };
    const matches = this.matcher.scan(text, scanOptions);
    const returnMatches = options.returnMatches ?? true;
    const categories = [...new Set(matches.map((match) => match.category))].sort();
    const uniqueTerms = new Set(matches.map((match) => match.term));

    const result: ModerationResult = {
      matched: matches.length > 0,
      decision: decide(matches, this.policy),
      riskLevel: riskLevelOf(matches),
      hitCount: matches.length,
      uniqueTermCount: uniqueTerms.size,
      categories,
      matches: returnMatches ? matches : [],
      lexicon: {
        version: this.lexicon.version,
        upstreamCommit: this.lexicon.upstreamCommit,
      },
    };
    if (options.mask === true) {
      result.maskedText = maskMatches(createCodePointText(text), matches, maskChar);
    }
    return result;
  }

  /** True when at least one term occurs. */
  contains(text: string, options: CheckOptions = {}): boolean {
    assertText(text);
    this.assertCategories(options.categories);
    return this.matcher.contains(text, this.toScanOptions(options));
  }

  /** Leftmost, longest occurrence. */
  findFirst(text: string, options: CheckOptions = {}): Match | undefined {
    assertText(text);
    this.assertCategories(options.categories);
    return this.matcher.findFirst(text, this.toScanOptions(options));
  }

  /** Every occurrence, after overlap reduction. */
  findAll(text: string, options: CheckOptions = {}): Match[] {
    assertText(text);
    this.assertCategories(options.categories);
    return this.matcher.findAll(text, this.toScanOptions(options));
  }

  /** Distinct terms that occur in the text. */
  findUniqueTerms(text: string, options: CheckOptions = {}): string[] {
    return [...new Set(this.findAll(text, options).map((match) => match.term))];
  }

  /** Replace every matched range with `maskChar`. */
  mask(text: string, options: CheckOptions = {}): string {
    assertText(text);
    const maskChar = options.maskChar ?? this.defaultMaskChar;
    assertValidMaskChar(maskChar);
    const matches = this.findAll(text, options);
    return maskMatches(createCodePointText(text), matches, maskChar);
  }

  /** Lexicon metadata: version, upstream commit, counts and categories. */
  getMetadata(): LexiconMetadata {
    return this.metadataCache;
  }

  /** Automaton statistics for the modes compiled so far. */
  getMatcherStats(): ReturnType<Matcher['stats']> {
    return this.matcher.stats();
  }

  /** Re-read the lexicon from disk and rebuild the automata. */
  async reload(): Promise<void> {
    const lexicon = await loadLexicon(this.options.lexicon ?? {});
    this.lexicon = lexicon;
    this.matcher = buildMatcher(lexicon, this.options, this.defaultMode);
    this.metadataCache = buildMetadata(lexicon);
  }

  /** Compile the automaton of a mode ahead of the first request that needs it. */
  warmup(mode: MatchMode): void {
    this.matcher.compile(mode);
  }

  private toScanOptions(options: CheckOptions): ScanOptions {
    return {
      mode: this.resolveMode(options.mode),
      overlap: options.overlap ?? this.defaultOverlap,
      ...(options.categories ? { categories: options.categories } : {}),
      ...(options.maxMatches !== undefined ? { maxMatches: options.maxMatches } : {}),
      ...(options.allowlist ? { allowlist: options.allowlist } : {}),
    };
  }

  private resolveMode(mode: MatchMode | undefined): MatchMode {
    if (mode === undefined) return this.defaultMode;
    if (mode !== 'exact' && mode !== 'normalized' && mode !== 'fuzzy') {
      throw new ModerationInputError(
        `unsupported match mode: ${String(mode)}`,
        'INVALID_MODE',
      );
    }
    return mode;
  }

  private assertCategories(categories: string[] | undefined): void {
    if (!categories || categories.length === 0) return;
    if (categories.includes('all') || categories.includes('*')) return;
    const known = new Set(this.lexicon.categories.map((category) => category.id));
    known.add(this.options.customTermCategory ?? DEFAULT_CUSTOM_CATEGORY);
    for (const custom of this.options.customTerms ?? []) {
      if (custom.category) known.add(custom.category);
    }
    for (const custom of this.lexicon.customTerms) {
      if (custom.category) known.add(custom.category);
    }
    const unknown = categories.filter((category) => !known.has(category));
    if (unknown.length > 0) {
      throw new ModerationInputError(
        `unknown category: ${unknown.join(', ')}`,
        'UNKNOWN_CATEGORY',
      );
    }
  }
}

/** Load the lexicon and build a ready-to-use moderator. */
export async function createModerator(
  options: ModeratorOptions = {},
): Promise<Moderator> {
  const lexicon =
    options.entries !== undefined
      ? syntheticLexicon(options.entries)
      : await loadLexicon({
          ...(options.lexicon ?? {}),
          ...(options.categories ? { categories: options.categories } : {}),
        });
  return new Moderator(lexicon, options);
}

/** Build a moderator from an in-memory term list, without touching the filesystem. */
export function createModeratorFromTerms(
  terms: (CustomTerm | string)[],
  options: Omit<ModeratorOptions, 'entries' | 'lexicon'> = {},
): Moderator {
  const entries: LexiconEntry[] = terms.map((item, index) => {
    const custom = typeof item === 'string' ? { term: item } : item;
    return {
      id: `inline:${index}`,
      term: custom.term,
      normalizedTerm: '',
      language: 'other',
      category:
        custom.category ?? options.customTermCategory ?? DEFAULT_CUSTOM_CATEGORY,
      severity:
        custom.severity ?? options.customTermSeverity ?? DEFAULT_CUSTOM_SEVERITY,
      source: 'inline',
      sourcePath: 'inline',
      upstreamCommit: null,
      needsReview: false,
    };
  });
  return new Moderator(syntheticLexicon(entries), options);
}

function syntheticLexicon(entries: LexiconEntry[]): LoadedLexicon {
  const categories = new Map<string, number>();
  for (const entry of entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  return {
    entries,
    categories: [...categories.entries()].map(([id, termCount]) => ({
      id,
      displayName: id,
      severity: 'medium',
      sourcePath: 'inline',
      source: 'inline',
      termCount,
      defaultEnabled: true,
    })),
    sources: [],
    version: 'inline',
    upstreamCommit: null,
    syncedAt: null,
    builtAt: new Date(0).toISOString(),
    totalTermCount: entries.length,
    allowlist: [],
    customTerms: [],
  };
}

function buildMatcher(
  lexicon: LoadedLexicon,
  options: ModeratorOptions,
  defaultMode: MatchMode,
): Matcher {
  const customCategory = options.customTermCategory ?? DEFAULT_CUSTOM_CATEGORY;
  const customSeverity = options.customTermSeverity ?? DEFAULT_CUSTOM_SEVERITY;
  const terms: MatcherTerm[] = lexicon.entries.map((entry) => ({
    term: entry.term,
    normalizedTerm: entry.normalizedTerm,
    category: entry.category,
    severity: entry.severity,
  }));
  for (const custom of [...lexicon.customTerms, ...(options.customTerms ?? [])]) {
    if (custom.term.trim() === '') continue;
    terms.push({
      term: custom.term,
      category: custom.category ?? customCategory,
      severity: custom.severity ?? customSeverity,
    });
  }

  const matcherOptions: MatcherOptions = {
    allowlist: [...lexicon.allowlist, ...(options.allowlist ?? [])],
    precompileModes: options.precompileModes ?? [defaultMode],
    ...(options.normalize ? { normalize: options.normalize } : {}),
    ...(options.fuzzy ? { fuzzy: options.fuzzy } : {}),
    ...(options.wordBoundary !== undefined
      ? { wordBoundary: options.wordBoundary }
      : {}),
    ...(options.overlap ? { overlap: options.overlap } : {}),
  };
  return new Matcher(terms, matcherOptions);
}

function assertText(text: unknown): void {
  if (typeof text !== 'string') {
    throw new ModerationInputError('text must be a string', 'INVALID_TEXT');
  }
}
