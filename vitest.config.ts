import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/performance/**'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/types.ts', 'src/api/serve.ts'],
    },
  },
});
