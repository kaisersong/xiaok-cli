export default {
  cacheDir: '.test-cache/vitest-sandbox',
  test: {
    globalSetup: ['./tests/support/profile-account.global.mjs'],
    // Host-env scrub snapshots the inherited env first; account isolation then rewrites HOME.
    setupFiles: ['./.test-dist/tests/support/setup-host-env.js','./tests/support/profile-account.setup.mjs'],
    sequence: { setupFiles: 'list' },
    globals: true,
    environment: 'node',
    include: ['.test-dist/tests/**/*.test.js'],
    exclude: [
      '.test-dist/tests/ai/tools/bash.test.js',
      '.test-dist/tests/ai/tools/grep.test.js',
      '.test-dist/tests/commands/chat-cli-smoke.test.js',
      '.test-dist/tests/commands/chat-skill-runtime.release.test.js',
      '.test-dist/tests/platform/plugins/runtime-real-process.test.js',
      '.test-dist/tests/platform/runtime/registry-factory.test.js',
      '.test-dist/tests/scripts/check-repo-hygiene.test.js',
      '.test-dist/tests/scripts/new-worktree.test.js',
    ],
    // afterEach 清理临时目录在 Windows 上会因文件句柄重试而超过默认 10s。
    hookTimeout: 30_000,
    fileParallelism: false,
    // #123（观察口径）：threads 下重 verification 用例超时后 runner 收不住，全量只能外部 kill（exit 143）。
    // forks 下 worker 是独立子进程，超时/teardown 可杀掉 worker，套件能写完报告并退出。
    // 验收=进程能退出并写出 JSON，不是用例全绿；yolo spread 本配置继承 forks。
    pool: 'forks',
  },
};
