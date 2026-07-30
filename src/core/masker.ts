/**
 * Masking of matched ranges.
 *
 * Ranges are merged before replacement, so overlapping occurrences can never corrupt
 * the output or shift the remaining text. Every non-matched code point is preserved
 * byte for byte, including emoji, newlines and zero-width characters.
 */
import type { CodePointText } from './position-map.js';
import { createCodePointText } from './position-map.js';
import type { Match } from './types.js';

/** A half-open code-point range. */
export interface Range {
  start: number;
  end: number;
}

/** Merge overlapping and touching ranges, sorted by start offset. */
export function mergeRanges(ranges: readonly Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  let current = { start: sorted[0]!.start, end: sorted[0]!.end };
  for (let i = 1; i < sorted.length; i += 1) {
    const range = sorted[i]!;
    if (range.start <= current.end) {
      if (range.end > current.end) current.end = range.end;
    } else {
      merged.push(current);
      current = { start: range.start, end: range.end };
    }
  }
  merged.push(current);
  return merged;
}

/** Validation error for an unusable mask character. */
export class InvalidMaskCharError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMaskCharError';
  }
}

/** Validate a mask character: exactly one Unicode code point. */
export function assertValidMaskChar(maskChar: string): void {
  if (typeof maskChar !== 'string' || maskChar.length === 0) {
    throw new InvalidMaskCharError('maskChar must be a non-empty string');
  }
  if ([...maskChar].length !== 1) {
    throw new InvalidMaskCharError('maskChar must be exactly one Unicode code point');
  }
}

/**
 * Replace every code point covered by `ranges` with `maskChar`.
 * One masked code point is emitted per masked source code point, so offsets of the
 * surrounding text stay comparable with the input.
 */
export function maskRanges(
  text: CodePointText | string,
  ranges: readonly Range[],
  maskChar = '*',
): string {
  assertValidMaskChar(maskChar);
  const view = typeof text === 'string' ? createCodePointText(text) : text;
  const merged = mergeRanges(ranges);
  if (merged.length === 0) return view.source;

  let out = '';
  let cursor = 0;
  for (const range of merged) {
    const start = Math.max(0, Math.min(range.start, view.length));
    const end = Math.max(start, Math.min(range.end, view.length));
    if (start > cursor) {
      out += view.source.slice(view.utf16Offsets[cursor], view.utf16Offsets[start]);
    }
    out += maskChar.repeat(end - start);
    cursor = Math.max(cursor, end);
  }
  if (cursor < view.length) {
    out += view.source.slice(view.utf16Offsets[cursor]);
  }
  return out;
}

/** Convenience wrapper masking the ranges of a match list. */
export function maskMatches(
  text: CodePointText | string,
  matches: readonly Match[],
  maskChar = '*',
): string {
  return maskRanges(
    text,
    matches.map((match) => ({ start: match.start, end: match.end })),
    maskChar,
  );
}
