import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'web'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Database-backed suites share one cluster; run files serially to keep
    // schema state deterministic.
    fileParallelism: false,
    reporters: ['default'],
  },
});
