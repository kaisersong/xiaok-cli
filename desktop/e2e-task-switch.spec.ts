import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';

test.describe('Task switching', () => {
  test('sidebar shows "最近" label and selection state', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const recentLabel = page.locator('text=最近');
    await expect(recentLabel).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'test-results/sidebar-recent-label.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });

  test('selected task has bold styling', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();

    if (itemCount >= 2) {
      const firstThread = threadItems.first();
      await firstThread.click();
      await page.waitForTimeout(2000);

      const firstTitle = await firstThread.locator('span').first().innerText();

      const secondThread = threadItems.nth(1);
      await secondThread.click();
      await page.waitForTimeout(2000);

      const firstStillBold = await firstThread.evaluate(el => el.classList.contains('font-semibold'));
      const secondBold = await secondThread.evaluate(el => el.classList.contains('font-semibold'));

      expect(firstStillBold).toBe(false);
      expect(secondBold).toBe(true);

      await page.screenshot({ path: 'test-results/task-selection-styling.png' });
    } else {
      console.log(`[SKIP] Only ${itemCount} threads, need at least 2`);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('task content loads correctly for threads with real tasks', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();
    const testCount = Math.min(itemCount, 10);

    let threadsWithContent = 0;
    let matchCount = 0;

    if (testCount >= 2) {
      for (let i = 0; i < testCount; i++) {
        const thread = threadItems.nth(i);
        const sidebarTitle = await thread.locator('span').first().innerText();

        await thread.click();
        await page.waitForTimeout(2000);

        const userBubbles = page.locator('[data-role="user"]');
        const bubbleCount = await userBubbles.count();

        if (bubbleCount > 0) {
          threadsWithContent++;
          const firstMsg = await userBubbles.first().innerText();
          const titleMatch = firstMsg.includes(sidebarTitle) || sidebarTitle.includes(firstMsg.slice(0, 40));
          if (titleMatch) matchCount++;
          console.log(`[THREAD ${i}] sidebar="${sidebarTitle}" firstMsg="${firstMsg.slice(0, 50)}" match=${titleMatch}`);
        } else {
          console.log(`[THREAD ${i}] EMPTY — sidebar="${sidebarTitle}"`);
        }
      }
    }

    console.log(`\n[SUMMARY] ${testCount} tested, ${threadsWithContent} with content, ${matchCount} matching`);

    // All threads with content must match their sidebar title (no 串)
    if (threadsWithContent > 0) {
      expect(matchCount).toBe(threadsWithContent);
    }

    await page.screenshot({ path: 'test-results/task-content-10-threads.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });

  test('rapid task switching does not cause content mix', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();

    if (itemCount >= 3) {
      // Rapid switching
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 3; i++) {
          await threadItems.nth(i).click();
          await page.waitForTimeout(300);
        }
      }

      await page.waitForTimeout(2000);

      // Now click thread 0 and verify content
      const thread0 = threadItems.first();
      const title0 = await thread0.locator('span').first().innerText();
      await thread0.click();
      await page.waitForTimeout(2000);

      const userBubbles = page.locator('[data-role="user"]');
      if (await userBubbles.count() > 0) {
        const firstMsg = await userBubbles.first().innerText();
        const titleMatch = firstMsg.includes(title0) || title0.includes(firstMsg.slice(0, 40));
        console.log(`[RAPID] After rapid switching, thread 0: sidebar="${title0}" firstMsg="${firstMsg.slice(0, 60)}" match=${titleMatch}`);
        expect(titleMatch).toBe(true);
      }

      await page.screenshot({ path: 'test-results/rapid-task-switch.png' });
    } else {
      console.log(`[SKIP] Only ${itemCount} threads, need at least 3`);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });

  test('switching between threads shows different content', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));

    const threadItems = page.locator('[data-testid^="thread-item-"]');
    const itemCount = await threadItems.count();

    if (itemCount >= 2) {
      // Click thread 0
      await threadItems.first().click();
      await page.waitForTimeout(2000);
      const userBubbles0 = page.locator('[data-role="user"]');
      const content0 = (await userBubbles0.count()) > 0 ? await userBubbles0.first().innerText() : '';

      // Click thread 1
      await threadItems.nth(1).click();
      await page.waitForTimeout(2000);
      const userBubbles1 = page.locator('[data-role="user"]');
      const content1 = (await userBubbles1.count()) > 0 ? await userBubbles1.first().innerText() : '';

      // Content should be different (different threads)
      if (content0 && content1) {
        console.log(`[DIFF] Thread 0: "${content0.slice(0, 40)}" | Thread 1: "${content1.slice(0, 40)}"`);
        // Different threads should show different content
        expect(content0).not.toBe(content1);
      }

      await page.screenshot({ path: 'test-results/thread-content-diff.png' });
    } else {
      console.log(`[SKIP] Only ${itemCount} threads, need at least 2`);
    }

    await app.close();
    expect(errors.length).toBe(0);
  });
});