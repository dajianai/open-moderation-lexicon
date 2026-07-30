/**
 * Decision policy.
 *
 * The policy deliberately errs on the side of *not* blocking: a keyword hit means
 * "a human or a stricter system should look at this", not "this content is illegal".
 * Only severities or categories that an operator explicitly marks as high risk can
 * produce `block`.
 */
import type { Decision, Match, PolicyConfig, RiskLevel, Severity } from './types.js';

export const DEFAULT_POLICY: Readonly<PolicyConfig> = Object.freeze({
  blockSeverities: ['high'] as Severity[],
  blockCategories: [] as string[],
  allowCategories: [] as string[],
  blockMinHitCount: 1,
});

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

/** Highest severity among the matches, or `none` when there are none. */
export function riskLevelOf(matches: readonly Match[]): RiskLevel {
  let rank = 0;
  for (const match of matches) {
    const value = SEVERITY_RANK[match.severity];
    if (value > rank) rank = value;
  }
  switch (rank) {
    case 3:
      return 'high';
    case 2:
      return 'medium';
    case 1:
      return 'low';
    default:
      return 'none';
  }
}

/** Compare two severities. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

/** Merge a partial policy with the defaults. */
export function resolvePolicy(policy?: Partial<PolicyConfig>): PolicyConfig {
  return {
    blockSeverities: policy?.blockSeverities ?? [...DEFAULT_POLICY.blockSeverities],
    blockCategories: policy?.blockCategories ?? [...DEFAULT_POLICY.blockCategories],
    allowCategories: policy?.allowCategories ?? [...DEFAULT_POLICY.allowCategories],
    blockMinHitCount: policy?.blockMinHitCount ?? DEFAULT_POLICY.blockMinHitCount,
  };
}

/**
 * Decide what to suggest for a set of occurrences.
 *
 * - No occurrence at all -> `allow`.
 * - Every occurrence in an `allowCategories` category -> `allow`.
 * - An occurrence whose severity is in `blockSeverities`, or whose category is in
 *   `blockCategories`, and at least `blockMinHitCount` occurrences -> `block`.
 * - Anything else -> `review`.
 */
export function decide(matches: readonly Match[], policy: PolicyConfig): Decision {
  if (matches.length === 0) return 'allow';
  const allowSet = new Set(policy.allowCategories);
  const relevant = matches.filter((match) => !allowSet.has(match.category));
  if (relevant.length === 0) return 'allow';

  const blockSeverities = new Set(policy.blockSeverities);
  const blockCategories = new Set(policy.blockCategories);
  const blocking = relevant.filter(
    (match) =>
      blockSeverities.has(match.severity) || blockCategories.has(match.category),
  );
  if (blocking.length >= policy.blockMinHitCount && blocking.length > 0) return 'block';
  return 'review';
}

/** Occurrences that survive the `allowCategories` filter. */
export function filterAllowedCategories(
  matches: readonly Match[],
  policy: PolicyConfig,
): Match[] {
  if (policy.allowCategories.length === 0) return [...matches];
  const allowSet = new Set(policy.allowCategories);
  return matches.filter((match) => !allowSet.has(match.category));
}
