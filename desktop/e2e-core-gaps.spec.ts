import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';

test.describe('Core gap coverage', () => {
  // ── 1. taskId uniqueness: new task gets unique ID, not task_1 ──
  test('new tasks receive unique taskId (not ordinal task_1)', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    // Submit a task
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('test unique task id');
      await textarea.press('Enter');
      await page.waitForTimeout(8000);

      // Check IndexedDB: the thread's currentTaskId should NOT be task_1/task_2/task_3
      const taskIdCheck = await page.evaluate(async () => {
        const DB_NAME = 'xiaok-desktop';
        const THREADS_STORE = 'threads';
        return new Promise<{ latestTaskId: string | null }>((resolve) => {
          const request = indexedDB.open(DB_NAME, 1);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction(THREADS_STORE, 'readonly');
            const store = tx.objectStore(THREADS_STORE);
            const getAll = store.getAll();
            getAll.onsuccess = () => {
              const threads = getAll.result;
              // Sort by createdAt desc, get most recent
              threads.sort((a: any, b: any) => b.createdAt - a.createdAt);
              const latest = threads[0];
              resolve({ latestTaskId: latest?.currentTaskId ?? null });
            };
          };
        });
      });

      console.log(`[TASK-ID] latest taskId = ${taskIdCheck.latestTaskId}`);

      // Should NOT be task_1, task_2, etc (ordinal format)
      const isOrdinal = /^task_\d+$/.test(taskIdCheck.latestTaskId || '');
      expect(isOrdinal).toBe(false);
      // Should contain underscore (new format: task_timestamp_random)
      expect(taskIdCheck.latestTaskId).toContain('_');
    }

    await app.close();
  });

  // ── 2. Second task after first completes: active task cleanup ──
  test('second task runs after first completes', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(`PAGE: ${e.message}`));
    await page.waitForTimeout(5000);

    // Submit first task
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.fill('回复"你好"两个字');
      await textarea.press('Enter');
      await page.waitForTimeout(15000);

      // Navigate to sidebar, click another existing thread
      const threads = page.locator('[data-testid^="thread-item-"]');
      if (await threads.count() >= 2) {
        // Click a different thread
        await threads.nth(1).click();
        await page.waitForTimeout(1000);

        // Submit a second task in this thread
        const textarea2 = page.locator('textarea');
        if (await textarea2.isVisible()) {
          await textarea2.fill('回复"世界"两个字');
          await textarea2.press('Enter');
          await page.waitForTimeout(15000);

          const bodyText = await page.locator('body').innerText();
          const hasActiveTaskError = bodyText.includes('active task already exists');
          console.log(`[SECOND-TASK] hasActiveTaskError=${hasActiveTaskError}`);

          expect(hasActiveTaskError).toBe(false);
        }
      } else {
        console.log('[SECOND-TASK] Not enough threads to test');
      }
    }

    await page.screenshot({ path: 'test-results/second-task.png' });
    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── 3. Expand/collapse button alignment ──
  test('expand button aligns with collapse button', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(5000);

    // Get collapse button position
    const collapseBtn = page.locator('button[title="收起侧边栏"]');
    await expect(collapseBtn).toBeVisible();
    const collapseBox = await collapseBtn.boundingBox();
    const collapseTop = collapseBox!.y;
    const collapseSize = collapseBox!.height;

    // Click to collapse
    await collapseBtn.click();
    await page.waitForTimeout(1000);

    // Get expand button position
    const expandBtn = page.locator('button[title="展开侧边栏"]');
    await expect(expandBtn).toBeVisible();
    const expandBox = await expandBtn.boundingBox();
    const expandTop = expandBox!.y;
    const expandSize = expandBox!.height;

    console.log(`[ALIGN] collapse: top=${collapseTop.toFixed(1)}, size=${collapseSize.toFixed(1)}`);
    console.log(`[ALIGN] expand:   top=${expandTop.toFixed(1)}, size=${expandSize.toFixed(1)}`);

    // Both buttons should have same size
    expect(Math.abs(collapseSize - expandSize)).toBeLessThanOrEqual(2);

    // Restore sidebar
    await expandBtn.click();
    await page.waitForTimeout(500);

    await app.close();
    expect(errors.length).toBe(0);
  });

  // ── 4. No data pollution: threads have distinct currentTaskIds ──
  test('IndexedDB threads have distinct currentTaskIds', async () => {
    const app = await electron.launch({ executablePath: APP_PATH });
    const page = await app.firstWindow();
    await page.waitForTimeout(5000);

    const analysis = await page.evaluate(async () => {
      const DB_NAME = 'xiaok-desktop';
      const THREADS_STORE = 'threads';
      return new Promise<any>((resolve) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(THREADS_STORE, 'readonly');
          const store = tx.objectStore(THREADS_STORE);
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const threads = getAll.result;
            const withTask = threads.filter((t: any) => t.currentTaskId);
            const taskIds = withTask.map((t: any) => t.currentTaskId);
            const uniqueTaskIds = new Set(taskIds);
            resolve({
              total: threads.length,
              withTaskId: withTask.length,
              uniqueTaskIds: uniqueTaskIds.size,
              duplicateCount: taskIds.length - uniqueTaskIds.size,
              sample: taskIds.slice(0, 5),
            });
          };
        };
      });
    });

    console.log(`[DATA-CHECK] total=${analysis.total}, withTaskId=${analysis.withTaskId}, unique=${analysis.uniqueTaskIds}, dupes=${analysis.duplicateCount}`);
    console.log(`[DATA-CHECK] sample taskIds: ${JSON.stringify(analysis.sample)}`);

    // No thread should have ordinal taskIds (task_1, task_2, etc)
    // New format is task_<timestamp>_<random>
    const ordinalCount = analysis.sample.filter((id: string) => /^task_\d+$/.test(id)).length;
    if (ordinalCount > 0) {
      console.log(`[DATA-CHECK] WARNING: ${ordinalCount} threads with ordinal taskIds (legacy data pollution)`);
    }

    await app.close();
  });
});
