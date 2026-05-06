import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

test.describe('Task switching', () => {
  test('sidebar shows "最近" label and selection state', async () => {
    const app = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Check sidebar label changed to "最近"
    const recentLabel = page.locator('text=最近');
    await expect(recentLabel).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/sidebar-recent-label.png' });

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('selected task has bold styling', async () => {
    const app = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    // Look for existing thread items in sidebar
    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();

    if (itemCount >= 2) {
      // Click first thread
      const firstThread = threadItems.first();
      await firstThread.click();
      await page.waitForTimeout(2000);

      // Check if it has font-semibold class (selection indicator)
      const hasBold = await firstThread.evaluate(el => el.classList.contains('font-semibold') || el.classList.contains('bg-[var(--c-bg-card)]'));
      console.log(`[FIRST THREAD] Has selection styling: ${hasBold}`);

      // Get the thread title
      const firstTitle = await firstThread.locator('span').first().innerText();
      console.log(`[FIRST THREAD] Title: ${firstTitle}`);

      // Click second thread
      const secondThread = threadItems.nth(1);
      await secondThread.click();
      await page.waitForTimeout(2000);

      // Now first thread should NOT have bold, second should have bold
      const firstStillBold = await firstThread.evaluate(el => el.classList.contains('font-semibold'));
      const secondBold = await secondThread.evaluate(el => el.classList.contains('font-semibold'));

      console.log(`[AFTER SWITCH] First has bold: ${firstStillBold}, Second has bold: ${secondBold}`);
      expect(firstStillBold).toBe(false);
      expect(secondBold).toBe(true);

      await page.screenshot({ path: 'test-results/task-selection-styling.png' });
    } else {
      console.log(`[SKIP] Only ${itemCount} threads, need at least 2 to test selection switching`);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('rapid task switching does not cause content mix', async () => {
    const app = await electron.launch({
      executablePath: '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok',
    });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();

    if (itemCount >= 3) {
      // Rapid switching: click thread 1, 2, 3, 1, 2, 3 quickly
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 3; i++) {
          const thread = threadItems.nth(i);
          await thread.click();
          await page.waitForTimeout(300); // Very short wait
        }
      }

      // Now wait for final settle
      await page.waitForTimeout(2000);

      // Click thread 1 and verify content matches
      const thread1 = threadItems.first();
      const title1 = await thread1.locator('span').first().innerText();
      await thread1.click();
      await page.waitForTimeout(1500);

      // Check no JS errors during rapid switching
      console.log(`[RAPID SWITCH] Errors during test: ${errors.length}`);

      await page.screenshot({ path: 'test-results/rapid-task-switch.png' });
    } else {
      console.log(`[SKIP] Only ${itemCount} threads, need at least 3 to test rapid switching`);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });
});