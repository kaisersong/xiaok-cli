import { createRequire } from 'node:module';
// Emitted Desktop imports use the same real installed Electron package as source.
// In plain Node it exports its executable path, never a Main app qualification.
let electronAlias = [];
try {
  const desktopRequire = createRequire(new URL('./desktop/package.json', import.meta.url));
  electronAlias = [{ find: /^electron$/, replacement: desktopRequire.resolve('electron') }];
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  console.warn('[tests] desktop Electron dependency missing; real package alias unavailable');
}

export default {
  resolve: { alias: electronAlias },
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
    pool: 'threads',
  },
};
