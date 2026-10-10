export default {
  cacheDir: '.test-cache/vitest-skill-release',
  test: {
    globals: true,
    environment: 'node',
    include: ['.test-dist/tests/commands/chat-skill-runtime.release.test.js'],
    exclude: [],
    setupFiles: ['./.test-dist/tests/support/setup-host-env.js'],
    fileParallelism: false,
    pool: 'threads',
  },
};
