// Test with console capture
import { _electron as electron } from '@playwright/test';

async function main() {
  console.log('[TEST] Starting app...');
  const app = await electron.launch({
    executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
  });

  const page = app.windows()[0];
  console.log(`[TEST] URL: ${page.url()}`);

  // Capture all console messages
  page.on('console', msg => {
    console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/console-1.png' });

  // Click New
  console.log('[TEST] Clicking New...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  // Type and submit
  const textarea = page.locator('textarea');
  await textarea.fill('测试console日志');
  await page.locator('button[type="submit"]').click();
  console.log('[TEST] Submitted, waiting 15s...');
  await page.waitForTimeout(15000);
  await page.screenshot({ path: 'test-results/console-2.png' });

  // Navigate away and back
  console.log('[TEST] Navigate to welcome...');
  await page.locator('aside button', { hasText: 'New' }).click();
  await page.waitForTimeout(2000);

  console.log('[TEST] Click first thread...');
  const threadItem = page.locator('[data-testid^="thread-item-"]').first();
  await threadItem.click();
  await page.waitForTimeout(5000);

  await page.screenshot({ path: 'test-results/console-3.png' });
  console.log(`[TEST] Final URL: ${page.url()}`);

  // Check content
  const mainContent = await page.locator('main').textContent() ?? '';
  console.log(`[TEST] Main content: ${mainContent.slice(0, 300)}`);

  await app.close();
  console.log('[TEST] Done');
}

main().catch(e => {
  console.error('[ERROR]', e);
  process.exit(1);
});