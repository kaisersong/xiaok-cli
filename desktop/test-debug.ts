// Debug test for ChatShell navigation bug
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

let electronApp: ElectronApplication;
let page: Page;

async function main() {
  console.log('[TEST] Launching app...');
  electronApp = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    args: [],
    cwd: '/Users/song/projects/xiaok-cli/desktop',
  });

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3000);

  page.on('pageerror', error => console.log(`[PAGE ERROR] ${error.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
    }
  });

  console.log(`[TEST] Page URL: ${page.url()}`);

  // Step 1: Create a new thread with a message
  console.log('[TEST] Step 1: Creating new thread...');
  await page.screenshot({ path: 'test-debug-1-initial.png' });

  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(1000);

  const textarea = page.locator('textarea');
  await textarea.fill('测试历史会话导航');
  await page.locator('button[type="submit"]').click();

  console.log('[TEST] Waiting for response...');
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'test-debug-2-after-submit.png' });

  // Step 2: Check sidebar for the new thread
  console.log('[TEST] Step 2: Checking sidebar...');
  const sidebar = await page.locator('aside').textContent() ?? '';
  console.log(`[TEST] Sidebar content: ${sidebar.slice(0, 200)}`);
  const hasThread = sidebar.includes('测试历史会话导航');
  console.log(`[TEST] Thread in sidebar: ${hasThread}`);

  // Step 3: Navigate back to welcome page
  console.log('[TEST] Step 3: Navigate back...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-debug-3-welcome.png' });

  // Step 4: Click the thread item in sidebar
  console.log('[TEST] Step 4: Clicking thread item...');
  const threadItem = page.locator('[data-testid^="thread-item-"]').filter({ hasText: '测试历史会话导航' });
  const visible = await threadItem.isVisible({ timeout: 5000 });
  console.log(`[TEST] Thread item visible: ${visible}`);

  if (visible) {
    await threadItem.click();
    await page.waitForTimeout(3000);

    const newUrl = page.url();
    console.log(`[TEST] After click URL: ${newUrl}`);
    await page.screenshot({ path: 'test-debug-4-after-click.png' });

    // Step 5: Check if ChatView shows content
    console.log('[TEST] Step 5: Checking ChatView content...');
    const mainContent = await page.locator('main').textContent() ?? '';
    console.log(`[TEST] Main content: ${mainContent.slice(0, 500)}`);

    // Check for Loading... text
    const isLoading = mainContent.includes('Loading');
    const hasMessages = mainContent.includes('测试历史会话导航') || mainContent.includes('assistant');
    console.log(`[TEST] Is Loading: ${isLoading}`);
    console.log(`[TEST] Has messages: ${hasMessages}`);

    if (isLoading) {
      console.log('[FAIL] Still showing Loading... - thread data not loaded');
    } else if (!hasMessages) {
      console.log('[FAIL] No messages visible - ChatShell not rendering properly');
    } else {
      console.log('[PASS] Navigation works correctly');
    }
  } else {
    console.log('[FAIL] Thread item not visible in sidebar');
  }

  await electronApp.close();
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});