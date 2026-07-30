#!/usr/bin/env tsx
/**
 * Benchmarks automaton construction and scanning throughput.
 *
 * Measures what the README publishes. Nothing here is estimated: every number printed
 * comes from a measured run on the machine that executes the script.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --json
 *   npm run benchmark -- --iterations 20
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cpus, totalmem } from 'node:os';
import { Matcher } from '../src/core/matcher.js';
import { createModerator } from '../src/moderator.js';
import { loadLexicon } from '../src/lexicon/loader.js';
import { reportsDir } from '../src/lexicon/paths.js';
import type { MatcherTerm } from '../src/core/matcher.js';

interface BuildMeasurement {
  termCount: number;
  buildMs: number;
  patternCount: number;
  nodeCount: number;
  automatonBytes: number;
}

interface ScanMeasurement {
  termCount: number;
  textKiB: number;
  iterations: number;
  medianMs: number;
  p95Ms: number;
  throughputMiBPerSecond: number;
  hitCount: number;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      iterations: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help === true) {
    console.log('Usage: npm run benchmark -- [--json] [--iterations N]');
    return 0;
  }
  const iterations = Math.max(3, Number.parseInt(values.iterations ?? '15', 10));

  const lexicon = await loadLexicon({ categories: ['*'], includeNeedsReview: true });
  const allTerms: MatcherTerm[] = lexicon.entries.map((entry) => ({
    term: entry.term,
    normalizedTerm: entry.normalizedTerm,
    category: entry.category,
    severity: entry.severity,
  }));

  const termCounts = [1_000, 10_000, 50_000].filter(
    (count) => count <= allTerms.length,
  );
  const largest = termCounts[termCounts.length - 1] ?? 0;
  if (allTerms.length > largest * 1.2) termCounts.push(allTerms.length);
  const textSizes = [1, 10, 100];

  const builds: BuildMeasurement[] = [];
  const scans: ScanMeasurement[] = [];

  // Warm-up build so JIT compilation is not attributed to the first measured size.
  new Matcher(sample(allTerms, Math.min(2_000, allTerms.length)), {
    precompileModes: ['normalized'],
  });

  for (const termCount of termCounts) {
    const terms = sample(allTerms, termCount);
    // Build repeatedly and take the median: a single build is easily doubled by a GC
    // pause, which would make the published table misleading.
    const buildSamples: number[] = [];
    let matcher = new Matcher(terms, { precompileModes: ['normalized'] });
    for (let i = 0; i < 5; i += 1) {
      const start = performance.now();
      matcher = new Matcher(terms, { precompileModes: ['normalized'] });
      buildSamples.push(performance.now() - start);
    }
    buildSamples.sort((a, b) => a - b);
    const stats = matcher.stats()[0]!;
    builds.push({
      termCount,
      buildMs: round(buildSamples[Math.floor(buildSamples.length / 2)]!),
      patternCount: stats.patternCount,
      nodeCount: stats.nodeCount,
      automatonBytes: stats.approximateByteSize,
    });

    for (const kib of textSizes) {
      const text = buildText(kib, terms);
      // Warm-up runs so JIT tiering and the first GC cycle do not distort the samples.
      for (let i = 0; i < 5; i += 1) matcher.findAll(text, { mode: 'normalized' });
      const samples: number[] = [];
      let hitCount = 0;
      for (let i = 0; i < iterations; i += 1) {
        const t0 = performance.now();
        const matches = matcher.findAll(text, { mode: 'normalized' });
        samples.push(performance.now() - t0);
        hitCount = matches.length;
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)]!;
      const p95 =
        samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))]!;
      const bytes = Buffer.byteLength(text, 'utf8');
      scans.push({
        termCount,
        textKiB: kib,
        iterations,
        medianMs: round(median),
        p95Ms: round(p95),
        throughputMiBPerSecond: round(bytes / 1024 / 1024 / (median / 1000)),
        hitCount,
      });
    }
  }

  // End to end SDK latency on the shipped default selection, including allowlist
  // filtering, result materialization and masking.
  const sdkStart = performance.now();
  const moderator = await createModerator();
  const sdkInitMs = performance.now() - sdkStart;
  const sdkTermCount = moderator.getMetadata().termCount;
  const sampleText = '这是一段普通文本，用于测量端到端调用开销。'.repeat(20);
  const sampleChars = [...sampleText].length;
  for (let i = 0; i < 20; i += 1) moderator.check(sampleText, { mask: true });
  const e2e: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const t0 = performance.now();
    moderator.check(sampleText, { mask: true });
    e2e.push(performance.now() - t0);
  }
  e2e.sort((a, b) => a - b);

  const result = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      totalMemoryGiB: round(totalmem() / 1024 ** 3),
    },
    lexicon: {
      version: lexicon.version,
      upstreamCommit: lexicon.upstreamCommit,
      availableTerms: allTerms.length,
    },
    builds,
    scans,
    sdkCall: {
      description: `check() with masking on a ${sampleChars} character Chinese text, default selection of ${sdkTermCount} terms`,
      initMs: round(sdkInitMs),
      medianMs: round(e2e[Math.floor(e2e.length / 2)]!),
      p95Ms: round(e2e[Math.floor(e2e.length * 0.95)]!),
    },
  };

  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, 'benchmark.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8',
  );
  const markdown = renderMarkdown(result);
  await writeFile(join(reportsDir, 'benchmark.md'), markdown, 'utf8');

  if (values.json === true) console.log(JSON.stringify(result, null, 2));
  else console.log(markdown);
  return 0;
}

function renderMarkdown(result: {
  generatedAt: string;
  environment: Record<string, unknown>;
  lexicon: Record<string, unknown>;
  builds: BuildMeasurement[];
  scans: ScanMeasurement[];
  sdkCall: { description: string; initMs: number; medianMs: number; p95Ms: number };
}): string {
  const lines: string[] = [];
  lines.push('# Benchmark');
  lines.push('');
  lines.push(`- Generated: ${result.generatedAt}`);
  lines.push(`- Node: ${String(result.environment.node)}`);
  lines.push(`- Platform: ${String(result.environment.platform)}`);
  lines.push(
    `- CPU: ${String(result.environment.cpu)} (${String(result.environment.cpuCount)} threads)`,
  );
  lines.push(
    `- Lexicon: ${String(result.lexicon.version)}, ${String(result.lexicon.availableTerms)} terms available`,
  );
  lines.push('');
  lines.push('## Automaton construction (normalized mode)');
  lines.push('');
  lines.push('| Terms | Build time | Patterns | Trie nodes | Automaton size |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const build of result.builds) {
    lines.push(
      `| ${build.termCount} | ${build.buildMs} ms | ${build.patternCount} | ${build.nodeCount} | ${(build.automatonBytes / 1024 / 1024).toFixed(2)} MiB |`,
    );
  }
  lines.push('');
  lines.push('## Scanning (findAll, leftmost-longest)');
  lines.push('');
  lines.push('| Terms | Text size | Median | p95 | Throughput | Matches |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const scan of result.scans) {
    lines.push(
      `| ${scan.termCount} | ${scan.textKiB} KiB | ${scan.medianMs} ms | ${scan.p95Ms} ms | ${scan.throughputMiBPerSecond} MiB/s | ${scan.hitCount} |`,
    );
  }
  lines.push('');
  lines.push('## End to end SDK call');
  lines.push('');
  lines.push(
    `\`createModerator()\` (read artifact, filter, build automaton): ${result.sdkCall.initMs} ms.`,
  );
  lines.push('');
  lines.push(
    `${result.sdkCall.description}: median ${result.sdkCall.medianMs} ms, p95 ${result.sdkCall.p95Ms} ms.`,
  );
  lines.push('');
  lines.push(
    'Numbers depend on hardware and on how many terms the text actually contains.',
  );
  lines.push('Re-run `npm run benchmark` to measure your own environment.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/** Deterministic, evenly spread sample so results are comparable across runs. */
function sample<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  const out: T[] = [];
  const step = items.length / count;
  for (let i = 0; i < count; i += 1) {
    out.push(items[Math.floor(i * step)]!);
  }
  return out;
}

/**
 * Build a text of roughly `kib` kibibytes of Chinese prose with a realistic sprinkling
 * of lexicon terms, so scanning does real work instead of running through a miss-only
 * fast path.
 */
function buildText(kib: number, terms: readonly MatcherTerm[]): string {
  const filler =
    '今天的会议讨论了社区内容治理的流程，我们需要在保证表达自由的同时降低违规内容的传播风险。';
  const target = kib * 1024;
  const parts: string[] = [];
  let bytes = 0;
  let index = 0;
  while (bytes < target) {
    parts.push(filler);
    bytes += Buffer.byteLength(filler, 'utf8');
    if (terms.length > 0 && index % 4 === 3) {
      const term = terms[(index * 7919) % terms.length]!.term;
      parts.push(term);
      bytes += Buffer.byteLength(term, 'utf8');
    }
    index += 1;
  }
  return parts.join('');
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
