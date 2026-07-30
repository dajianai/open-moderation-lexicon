/**
 * Aho–Corasick multi-pattern matcher over Unicode code points.
 *
 * Design notes:
 *
 * - The trie is built with a single flat `Map<number, number>` keyed by
 *   `parent * CODE_POINT_SPACE + codePoint`, which keeps construction O(total pattern
 *   length) without allocating one `Map` per node (~600k nodes for the bundled lexicon).
 * - The finished automaton is compiled into a compressed sparse row layout backed by
 *   `Int32Array`s. Transitions are found with a binary search over the sorted edge
 *   labels of a node, so the memory cost is proportional to the number of edges rather
 *   than to the (Unicode-sized) alphabet.
 * - Failure links use the classic NFA formulation plus *dictionary suffix links*, so
 *   reporting all matches at a position costs O(number of matches) instead of walking
 *   the whole failure chain.
 * - Scanning is O(text length + matches) and allocation free.
 */

const CODE_POINT_SPACE = 0x110000;

/** A pattern occurrence, in code-point offsets of the scanned array. */
export interface AutomatonMatch {
  /** Index of the pattern as returned by {@link AhoCorasickBuilder.add}. */
  patternId: number;
  /** Inclusive start offset. */
  start: number;
  /** Exclusive end offset. */
  end: number;
}

/** Return `false` from a visitor to stop scanning early. */
export type MatchVisitor = (
  patternId: number,
  start: number,
  end: number,
) => boolean | void;

/** Incremental builder. Reused patterns are rejected: callers must de-duplicate. */
export class AhoCorasickBuilder {
  private readonly edges = new Map<number, number>();
  private patternAt: Int32Array;
  private depth: Int32Array;
  private nodeCount = 1;
  private patternCount = 0;
  private duplicatePatterns = 0;

  constructor(capacityHint = 1024) {
    const capacity = Math.max(16, capacityHint);
    this.patternAt = new Int32Array(capacity).fill(-1);
    this.depth = new Int32Array(capacity);
  }

  /**
   * Adds a pattern. Returns the node id that terminates it, or -1 when the pattern is
   * empty. When the same pattern is added twice the first `patternId` wins.
   */
  add(codePoints: Int32Array | readonly number[], patternId: number): number {
    if (codePoints.length === 0) return -1;
    let node = 0;
    for (let i = 0; i < codePoints.length; i += 1) {
      const cp = codePoints[i]!;
      const key = node * CODE_POINT_SPACE + cp;
      const existing = this.edges.get(key);
      if (existing === undefined) {
        const next = this.nodeCount;
        this.nodeCount += 1;
        this.ensureCapacity(this.nodeCount);
        this.depth[next] = i + 1;
        this.edges.set(key, next);
        node = next;
      } else {
        node = existing;
      }
    }
    if (this.patternAt[node] === -1) {
      this.patternAt[node] = patternId;
      this.patternCount += 1;
    } else {
      this.duplicatePatterns += 1;
    }
    return node;
  }

  /** Number of patterns that collided with an earlier identical pattern. */
  get duplicateCount(): number {
    return this.duplicatePatterns;
  }

  /** Compile into the immutable, flat automaton. */
  build(): AhoCorasick {
    const nodeCount = this.nodeCount;
    const edgeCount = this.edges.size;

    const edgeStart = new Int32Array(nodeCount + 1);
    const edgeLabel = new Int32Array(edgeCount);
    const edgeTarget = new Int32Array(edgeCount);

    // Bucket edges by parent via counting sort, then sort each bucket by label.
    for (const key of this.edges.keys()) {
      const parent = Math.floor(key / CODE_POINT_SPACE);
      edgeStart[parent + 1] = edgeStart[parent + 1]! + 1;
    }
    for (let i = 0; i < nodeCount; i += 1) {
      edgeStart[i + 1] = edgeStart[i]! + edgeStart[i + 1]!;
    }
    const cursor = Int32Array.from(edgeStart.subarray(0, nodeCount));
    for (const [key, target] of this.edges) {
      const parent = Math.floor(key / CODE_POINT_SPACE);
      const label = key - parent * CODE_POINT_SPACE;
      const at = cursor[parent]!;
      cursor[parent] = at + 1;
      edgeLabel[at] = label;
      edgeTarget[at] = target;
    }
    for (let node = 0; node < nodeCount; node += 1) {
      const from = edgeStart[node]!;
      const to = edgeStart[node + 1]!;
      if (to - from > 1) sortEdgeRange(edgeLabel, edgeTarget, from, to);
    }

    const fail = new Int32Array(nodeCount);
    const dictLink = new Int32Array(nodeCount);
    const patternAt = this.patternAt.slice(0, nodeCount);
    const depth = this.depth.slice(0, nodeCount);

    // Breadth-first construction of failure and dictionary-suffix links.
    const queue = new Int32Array(nodeCount);
    let head = 0;
    let tail = 0;
    for (let e = edgeStart[0]!; e < edgeStart[1]!; e += 1) {
      const child = edgeTarget[e]!;
      fail[child] = 0;
      dictLink[child] = 0;
      queue[tail] = child;
      tail += 1;
    }
    while (head < tail) {
      const node = queue[head]!;
      head += 1;
      for (let e = edgeStart[node]!; e < edgeStart[node + 1]!; e += 1) {
        const label = edgeLabel[e]!;
        const child = edgeTarget[e]!;
        let candidate = fail[node]!;
        let target: number;
        for (;;) {
          target = findEdge(edgeStart, edgeLabel, edgeTarget, candidate, label);
          if (target !== -1) break;
          if (candidate === 0) break;
          candidate = fail[candidate]!;
        }
        fail[child] = target === -1 ? 0 : target;
        const failNode = fail[child];
        dictLink[child] = patternAt[failNode]! >= 0 ? failNode : dictLink[failNode]!;
        queue[tail] = child;
        tail += 1;
      }
    }

    return new AhoCorasick({
      edgeStart,
      edgeLabel,
      edgeTarget,
      fail,
      dictLink,
      patternAt,
      depth,
      patternCount: this.patternCount,
    });
  }

  private ensureCapacity(size: number): void {
    if (size <= this.patternAt.length) return;
    let capacity = this.patternAt.length;
    while (capacity < size) capacity *= 2;
    const patternAt = new Int32Array(capacity).fill(-1);
    patternAt.set(this.patternAt);
    const depth = new Int32Array(capacity);
    depth.set(this.depth);
    this.patternAt = patternAt;
    this.depth = depth;
  }
}

interface AutomatonTables {
  edgeStart: Int32Array;
  edgeLabel: Int32Array;
  edgeTarget: Int32Array;
  fail: Int32Array;
  dictLink: Int32Array;
  patternAt: Int32Array;
  depth: Int32Array;
  patternCount: number;
}

/** Immutable compiled automaton. Safe to share between concurrent scans. */
export class AhoCorasick {
  private readonly edgeStart: Int32Array;
  private readonly edgeLabel: Int32Array;
  private readonly edgeTarget: Int32Array;
  private readonly fail: Int32Array;
  private readonly dictLink: Int32Array;
  private readonly patternAt: Int32Array;
  private readonly depth: Int32Array;
  /** Number of distinct patterns stored in the automaton. */
  readonly patternCount: number;

  constructor(tables: AutomatonTables) {
    this.edgeStart = tables.edgeStart;
    this.edgeLabel = tables.edgeLabel;
    this.edgeTarget = tables.edgeTarget;
    this.fail = tables.fail;
    this.dictLink = tables.dictLink;
    this.patternAt = tables.patternAt;
    this.depth = tables.depth;
    this.patternCount = tables.patternCount;
  }

  /** Number of trie nodes, useful for diagnostics and benchmarks. */
  get nodeCount(): number {
    return this.fail.length;
  }

  /** Number of trie edges. */
  get edgeCount(): number {
    return this.edgeLabel.length;
  }

  /** Approximate retained heap size of the automaton in bytes. */
  get approximateByteSize(): number {
    return (
      this.edgeStart.byteLength +
      this.edgeLabel.byteLength +
      this.edgeTarget.byteLength +
      this.fail.byteLength +
      this.dictLink.byteLength +
      this.patternAt.byteLength +
      this.depth.byteLength
    );
  }

  /**
   * Scan `codePoints`, invoking `visit` for every occurrence of every pattern,
   * ordered by end offset. Returning `false` from `visit` stops the scan.
   */
  search(codePoints: Int32Array, visit: MatchVisitor): void {
    const { edgeStart, edgeLabel, edgeTarget, fail, dictLink, patternAt, depth } = this;
    let state = 0;
    for (let i = 0; i < codePoints.length; i += 1) {
      const cp = codePoints[i]!;
      for (;;) {
        const next = findEdge(edgeStart, edgeLabel, edgeTarget, state, cp);
        if (next !== -1) {
          state = next;
          break;
        }
        if (state === 0) break;
        state = fail[state]!;
      }
      if (state === 0) continue;
      let node = state;
      while (node > 0) {
        const patternId = patternAt[node]!;
        if (patternId >= 0) {
          const end = i + 1;
          const start = end - depth[node]!;
          if (visit(patternId, start, end) === false) return;
        }
        node = dictLink[node]!;
      }
    }
  }

  /** True when any pattern occurs in `codePoints`. */
  test(codePoints: Int32Array): boolean {
    let found = false;
    this.search(codePoints, () => {
      found = true;
      return false;
    });
    return found;
  }

  /** Collect every occurrence. Prefer {@link search} on hot paths. */
  findAll(codePoints: Int32Array): AutomatonMatch[] {
    const out: AutomatonMatch[] = [];
    this.search(codePoints, (patternId, start, end) => {
      out.push({ patternId, start, end });
    });
    return out;
  }
}

/** Binary search for the edge labelled `label` leaving `node`; -1 when absent. */
function findEdge(
  edgeStart: Int32Array,
  edgeLabel: Int32Array,
  edgeTarget: Int32Array,
  node: number,
  label: number,
): number {
  let low = edgeStart[node]!;
  let high = edgeStart[node + 1]! - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = edgeLabel[mid]!;
    if (value === label) return edgeTarget[mid]!;
    if (value < label) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

/** Insertion sort of one edge bucket; buckets are tiny except at the root. */
function sortEdgeRange(
  edgeLabel: Int32Array,
  edgeTarget: Int32Array,
  from: number,
  to: number,
): void {
  const size = to - from;
  if (size > 32) {
    const order = Array.from({ length: size }, (_unused, index) => from + index);
    order.sort((a, b) => edgeLabel[a]! - edgeLabel[b]!);
    const labels = new Int32Array(size);
    const targets = new Int32Array(size);
    for (let i = 0; i < size; i += 1) {
      labels[i] = edgeLabel[order[i]!]!;
      targets[i] = edgeTarget[order[i]!]!;
    }
    edgeLabel.set(labels, from);
    edgeTarget.set(targets, from);
    return;
  }
  for (let i = from + 1; i < to; i += 1) {
    const label = edgeLabel[i]!;
    const target = edgeTarget[i]!;
    let j = i - 1;
    while (j >= from && edgeLabel[j]! > label) {
      edgeLabel[j + 1] = edgeLabel[j]!;
      edgeTarget[j + 1] = edgeTarget[j]!;
      j -= 1;
    }
    edgeLabel[j + 1] = label;
    edgeTarget[j + 1] = target;
  }
}
