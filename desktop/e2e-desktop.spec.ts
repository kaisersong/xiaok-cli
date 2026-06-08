// E2E test for PACKAGED app
// Run with: npx playwright test --config=playwright.e2e.config.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;
let userDataDir: string | null = null;
const APP_PATH = process.env.XIAOK_E2E_APP_PATH
  ?? join(process.cwd(), 'release/mac-arm64/xiaok.app/Contents/MacOS/xiaok');

test.describe('xiaok Desktop - Packaged App', () => {

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'xiaok-e2e-desktop-'));
    // Launch the PACKAGED app, not dev mode
    electronApp = await electron.launch({
      executablePath: APP_PATH,
      args: [`--user-data-dir=${userDataDir}`],
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
      },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`);
    });

    console.log(`[DEBUG] Page URL: ${page.url()}`);
  });

  test.afterAll(async () => {
    await electronApp.close().catch(() => {});
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  });

  test('Packaged app: User scenario works', async () => {
    const prompt = `测试打包版 ${Date.now()}`;

    // Take screenshot of initial state
    await page.screenshot({ path: 'test-results/screenshot-packaged-initial.png' });

    // Step 1: Click New
    console.log('[STEP 1] Click New');
    const newTaskButton = page.locator('aside button', { hasText: /New|新建任务/ });
    await expect(newTaskButton).toBeVisible({ timeout: 10000 });
    await newTaskButton.click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/screenshot-packaged-new.png' });

    // Step 2: Type and send
    console.log('[STEP 2] Type and send');
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill(prompt);
    await expect(textarea).toHaveValue(prompt);
    const inputForm = textarea.locator('xpath=ancestor::form[1]');
    const sendButton = inputForm.locator('button[type="submit"]');
    await expect(sendButton).toBeEnabled({ timeout: 5000 });
    await sendButton.click();

    await page.waitForTimeout(20000);

    await page.screenshot({ path: 'test-results/screenshot-packaged-sent.png' });

    // Step 3: Check sidebar
    console.log('[STEP 3] Check sidebar');
    const sidebarText = await page.locator('aside').textContent() ?? '';
    const hasThread = sidebarText.includes(prompt);
    console.log(`[VERIFY] Sidebar has thread: ${hasThread}`);
    expect(hasThread).toBe(true);

    // Step 4: Navigate back and click thread
    console.log('[STEP 4] Navigate back and click');
    await newTaskButton.click();
    await page.waitForTimeout(2000);

    const threadItem = page.locator('[data-testid^="thread-item-"]').filter({ hasText: prompt }).first();
    await expect(threadItem).toBeVisible({ timeout: 10000 });
    console.log('[VERIFY] Thread item visible: true');
    await threadItem.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/screenshot-packaged-final.png' });
  });
});
