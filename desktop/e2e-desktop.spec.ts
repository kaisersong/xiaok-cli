// E2E test for PACKAGED app
// Run with: npx playwright test --config=playwright.e2e.config.ts

import { _electron as electron, chromium } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

test.describe('xiaok Desktop - Packaged App', () => {

  test.beforeAll(async () => {
    // Launch the PACKAGED app, not dev mode
    electronApp = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
      args: [],
      cwd: '/Users/song/projects/xiaok-cli/desktop',
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
  });

  test('Packaged app: User scenario works', async () => {
    // Take screenshot of initial state
    await page.screenshot({ path: 'test-results/screenshot-packaged-initial.png' });

    // Step 1: Click New
    console.log('[STEP 1] Click New');
    await page.locator('aside button', { hasText: 'New' }).click();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: 'test-results/screenshot-packaged-new.png' });

    // Step 2: Type and send
    console.log('[STEP 2] Type and send');
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill('测试打包版');
    await page.locator('button[type="submit"]').click();

    await page.waitForTimeout(20000);

    await page.screenshot({ path: 'test-results/screenshot-packaged-sent.png' });

    // Step 3: Check sidebar
    console.log('[STEP 3] Check sidebar');
    const sidebarText = await page.locator('aside').textContent() ?? '';
    const hasThread = sidebarText.includes('测试打包版');
    console.log(`[VERIFY] Sidebar has thread: ${hasThread}`);
    expect(hasThread).toBe(true);

    // Step 4: Navigate back and click thread
    console.log('[STEP 4] Navigate back and click');
    await page.locator('aside button', { hasText: 'New' }).click();
    await page.waitForTimeout(2000);

    const threadItem = page.locator('[data-testid^="thread-item-"]').filter({ hasText: '测试打包版' });
    const visible = await threadItem.isVisible({ timeout: 10000 });
    console.log(`[VERIFY] Thread item visible: ${visible}`);
    if (visible) {
      await threadItem.click();
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'test-results/screenshot-packaged-final.png' });
    }
  });
});