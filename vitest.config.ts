import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.test-cache/vitest',
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
  },
});
