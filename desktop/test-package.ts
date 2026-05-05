// Simpler test for packaged app
import { _electron as electron, chromium } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

async function main() {
  console.log('[TEST] Launching packaged app...');
  const electronApp = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    args: [],
  });

  // Wait for windows
  await electronApp.waitForEvent('window');
  const page = electronApp.windows()[0];

  console.log(`[TEST] Page URL: ${page.url()}`);

  page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning' || msg.text().includes('ChatShell')) {
      console.log(`[CONSOLE ${msg.type()}] ${msg.text()}`);
    }
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'test-results/debug-1-start.png' });

  // Check initial state
  const urlBefore = page.url();
  console.log(`[TEST] URL before: ${urlBefore}`);

  // Click New button
  console.log('[TEST] Clicking New...');
  const newBtn = page.locator('button', { hasText: 'New' });
  await newBtn.click();
  await page.waitForTimeout(2000);

  const urlAfterNew = page.url();
  console.log(`[TEST] URL after New click: ${urlAfterNew}`);
  await page.screenshot({ path: 'test-results/debug-2-new.png' });

  // Type and submit
  console.log('[TEST] Typing message...');
  const textarea = page.locator('textarea');
  await textarea.fill('test navigation bug 123');
  await page.locator('button[type="submit"]').click();

  console.log('[TEST] Waiting for task response (20s)...');
  await page.waitForTimeout(20000);
  await page.screenshot({ path: 'test-results/debug-3-response.png' });

  // Check sidebar
  console.log('[TEST] Checking sidebar...');
  const sidebarText = await page.locator('aside').textContent() ?? '';
  console.log(`[TEST] Sidebar (200 chars): ${sidebarText.slice(0, 200)}`);

  // Navigate away
  console.log('[TEST] Navigate to welcome...');
  await newBtn.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/debug-4-welcome.png' });

  // Find and click thread
  console.log('[TEST] Finding thread item...');
  const threadItems = page.locator('[data-testid^="thread-item-"]');
  const count = await threadItems.count();
  console.log(`[TEST] Found ${count} thread items`);

  if (count > 0) {
    const firstThread = threadItems.first();
    const threadText = await firstThread.textContent() ?? '';
    console.log(`[TEST] First thread text: ${threadText}`);

    console.log('[TEST] Clicking first thread...');
    await firstThread.click();
    await page.waitForTimeout(3000);

    const urlAfterThread = page.url();
    console.log(`[TEST] URL after thread click: ${urlAfterThread}`);
    await page.screenshot({ path: 'test-results/debug-5-thread-click.png' });

    // Check main content
    console.log('[TEST] Checking main content...');
    const mainText = await page.locator('main').textContent() ?? '';
    console.log(`[TEST] Main content (500 chars): ${mainText.slice(0, 500)}`);

    // The bug: main shows "Loading..." instead of messages
    const hasLoading = mainText.toLowerCase().includes('loading');
    const hasUserMsg = mainText.includes('test navigation bug') || mainText.includes('123');

    console.log(`\n[RESULT] Has "Loading": ${hasLoading}`);
    console.log(`[RESULT] Has user message: ${hasUserMsg}`);

    if (hasLoading && !hasUserMsg) {
      console.log('[BUG CONFIRMED] Clicking thread shows Loading... instead of content');
    } else if (hasUserMsg) {
      console.log('[BUG FIXED] Thread navigation works correctly!');
    } else {
      console.log('[UNKNOWN STATE] Cannot determine bug status');
    }
  } else {
    console.log('[ERROR] No thread items found in sidebar');
  }

  await electronApp.close();
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});