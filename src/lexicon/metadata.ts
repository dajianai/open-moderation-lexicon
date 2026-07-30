/** Metadata helpers shared by the SDK, the CLI and the REST API. */
import { MATCH_MODES, type LexiconMetadata, type MatchMode } from '../core/types.js';
import type { LoadedLexicon } from './loader.js';

/** Build the public metadata object from a loaded lexicon. */
export function buildMetadata(lexicon: LoadedLexicon): LexiconMetadata {
  return {
    version: lexicon.version,
    upstreamCommit: lexicon.upstreamCommit,
    syncedAt: lexicon.syncedAt,
    builtAt: lexicon.builtAt,
    termCount: lexicon.entries.length,
    totalTermCount: lexicon.totalTermCount,
    categories: lexicon.categories.map((category) => ({
      id: category.id,
      displayName: category.displayName,
      severity: category.severity,
      termCount: category.termCount,
      defaultEnabled: category.defaultEnabled !== false,
      ...(category.description ? { description: category.description } : {}),
    })),
    sources: lexicon.sources,
  };
}

/** Supported match modes, for `/v1/metadata` and the CLI. */
export function supportedModes(): MatchMode[] {
  return [...MATCH_MODES];
}
