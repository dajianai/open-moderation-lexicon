/**
 * open-moderation-lexicon
 *
 * Keyword-based moderation toolkit. This entry point exposes the SDK; the REST server
 * lives in `open-moderation-lexicon/server` and the CLI in the `open-moderation-lexicon`
 * binary.
 *
 * This library detects keywords. It does not understand meaning, intent or context and
 * makes no claim about whether content is lawful.
 */
export {
  Moderator,
  ModerationInputError,
  createModerator,
  createModeratorFromTerms,
  type ModeratorOptions,
} from './moderator.js';

export {
  Matcher,
  type MatcherOptions,
  type MatcherTerm,
  type ScanOptions,
  type CompiledModeStats,
  type MatchCandidate,
} from './core/matcher.js';

export {
  AhoCorasick,
  AhoCorasickBuilder,
  type AutomatonMatch,
} from './core/aho-corasick.js';

export {
  DEFAULT_FUZZY_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  foldFuzzy,
  fuzzyFoldString,
  normalize,
  normalizeString,
  type FuzzyOptions,
  type NormalizeOptions,
} from './core/normalizer.js';

export {
  createCodePointText,
  sliceCodePoints,
  codePointsToString,
  mapToOrigin,
  type CodePointText,
  type NormalizedText,
} from './core/position-map.js';

export {
  DEFAULT_POLICY,
  compareSeverity,
  decide,
  resolvePolicy,
  riskLevelOf,
} from './core/policy.js';

export {
  InvalidMaskCharError,
  maskMatches,
  maskRanges,
  mergeRanges,
  assertValidMaskChar,
  type Range,
} from './core/masker.js';

export {
  LexiconLoadError,
  loadLexicon,
  readAllowlist,
  readCustomTerms,
  type LoadLexiconOptions,
  type LoadedLexicon,
} from './lexicon/loader.js';

export { buildMetadata, supportedModes } from './lexicon/metadata.js';

export {
  buildLexicon,
  toArtifact,
  writeBuildOutput,
  renderReportMarkdown,
  calendarVersion,
  detectLanguage,
  deriveCategoryId,
  inspectTerm,
  listTermFiles,
  type BuildOptions,
  type BuildReport,
  type BuildResult,
  type BuiltCategory,
  type BuiltEntry,
  type CategoryConfig,
  type CategoryReport,
  type FlaggedTerm,
  type LexiconArtifact,
  type SourceConfig,
  type TermIssue,
} from './lexicon/builder.js';

export * as paths from './lexicon/paths.js';

export {
  MATCH_MODES,
  SEVERITIES,
  type CategoryMetadata,
  type CheckOptions,
  type CustomTerm,
  type Decision,
  type Language,
  type LexiconEntry,
  type LexiconMetadata,
  type LexiconStamp,
  type Match,
  type MatchMode,
  type ModerationResult,
  type OverlapStrategy,
  type PolicyConfig,
  type RiskLevel,
  type Severity,
  type SourceMetadata,
} from './core/types.js';
