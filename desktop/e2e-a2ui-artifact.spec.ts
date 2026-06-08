import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const APP_PATH = process.env.XIAOK_E2E_APP_PATH
  ?? join(process.cwd(), 'release/mac-arm64/xiaok.app/Contents/MacOS/xiaok');
const ELECTRON_BINARY_PATH = process.env.XIAOK_E2E_ELECTRON_BINARY;
const A2UI_MIME_TYPE = 'application/vnd.xiaok.a2ui+json';
const DASHBOARD_TOOL_NAME = ['render', 'ui'].join('_');

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

function writeA2uiArtifact(root: string): string {
  const surfaceId = 'a2ui-task-a2ui-replay-tool-render-ui';
  const artifactPath = join(root, 'artifacts', 'ops-replay.a2ui.json');
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify([
    { version: 1, createSurface: { surfaceId, catalogId: 'xiaok-safe', root: 'root' } },
    {
      version: 1,
      updateComponents: {
        surfaceId,
        components: [
          { id: 'root', component: 'Column', children: ['heading', 'metric', 'table'] },
          { id: 'heading', component: 'Text', text: 'A2UI replay dashboard', variant: 'h1' },
          { id: 'metric', component: 'MetricCard', label: 'Latency', value: { path: 'metrics.metric.value' }, change: '-12%' },
          { id: 'table', component: 'Table', columns: ['Name', 'State'], rows: { path: 'tables.table.rows' } },
        ],
      },
    },
    {
      version: 1,
      updateDataModel: {
        surfaceId,
        path: '',
        value: {
          metrics: { metric: { value: '128 ms' } },
          tables: { table: { rows: [['Renderer', 'ok']] } },
        },
      },
    },
  ]), 'utf8');
  return artifactPath;
}

test.describe('A2UI artifact replay', () => {
  let configRoot: string;
  let app: ElectronApplication;

  test.beforeEach(async () => {
    configRoot = mkdtempSync(join(tmpdir(), 'xiaok-a2ui-artifact-'));
    const now = Date.now();
    const artifactPath = writeA2uiArtifact(configRoot);

    writeTaskSnapshot(configRoot, {
      taskId: 'task-a2ui-replay',
      sessionId: 'sess-a2ui',
      status: 'completed',
      prompt: '生成 A2UI 运营看板',
      materials: [],
      events: [
        { type: 'task_started', taskId: 'task-a2ui-replay' },
        {
          type: 'canvas_tool_call',
          toolName: DASHBOARD_TOOL_NAME,
          input: { title: 'A2UI replay dashboard', sectionCount: 3, payloadBytes: 256, redacted: true },
          displayInputSummary: '[A2UI] A2UI replay dashboard - 3 sections, 256 B',
          toolUseId: 'tool-render-ui',
          eventId: 'event-render-ui',
          ts: now - 2000,
        },
        {
          type: 'canvas_tool_result',
          toolName: DASHBOARD_TOOL_NAME,
          toolUseId: 'tool-render-ui',
          ok: true,
          response: JSON.stringify({ ok: true, artifactPath, mimeType: A2UI_MIME_TYPE }),
          eventId: 'event-render-ui-result',
          ts: now - 1500,
        },
        {
          type: 'artifact_recorded',
          artifactId: 'artifact-a2ui-replay',
          kind: 'a2ui',
          label: 'ops-replay.a2ui.json',
          filePath: artifactPath,
          previewAvailable: true,
          turnId: 'turn-a2ui',
          creator: `tool:${DASHBOARD_TOOL_NAME}`,
          mimeType: A2UI_MIME_TYPE,
        },
        { type: 'result', result: { summary: '已生成 A2UI 运营看板。', artifacts: [] } },
      ],
      result: { summary: '已生成 A2UI 运营看板。', artifacts: [] },
      createdAt: now - 3000,
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

  test('renders a recorded A2UI artifact inline after thread replay', async () => {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.waitForLoadState('domcontentloaded');
    await seedThread(page, {
      id: 'thread-a2ui-replay',
      title: 'A2UI replay e2e',
      status: 'completed',
      mode: 'work',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now(),
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-a2ui-replay',
      taskIds: ['task-a2ui-replay'],
    });

    await page.evaluate(() => {
      window.location.hash = '#/t/thread-a2ui-replay';
    });

    await expect(page.getByRole('heading', { name: 'A2UI replay dashboard' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Latency')).toBeVisible();
    await expect(page.getByText('128 ms')).toBeVisible();
    await expect(page.getByText('-12%')).toBeVisible();
    await expect(page.getByText('Renderer')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'ok' })).toBeVisible();
    await expect(page.getByText('[A2UI] A2UI replay dashboard - 3 sections, 256 B')).toBeVisible();
    await expect(page.getByText('payloadBytes')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/a2ui-artifact-replay.png' });
    expect(errors).toEqual([]);
  });
});
