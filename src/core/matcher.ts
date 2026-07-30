/**
 * The matching engine. Independent of the lexicon loader, of Fastify and of any I/O,
 * so it can be used standalone with an in-memory term list.
 *
 * One Aho–Corasick automaton is compiled per {@link MatchMode}, lazily and at most
 * once. Scanning never rebuilds or copies the term list.
 */
import type { AhoCorasick } from './aho-corasick.js';
import { AhoCorasickBuilder } from './aho-corasick.js';
import {
  DEFAULT_FUZZY_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  exactView,
  foldFuzzy,
  isWordCodePoint,
  normalize,
  type FuzzyOptions,
  type NormalizeOptions,
} from './normalizer.js';
import {
  createCodePointText,
  identityNormalizedText,
  mapToOrigin,
  sliceCodePoints,
  codePointsToString,
  type CodePointText,
  type NormalizedText,
} from './position-map.js';
import { compareSeverity } from './policy.js';
import type { Match, MatchMode, OverlapStrategy, Severity } from './types.js';

/** Minimal term shape the matcher needs. */
export interface MatcherTerm {
  term: string;
  /** Pre-computed normalized form. Computed on demand when omitted. */
  normalizedTerm?: string;
  category: string;
  severity: Severity;
}

/** Construction options. */
export interface MatcherOptions {
  normalize?: Partial<NormalizeOptions>;
  fuzzy?: Partial<FuzzyOptions>;
  /**
   * Require word boundaries around terms whose first/last character is a Latin,
   * Greek or Cyrillic letter or a digit, so `ass` does not match inside `class`.
   * Defaults to true.
   */
  wordBoundary?: boolean;
  /** Default overlap strategy. Defaults to `leftmost-longest`. */
  overlap?: OverlapStrategy;
  /** Terms that suppress a match, either identical to it or fully covering it. */
  allowlist?: string[];
  /** Modes to compile eagerly. Defaults to `['normalized']`. */
  precompileModes?: MatchMode[];
  /**
   * Hard cap on raw occurrences collected per scan, protecting against pathological
   * inputs. Defaults to 200000.
   */
  maxRawMatches?: number;
}

/** Per-scan options. */
export interface ScanOptions {
  mode?: MatchMode;
  categories?: string[];
  overlap?: OverlapStrategy;
  maxMatches?: number;
  allowlist?: string[];
  /** Stop after the first (leftmost, longest) occurrence. */
  firstOnly?: boolean;
}

/** An occurrence before allowlist filtering, overlap reduction and materialization. */
export interface MatchCandidate {
  termIndex: number;
  /** Inclusive start offset in original code points. */
  start: number;
  /** Exclusive end offset in original code points. */
  end: number;
  /** True when the occurrence came from the heuristic fuzzy automaton. */
  fromFuzzy: boolean;
}

interface CompiledMode {
  automaton: AhoCorasick;
  /** Flattened per-pattern term indices, ordered by descending severity. */
  patternTerms: Int32Array;
  patternStart: Int32Array;
  needsLeftBoundary: Uint8Array;
  needsRightBoundary: Uint8Array;
  patternCount: number;
  maxPatternLength: number;
  /** Number of terms that were skipped for this mode (empty or too short). */
  skippedTerms: number;
}

/** Selectors that disable per-call category filtering. */
const CATEGORY_WILDCARDS = new Set(['all', '*']);

/** Statistics about a compiled mode, exposed for diagnostics and benchmarks. */
export interface CompiledModeStats {
  mode: MatchMode;
  patternCount: number;
  nodeCount: number;
  edgeCount: number;
  approximateByteSize: number;
  skippedTerms: number;
}

export class Matcher {
  private readonly terms: readonly MatcherTerm[];
  private readonly normalizedTerms: string[];
  private readonly normalizeOptions: NormalizeOptions;
  private readonly fuzzyOptions: FuzzyOptions;
  private readonly wordBoundary: boolean;
  private readonly defaultOverlap: OverlapStrategy;
  private readonly maxRawMatches: number;
  private readonly compiled = new Map<MatchMode, CompiledMode>();
  private readonly allowlistCache = new Map<string, AhoCorasick | null>();
  private readonly baseAllowlist: readonly string[];
  private readonly baseAllowlistTerms: ReadonlySet<string>;

  constructor(terms: readonly MatcherTerm[], options: MatcherOptions = {}) {
    this.terms = terms;
    this.normalizeOptions = { ...DEFAULT_NORMALIZE_OPTIONS, ...options.normalize };
    this.fuzzyOptions = { ...DEFAULT_FUZZY_OPTIONS, ...options.fuzzy };
    this.wordBoundary = options.wordBoundary ?? true;
    this.defaultOverlap = options.overlap ?? 'leftmost-longest';
    this.maxRawMatches = options.maxRawMatches ?? 200_000;
    this.normalizedTerms = terms.map((term) =>
      term.normalizedTerm !== undefined && term.normalizedTerm !== ''
        ? term.normalizedTerm
        : this.normalizeToString(term.term),
    );
    this.baseAllowlist = options.allowlist ? [...options.allowlist] : [];
    this.baseAllowlistTerms = new Set(
      this.baseAllowlist
        .map((term) => this.normalizeToString(term))
        .filter((t) => t !== ''),
    );
    for (const mode of options.precompileModes ?? ['normalized']) {
      this.compile(mode);
    }
  }

  /** Number of terms known to the matcher. */
  get termCount(): number {
    return this.terms.length;
  }

  /** Compile (or fetch) the automaton for a mode. */
  compile(mode: MatchMode): void {
    this.getCompiled(mode);
  }

  /** Diagnostics for every mode compiled so far. */
  stats(): CompiledModeStats[] {
    return [...this.compiled.entries()].map(([mode, compiled]) => ({
      mode,
      patternCount: compiled.patternCount,
      nodeCount: compiled.automaton.nodeCount,
      edgeCount: compiled.automaton.edgeCount,
      approximateByteSize: compiled.automaton.approximateByteSize,
      skippedTerms: compiled.skippedTerms,
    }));
  }

  /** True when at least one term occurs in `text`. */
  contains(text: string, options: ScanOptions = {}): boolean {
    return this.scan(text, { ...options, firstOnly: true }).length > 0;
  }

  /** Leftmost, longest occurrence, or `undefined`. */
  findFirst(text: string, options: ScanOptions = {}): Match | undefined {
    return this.scan(text, { ...options, firstOnly: true })[0];
  }

  /** Every occurrence, after overlap reduction. */
  findAll(text: string, options: ScanOptions = {}): Match[] {
    return this.scan(text, options);
  }

  /**
   * Core scan. Returns occurrences with offsets in Unicode code points of the
   * original `text`.
   */
  scan(text: string, options: ScanOptions = {}): Match[] {
    if (text === '') return [];
    const mode = options.mode ?? 'normalized';
    const overlap = options.overlap ?? this.defaultOverlap;
    const view = createCodePointText(text);
    const categoryFilter = buildCategoryFilter(options.categories);

    const hits: MatchCandidate[] = [];
    let normalizedView: NormalizedText | undefined;

    if (mode === 'exact') {
      this.scanWith('exact', exactView(view), categoryFilter, hits, options.firstOnly);
    } else {
      normalizedView = normalize(view, this.normalizeOptions);
      this.scanWith(
        'normalized',
        normalizedView,
        categoryFilter,
        hits,
        options.firstOnly,
      );
      if (mode === 'fuzzy') {
        const fuzzyView = foldFuzzy(normalizedView, this.fuzzyOptions);
        this.scanWith(
          'fuzzy',
          fuzzyView,
          categoryFilter,
          hits,
          options.firstOnly,
          true,
        );
      }
    }

    if (hits.length === 0) return [];

    const deduplicated = deduplicateHits(hits);
    const allowed = this.applyAllowlist(
      view,
      deduplicated,
      options.allowlist,
      normalizedView,
    );
    const reduced = reduceOverlaps(allowed, overlap);
    const limited =
      options.firstOnly === true
        ? reduced.slice(0, 1)
        : options.maxMatches !== undefined && options.maxMatches >= 0
          ? reduced.slice(0, options.maxMatches)
          : reduced;

    return limited.map((hit) => this.materialize(view, hit));
  }

  /** Normalize a string with this matcher's options. */
  normalizeToString(text: string): string {
    const normalized = normalize(createCodePointText(text), this.normalizeOptions);
    return codePointsToString(normalized.codePoints);
  }

  /** Fuzzy-fold a string with this matcher's options. */
  fuzzyFoldToString(text: string): string {
    const normalized = normalize(createCodePointText(text), this.normalizeOptions);
    return codePointsToString(foldFuzzy(normalized, this.fuzzyOptions).codePoints);
  }

  private scanWith(
    mode: MatchMode,
    textView: NormalizedText,
    categoryFilter: Set<string> | null,
    out: MatchCandidate[],
    firstOnly: boolean | undefined,
    fromFuzzy = false,
  ): void {
    const compiled = this.getCompiled(mode);
    if (compiled.patternCount === 0) return;
    const cps = textView.codePoints;
    const limit = this.maxRawMatches;
    let earliestEnd = Number.POSITIVE_INFINITY;

    compiled.automaton.search(cps, (patternId, nStart, nEnd) => {
      if (this.wordBoundary) {
        // Boundaries are checked in the scanned (folded) text, where full-width letters
        // have already become plain Latin ones. A dropped separator still counts as a
        // boundary, otherwise fuzzy folding would glue neighbouring words together.
        if (
          compiled.needsLeftBoundary[patternId] === 1 &&
          nStart > 0 &&
          textView.separatorBefore[nStart] !== 1 &&
          isWordCodePoint(cps[nStart - 1]!)
        ) {
          return;
        }
        if (
          compiled.needsRightBoundary[patternId] === 1 &&
          nEnd < cps.length &&
          textView.separatorBefore[nEnd] !== 1 &&
          isWordCodePoint(cps[nEnd]!)
        ) {
          return;
        }
      }
      const range = mapToOrigin(textView, nStart, nEnd);
      const termIndex = this.pickTerm(compiled, patternId, categoryFilter);
      if (termIndex < 0) return;
      out.push({ termIndex, start: range.start, end: range.end, fromFuzzy });
      if (out.length >= limit) return false;
      if (firstOnly === true) {
        // Keep scanning a little past the first hit so a longer or earlier-starting
        // term can still win, then stop.
        if (earliestEnd === Number.POSITIVE_INFINITY) {
          earliestEnd = nEnd + compiled.maxPatternLength;
        }
        if (nEnd > earliestEnd) return false;
      }
      return;
    });
  }

  private pickTerm(
    compiled: CompiledMode,
    patternId: number,
    categoryFilter: Set<string> | null,
  ): number {
    const from = compiled.patternStart[patternId]!;
    const to = compiled.patternStart[patternId + 1]!;
    for (let i = from; i < to; i += 1) {
      const termIndex = compiled.patternTerms[i]!;
      if (categoryFilter === null) return termIndex;
      const category = this.terms[termIndex]!.category;
      if (categoryFilter.has(category)) return termIndex;
    }
    return -1;
  }

  private materialize(view: CodePointText, hit: MatchCandidate): Match {
    const term = this.terms[hit.termIndex]!;
    const matchedText = sliceCodePoints(view, hit.start, hit.end);
    let matchType: MatchMode;
    if (matchedText === term.term) matchType = 'exact';
    else if (hit.fromFuzzy) matchType = 'fuzzy';
    else matchType = 'normalized';
    return {
      term: term.term,
      matchedText,
      category: term.category,
      severity: term.severity,
      matchType,
      start: hit.start,
      end: hit.end,
    };
  }

  private applyAllowlist(
    view: CodePointText,
    hits: MatchCandidate[],
    callAllowlist: string[] | undefined,
    normalizedView: NormalizedText | undefined,
  ): MatchCandidate[] {
    const allowTerms =
      callAllowlist && callAllowlist.length > 0
        ? new Set([
            ...this.baseAllowlistTerms,
            ...callAllowlist
              .map((term) => this.normalizeToString(term))
              .filter((t) => t !== ''),
          ])
        : this.baseAllowlistTerms;
    if (allowTerms.size === 0) return hits;

    const automaton = this.getAllowlistAutomaton(allowTerms);
    const covering: { start: number; end: number }[] = [];
    if (automaton) {
      const textView = normalizedView ?? normalize(view, this.normalizeOptions);
      automaton.search(textView.codePoints, (_patternId, nStart, nEnd) => {
        covering.push(mapToOrigin(textView, nStart, nEnd));
      });
    }

    return hits.filter((hit) => {
      const normalizedTerm = this.normalizedTerms[hit.termIndex]!;
      if (allowTerms.has(normalizedTerm)) return false;
      const matchedText = sliceCodePoints(view, hit.start, hit.end);
      if (allowTerms.has(this.normalizeToString(matchedText))) return false;
      for (const range of covering) {
        if (range.start <= hit.start && range.end >= hit.end) return false;
      }
      return true;
    });
  }

  private getAllowlistAutomaton(terms: ReadonlySet<string>): AhoCorasick | null {
    const key = [...terms].sort().join('\u0000');
    const cached = this.allowlistCache.get(key);
    if (cached !== undefined) return cached;
    const builder = new AhoCorasickBuilder(64);
    let added = 0;
    let patternId = 0;
    for (const term of terms) {
      const cps = createCodePointText(term).codePoints;
      if (cps.length === 0) continue;
      builder.add(cps, patternId);
      patternId += 1;
      added += 1;
    }
    const automaton = added === 0 ? null : builder.build();
    if (this.allowlistCache.size < 64) this.allowlistCache.set(key, automaton);
    return automaton;
  }

  private getCompiled(mode: MatchMode): CompiledMode {
    const existing = this.compiled.get(mode);
    if (existing) return existing;
    const compiled = this.buildMode(mode);
    this.compiled.set(mode, compiled);
    return compiled;
  }

  private buildMode(mode: MatchMode): CompiledMode {
    const groups = new Map<string, number[]>();
    let skippedTerms = 0;

    for (let index = 0; index < this.terms.length; index += 1) {
      const key = this.patternFor(mode, index);
      if (key === '') {
        skippedTerms += 1;
        continue;
      }
      if (mode === 'fuzzy') {
        const length = [...key].length;
        if (length < this.fuzzyOptions.minTermLength) {
          skippedTerms += 1;
          continue;
        }
      }
      const bucket = groups.get(key);
      if (bucket) bucket.push(index);
      else groups.set(key, [index]);
    }

    const patternCount = groups.size;
    const patternStart = new Int32Array(patternCount + 1);
    const needsLeftBoundary = new Uint8Array(patternCount);
    const needsRightBoundary = new Uint8Array(patternCount);
    const builder = new AhoCorasickBuilder(Math.max(1024, patternCount * 4));

    let totalTerms = 0;
    for (const bucket of groups.values()) totalTerms += bucket.length;
    const patternTerms = new Int32Array(totalTerms);

    let patternId = 0;
    let cursor = 0;
    let maxPatternLength = 0;
    for (const [key, bucket] of groups) {
      bucket.sort(
        (a, b) =>
          compareSeverity(this.terms[b]!.severity, this.terms[a]!.severity) || a - b,
      );
      patternStart[patternId] = cursor;
      for (const termIndex of bucket) {
        patternTerms[cursor] = termIndex;
        cursor += 1;
      }
      const cps = createCodePointText(key).codePoints;
      if (cps.length > maxPatternLength) maxPatternLength = cps.length;
      needsLeftBoundary[patternId] = isWordCodePoint(cps[0]!) ? 1 : 0;
      needsRightBoundary[patternId] = isWordCodePoint(cps[cps.length - 1]!) ? 1 : 0;
      builder.add(cps, patternId);
      patternId += 1;
    }
    patternStart[patternId] = cursor;

    return {
      automaton: builder.build(),
      patternTerms,
      patternStart,
      needsLeftBoundary,
      needsRightBoundary,
      patternCount,
      maxPatternLength,
      skippedTerms,
    };
  }

  private patternFor(mode: MatchMode, index: number): string {
    if (mode === 'exact') return this.terms[index]!.term;
    const normalized = this.normalizedTerms[index]!;
    if (mode === 'normalized') return normalized;
    // The normalized form is already available, so fuzzy folding can skip
    // re-normalizing the raw term.
    const view = identityNormalizedText(createCodePointText(normalized));
    return codePointsToString(foldFuzzy(view, this.fuzzyOptions).codePoints);
  }
}

function buildCategoryFilter(categories: string[] | undefined): Set<string> | null {
  if (!categories || categories.length === 0) return null;
  if (categories.some((category) => CATEGORY_WILDCARDS.has(category))) return null;
  return new Set(categories);
}

/** Drop duplicate `(termIndex, start, end)` triples, preferring non-fuzzy origins. */
function deduplicateHits(hits: MatchCandidate[]): MatchCandidate[] {
  if (hits.length === 1) return hits;
  const seen = new Map<string, MatchCandidate>();
  for (const hit of hits) {
    const key = `${hit.start}:${hit.end}:${hit.termIndex}`;
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, hit);
      continue;
    }
    if (previous.fromFuzzy && !hit.fromFuzzy) seen.set(key, hit);
  }
  return [...seen.values()];
}

/**
 * Reduce overlapping occurrences.
 *
 * `all` keeps everything, sorted by start then by descending length.
 * `leftmost-longest` walks the sorted list and greedily keeps an occurrence when it
 * does not overlap an already kept one, which yields the classic leftmost-longest set.
 */
export function reduceOverlaps(
  hits: MatchCandidate[],
  strategy: OverlapStrategy,
): MatchCandidate[] {
  const sorted = [...hits].sort(
    (a, b) => a.start - b.start || b.end - a.end || a.termIndex - b.termIndex,
  );
  if (strategy === 'all') return sorted;
  const kept: MatchCandidate[] = [];
  let lastEnd = -1;
  for (const hit of sorted) {
    if (hit.start >= lastEnd) {
      kept.push(hit);
      lastEnd = hit.end;
    }
  }
  return kept;
}
