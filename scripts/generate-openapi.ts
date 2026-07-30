#!/usr/bin/env tsx
/**
 * Writes `openapi.json` from the live Fastify schemas, so the committed document can
 * never drift from the implementation.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildServer } from '../src/api/server.js';
import { packageRoot } from '../src/lexicon/paths.js';

async function main(): Promise<number> {
  const app = await buildServer({
    config: { logLevel: 'silent', enableDocs: true, corsOrigin: null },
    // The document does not depend on the lexicon, so skip loading ~50k terms.
    deferLexiconLoad: true,
  });
  await app.ready();
  const document = app.swagger();
  await app.close();

  const target = resolve(packageRoot, 'openapi.json');
  await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  const paths = Object.keys(
    (document as { paths?: Record<string, unknown> }).paths ?? {},
  );
  console.log(`wrote openapi.json with ${paths.length} paths: ${paths.join(', ')}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
