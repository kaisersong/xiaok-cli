export default {
  cacheDir: '.test-cache/vitest-sandbox',
  test: {
    globals: true,
    environment: 'node',
    include: ['.test-dist/tests/**/*.test.js'],
    exclude: [
      '.test-dist/tests/ai/tools/bash.test.js',
      '.test-dist/tests/ai/tools/grep.test.js',
    ],
    pool: 'threads',
  },
};
