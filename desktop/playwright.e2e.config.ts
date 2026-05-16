import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'e2e-desktop.spec.ts',
    'e2e-settings.spec.ts',
    'e2e-task-switch.spec.ts',
    'e2e-diff-verify.spec.ts',
    'e2e-kswarm.spec.ts',
    'e2e-windows-smoke.spec.ts',
  ],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 60000,
  use: {
    trace: 'on-first-retry',
  },
});
