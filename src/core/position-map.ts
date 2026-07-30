/**
 * Code-point oriented text views.
 *
 * Every offset exposed by this project is a Unicode **code point** offset, never a
 * UTF-16 code unit offset. Surrogate pairs (emoji, rare CJK ideographs) therefore
 * count as one position, which is what humans and most non-JavaScript runtimes expect.
 */

/** A string together with its code-point decomposition and UTF-16 offset table. */
export interface CodePointText {
  /** The original, untouched string. */
  readonly source: string;
  /** One entry per code point. */
  readonly codePoints: Int32Array;
  /**
   * UTF-16 index of every code point, plus a final sentinel equal to `source.length`.
   * Length is `codePoints.length + 1`.
   */
  readonly utf16Offsets: Int32Array;
  /** Number of code points. */
  readonly length: number;
}

/** Decompose a string into a reusable code-point view. */
export function createCodePointText(source: string): CodePointText {
  const upperBound = source.length;
  const codePoints = new Int32Array(upperBound);
  const utf16Offsets = new Int32Array(upperBound + 1);
  let count = 0;
  for (let i = 0; i < source.length;) {
    const cp = source.codePointAt(i);
    // `codePointAt` only returns undefined for out-of-range indices, which cannot
    // happen inside this loop, but the strict type needs narrowing.
    if (cp === undefined) break;
    codePoints[count] = cp;
    utf16Offsets[count] = i;
    count += 1;
    i += cp > 0xffff ? 2 : 1;
  }
  utf16Offsets[count] = source.length;
  return {
    source,
    codePoints: codePoints.subarray(0, count),
    utf16Offsets: utf16Offsets.subarray(0, count + 1),
    length: count,
  };
}

/** Extract the substring covering code points `[start, end)`. */
export function sliceCodePoints(
  text: CodePointText,
  start: number,
  end: number,
): string {
  const from = clamp(start, 0, text.length);
  const to = clamp(end, from, text.length);
  return text.source.slice(text.utf16Offsets[from], text.utf16Offsets[to]);
}

/** Convert a code-point array back into a string. */
export function codePointsToString(
  codePoints: Int32Array | readonly number[],
  start = 0,
  end = codePoints.length,
): string {
  let out = '';
  // Chunked to stay well below the argument-count limit of `String.fromCodePoint`.
  const chunk = 4096;
  for (let i = start; i < end; i += chunk) {
    const stop = Math.min(i + chunk, end);
    const slice: number[] = [];
    for (let j = i; j < stop; j += 1) slice.push(codePoints[j]!);
    out += String.fromCodePoint(...slice);
  }
  return out;
}

/**
 * A normalized text plus the mapping needed to translate any normalized range back
 * into the code-point range of the original text.
 */
export interface NormalizedText {
  /** The source view the mapping refers to. */
  readonly origin: CodePointText;
  /** Normalized code points. */
  readonly codePoints: Int32Array;
  /** For normalized index `i`: first origin code-point index it came from. */
  readonly originStart: Int32Array;
  /** For normalized index `i`: origin code-point index just after its source range. */
  readonly originEnd: Int32Array;
  /**
   * For normalized index `i` (0..length inclusive): 1 when at least one separator was
   * dropped immediately before that position. Fuzzy folding removes separators, which
   * would otherwise glue two words together and defeat word-boundary checks.
   */
  readonly separatorBefore: Uint8Array;
  /** Number of normalized code points. */
  readonly length: number;
}

/** Origin code-point range for a normalized `[start, end)` range. */
export function mapToOrigin(
  normalized: NormalizedText,
  start: number,
  end: number,
): { start: number; end: number } {
  if (normalized.length === 0) return { start: 0, end: 0 };
  const from = clamp(start, 0, normalized.length - 1);
  const lastIndex = clamp(end - 1, from, normalized.length - 1);
  return {
    start: normalized.originStart[from]!,
    end: normalized.originEnd[lastIndex]!,
  };
}

/**
 * Growable builder for {@link NormalizedText}. Normalization can both drop code
 * points (zero-width characters) and expand them (NFKC of `㈱`), so the output size
 * is unknown in advance.
 */
export class NormalizedTextBuilder {
  private codePoints: Int32Array;
  private starts: Int32Array;
  private ends: Int32Array;
  private separators: Uint8Array;
  private size = 0;
  private pendingSeparator = false;

  constructor(
    private readonly origin: CodePointText,
    capacityHint = origin.length + 8,
  ) {
    const capacity = Math.max(8, capacityHint);
    this.codePoints = new Int32Array(capacity);
    this.starts = new Int32Array(capacity);
    this.ends = new Int32Array(capacity);
    this.separators = new Uint8Array(capacity + 1);
  }

  get length(): number {
    return this.size;
  }

  /** Code point most recently pushed, or -1 when empty. */
  get lastCodePoint(): number {
    return this.size === 0 ? -1 : this.codePoints[this.size - 1]!;
  }

  push(codePoint: number, originStart: number, originEnd: number): void {
    if (this.size === this.codePoints.length) this.grow();
    this.codePoints[this.size] = codePoint;
    this.starts[this.size] = originStart;
    this.ends[this.size] = originEnd;
    if (this.pendingSeparator) {
      this.separators[this.size] = 1;
      this.pendingSeparator = false;
    }
    this.size += 1;
  }

  /**
   * Record that a separator was dropped here, so the next pushed code point (or the
   * end of the text) still counts as a word boundary.
   */
  markSeparator(): void {
    this.pendingSeparator = true;
  }

  /** Replace the last pushed code point, extending its origin range. */
  replaceLast(codePoint: number, originEnd: number): void {
    if (this.size === 0) return;
    this.codePoints[this.size - 1] = codePoint;
    this.ends[this.size - 1] = originEnd;
  }

  /** Extend the origin range of the last code point, e.g. after dropping a mark. */
  extendLast(originEnd: number): void {
    if (this.size === 0) return;
    if (this.ends[this.size - 1]! < originEnd) this.ends[this.size - 1] = originEnd;
  }

  finish(): NormalizedText {
    if (this.pendingSeparator) {
      this.separators[this.size] = 1;
      this.pendingSeparator = false;
    }
    return {
      origin: this.origin,
      codePoints: this.codePoints.subarray(0, this.size),
      originStart: this.starts.subarray(0, this.size),
      originEnd: this.ends.subarray(0, this.size),
      separatorBefore: this.separators.subarray(0, this.size + 1),
      length: this.size,
    };
  }

  private grow(): void {
    const capacity = this.codePoints.length * 2;
    const codePoints = new Int32Array(capacity);
    const starts = new Int32Array(capacity);
    const ends = new Int32Array(capacity);
    const separators = new Uint8Array(capacity + 1);
    codePoints.set(this.codePoints);
    starts.set(this.starts);
    ends.set(this.ends);
    separators.set(this.separators);
    this.codePoints = codePoints;
    this.starts = starts;
    this.ends = ends;
    this.separators = separators;
  }
}

/** Identity mapping, used by the `exact` mode so all modes share one code path. */
export function identityNormalizedText(origin: CodePointText): NormalizedText {
  const starts = new Int32Array(origin.length);
  const ends = new Int32Array(origin.length);
  for (let i = 0; i < origin.length; i += 1) {
    starts[i] = i;
    ends[i] = i + 1;
  }
  return {
    origin,
    codePoints: origin.codePoints,
    originStart: starts,
    originEnd: ends,
    separatorBefore: new Uint8Array(origin.length + 1),
    length: origin.length,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
