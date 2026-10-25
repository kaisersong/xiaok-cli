import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Keep the actual Main producer/account path; desktop's broad UI setup is not required here.
export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['tests/main/diagnostics-ipc-business.test.ts', 'tests/main/diagnostics-ipc-contract.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    globalSetup: [resolve(__dirname, '../tests/support/profile-account.global.mjs')],
    setupFiles: [
      resolve(__dirname, 'tests/profile-account.setup.mjs'),
      resolve(__dirname, 'tests/setup-host-env.ts'),
    ],
    server: { deps: { inline: ['electron'] } },
  },
});
