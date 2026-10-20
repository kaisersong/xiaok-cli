import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.test-cache/vitest',
  test: {
    globalSetup: ['./tests/support/profile-account.global.mjs'],
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    setupFiles: ['./tests/support/profile-account.setup.mjs', './tests/support/setup-host-env.ts'],
    sequence: { setupFiles: 'list' },
    // Owner-approved B1 (2026-10-19): budget for full verification fixtures.
    // Runner deadline only; logical clocks, case populations and assertions stay unchanged.
    testTimeout: 12000,
  },
});
