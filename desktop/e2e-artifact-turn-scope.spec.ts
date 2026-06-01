import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_PATH = process.env.XIAOK_E2E_APP_PATH
  ?? join(process.cwd(), 'release/mac-arm64/xiaok.app/Contents/MacOS/xiaok');
const ELECTRON_BINARY_PATH = process.env.XIAOK_E2E_ELECTRON_BINARY;

interface ThreadSeed {
  id: string;
  title: string;
  status: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  gtdBucket: string;
  pinnedAt: number | null;
  currentTaskId: string;
  taskIds: string[];
}

async function seedThread(page: Page, thread: ThreadSeed): Promise<void> {
  await page.evaluate(async (input) => {
    const request = indexedDB.open('xiaok-desktop', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('threads')) {
          const store = db.createObjectStore('threads', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('threads', 'readwrite');
      tx.objectStore('threads').put(input);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, thread);
}

function writeTaskSnapshot(root: string, snapshot: Record<string, unknown>): void {
  const dir = join(root, 'desktop', 'tasks', 'snapshots');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${snapshot.taskId}.json`), JSON.stringify(snapshot, null, 2), 'utf8');
}

test.describe('artifact turn scoping', () => {
  let configRoot: string;
  let app: ElectronApplication;

  test.beforeEach(async () => {
    configRoot = mkdtempSync(join(tmpdir(), 'xiaok-artifact-turn-scope-'));
    const now = Date.now();

    writeTaskSnapshot(configRoot, {
      taskId: 'task-old-completed',
      sessionId: 'sess-old',
      status: 'completed',
      prompt: '第一轮输入',
      materials: [],
      events: [
        { type: 'task_started', taskId: 'task-old-completed' },
        {
          type: 'canvas_tool_call',
          toolName: 'Write',
          input: { file_path: '/tmp/old-turn.md' },
          toolUseId: 'tool-old-write',
          eventId: 'event-old-write',
          ts: now - 4000,
        },
        {
          type: 'canvas_tool_result',
          toolName: 'Write',
          toolUseId: 'tool-old-write',
          ok: true,
          response: 'ok',
          eventId: 'event-old-write-result',
          ts: now - 3000,
        },
        { type: 'result', result: { summary: '第一轮完成', artifacts: [] } },
      ],
      result: { summary: '第一轮完成', artifacts: [] },
      createdAt: now - 5000,
      updatedAt: now - 3000,
    });

    writeTaskSnapshot(configRoot, {
      taskId: 'task-current-running',
      sessionId: 'sess-current',
      status: 'running',
      prompt: '第二轮输入',
      materials: [],
      events: [
        { type: 'task_started', taskId: 'task-current-running' },
        {
          type: 'canvas_tool_call',
          toolName: 'Write',
          input: { file_path: '/tmp/current-turn.pdf' },
          toolUseId: 'tool-current-write',
          eventId: 'event-current-write',
          ts: now - 1000,
        },
      ],
      createdAt: now - 2000,
      updatedAt: now - 1000,
    });

    const userDataArg = `--user-data-dir=${join(configRoot, 'electron-user-data')}`;

    app = await electron.launch({
      executablePath: ELECTRON_BINARY_PATH ?? APP_PATH,
      args: ELECTRON_BINARY_PATH ? [process.cwd(), userDataArg] : [userDataArg],
      cwd: process.cwd(),
      env: {
        ...process.env,
        XIAOK_CONFIG_DIR: configRoot,
        XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
      },
    });
  });

  test.afterEach(async () => {
    await app?.close().catch(() => {});
    rmSync(configRoot, { recursive: true, force: true });
  });

  test('does not render a previous turn generated file under the current running turn', async () => {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.waitForLoadState('domcontentloaded');
    await seedThread(page, {
      id: 'thread-artifact-turn-scope',
      title: 'artifact turn scope e2e',
      status: 'running',
      mode: 'work',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now(),
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-current-running',
      taskIds: ['task-old-completed', 'task-current-running'],
    });

    await page.evaluate(() => {
      window.location.hash = '#/t/thread-artifact-turn-scope';
    });

    const oldFile = page.locator('[data-testid="generated-file-old-turn.md"]');
    const currentPrompt = page.locator('[data-role="user"]').filter({ hasText: '第二轮输入' });

    await expect(currentPrompt).toBeVisible({ timeout: 10_000 });
    await expect(oldFile).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="generated-file-current-turn.pdf"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Thinking...')).toBeVisible();

    const positions = await page.evaluate(() => {
      const oldFile = document.querySelector('[data-testid="generated-file-old-turn.md"]');
      const currentPrompt = Array.from(document.querySelectorAll('[data-role="user"]'))
        .find((element) => element.textContent?.includes('第二轮输入'));
      if (!oldFile || !currentPrompt) {
        return null;
      }
      return {
        oldFileBottom: oldFile.getBoundingClientRect().bottom,
        currentPromptTop: currentPrompt.getBoundingClientRect().top,
      };
    });

    expect(positions).not.toBeNull();
    expect(positions!.oldFileBottom).toBeLessThan(positions!.currentPromptTop);

    await page.screenshot({ path: 'test-results/artifact-turn-scope.png' });
    expect(errors).toEqual([]);
  });
});
