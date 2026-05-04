// Comprehensive E2E test for xiaok Desktop
// Run with: npx playwright test --config=playwright.e2e.config.ts

import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

test.describe('xiaok Desktop E2E', () => {

  test.beforeAll(async () => {
    electronApp = await electron.launch({ args: ['.'], cwd: process.cwd() });
    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[CONSOLE ERROR] ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    await electronApp.close().catch(() => {});
  });

  test('3.1 App startup - WelcomePage', async () => {
    const title = await page.title();
    expect(title).toBe('xiaok');
    const h1 = await page.locator('h1').textContent();
    expect(h1).toContain('What do you want to build?');
  });

  test('3.2 IPC bridge - preload injected', async () => {
    const hasDesktop = await page.evaluate(() => typeof window.xiaokDesktop !== 'undefined');
    expect(hasDesktop).toBe(true);
  });

  // ---- Full user scenario: New → input → sidebar → content → navigate back → click again ----
  test('3.3 Full user scenario: create thread, see in sidebar, navigate, switch back', async () => {
    // Step 1: Go to home
    await page.locator('aside button', { hasText: 'New' }).click();
    await page.waitForTimeout(1000);

    // Verify WelcomePage
    const h1 = await page.locator('h1').textContent();
    expect(h1).toContain('What do you want to build?');

    // Step 2: Type and send a message
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('你好');
    await page.locator('button[type="submit"]').click();

    // Verify navigation to thread page
    await page.waitForURL(/\/t\/.*/, { timeout: 10000 });

    // Wait for task to complete
    await page.waitForTimeout(20000);

    // Step 3: Verify thread appears in sidebar
    await page.waitForTimeout(3000); // extra wait for polling
    const sidebarText = await page.locator('aside').textContent() ?? '';
    const hasThreadInSidebar = sidebarText.includes('你好');
    console.log(`[DEBUG] sidebar has 你好: ${hasThreadInSidebar}`);
    expect(hasThreadInSidebar).toBe(true);

    // Step 4: Navigate back to home
    await page.locator('aside button', { hasText: 'New' }).click();
    await page.waitForTimeout(2000);

    // Verify back on WelcomePage
    const h1Again = await page.locator('h1').textContent();
    expect(h1Again).toContain('What do you want to build?');

    // Step 5: Click the "你好" thread in sidebar
    const threadItem = page.locator('[data-testid^="thread-item-"]').filter({ hasText: '你好' });
    await expect(threadItem).toBeVisible({ timeout: 5000 });
    await threadItem.click();

    // Step 6: Verify we navigated to the thread page
    await page.waitForURL(/\/t\/.*/, { timeout: 10000 });

    // Step 7: Verify content is visible (user message should be there)
    const pageText = await page.locator('body').textContent() ?? '';
    const hasContent = pageText.includes('你好');
    console.log(`[DEBUG] content area has 你好: ${hasContent}`);
    expect(hasContent).toBe(true);

    await page.screenshot({ path: 'test-results/screenshot-thread-navigation.png' });
  });

  // ---- Tool execution test ----
  test('3.4 Send message - tool execution (ls)', async () => {
    await page.locator('aside button', { hasText: 'New' }).click();
    await page.waitForTimeout(1000);

    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.fill('列出当前目录的文件');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/t\/.*/, { timeout: 10000 });
    await page.waitForTimeout(30000);

    const pageText = await page.locator('body').textContent() ?? '';
    const hasFileListing = pageText.includes('package.json') || pageText.includes('src');
    expect(hasFileListing).toBe(true);
  });

  // ---- Skills test ----
  test('3.5 Skills IPC works', async () => {
    const skills = await page.evaluate(() => window.xiaokDesktop.listSkills());
    expect(Array.isArray(skills)).toBe(true);
    expect(skills.length).toBeGreaterThan(0);
    console.log(`[DEBUG] skills loaded: ${skills.length}`);
  });

  // ---- File upload button exists ----
  test('3.6 File upload button exists', async () => {
    const plusBtn = page.locator('button[type="button"]').filter({ has: page.locator('svg') });
    const count = await plusBtn.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});