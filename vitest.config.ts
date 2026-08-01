import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'web'],
    // Tests run against their OWN database and truncate freely between suites.
    // Without this they share the development database, and a single
    // `npm test` would silently destroy an ingested watchlist that took half
    // an hour to build. Override with TEST_DATABASE_URL.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgresql://root@localhost:26257/sifta_test?sslmode=disable',
    },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Database-backed suites share one cluster; run files serially to keep
    // schema state deterministic.
    fileParallelism: false,
    reporters: ['default'],
  },
});
