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
    // #123：全量“停在第 42 个文件之后”是慢 + 静默，不是该位置挂死（forks 诊断轮实测，threads 同条件对照见 PR #131）：
    // --no-cache 下按文件大小降序跑，第 26/35/43 位的 verification-host-controller、intent-publication-dependencies、
    // publication-operation 各跑约 14–29 分钟（慢文件跟 #98/#105），前 42 个文件合计约 3500s，第 43 个在 1h 外层超时内跑不完；
    // 非 TTY 的 default reporter 只在文件结束时输出，期间日志不动。验收全量请用逐用例 reporter，不要设 1h 外层超时。
    pool: 'threads',
  },
};
