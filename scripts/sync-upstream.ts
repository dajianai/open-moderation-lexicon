#!/usr/bin/env tsx
/**
 * Synchronizes the vendored upstream lexicon.
 *
 * This is the only component allowed to talk to the network. It downloads a pinned
 * commit of the upstream repository, writes the files into `data/upstream/`, refreshes
 * `UPSTREAM.lock.json` and reports what changed. Nothing is overwritten silently: a
 * diff report is always written and printed.
 *
 * Usage:
 *   npm run lexicon:sync                 # sync to the latest upstream commit
 *   npm run lexicon:sync -- --check      # exit 10 when upstream moved, change nothing
 *   npm run lexicon:sync -- --ref <sha>  # sync to a specific commit or tag
 *   npm run lexicon:sync -- --dry-run    # report only
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  packageRoot,
  reportsDir,
  upstreamDir,
  upstreamLockFile,
} from '../src/lexicon/paths.js';

const UPSTREAM_OWNER = 'konsheng';
const UPSTREAM_REPO = 'Sensitive-lexicon';
const UPSTREAM_URL = `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`;
const UPSTREAM_BRANCH = 'main';
/** Directories copied from the upstream tarball, plus the licence and readme. */
const SYNCED_DIRECTORIES = ['Organized', 'Vocabulary'];
const SYNCED_FILES: { from: string; to: string }[] = [
  { from: 'LICENSE', to: 'LICENSE' },
  { from: 'README.md', to: 'README.upstream.md' },
];
/**
 * Other third-party data vendored into the repository. Not synced by this script, but
 * recorded in the lock file so provenance stays in one place. Update the commit here
 * when refreshing the dictionary and re-run `scripts/generate-tscharacters.mjs`.
 */
const VENDORED_THIRD_PARTY = [
  {
    name: 'OpenCC (BYVoid/OpenCC)',
    url: 'https://github.com/BYVoid/OpenCC',
    license: 'Apache-2.0',
    path: 'data/vendor/opencc/TSCharacters.txt',
    commit: '56d028aa324c407a51b74da7891450e408432569',
    usage:
      'Traditional to simplified single-character mapping, compiled into src/core/data/traditional-simplified.ts',
  },
];

interface LockFile {
  upstream: {
    name: string;
    url: string;
    branch: string;
    license: string;
    commit: string;
    commitDate: string | null;
  };
  syncedAt: string;
  syncedDirectories: string[];
  files: { path: string; sha256: string; bytes: number; termLines: number }[];
  vendoredThirdParty: typeof VENDORED_THIRD_PARTY;
}

interface FileSnapshot {
  path: string;
  sha256: string;
  bytes: number;
  terms: Set<string>;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      ref: { type: 'string' },
      check: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  if (values.help === true) {
    console.log(
      [
        'Usage: npm run lexicon:sync -- [options]',
        '',
        '  --ref <sha|tag>  Sync a specific upstream revision (default: latest main)',
        '  --check          Only report whether upstream moved; exit code 10 when it did',
        '  --dry-run        Download and diff, but do not modify data/upstream',
        '  --force          Re-sync even when the lock file already points at this commit',
        '  --help           Show this message',
      ].join('\n'),
    );
    return 0;
  }

  const previousLock = await readLock();
  const targetRef = values.ref ?? UPSTREAM_BRANCH;
  const head = await resolveCommit(targetRef);
  console.log(
    `upstream ${UPSTREAM_OWNER}/${UPSTREAM_REPO}@${targetRef} -> ${head.sha}`,
  );

  if (
    previousLock &&
    previousLock.upstream.commit === head.sha &&
    values.force !== true
  ) {
    console.log('already up to date; nothing to do (use --force to re-sync anyway)');
    return 0;
  }
  if (values.check === true) {
    console.log(
      `upstream moved: ${previousLock?.upstream.commit ?? '(no lock file)'} -> ${head.sha}`,
    );
    return 10;
  }

  const before = await snapshotDirectory(upstreamDir);
  const workDir = await downloadUpstream(head.sha);
  try {
    const staged = join(workDir, 'staged');
    await stageUpstream(workDir, staged);
    const after = await snapshotDirectory(staged);
    const diff = diffSnapshots(before, after);

    await mkdir(reportsDir, { recursive: true });
    const report = renderSyncReport(head, previousLock, diff);
    await writeFile(join(reportsDir, 'sync-report.md'), report, 'utf8');
    await writeFile(
      join(reportsDir, 'sync-report.json'),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          previousCommit: previousLock?.upstream.commit ?? null,
          newCommit: head.sha,
          ...diff,
          addedTerms: [...diff.addedTermSet].slice(0, 2000),
          removedTerms: [...diff.removedTermSet].slice(0, 2000),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(report);

    if (values['dry-run'] === true) {
      console.log('dry run: data/upstream left untouched');
      return 0;
    }

    for (const directory of SYNCED_DIRECTORIES) {
      await rm(join(upstreamDir, directory), { recursive: true, force: true });
    }
    await copyTree(staged, upstreamDir);
    await writeLock(head, after);
    console.log(`\nwrote ${relative(packageRoot, upstreamLockFile)}`);
    console.log('next: npm run lexicon:build && npm run lexicon:validate && npm test');
    return 0;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function readLock(): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(upstreamLockFile, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

interface CommitInfo {
  sha: string;
  date: string | null;
}

async function resolveCommit(ref: string): Promise<CommitInfo> {
  const response = await fetch(
    `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/commits/${encodeURIComponent(ref)}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'open-moderation-lexicon-sync',
        ...(process.env.GITHUB_TOKEN
          ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    sha: string;
    commit?: { committer?: { date?: string } };
  };
  return { sha: body.sha, date: body.commit?.committer?.date ?? null };
}

/** Download and extract the upstream tarball into a temporary directory. */
async function downloadUpstream(sha: string): Promise<string> {
  const workDir = await mkdtempDir();
  const tarball = join(workDir, 'upstream.tar.gz');
  const url = `https://codeload.github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/tar.gz/${sha}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'open-moderation-lexicon-sync' },
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      `cannot download ${url}: ${response.status} ${response.statusText}`,
    );
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tarball));
  const extracted = join(workDir, 'extracted');
  await mkdir(extracted, { recursive: true });
  await run('tar', ['-xzf', tarball, '-C', extracted, '--strip-components=1']);
  return workDir;
}

/** Copy the synced subset of the extracted tree into `staged/`. */
async function stageUpstream(workDir: string, staged: string): Promise<void> {
  const extracted = join(workDir, 'extracted');
  await mkdir(staged, { recursive: true });
  for (const directory of SYNCED_DIRECTORIES) {
    await copyTree(join(extracted, directory), join(staged, directory));
  }
  for (const file of SYNCED_FILES) {
    const body = await readFile(join(extracted, file.from));
    await mkdir(dirname(join(staged, file.to)), { recursive: true });
    await writeFile(join(staged, file.to), body);
  }
}

async function copyTree(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true }).catch(() => []);
  await mkdir(to, { recursive: true });
  for (const entry of entries) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(source, target);
    } else if (entry.isFile()) {
      await writeFile(target, await readFile(source));
    }
  }
}

/**
 * Read every `.txt` inside the synced directories of `root` into a comparable
 * snapshot. Other vendored data (for example the OpenCC dictionary) is deliberately
 * excluded so it never shows up as a term level change.
 */
async function snapshotDirectory(root: string): Promise<Map<string, FileSnapshot>> {
  const out = new Map<string, FileSnapshot>();
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith('.txt')) continue;
      const buffer = await readFile(full);
      const body = buffer.toString('utf8').replace(/^\ufeff/, '');
      const terms = new Set<string>();
      for (const line of body.split('\n')) {
        const cleaned = line.replace(/\r$/, '').trim();
        if (cleaned !== '' && !cleaned.startsWith('#')) terms.add(cleaned);
      }
      const key = relative(root, full).split(sep).join(posix.sep);
      out.set(key, {
        path: key,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        bytes: buffer.byteLength,
        terms,
      });
    }
  }
  for (const directory of SYNCED_DIRECTORIES) {
    await walk(join(root, directory));
  }
  return out;
}

interface SnapshotDiff {
  addedFiles: string[];
  removedFiles: string[];
  changedFiles: { path: string; added: number; removed: number }[];
  addedTermCount: number;
  removedTermCount: number;
  addedTermSet: Set<string>;
  removedTermSet: Set<string>;
}

function diffSnapshots(
  before: Map<string, FileSnapshot>,
  after: Map<string, FileSnapshot>,
): SnapshotDiff {
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];
  const changedFiles: { path: string; added: number; removed: number }[] = [];
  const addedTermSet = new Set<string>();
  const removedTermSet = new Set<string>();

  for (const [path, snapshot] of after) {
    const previous = before.get(path);
    if (!previous) {
      addedFiles.push(path);
      for (const term of snapshot.terms) addedTermSet.add(term);
      continue;
    }
    if (previous.sha256 === snapshot.sha256) continue;
    let added = 0;
    let removed = 0;
    for (const term of snapshot.terms) {
      if (!previous.terms.has(term)) {
        addedTermSet.add(term);
        added += 1;
      }
    }
    for (const term of previous.terms) {
      if (!snapshot.terms.has(term)) {
        removedTermSet.add(term);
        removed += 1;
      }
    }
    changedFiles.push({ path, added, removed });
  }
  for (const [path, snapshot] of before) {
    if (after.has(path)) continue;
    removedFiles.push(path);
    for (const term of snapshot.terms) removedTermSet.add(term);
  }

  return {
    addedFiles: addedFiles.sort(),
    removedFiles: removedFiles.sort(),
    changedFiles: changedFiles.sort((a, b) => a.path.localeCompare(b.path, 'en')),
    addedTermCount: addedTermSet.size,
    removedTermCount: removedTermSet.size,
    addedTermSet,
    removedTermSet,
  };
}

function renderSyncReport(
  head: CommitInfo,
  previous: LockFile | null,
  diff: SnapshotDiff,
): string {
  const lines: string[] = [];
  lines.push('# Upstream sync report');
  lines.push('');
  lines.push(`- Upstream: ${UPSTREAM_URL}`);
  lines.push(`- Previous commit: ${previous?.upstream.commit ?? '(none)'}`);
  lines.push(`- New commit: ${head.sha}`);
  lines.push(`- Upstream commit date: ${head.date ?? '(unknown)'}`);
  lines.push(`- Synced at: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push(`- Added files: ${diff.addedFiles.length}`);
  for (const file of diff.addedFiles) lines.push(`  - \`${file}\``);
  lines.push(`- Removed files: ${diff.removedFiles.length}`);
  for (const file of diff.removedFiles) lines.push(`  - \`${file}\``);
  lines.push(`- Changed files: ${diff.changedFiles.length}`);
  for (const file of diff.changedFiles) {
    lines.push(`  - \`${file.path}\`: +${file.added} / -${file.removed} terms`);
  }
  lines.push('');
  lines.push('## Terms');
  lines.push('');
  lines.push(`- Added: ${diff.addedTermCount}`);
  lines.push(`- Removed: ${diff.removedTermCount}`);
  lines.push('');
  if (diff.addedTermCount === 0 && diff.removedTermCount === 0) {
    lines.push('No term level changes.');
    lines.push('');
  } else {
    const sample = (values: Set<string>) => [...values].slice(0, 40);
    if (diff.addedTermCount > 0) {
      lines.push('<details><summary>Sample of added terms</summary>');
      lines.push('');
      lines.push('```');
      for (const term of sample(diff.addedTermSet)) lines.push(term);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
    if (diff.removedTermCount > 0) {
      lines.push('<details><summary>Sample of removed terms</summary>');
      lines.push('');
      lines.push('```');
      for (const term of sample(diff.removedTermSet)) lines.push(term);
      lines.push('```');
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }
  }
  lines.push(
    'Review the diff of `data/upstream/` before merging. Category assignments live',
  );
  lines.push(
    'in `data/overrides/category-config.json` and are never changed automatically.',
  );
  return `${lines.join('\n')}\n`;
}

async function writeLock(
  head: CommitInfo,
  snapshot: Map<string, FileSnapshot>,
): Promise<void> {
  const files = [...snapshot.values()]
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
    .map((file) => ({
      path: `data/upstream/${file.path}`,
      sha256: file.sha256,
      bytes: file.bytes,
      termLines: file.terms.size,
    }));
  const lock: LockFile = {
    upstream: {
      name: `${UPSTREAM_OWNER}/${UPSTREAM_REPO}`,
      url: UPSTREAM_URL,
      branch: UPSTREAM_BRANCH,
      license: 'MIT',
      commit: head.sha,
      commitDate: head.date,
    },
    syncedAt: new Date().toISOString(),
    syncedDirectories: SYNCED_DIRECTORIES.map(
      (directory) => `data/upstream/${directory}`,
    ),
    files,
    vendoredThirdParty: VENDORED_THIRD_PARTY,
  };
  await writeFile(upstreamLockFile, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

async function mkdtempDir(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises');
  return mkdtemp(join(tmpdir(), 'oml-sync-'));
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with code ${String(code)}`));
    });
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
