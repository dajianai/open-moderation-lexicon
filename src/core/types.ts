/** Public type surface of the SDK. */

/** Matching strategy. `normalized` is the default. */
export type MatchMode = 'exact' | 'normalized' | 'fuzzy';

/** Per-term severity weight. */
export type Severity = 'low' | 'medium' | 'high';

/** Aggregated risk of a single moderation call. */
export type RiskLevel = 'none' | 'low' | 'medium' | 'high';

/**
 * Suggested action. This is the output of a *configurable policy*, not a legal or
 * regulatory conclusion. See README for the exact default policy.
 */
export type Decision = 'allow' | 'review' | 'block';

/** Rough language bucket derived from the characters of a term. */
export type Language = 'zh' | 'en' | 'other';

/** How overlapping occurrences are reduced. */
export type OverlapStrategy = 'all' | 'leftmost-longest';

/** All supported match modes, ordered from strictest to loosest. */
export const MATCH_MODES: readonly MatchMode[] = ['exact', 'normalized', 'fuzzy'];

/** All supported severities, ordered from lowest to highest. */
export const SEVERITIES: readonly Severity[] = ['low', 'medium', 'high'];

/** A single lexicon record. */
export interface LexiconEntry {
  /** Stable identifier: `<category>:<index>`. */
  id: string;
  /** The term exactly as it appears in the source file. */
  term: string;
  /** The term after {@link MatchMode} `normalized` processing. */
  normalizedTerm: string;
  language: Language;
  category: string;
  severity: Severity;
  /** Human readable source name, usually the upstream file name. */
  source: string;
  /** Repository-relative path of the source file. */
  sourcePath: string;
  /** Upstream commit the term was synced from; `null` for local-only terms. */
  upstreamCommit: string | null;
  /** True when the term needs human review (single character, suspicious shape, ...). */
  needsReview: boolean;
  /** Additional source paths the identical term was also found in. */
  alsoFoundIn?: string[];
}

/** A term supplied by the host application. */
export interface CustomTerm {
  term: string;
  category?: string;
  severity?: Severity;
}

/** One occurrence in the checked text. */
export interface Match {
  /** The lexicon term that matched. */
  term: string;
  /** The exact substring of the original text that matched. */
  matchedText: string;
  category: string;
  severity: Severity;
  /** Weakest rule that was required for this occurrence to match. */
  matchType: MatchMode;
  /** Inclusive start offset, in Unicode code points of the original text. */
  start: number;
  /** Exclusive end offset, in Unicode code points of the original text. */
  end: number;
}

/** Lexicon provenance echoed in every result. */
export interface LexiconStamp {
  version: string;
  upstreamCommit: string | null;
}

/** Result of a moderation call. */
export interface ModerationResult {
  matched: boolean;
  decision: Decision;
  riskLevel: RiskLevel;
  /** Number of occurrences (after overlap reduction). */
  hitCount: number;
  /** Number of distinct terms among the occurrences. */
  uniqueTermCount: number;
  /** Distinct categories among the occurrences, sorted. */
  categories: string[];
  /** Occurrences; empty when `returnMatches` is false. */
  matches: Match[];
  /** Present only when masking was requested. */
  maskedText?: string;
  lexicon: LexiconStamp;
}

/** Policy configuration mapping matches to a decision and a risk level. */
export interface PolicyConfig {
  /**
   * Severities that lead to `block`. Defaults to `['high']`, so an ordinary hit is
   * only ever escalated to `review`.
   */
  blockSeverities: Severity[];
  /** Categories that always lead to `block`, regardless of term severity. */
  blockCategories: string[];
  /** Categories that are downgraded to `allow` even when they match. */
  allowCategories: string[];
  /** Minimum number of occurrences before a decision is escalated to `block`. */
  blockMinHitCount: number;
}

/** Options accepted by `check`, `findAll` and friends. */
export interface CheckOptions {
  mode?: MatchMode;
  /** `['all']` (default) or an explicit list of category ids. */
  categories?: string[];
  /** Include the `matches` array in the result. Defaults to true. */
  returnMatches?: boolean;
  /** Maximum number of occurrences to collect. Defaults to unlimited. */
  maxMatches?: number;
  /** Overlap reduction. Defaults to `leftmost-longest`. */
  overlap?: OverlapStrategy;
  /** Produce `maskedText`. Defaults to false. */
  mask?: boolean;
  /** Single code point used for masking. Defaults to `*`. */
  maskChar?: string;
  /** Extra terms allowed for this call only. */
  allowlist?: string[];
}

/** Immutable metadata describing a loaded lexicon. */
export interface LexiconMetadata {
  /** Calendar version of the generated lexicon, e.g. `2026.07.29`. */
  version: string;
  /** Upstream commit the bundled data was generated from. */
  upstreamCommit: string | null;
  /** ISO timestamp of the last upstream sync. */
  syncedAt: string | null;
  /** ISO timestamp the lexicon artifacts were built. */
  builtAt: string;
  /** Number of terms available after filtering. */
  termCount: number;
  /** Number of terms in the generated artifact before runtime filtering. */
  totalTermCount: number;
  /** Categories present in the loaded lexicon. */
  categories: CategoryMetadata[];
  sources: SourceMetadata[];
}

/** Metadata for one category. */
export interface CategoryMetadata {
  id: string;
  /** Original (usually Chinese) display name. */
  displayName: string;
  severity: Severity;
  termCount: number;
  /**
   * False for broad upstream lists that are excluded from the default selection
   * because they contain many ordinary words.
   */
  defaultEnabled: boolean;
  description?: string;
}

/** Metadata for one source file. */
export interface SourceMetadata {
  path: string;
  name: string;
  category: string;
  termCount: number;
  sha256: string;
}
