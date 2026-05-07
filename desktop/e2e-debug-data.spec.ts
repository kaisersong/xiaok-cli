import { test } from '@playwright/test';
import { _electron as electron } from 'playwright';

const APP_PATH = '/Users/song/projects/xiaok-cli/desktop/release/mac-arm64/xiaok.app/Contents/MacOS/xiaok';

test('debug IndexedDB thread data', async () => {
  const app = await electron.launch({ executablePath: APP_PATH });
  const page = await app.firstWindow();
  await page.waitForTimeout(5000);

  // Get all threads from IndexedDB
  const threadsData = await page.evaluate(async () => {
    const DB_NAME = 'xiaok-desktop';
    const THREADS_STORE = 'threads';

    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onerror = () => resolve({ error: request.error?.message });
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(THREADS_STORE, 'readonly');
        const store = tx.objectStore(THREADS_STORE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const threads = getAll.result;
          const summary = threads.map((t: any) => ({
            id: t.id?.slice(0, 8),
            title: t.title?.slice(0, 30) || '(no title)',
            currentTaskId: t.currentTaskId?.slice(0, 12) || 'NULL',
            taskIds: t.taskIds?.length || 0,
          }));
          resolve({ count: threads.length, threads: summary });
        };
        getAll.onerror = () => resolve({ error: getAll.error?.message });
      };
    });
  });

  console.log('\n===== IndexedDB Thread Data =====');
  console.log(JSON.stringify(threadsData, null, 2));

  // Check for duplicate currentTaskId
  const threads = (threadsData as any).threads || [];
  const taskIds = threads.map((t: any) => t.currentTaskId);
  const uniqueTaskIds = new Set(taskIds);
  console.log(`\n===== Analysis =====`);
  console.log(`Total threads: ${threads.length}`);
  console.log(`Unique currentTaskIds: ${uniqueTaskIds.size}`);
  console.log(`Duplicate currentTaskIds: ${taskIds.length - uniqueTaskIds.size}`);

  if (taskIds.length - uniqueTaskIds.size > 0) {
    console.log('\n⚠️  PROBLEM: Multiple threads share the same currentTaskId!');
    const grouped: Record<string, string[]> = {};
    for (const t of threads) {
      if (!grouped[t.currentTaskId]) grouped[t.currentTaskId] = [];
      grouped[t.currentTaskId].push(t.id);
    }
    for (const [taskId, threadIds] of Object.entries(grouped)) {
      if (threadIds.length > 1) {
        console.log(`  taskId=${taskId} used by threads: ${threadIds.join(', ')}`);
      }
    }
  }

  // Check task snapshots directory
  const snapshotsDir = '/Users/song/.xiaok/desktop/tasks/snapshots';
  const fs = require('fs');
  if (fs.existsSync(snapshotsDir)) {
    const files = fs.readdirSync(snapshotsDir);
    console.log(`\n===== Task Snapshots =====`);
    console.log(`Total snapshots: ${files.length}`);
    const snapshotIds = files.map(f => f.replace('.json', '').slice(0, 12));
    console.log(`Snapshot IDs: ${snapshotIds.slice(0, 10).join(', ')}...`);

    // Check which taskIds have no snapshot
    const missingSnapshots = taskIds.filter(id => id !== 'NULL' && !snapshotIds.some(s => s.includes(id)));
    console.log(`TaskIds without snapshot: ${missingSnapshots.length}`);
  }

  await app.close();
});