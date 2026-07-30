import { defineConfig } from 'vitest/config';

/**
 * Performance guard rails. Kept out of the default run (and out of CI) because the
 * timings depend on the machine; run them with `npm run test:perf`.
 */
export default defineConfig({
  test: {
    include: ['tests/performance/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    pool: 'forks',
  },
});
