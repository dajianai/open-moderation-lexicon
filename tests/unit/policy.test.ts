import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  compareSeverity,
  decide,
  filterAllowedCategories,
  resolvePolicy,
  riskLevelOf,
} from '../../src/core/policy.js';
import type { Match, Severity } from '../../src/core/types.js';

function match(severity: Severity, category = 'test'): Match {
  return {
    term: 'x',
    matchedText: 'x',
    category,
    severity,
    matchType: 'normalized',
    start: 0,
    end: 1,
  };
}

describe('riskLevelOf', () => {
  it('reports the highest severity present', () => {
    expect(riskLevelOf([])).toBe('none');
    expect(riskLevelOf([match('low')])).toBe('low');
    expect(riskLevelOf([match('low'), match('medium')])).toBe('medium');
    expect(riskLevelOf([match('low'), match('high'), match('medium')])).toBe('high');
  });
});

describe('decide', () => {
  const policy = resolvePolicy();

  it('allows when nothing matched', () => {
    expect(decide([], policy)).toBe('allow');
  });

  it('escalates ordinary matches to review, not block', () => {
    expect(decide([match('low')], policy)).toBe('review');
    expect(decide([match('medium')], policy)).toBe('review');
  });

  it('blocks only high severity by default', () => {
    expect(decide([match('high')], policy)).toBe('block');
    expect(DEFAULT_POLICY.blockSeverities).toEqual(['high']);
  });

  it('honours blockCategories', () => {
    const custom = resolvePolicy({ blockCategories: ['spam'] });
    expect(decide([match('low', 'spam')], custom)).toBe('block');
    expect(decide([match('low', 'other')], custom)).toBe('review');
  });

  it('honours allowCategories', () => {
    const custom = resolvePolicy({ allowCategories: ['noise'] });
    expect(decide([match('high', 'noise')], custom)).toBe('allow');
    expect(decide([match('high', 'noise'), match('low', 'other')], custom)).toBe(
      'review',
    );
  });

  it('honours blockMinHitCount', () => {
    const custom = resolvePolicy({ blockMinHitCount: 2 });
    expect(decide([match('high')], custom)).toBe('review');
    expect(decide([match('high'), match('high')], custom)).toBe('block');
  });

  it('never blocks when no severity is configured to block', () => {
    const custom = resolvePolicy({ blockSeverities: [] });
    expect(decide([match('high')], custom)).toBe('review');
  });
});

describe('helpers', () => {
  it('compares severities', () => {
    expect(compareSeverity('low', 'high')).toBeLessThan(0);
    expect(compareSeverity('high', 'low')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'medium')).toBe(0);
  });

  it('filters allowed categories', () => {
    const matches = [match('low', 'a'), match('low', 'b')];
    expect(filterAllowedCategories(matches, resolvePolicy())).toHaveLength(2);
    expect(
      filterAllowedCategories(matches, resolvePolicy({ allowCategories: ['a'] })),
    ).toEqual([matches[1]]);
  });
});
