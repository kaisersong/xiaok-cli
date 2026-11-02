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
    // #123：全量“停在第 42 个文件之后”不是挂死：--no-cache 下按文件大小降序跑，第 43 起的几个 verification
    // 文件各跑 14–29 分钟，非 TTY 的 default reporter 只在文件结束时输出，日志长时间不动；整套全量约 2h。
    // 慢文件跟 #105/#98。验收全量请用逐用例输出的 reporter，并且不要设 1h 外层超时。
    pool: 'threads',
  },
};
