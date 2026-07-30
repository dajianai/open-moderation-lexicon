#!/usr/bin/env tsx
/**
 * Validates the generated lexicon artifact and its provenance.
 *
 * Checks performed:
 *  1. The artifact parses and its column lengths agree with `termCount`.
 *  2. No empty, duplicated or newline-containing terms.
 *  3. Every category referenced by a term exists.
 *  4. Checksums in `UPSTREAM.lock.json` match the vendored files on disk.
 *  5. Checksums recorded in the artifact match the vendored files on disk.
 *  6. Every vendored source file is mapped in `category-config.json`.
 *  7. A sampled round trip: terms from the artifact are actually detected.
 *
 * Exit code 0 = valid, 1 = validation failed, 2 = could not run.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createModerator } from '../src/index.js';
import { assertArtifact } from '../src/lexicon/loader.js';
import {
  listTermFiles,
  type CategoryConfig,
  type LexiconArtifact,
} from '../src/lexicon/builder.js';
import {
  categoryConfigFile,
  lexiconFile,
  packageRoot,
  upstreamDir,
  upstreamLockFile,
} from '../src/lexicon/paths.js';

interface LockFile {
  upstream: { commit: string };
  files: { path: string; sha256: string; bytes: number }[];
}

const failures: string[] = [];
const warnings: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function warn(message: string): void {
  warnings.push(message);
}

async function main(): Promise<number> {
  const artifact = await loadArtifact();
  checkColumns(artifact);
  await checkLock(artifact);
  await checkCategoryConfig(artifact);
  await checkRoundTrip();

  for (const message of warnings) console.warn(`warning: ${message}`);
  if (failures.length > 0) {
    for (const message of failures) console.error(`error: ${message}`);
    console.error(`\nlexicon validation failed with ${failures.length} error(s)`);
    return 1;
  }
  console.log(
    `lexicon validation passed: ${artifact.termCount} terms, ${artifact.categories.length} categories, upstream ${artifact.upstreamCommit ?? '(none)'}`,
  );
  if (warnings.length > 0) console.log(`${warnings.length} warning(s)`);
  return 0;
}

async function loadArtifact(): Promise<LexiconArtifact> {
  const raw = await readFile(lexiconFile, 'utf8').catch(() => {
    throw new Error(
      `cannot read ${relative(packageRoot, lexiconFile)}; run "npm run lexicon:build"`,
    );
  });
  return assertArtifact(JSON.parse(raw));
}

function checkColumns(artifact: LexiconArtifact): void {
  const terms = artifact.terms === '' ? [] : artifact.terms.split('\n');
  if (terms.length !== artifact.termCount) {
    fail(
      `termCount is ${artifact.termCount} but the artifact contains ${terms.length} terms`,
    );
  }
  for (const [field, value] of [
    ['categoryIndex', artifact.categoryIndex],
    ['severityIndex', artifact.severityIndex],
    ['languageIndex', artifact.languageIndex],
    ['flags', artifact.flags],
  ] as const) {
    const count = value === '' ? 0 : value.split(',').length;
    if (count !== terms.length) {
      fail(`column "${field}" has ${count} values but there are ${terms.length} terms`);
    }
  }

  const categoryCount = artifact.categories.length;
  const categoryIndexes =
    artifact.categoryIndex === '' ? [] : artifact.categoryIndex.split(',');
  const seen = new Set<string>();
  let emptyTerms = 0;
  let duplicates = 0;
  let outOfRange = 0;
  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i]!;
    if (term.trim() === '') emptyTerms += 1;
    if (seen.has(term)) duplicates += 1;
    else seen.add(term);
    const index = Number.parseInt(categoryIndexes[i] ?? '', 10);
    if (!Number.isInteger(index) || index < 0 || index >= categoryCount)
      outOfRange += 1;
  }
  if (emptyTerms > 0) fail(`${emptyTerms} empty term(s) in the artifact`);
  if (duplicates > 0) fail(`${duplicates} duplicated term(s) in the artifact`);
  if (outOfRange > 0) fail(`${outOfRange} term(s) reference an unknown category index`);

  for (const category of artifact.categories) {
    if (typeof category.id !== 'string' || category.id === '') {
      fail('a category has an empty id');
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(category.id)) {
      warn(`category id "${category.id}" is not a lowercase kebab-case slug`);
    }
  }
}

async function checkLock(artifact: LexiconArtifact): Promise<void> {
  let lock: LockFile;
  try {
    lock = JSON.parse(await readFile(upstreamLockFile, 'utf8')) as LockFile;
  } catch {
    fail(
      `cannot read ${relative(packageRoot, upstreamLockFile)}; run "npm run lexicon:sync"`,
    );
    return;
  }
  if (artifact.upstreamCommit !== lock.upstream.commit) {
    fail(
      `artifact upstream commit ${artifact.upstreamCommit ?? '(none)'} does not match the lock file ${lock.upstream.commit}; rebuild the lexicon`,
    );
  }
  for (const file of lock.files) {
    const absolute = join(packageRoot, file.path);
    const digest = await sha256(absolute);
    if (digest === null) {
      fail(`${file.path} is listed in the lock file but missing on disk`);
      continue;
    }
    if (digest !== file.sha256) {
      fail(`${file.path} has changed since the last sync (checksum mismatch)`);
    }
  }
  for (const source of artifact.sources) {
    const absolute = join(upstreamDir, source.path);
    const digest = await sha256(absolute);
    if (digest === null) {
      // Local term files live outside data/upstream.
      if (!source.path.startsWith('local/')) {
        fail(`${source.path} recorded in the artifact is missing on disk`);
      }
      continue;
    }
    if (digest !== source.sha256) {
      fail(
        `${source.path} changed after the lexicon was built; run "npm run lexicon:build"`,
      );
    }
  }
}

async function checkCategoryConfig(artifact: LexiconArtifact): Promise<void> {
  let config: CategoryConfig;
  try {
    config = JSON.parse(await readFile(categoryConfigFile, 'utf8')) as CategoryConfig;
  } catch {
    fail(`cannot read ${relative(packageRoot, categoryConfigFile)}`);
    return;
  }
  const configured = new Set(Object.keys(config.sources ?? {}));
  const onDisk = (await listTermFiles(upstreamDir)).map((file) =>
    relative(upstreamDir, file).split('\\').join('/'),
  );
  for (const file of onDisk) {
    if (!configured.has(file)) {
      warn(
        `${file} has no entry in category-config.json; its category id was derived from the file name`,
      );
    }
  }
  for (const file of configured) {
    if (!onDisk.includes(file)) {
      warn(`category-config.json references ${file}, which no longer exists upstream`);
    }
  }
  const categoryIds = new Set(artifact.categories.map((category) => category.id));
  for (const source of Object.values(config.sources ?? {})) {
    if (!categoryIds.has(source.category)) {
      warn(`configured category "${source.category}" produced no terms`);
    }
  }
}

/** Detect a sample of real terms end to end through the SDK. */
async function checkRoundTrip(): Promise<void> {
  const moderator = await createModerator({ lexicon: { categories: ['*'] } });
  const metadata = moderator.getMetadata();
  if (metadata.termCount === 0) {
    fail('no terms were loaded from the artifact');
    return;
  }

  const nonEmptyCategories = metadata.categories.filter(
    (category) => category.termCount > 0,
  );

  // Sample terms straight from the artifact and verify they are detected.
  const entries = await sampleTerms();
  let missed = 0;
  for (const term of entries) {
    const result = moderator.check(`前缀 ${term} 后缀`, {
      returnMatches: true,
      categories: ['*'],
    });
    if (!result.matched) {
      missed += 1;
      if (missed <= 5) fail(`term "${term}" from the artifact is not detected`);
    }
  }
  if (missed > 5) fail(`${missed} sampled terms are not detected`);
  if (nonEmptyCategories.length === 0) warn('every category is empty');
}

async function sampleTerms(): Promise<string[]> {
  const artifact = await loadArtifact();
  const terms = artifact.terms.split('\n');
  const out: string[] = [];
  const step = Math.max(1, Math.floor(terms.length / 500));
  for (let i = 0; i < terms.length; i += step) {
    const term = terms[i]!;
    // Terms flagged for review are excluded at load time, so they cannot be sampled.
    if ([...term].length < 2) continue;
    if (/[\t\n\r]/.test(term) || /\s{2,}/.test(term)) continue;
    if (/^\d+$/.test(term)) continue;
    out.push(term);
  }
  return out;
}

async function sha256(file: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
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
