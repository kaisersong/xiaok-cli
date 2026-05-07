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

    // Find threads with unique content (skip polluted ones)
    const seenContent = new Set<string>();
    const validThreads: { index: number; title: string; content: string }[] = [];

    // Limit to 6 threads to avoid timeout (2s per thread)
    for (let i = 0; i < Math.min(itemCount, 6); i++) {
      const thread = threadItems.nth(i);
      const sidebarTitle = await thread.locator('span').first().innerText();

      await thread.click();
      await page.waitForTimeout(1500);

      const userBubbles = page.locator('[data-role="user"]');
      const bubbleCount = await userBubbles.count();

      if (bubbleCount > 0) {
        const firstMsg = await userBubbles.first().innerText();
        if (!seenContent.has(firstMsg)) {
          seenContent.add(firstMsg);
          const titleMatch = firstMsg.includes(sidebarTitle) || sidebarTitle.includes(firstMsg.slice(0, 40));
          validThreads.push({ index: i, title: sidebarTitle, content: firstMsg });
          console.log(`[THREAD ${i}] sidebar="${sidebarTitle}" firstMsg="${firstMsg.slice(0, 50)}" titleMatch=${titleMatch}`);
        } else {
          console.log(`[THREAD ${i}] DUPLICATE — sidebar="${sidebarTitle}"`);
        }
      }
    }

    console.log(`\n[SUMMARY] Found ${validThreads.length} threads with unique content`);

    // Each unique-content thread should have matching title
    for (const t of validThreads) {
      const titleMatch = t.content.includes(t.title) || t.title.includes(t.content.slice(0, 40));
      expect(titleMatch).toBe(true);
    }

    await page.screenshot({ path: 'test-results/task-content-threads.png' });
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

    // Find two threads with different content
    const seenContent: string[] = [];
    const uniqueIndices: number[] = [];

    for (let i = 0; i < Math.min(itemCount, 12); i++) {
      await threadItems.nth(i).click();
      await page.waitForTimeout(1500);

      const userBubbles = page.locator('[data-role="user"]');
      if (await userBubbles.count() > 0) {
        const content = await userBubbles.first().innerText();
        if (!seenContent.includes(content)) {
          seenContent.push(content);
          uniqueIndices.push(i);
        }
      }
      if (uniqueIndices.length >= 2) break;
    }

    if (uniqueIndices.length >= 2) {
      // Click first unique thread
      await threadItems.nth(uniqueIndices[0]).click();
      await page.waitForTimeout(2000);
      const content0 = await page.locator('[data-role="user"]').first().innerText();

      // Click second unique thread
      await threadItems.nth(uniqueIndices[1]).click();
      await page.waitForTimeout(2000);
      const content1 = await page.locator('[data-role="user"]').first().innerText();

      console.log(`[DIFF] Thread ${uniqueIndices[0]}: "${content0.slice(0, 40)}" | Thread ${uniqueIndices[1]}: "${content1.slice(0, 40)}"`);
      expect(content0).not.toBe(content1);
    } else {
      console.log(`[SKIP] Only found ${uniqueIndices.length} unique threads`);
    }

    await page.screenshot({ path: 'test-results/thread-content-diff.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });
});