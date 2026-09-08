import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({ testDir: './tests/e2e', testMatch: ['multi-agent.spec.ts', 'multi-agent-authorization-approval.spec.ts', 'multi-agent-welcome.spec.ts', 'foreground-background-lanes.spec.ts', 'summary-resume.spec.ts'], workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: 'line', outputDir: join(tmpdir(), 'xiaok-desktop-multi-agent-playwright') });
