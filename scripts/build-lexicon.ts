#!/usr/bin/env tsx
/**
 * Builds `data/generated/lexicon.json` from the vendored upstream data plus local
 * term files. Offline and deterministic.
 *
 * Usage:
 *   npm run lexicon:build
 *   npm run lexicon:build -- --version 2026.07.29
 */
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildLexicon,
  writeBuildOutput,
  type CategoryConfig,
} from '../src/lexicon/builder.js';
import {
  categoryConfigFile,
  lexiconFile,
  localTermsDir,
  metadataFile,
  packageRoot,
  reportsDir,
  upstreamDir,
  upstreamLockFile,
} from '../src/lexicon/paths.js';

interface LockFile {
  upstream?: { commit?: string };
  syncedAt?: string;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help === true) {
    console.log('Usage: npm run lexicon:build -- [--version YYYY.MM.DD]');
    return 0;
  }

  const categoryConfig = await readCategoryConfig();
  const lock = await readLock();

  const started = performance.now();
  const result = await buildLexicon({
    upstreamDir,
    localTermsDir,
    categoryConfig,
    upstreamCommit: lock?.upstream?.commit ?? null,
    syncedAt: lock?.syncedAt ?? null,
    ...(values.version ? { version: values.version } : {}),
  });
  await writeBuildOutput(result, { lexiconFile, metadataFile, reportsDir });
  const elapsed = performance.now() - started;

  const report = result.report;
  console.log(`lexicon built in ${elapsed.toFixed(0)} ms`);
  console.log(`  version:            ${report.version}`);
  console.log(`  upstream commit:    ${report.upstreamCommit ?? '(none)'}`);
  console.log(`  raw term lines:     ${report.rawLineCount}`);
  console.log(`  skipped lines:      ${report.emptyLineCount}`);
  console.log(`  before de-dupe:     ${report.termCountBeforeDedupe}`);
  console.log(`  after de-dupe:      ${report.termCountAfterDedupe}`);
  console.log(`  duplicates removed: ${report.duplicateCount}`);
  console.log(`  single-char terms:  ${report.singleCharacterTermCount}`);
  console.log(`  flagged terms:      ${report.suspiciousTermCount}`);
  console.log(`  categories:         ${report.perCategory.length}`);
  console.log(`  artifact:           ${relative(packageRoot, lexiconFile)}`);
  console.log(`  reports:            ${relative(packageRoot, reportsDir)}`);
  if (report.upstreamCommit === null) {
    console.warn(
      `warning: ${relative(packageRoot, upstreamLockFile)} has no commit; run "npm run lexicon:sync" for reproducible provenance`,
    );
  }
  return 0;
}

async function readCategoryConfig(): Promise<CategoryConfig> {
  try {
    return JSON.parse(await readFile(categoryConfigFile, 'utf8')) as CategoryConfig;
  } catch (error) {
    throw new Error(
      `cannot read ${relative(packageRoot, categoryConfigFile)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function readLock(): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(upstreamLockFile, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
