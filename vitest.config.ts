import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
// Emitted Desktop imports use the same real installed Electron package as source.
// In plain Node it exports its executable path, never a Main app qualification.
let electronAlias: { find: RegExp; replacement: string }[] = [];
try {
  const desktopRequire = createRequire(new URL('./desktop/package.json', import.meta.url));
  electronAlias = [{ find: /^electron$/, replacement: desktopRequire.resolve('electron') }];
} catch (error) {
  if ((error as NodeJS.ErrnoException)?.code !== 'MODULE_NOT_FOUND') throw error;
  console.warn('[tests] desktop Electron dependency missing; real package alias unavailable');
}



export default defineConfig({
  resolve: { alias: electronAlias },
  cacheDir: '.test-cache/vitest',
  test: {
    globalSetup: ['./tests/support/profile-account.global.mjs'],
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    setupFiles: ['./tests/support/profile-account.setup.mjs', './tests/support/setup-host-env.ts', './tests/support/mock-system-credentials.ts'],
    sequence: { setupFiles: 'list' },
    // Owner-approved B1 (2026-10-19): budget for full verification fixtures.
    // Runner deadline only; logical clocks, case populations and assertions stay unchanged.
    testTimeout: 12000,
  },
});
