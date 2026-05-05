// Test switching between different threads
import { _electron as electron } from '@playwright/test';

async function main() {
  console.log('[TEST] Starting app...');
  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
  });

  const page = app.windows()[0];
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[ChatShell]') || text.includes('[api-bridge]')) {
      console.log(`[BROWSER] ${text}`);
    }
  });
  page.on('pageerror', err => console.log(`[ERROR] ${err.message}`));

  await page.waitForTimeout(3000);

  // Create first thread
  console.log('[TEST] Creating thread 1...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(1000);
  await page.locator('textarea').fill('第一个会话 AAA');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(12000);
  console.log('[TEST] Thread 1 created');
  await page.screenshot({ path: 'test-results/switch-1.png' });

  // Navigate to welcome
  console.log('[TEST] Navigate to welcome...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  // Create second thread
  console.log('[TEST] Creating thread 2...');
  await page.locator('textarea').fill('第二个会话 BBB');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(12000);
  console.log('[TEST] Thread 2 created');
  await page.screenshot({ path: 'test-results/switch-2.png' });

  // Now click on thread 1 (the first one in sidebar, which should be thread 2 since newest first)
  // Actually sidebar shows newest first, so first item = thread 2, second item = thread 1
  console.log('[TEST] Navigate to welcome again...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  // Get all thread items
  const threadItems = page.locator('[data-testid^="thread-item-"]');
  const count = await threadItems.count();
  console.log(`[TEST] Found ${count} thread items`);

  // Click the SECOND thread item (older one = thread 1 with "AAA")
  console.log('[TEST] Clicking second thread item (older thread)...');
  if (count >= 2) {
    const olderThread = threadItems.nth(1);  // Second item = older = thread 1
    const olderText = await olderThread.textContent() ?? '';
    console.log(`[TEST] Older thread text: ${olderText}`);
    await olderThread.click();
    await page.waitForTimeout(5000);

    console.log(`[TEST] URL: ${page.url()}`);
    const mainContent = await page.locator('main').textContent() ?? '';
    console.log(`[TEST] Main content: ${mainContent.slice(0, 400)}`);

    // Check if we see "AAA" (thread 1 content) or wrong content
    const hasAAA = mainContent.includes('AAA') || mainContent.includes('第一个');
    const hasBBB = mainContent.includes('BBB') || mainContent.includes('第二个');
    console.log(`[TEST] Has AAA (correct): ${hasAAA}`);
    console.log(`[TEST] Has BBB (wrong): ${hasBBB}`);

    if (hasAAA && !hasBBB) {
      console.log('[PASS] Correct thread content loaded');
    } else if (hasBBB) {
      console.log('[FAIL] Wrong thread content - loaded thread 2 instead of thread 1');
    } else {
      console.log('[UNKNOWN] Cannot determine - might be empty/loading');
    }
  } else {
    console.log('[ERROR] Not enough thread items');
  }

  await page.screenshot({ path: 'test-results/switch-3.png' });
  await app.close();
  console.log('[TEST] Done');
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});