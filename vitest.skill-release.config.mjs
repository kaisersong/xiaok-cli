export default {
  cacheDir: '.test-cache/vitest-skill-release',
  test: {
    globalSetup: ['./tests/support/profile-account.global.mjs'],
    setupFiles: ['./tests/support/profile-account.setup.mjs'],
    globals: true,
    environment: 'node',
    include: ['.test-dist/tests/commands/chat-skill-runtime.release.test.js'],
    exclude: [],
    setupFiles: ['./.test-dist/tests/support/setup-host-env.js'],
    fileParallelism: false,
    pool: 'threads',
  },
};
