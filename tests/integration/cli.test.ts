import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXIT_CLEAN,
  EXIT_ERROR,
  EXIT_MATCHED,
  run,
  type CliIo,
} from '../../src/cli/index.js';

function capture(stdin = ''): { io: CliIo; out: () => string; err: () => string } {
  let out = '';
  let err = '';
  return {
    io: {
      stdout: (text) => {
        out += text;
      },
      stderr: (text) => {
        err += text;
      },
      readStdin: () => Promise.resolve(stdin),
    },
    out: () => out,
    err: () => err,
  };
}

describe('CLI', () => {
  it('exits 0 and prints a summary for clean text', async () => {
    const io = capture();
    const code = await run(['check', '这是一段完全正常的内容'], io.io);
    expect(code).toBe(EXIT_CLEAN);
    expect(io.out()).toContain('matched: false');
    expect(io.out()).toContain('decision: allow');
    expect(io.err()).toBe('');
  });

  it('exits 1 and reports matches for flagged text', async () => {
    const io = capture();
    const code = await run(['check', '这段文本包含法轮功内容'], io.io);
    expect(code).toBe(EXIT_MATCHED);
    expect(io.out()).toContain('matched: true');
    expect(io.out()).toContain('法轮功');
    expect(io.out()).toContain('masked:');
  });

  it('requires an explicit command so typos are not treated as text', async () => {
    const io = capture();
    expect(await run(['法轮功'], io.io)).toBe(EXIT_ERROR);
    expect(io.err()).toContain('unknown command');
  });

  it('supports --json', async () => {
    const io = capture();
    const code = await run(['check', '--json', '包含法轮功'], io.io);
    expect(code).toBe(EXIT_MATCHED);
    const parsed = JSON.parse(io.out());
    expect(parsed.matched).toBe(true);
    expect(parsed.matches[0].term).toBe('法轮功');
    expect(parsed.lexicon.upstreamCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('supports --file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oml-cli-'));
    const file = join(dir, 'article.txt');
    await writeFile(file, '文章正文提到了法轮功。\n', 'utf8');
    const io = capture();
    expect(await run(['check', '--file', file], io.io)).toBe(EXIT_MATCHED);
    expect(io.out()).toContain('法轮功');
  });

  it('fails with exit code 2 for an unreadable file', async () => {
    const io = capture();
    expect(await run(['check', '--file', '/nonexistent/file.txt'], io.io)).toBe(
      EXIT_ERROR,
    );
    expect(io.err()).toContain('cannot read file');
  });

  it('reads stdin when no text is given', async () => {
    const io = capture('包含法轮功的内容\n');
    expect(await run(['check'], io.io)).toBe(EXIT_MATCHED);
  });

  it('errors when there is no input at all', async () => {
    const io = capture('');
    expect(await run(['check'], io.io)).toBe(EXIT_ERROR);
    expect(io.err()).toContain('no text provided');
  });

  it('masks text', async () => {
    const io = capture();
    expect(await run(['mask', '包含法轮功的内容'], io.io)).toBe(EXIT_MATCHED);
    expect(io.out().trim()).toBe('包含***的内容');

    const custom = capture();
    await run(['mask', '--mask-char', '#', '包含法轮功的内容'], custom.io);
    expect(custom.out().trim()).toBe('包含###的内容');

    const clean = capture();
    expect(await run(['mask', '正常内容'], clean.io)).toBe(EXIT_CLEAN);
    expect(clean.out().trim()).toBe('正常内容');
  });

  it('prints metadata', async () => {
    const io = capture();
    expect(await run(['metadata'], io.io)).toBe(EXIT_CLEAN);
    expect(io.out()).toContain('lexicon version:');
    expect(io.out()).toContain('upstream commit:');
    expect(io.out()).toContain('supported modes:  exact, normalized, fuzzy');
    expect(io.out()).toContain('not part of the default selection');

    const json = capture();
    await run(['metadata', '--json'], json.io);
    const parsed = JSON.parse(json.out());
    expect(parsed.termCount).toBeGreaterThan(1000);
    expect(parsed.categories.length).toBeGreaterThan(5);
  });

  it('supports --mode and --categories', async () => {
    // The traditional spelling only exists in a non-default upstream list, so it is
    // reachable through normalization but not through an exact match.
    const exact = capture();
    expect(await run(['check', '--mode', 'exact', '法輪功'], exact.io)).toBe(
      EXIT_CLEAN,
    );
    const normalized = capture();
    expect(await run(['check', '--mode', 'normalized', '法輪功'], normalized.io)).toBe(
      EXIT_MATCHED,
    );
    const filtered = capture();
    expect(
      await run(['check', '--categories', 'adult', '包含法轮功'], filtered.io),
    ).toBe(EXIT_CLEAN);
  });

  it('supports --allowlist', async () => {
    const io = capture();
    expect(await run(['check', '--allowlist', '法轮功', '包含法轮功'], io.io)).toBe(
      EXIT_CLEAN,
    );
  });

  it('supports --quiet', async () => {
    const io = capture();
    expect(await run(['check', '--quiet', '包含法轮功'], io.io)).toBe(EXIT_MATCHED);
    expect(io.out()).toBe('');
  });

  it('validates options', async () => {
    for (const args of [
      ['check', '--mode', 'semantic', 'x'],
      ['check', '--overlap', 'nope', 'x'],
      ['check', '--mask-char', 'ab', 'x'],
      ['check', '--categories', 'no-such-category', 'x'],
      ['nonsense', 'x'],
      ['check', '--unknown-flag'],
    ]) {
      const io = capture();
      expect(await run(args, io.io), args.join(' ')).toBe(EXIT_ERROR);
      expect(io.err().length, args.join(' ')).toBeGreaterThan(0);
    }
  });

  it('prints help and version', async () => {
    const help = capture();
    expect(await run(['--help'], help.io)).toBe(EXIT_CLEAN);
    expect(help.out()).toContain('open-moderation-lexicon');
    expect(help.out()).toContain('Exit codes:');

    const version = capture();
    expect(await run(['--version'], version.io)).toBe(EXIT_CLEAN);
    expect(version.out().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
