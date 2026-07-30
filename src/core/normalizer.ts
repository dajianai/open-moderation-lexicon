/**
 * Text normalization with an exact code-point position map back to the source text.
 *
 * Two independent stages exist:
 *
 * 1. {@link normalize} – Unicode NFKC, case folding, zero-width removal, full-width to
 *    half-width, traditional to simplified Chinese, whitespace unification. This is the
 *    default matching mode and is considered safe: it only removes information that is
 *    invisible or presentational.
 * 2. {@link foldFuzzy} – separator stripping, leetspeak folding and optional repeated
 *    character collapsing. This is heuristic, raises false positives and is therefore
 *    opt-in.
 *
 * Both stages are pure functions over {@link CodePointText} and preserve the mapping
 * required to report offsets in the *original* text.
 */
import {
  NormalizedTextBuilder,
  createCodePointText,
  codePointsToString,
  identityNormalizedText,
  type CodePointText,
  type NormalizedText,
} from './position-map.js';
import { TRADITIONAL_TO_SIMPLIFIED_PAIRS } from './data/traditional-simplified.js';

/** Options for the `normalized` stage. */
export interface NormalizeOptions {
  /** Apply Unicode NFKC compatibility composition (also folds full-width forms). */
  nfkc: boolean;
  /** Lowercase letters (affects Latin, Greek, Cyrillic, ...). */
  lowercase: boolean;
  /** Drop zero-width and other invisible formatting code points. */
  stripInvisible: boolean;
  /** Map traditional Chinese characters to simplified ones. */
  simplifyChinese: boolean;
  /** Replace every whitespace code point (including newlines) with U+0020. */
  unifyWhitespace: boolean;
  /** Drop non-spacing combining marks that could not be composed into a base char. */
  stripCombiningMarks: boolean;
}

/** Options for the optional `fuzzy` stage. */
export interface FuzzyOptions {
  /** Ignore separators such as space, `-`, `_`, `.`, `·` inserted inside a term. */
  stripSeparators: boolean;
  /** Fold common leetspeak substitutions (`0`→`o`, `1`→`i`, `3`→`e`, `4`→`a`, ...). */
  leetspeak: boolean;
  /** Collapse runs of the same code point into one (`fuuuck` → `fuck`). */
  collapseRepeats: boolean;
  /**
   * Minimum folded length a term must keep to take part in fuzzy matching. Short
   * terms produce far too many false positives once separators are ignored.
   */
  minTermLength: number;
}

export const DEFAULT_NORMALIZE_OPTIONS: Readonly<NormalizeOptions> = Object.freeze({
  nfkc: true,
  lowercase: true,
  stripInvisible: true,
  simplifyChinese: true,
  unifyWhitespace: true,
  stripCombiningMarks: true,
});

export const DEFAULT_FUZZY_OPTIONS: Readonly<FuzzyOptions> = Object.freeze({
  stripSeparators: true,
  leetspeak: true,
  collapseRepeats: false,
  minTermLength: 3,
});

const SPACE = 0x20;

/** Invisible code points that must never influence matching. */
const INVISIBLE = new Set<number>([
  0x00ad, // soft hyphen
  0x180e, // mongolian vowel separator
  0x200b, // zero width space
  0x200c, // zero width non-joiner
  0x200d, // zero width joiner
  0x200e, // left-to-right mark
  0x200f, // right-to-left mark
  0x2028, // line separator
  0x2029, // paragraph separator
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e, // bidi embedding/override
  0x2060, // word joiner
  0x2061,
  0x2062,
  0x2063,
  0x2064, // invisible operators
  0x2066,
  0x2067,
  0x2068,
  0x2069, // bidi isolates
  0xfeff, // zero width no-break space / BOM
  0xfff9,
  0xfffa,
  0xfffb, // interlinear annotation
]);

function isInvisible(cp: number): boolean {
  if (cp < 0x00ad) return false;
  if (INVISIBLE.has(cp)) return true;
  // Variation selectors and their supplement.
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
  // Tag characters, used for hidden payloads.
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return false;
}

const WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002,
  0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f,
  0x3000,
]);

function isWhitespace(cp: number): boolean {
  return WHITESPACE.has(cp);
}

const COMBINING_MARK = /^\p{Mn}$/u;

function isCombiningMark(cp: number): boolean {
  if (cp < 0x0300) return false;
  return COMBINING_MARK.test(String.fromCodePoint(cp));
}

/**
 * Separators commonly injected between characters to dodge keyword filters.
 * `!` and `+` also appear in {@link LEET_MAP}; leetspeak folding runs first, so they
 * only count as separators when leetspeak folding is disabled.
 */
const FUZZY_SEPARATORS = new Set<number>([
  0x20, // space
  0x21, // !
  0x22, // "
  0x27, // '
  0x28,
  0x29, // ( )
  0x2a, // *
  0x2c, // ,
  0x2d, // -
  0x2e, // .
  0x2f, // /
  0x3a, // :
  0x3b, // ;
  0x3c,
  0x3e, // < >
  0x5b,
  0x5d, // [ ]
  0x5c, // \
  0x5f, // _
  0x60, // `
  0x7b,
  0x7d, // { }
  0x7c, // |
  0x7e, // ~
  0x23, // #
  0x25, // %
  0x26, // &
  0x5e, // ^
  0x00b7, // ·
  0x2022, // •
  0x3002, // 。
  0xff0c, // ，
  0x3001, // 、
  0x2010,
  0x2011,
  0x2012,
  0x2013,
  0x2014,
  0x2015, // dashes
  0x2018,
  0x2019,
  0x201c,
  0x201d, // quotes
]);

/** Leetspeak digit/symbol -> letter. Applied before separator stripping. */
const LEET_MAP = new Map<number, number>([
  [0x30, 0x6f], // 0 -> o
  [0x31, 0x69], // 1 -> i
  [0x33, 0x65], // 3 -> e
  [0x34, 0x61], // 4 -> a
  [0x35, 0x73], // 5 -> s
  [0x37, 0x74], // 7 -> t
  [0x38, 0x62], // 8 -> b
  [0x40, 0x61], // @ -> a
  [0x24, 0x73], // $ -> s
  [0x21, 0x69], // ! -> i
  [0x2b, 0x74], // + -> t
]);

const TRADITIONAL_TO_SIMPLIFIED = buildTraditionalMap();

function buildTraditionalMap(): Map<number, number> {
  const map = new Map<number, number>();
  const pairs = TRADITIONAL_TO_SIMPLIFIED_PAIRS;
  for (let i = 0; i < pairs.length;) {
    const from = pairs.codePointAt(i)!;
    i += from > 0xffff ? 2 : 1;
    const to = pairs.codePointAt(i)!;
    i += to > 0xffff ? 2 : 1;
    map.set(from, to);
  }
  return map;
}

/**
 * Per-code-point normalization cache for the slow path (NFKC + case folding).
 * The set of distinct code points in real traffic is small, so this keeps the hot
 * loop free of string allocations after warm-up.
 */
const slowPathCache = new Map<number, Int32Array>();

function slowPathExpand(cp: number, options: NormalizeOptions): Int32Array {
  const cacheable = options.nfkc && options.lowercase;
  if (cacheable) {
    const cached = slowPathCache.get(cp);
    if (cached) return cached;
  }
  let chunk = String.fromCodePoint(cp);
  if (options.nfkc) chunk = chunk.normalize('NFKC');
  if (options.lowercase) chunk = chunk.toLowerCase();
  const out: number[] = [];
  for (const char of chunk) out.push(char.codePointAt(0)!);
  const result = Int32Array.from(out);
  if (cacheable && slowPathCache.size < 65_536) slowPathCache.set(cp, result);
  return result;
}

/** Normalize a code-point view, keeping a mapping back to the source positions. */
export function normalize(
  origin: CodePointText,
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): NormalizedText {
  const builder = new NormalizedTextBuilder(origin);
  const cps = origin.codePoints;
  for (let i = 0; i < cps.length; i += 1) {
    const cp = cps[i]!;

    // Dropped code points need no bookkeeping: a match range spans from the first to
    // the last kept code point, so anything removed in between is covered implicitly,
    // while anything removed just outside stays outside the reported range.
    if (options.stripInvisible && isInvisible(cp)) continue;

    if (options.unifyWhitespace && isWhitespace(cp)) {
      builder.push(SPACE, i, i + 1);
      continue;
    }

    // Fast path: ASCII is NFKC-stable, so only case folding applies.
    if (cp < 0x80) {
      const folded = options.lowercase && cp >= 0x41 && cp <= 0x5a ? cp + 32 : cp;
      builder.push(folded, i, i + 1);
      continue;
    }

    if (options.stripCombiningMarks && isCombiningMark(cp)) {
      const base = builder.lastCodePoint;
      if (base >= 0) {
        const composed = String.fromCodePoint(base, cp).normalize('NFC');
        const composedPoints = [...composed];
        if (composedPoints.length === 1) {
          builder.replaceLast(composedPoints[0]!.codePointAt(0)!, i + 1);
          continue;
        }
        // A mark that cannot be composed still belongs to its base character.
        builder.extendLast(i + 1);
        continue;
      }
      // A leading mark has no base character; drop it.
      continue;
    }

    // Fast path: CJK unified ideographs are NFKC-stable and case-less, so only the
    // traditional -> simplified table applies.
    if (cp >= 0x4e00 && cp <= 0x9fff) {
      const simplified = options.simplifyChinese
        ? (TRADITIONAL_TO_SIMPLIFIED.get(cp) ?? cp)
        : cp;
      builder.push(simplified, i, i + 1);
      continue;
    }

    const expanded = slowPathExpand(cp, options);
    for (let k = 0; k < expanded.length; k += 1) {
      let out = expanded[k]!;
      if (options.simplifyChinese) out = TRADITIONAL_TO_SIMPLIFIED.get(out) ?? out;
      if (options.unifyWhitespace && isWhitespace(out)) out = SPACE;
      builder.push(out, i, i + 1);
    }
  }
  return builder.finish();
}

/**
 * Apply the heuristic fuzzy folding on top of an already normalized text.
 * The returned mapping still refers to the *original* text positions.
 */
export function foldFuzzy(
  normalized: NormalizedText,
  options: FuzzyOptions = DEFAULT_FUZZY_OPTIONS,
): NormalizedText {
  const builder = new NormalizedTextBuilder(normalized.origin, normalized.length + 8);
  const cps = normalized.codePoints;
  let previous = -1;
  for (let i = 0; i < cps.length; i += 1) {
    const raw = cps[i]!;
    const originStart = normalized.originStart[i]!;
    const originEnd = normalized.originEnd[i]!;
    if (normalized.separatorBefore[i] === 1) builder.markSeparator();

    let cp = raw;
    if (options.leetspeak) cp = LEET_MAP.get(cp) ?? cp;

    if (options.stripSeparators && cp === raw && FUZZY_SEPARATORS.has(cp)) {
      // The separator disappears, but it still separates words.
      builder.markSeparator();
      continue;
    }

    if (options.collapseRepeats && cp === previous) continue;

    builder.push(cp, originStart, originEnd);
    previous = cp;
  }
  return builder.finish();
}

/** Convenience helper: normalize a raw string and return the normalized string. */
export function normalizeString(
  text: string,
  options: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
): string {
  const normalized = normalize(createCodePointText(text), options);
  return codePointsToString(normalized.codePoints);
}

/** Convenience helper: normalize then fuzzy-fold a raw string. */
export function fuzzyFoldString(
  text: string,
  normalizeOptions: NormalizeOptions = DEFAULT_NORMALIZE_OPTIONS,
  fuzzyOptions: FuzzyOptions = DEFAULT_FUZZY_OPTIONS,
): string {
  const normalized = normalize(createCodePointText(text), normalizeOptions);
  return codePointsToString(foldFuzzy(normalized, fuzzyOptions).codePoints);
}

/** Identity view, used by the `exact` mode. */
export function exactView(origin: CodePointText): NormalizedText {
  return identityNormalizedText(origin);
}

/** True when the code point can be part of an ASCII/Latin word. */
export function isWordCodePoint(cp: number): boolean {
  if (cp >= 0x30 && cp <= 0x39) return true; // 0-9
  if (cp >= 0x41 && cp <= 0x5a) return true; // A-Z
  if (cp >= 0x61 && cp <= 0x7a) return true; // a-z
  if (cp === 0x5f) return true; // _
  // Latin-1 letters, Latin extended, Greek, Cyrillic.
  if (cp >= 0x00c0 && cp <= 0x024f) return true;
  if (cp >= 0x0370 && cp <= 0x04ff) return true;
  return false;
}
