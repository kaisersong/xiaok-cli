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
    // #123：预防性与 sandbox 对齐为 forks（本套件无挂死复现）。重复 setupFiles 键为既有问题，另跟，本 PR 不改。
    pool: 'forks',
  },
};
