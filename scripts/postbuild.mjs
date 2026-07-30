#!/usr/bin/env node
/**
 * Post-compilation step: make the CLI entry point executable and verify that the
 * published bundle can find the generated lexicon.
 */
import { chmod, access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executables = ['dist/cli/index.js', 'dist/api/serve.js'];
const lexicon = resolve(root, 'data/generated/lexicon.json');

for (const relative of executables) {
  await chmod(resolve(root, relative), 0o755);
}

try {
  await access(lexicon, constants.R_OK);
  const info = await stat(lexicon);
  console.log(
    `build ok: ${executables.join(', ')} are executable, data/generated/lexicon.json is ${(info.size / 1024 / 1024).toFixed(2)} MiB`,
  );
} catch {
  console.error(
    'build warning: data/generated/lexicon.json is missing; run "npm run lexicon:build" before publishing',
  );
  process.exitCode = 1;
}
