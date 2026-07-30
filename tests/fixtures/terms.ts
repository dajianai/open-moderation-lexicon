/**
 * Small, fully controlled term list used by the behavioural tests.
 *
 * The bundled upstream lexicon is exercised separately in
 * `tests/integration/real-lexicon.test.ts`; keeping the behavioural tests on a fixture
 * means they stay stable when upstream data changes.
 */
import type { CustomTerm } from '../../src/core/types.js';

export const TEST_TERMS: CustomTerm[] = [
  // Chinese, overlapping pair for longest-match tests.
  { term: '敏感', category: 'test-basic', severity: 'low' },
  { term: '敏感词汇', category: 'test-basic', severity: 'medium' },
  { term: '违规词', category: 'test-basic', severity: 'medium' },
  // Simplified form only; the traditional form must match through normalization.
  { term: '台湾独立', category: 'test-politics', severity: 'medium' },
  // English, one short term to prove word boundaries are enforced.
  { term: 'badword', category: 'test-en', severity: 'medium' },
  { term: 'ass', category: 'test-en', severity: 'low' },
  { term: 'finance', category: 'test-en', severity: 'low' },
  // Multi word phrase, for whitespace handling.
  { term: 'free money', category: 'test-spam', severity: 'low' },
  // High severity, so the default policy escalates to `block`.
  { term: '爆炸物制造', category: 'test-danger', severity: 'high' },
  // Term that a longer allowlist phrase should be able to rescue.
  { term: '冰', category: 'test-drugs', severity: 'medium' },
  // Mixed content term.
  { term: 'evil.example.com', category: 'test-url', severity: 'medium' },
  { term: 'spam@example.com', category: 'test-url', severity: 'low' },
];

/** Category ids present in {@link TEST_TERMS}. */
export const TEST_CATEGORIES = [
  'test-basic',
  'test-politics',
  'test-en',
  'test-spam',
  'test-danger',
  'test-drugs',
  'test-url',
];
