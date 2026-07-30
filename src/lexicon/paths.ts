/**
 * Filesystem layout resolution.
 *
 * Paths are resolved relative to the installed package, never from user input, so a
 * REST client can never point the service at an arbitrary local file.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the installed package (works from both `src/` under tsx and `dist/`). */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `data/` inside the package. */
export const dataRoot = resolve(packageRoot, 'data');

export const upstreamDir = resolve(dataRoot, 'upstream');
export const generatedDir = resolve(dataRoot, 'generated');
export const overridesDir = resolve(dataRoot, 'overrides');
export const reportsDir = resolve(dataRoot, 'reports');
export const localTermsDir = resolve(overridesDir, 'local-terms');

export const lexiconFile = resolve(generatedDir, 'lexicon.json');
export const metadataFile = resolve(generatedDir, 'metadata.json');
export const categoryConfigFile = resolve(overridesDir, 'category-config.json');
export const allowlistFile = resolve(overridesDir, 'allowlist.txt');
export const customTermsFile = resolve(overridesDir, 'custom-terms.json');
export const upstreamLockFile = resolve(packageRoot, 'UPSTREAM.lock.json');
