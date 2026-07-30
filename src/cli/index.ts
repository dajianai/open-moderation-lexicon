#!/usr/bin/env node
/**
 * Command line interface.
 *
 * Exit codes:
 *   0 – no match (or an informational command such as `metadata`)
 *   1 – at least one match
 *   2 – usage, configuration or runtime error
 */
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  MATCH_MODES,
  type CheckOptions,
  type MatchMode,
  type ModerationResult,
} from '../core/types.js';
import { createModerator, ModerationInputError, type Moderator } from '../moderator.js';
import { LexiconLoadError } from '../lexicon/loader.js';
import { InvalidMaskCharError } from '../core/masker.js';

/** Exit codes used by the CLI. */
export const EXIT_CLEAN = 0;
export const EXIT_MATCHED = 1;
export const EXIT_ERROR = 2;

const CLI_VERSION = '0.1.0';

const USAGE = `open-moderation-lexicon – keyword based moderation CLI

Usage:
  open-moderation-lexicon check [options] [text]
  open-moderation-lexicon mask [options] [text]
  open-moderation-lexicon metadata [options]

Commands:
  check      Report matches, a decision and a risk level for a text
  mask       Print the text with every match replaced by the mask character
  metadata   Print lexicon version, upstream commit and categories

Input:
  Pass the text as the last argument, use --file, or pipe it on stdin.

Options:
  --file <path>          Read the text from a file instead of an argument
  --mode <mode>          exact | normalized | fuzzy (default: normalized)
  --categories <list>    Comma separated category ids, "all" or "*"
  --overlap <strategy>   leftmost-longest (default) or all
  --mask-char <char>     Single character used for masking (default: *)
  --allowlist <list>     Comma separated terms to ignore
  --include-review       Include terms flagged for human review (single chars, digits)
  --json                 Print machine readable JSON
  --quiet                Print nothing; rely on the exit code
  --version              Print the CLI version
  --help                 Print this message

Exit codes:
  0 no match, 1 at least one match, 2 error

This tool detects keywords. It does not judge meaning, intent or legality.
`;

const options: ParseArgsConfig['options'] = {
  file: { type: 'string' },
  mode: { type: 'string' },
  categories: { type: 'string' },
  overlap: { type: 'string' },
  'mask-char': { type: 'string' },
  allowlist: { type: 'string' },
  'include-review': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  quiet: { type: 'boolean', default: false },
  version: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
};

/** Streams the CLI writes to, injectable for tests. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: async () => {
    if (process.stdin.isTTY === true) return '';
    // No encoding is set on stdin, so the stream yields Buffers.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin as AsyncIterable<Buffer>)
      chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  },
};

/** Run the CLI. Returns the process exit code. */
export async function run(argv: string[], io: CliIo = defaultIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : 'invalid arguments'}\n\n${USAGE}`,
    );
    return EXIT_ERROR;
  }
  const values = parsed.values as Record<string, string | boolean | undefined>;
  const positionals = parsed.positionals;

  if (values.help === true) {
    io.stdout(USAGE);
    return EXIT_CLEAN;
  }
  if (values.version === true) {
    io.stdout(`${CLI_VERSION}\n`);
    return EXIT_CLEAN;
  }

  const command = positionals[0] ?? 'check';
  if (!['check', 'mask', 'metadata'].includes(command)) {
    io.stderr(`unknown command: ${command}\n\n${USAGE}`);
    return EXIT_ERROR;
  }

  const mode = values.mode === undefined ? undefined : String(values.mode);
  if (mode !== undefined && !MATCH_MODES.includes(mode as MatchMode)) {
    io.stderr(
      `unsupported --mode "${mode}"; expected one of ${MATCH_MODES.join(', ')}\n`,
    );
    return EXIT_ERROR;
  }
  const overlap = values.overlap === undefined ? undefined : String(values.overlap);
  if (overlap !== undefined && overlap !== 'all' && overlap !== 'leftmost-longest') {
    io.stderr(`unsupported --overlap "${overlap}"; expected all or leftmost-longest\n`);
    return EXIT_ERROR;
  }
  const maskChar =
    values['mask-char'] === undefined ? undefined : String(values['mask-char']);
  if (maskChar !== undefined && [...maskChar].length !== 1) {
    io.stderr('--mask-char must be exactly one character\n');
    return EXIT_ERROR;
  }

  const categories = splitList(values.categories);
  const allowlist = splitList(values.allowlist);

  let moderator: Moderator;
  try {
    moderator = await createModerator({
      ...(mode ? { mode: mode as MatchMode } : {}),
      ...(maskChar ? { maskChar } : {}),
      ...(allowlist ? { allowlist } : {}),
      ...(overlap ? { overlap: overlap as CheckOptions['overlap'] } : {}),
      lexicon: {
        ...(categories ? { categories } : {}),
        includeNeedsReview: values['include-review'] === true,
      },
    });
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return EXIT_ERROR;
  }

  if (command === 'metadata') {
    const metadata = moderator.getMetadata();
    if (values.json === true) {
      io.stdout(`${JSON.stringify(metadata, null, 2)}\n`);
    } else if (values.quiet !== true) {
      io.stdout(renderMetadata(metadata));
    }
    return EXIT_CLEAN;
  }

  let text: string;
  try {
    text = await resolveText(values.file, positionals.slice(1), io);
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return EXIT_ERROR;
  }
  if (text === '') {
    io.stderr(`no text provided\n\n${USAGE}`);
    return EXIT_ERROR;
  }

  const checkOptions: CheckOptions = {
    ...(mode ? { mode: mode as MatchMode } : {}),
    ...(categories ? { categories } : {}),
    ...(overlap ? { overlap: overlap } : {}),
    ...(maskChar ? { maskChar } : {}),
    returnMatches: true,
    mask: true,
  };

  let result: ModerationResult;
  try {
    result = moderator.check(text, checkOptions);
  } catch (error) {
    io.stderr(`${formatError(error)}\n`);
    return EXIT_ERROR;
  }

  if (values.quiet !== true) {
    if (command === 'mask') {
      io.stdout(
        values.json === true
          ? `${JSON.stringify({ maskedText: result.maskedText, hitCount: result.hitCount }, null, 2)}\n`
          : `${result.maskedText ?? text}\n`,
      );
    } else {
      io.stdout(
        values.json === true
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderResult(result),
      );
    }
  }

  return result.matched ? EXIT_MATCHED : EXIT_CLEAN;
}

function splitList(value: string | boolean | undefined): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  return items.length > 0 ? items : undefined;
}

async function resolveText(
  file: string | boolean | undefined,
  positionals: string[],
  io: CliIo,
): Promise<string> {
  if (typeof file === 'string' && file !== '') {
    try {
      return await readFile(file, 'utf8');
    } catch {
      throw new Error(`cannot read file: ${file}`);
    }
  }
  if (positionals.length > 0) return positionals.join(' ');
  return (await io.readStdin()).replace(/\n$/, '');
}

function renderResult(result: ModerationResult): string {
  const lines: string[] = [];
  lines.push(
    `matched: ${result.matched}  decision: ${result.decision}  risk: ${result.riskLevel}  hits: ${result.hitCount}  uniqueTerms: ${result.uniqueTermCount}`,
  );
  if (result.categories.length > 0) {
    lines.push(`categories: ${result.categories.join(', ')}`);
  }
  if (result.matches.length > 0) {
    lines.push('matches:');
    for (const match of result.matches) {
      lines.push(
        `  [${match.start}-${match.end}] ${match.term} -> ${match.matchedText} (${match.category}, ${match.severity}, ${match.matchType})`,
      );
    }
  }
  if (result.maskedText !== undefined && result.matched) {
    lines.push(`masked: ${result.maskedText}`);
  }
  lines.push(
    `lexicon: ${result.lexicon.version} (upstream ${result.lexicon.upstreamCommit ?? 'unknown'})`,
  );
  return `${lines.join('\n')}\n`;
}

function renderMetadata(metadata: ReturnType<Moderator['getMetadata']>): string {
  const lines: string[] = [];
  lines.push(`lexicon version:  ${metadata.version}`);
  lines.push(`upstream commit:  ${metadata.upstreamCommit ?? '(none)'}`);
  lines.push(`synced at:        ${metadata.syncedAt ?? '(unknown)'}`);
  lines.push(`built at:         ${metadata.builtAt}`);
  lines.push(`terms loaded:     ${metadata.termCount} of ${metadata.totalTermCount}`);
  lines.push(`supported modes:  ${MATCH_MODES.join(', ')}`);
  lines.push('categories:');
  for (const category of metadata.categories) {
    const flag = category.defaultEnabled ? ' ' : '*';
    lines.push(
      `  ${flag} ${category.id.padEnd(20)} ${String(category.termCount).padStart(6)}  ${category.severity.padEnd(6)} ${category.displayName}`,
    );
  }
  lines.push('');
  lines.push(
    '* not part of the default selection (broad list, higher false-positive risk)',
  );
  return `${lines.join('\n')}\n`;
}

function formatError(error: unknown): string {
  if (error instanceof LexiconLoadError) {
    return `lexicon error: ${error.message}`;
  }
  if (error instanceof ModerationInputError || error instanceof InvalidMaskCharError) {
    return `input error: ${error.message}`;
  }
  return error instanceof Error ? `error: ${error.message}` : 'unknown error';
}

/**
 * True when this module is the process entry point.
 *
 * `argv[1]` is the `.bin/oml` symlink for an installed package, so it is compared
 * after resolving symlinks rather than by name.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Only run when executed as a binary, so tests can import `run` directly.
if (isEntryPoint()) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${formatError(error)}\n`);
      process.exitCode = EXIT_ERROR;
    });
}
