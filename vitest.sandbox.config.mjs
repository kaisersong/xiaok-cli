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
    // #123：全量“停在第 42 个文件之后”是按大小降序排在第 43 起的几个 verification 文件各跑 14–29 分钟、
    // 非 TTY reporter 无输出所致（threads/forks 皆然，慢文件跟 #105/#98），不是该位置挂死。
    // 另有独立的真挂死：threads 下 verification-obligation-observation 主进程 RPC 饿死只能外部 kill；
    // forks 下 worker 是独立子进程，同文件能跑完、写报告并退出。yolo spread 本配置继承 forks。
    pool: 'forks',
  },
};
