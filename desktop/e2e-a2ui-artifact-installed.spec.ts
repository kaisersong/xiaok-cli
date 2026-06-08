import { test, expect, chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CDP_URL = process.env.XIAOK_E2E_CDP_URL ?? 'http://127.0.0.1:9222';
const CONFIG_ROOT = process.env.XIAOK_CONFIG_DIR ?? join(homedir(), '.xiaok');
const INSTALLED_APP_EXECUTABLE = process.env.XIAOK_E2E_APP_PATH ?? '/Applications/xiaok.app/Contents/MacOS/xiaok';
const INSTALLED_RENDER_UI_MODULE = '/Applications/xiaok.app/Contents/Resources/app.asar/dist/main/src/ai/tools/render-ui.js';
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
    const request = indexedDB.open('xiaok-desktop');
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

function runInstalledRenderUiTool(input: Record<string, unknown>): {
  artifactPath: string;
  componentCount: number;
  mimeType: string;
  payloadSize: string;
} {
  const script = `
    (async () => {
      const { createRenderUiTool } = await import(${JSON.stringify(INSTALLED_RENDER_UI_MODULE)});
      const tool = createRenderUiTool({ cwd: ${JSON.stringify(CONFIG_ROOT)}, allowOutsideCwd: true });
      const result = await tool.execute(${JSON.stringify(input)}, { session: { sessionId: ${JSON.stringify(String(input.task_id ?? 'installed-e2e'))} } });
      console.log(result);
    })().catch((error) => {
      console.error(error && error.stack ? error.stack : String(error));
      process.exit(1);
    });
  `;
  const stdout = execFileSync(INSTALLED_APP_EXECUTABLE, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = stdout.trim().split('\n').at(-1);
  if (!line) throw new Error('installed dashboard tool returned no stdout');
  const parsed = JSON.parse(line);
  return {
    artifactPath: String(parsed.artifactPath),
    componentCount: Number(parsed.componentCount),
    mimeType: String(parsed.mimeType),
    payloadSize: String(parsed.payloadSize),
  };
}

test.describe('A2UI artifact replay in installed xiaok.app', () => {
  test('turns a natural dashboard request into an interactive view in the running Applications build', async () => {
    const suffix = `${Date.now()}`;
    const title = `Applications A2UI complex dashboard ${suffix}`;
    const taskId = `task-a2ui-applications-complex-${suffix}`;
    const threadId = `thread-a2ui-applications-complex-${suffix}`;
    const now = Date.now();
    const sections = [
      { kind: 'heading', text: title, level: 1 },
      { kind: 'text', content: '覆盖产品情报、风险、下一步动作和执行优先级，验证复杂看板请求能生成可直接查看的交互式结果。' },
      { kind: 'metric', label: '追踪产品', value: 12, change: '+4' },
      { kind: 'metric', label: '高优先级信号', value: 5, change: '+2' },
      { kind: 'metric', label: '待跟进事项', value: 7, change: '-1' },
      { kind: 'divider' },
      { kind: 'heading', text: '本周核心观察', level: 2 },
      {
        kind: 'list',
        items: [
          '把高优先级信号转成项目任务。',
          '对有交互价值的报告优先做成可直接查看的看板。',
          '保留原始数据在 artifact 中，工具步骤只展示摘要。',
        ],
      },
      {
        kind: 'table',
        columns: ['产品', '信号', '优先级', '下一步'],
        rows: [
          ['Alpha Code', 'IDE 工作流增强', 'P0', '创建跟进任务'],
          ['Beta Search', '研究型摘要升级', 'P1', '补充样例'],
          ['Gamma Canvas', '多模态画布协作', 'P1', '设计对比页'],
          ['Delta Agent', '后台任务恢复', 'P2', '观察稳定性'],
        ],
      },
      { kind: 'text', content: '结论：优先验证 P0 信号，并把 A2UI 看板作为交互式交付物回放。' },
    ];
    const outputPath = join(CONFIG_ROOT, 'artifacts', `applications-a2ui-complex-${suffix}.a2ui.json`);
    const input = {
      title,
      output_path: outputPath,
      task_id: taskId,
      data: {
        source: 'installed-app-e2e',
        scenario: 'complex dashboard prompt',
        generatedAt: new Date(now).toISOString(),
      },
      sections,
    };
    const ack = runInstalledRenderUiTool(input);
    expect(ack.mimeType).toBe(A2UI_MIME_TYPE);
    expect(ack.artifactPath).toBe(outputPath);
    expect(ack.componentCount).toBe(sections.length + 1);
    const artifactMessages = JSON.parse(readFileSync(ack.artifactPath, 'utf8'));
    expect(Array.isArray(artifactMessages)).toBe(true);
    expect(JSON.stringify(artifactMessages)).toContain('Alpha Code');
    expect(JSON.stringify(artifactMessages)).toContain('高优先级信号');

    writeTaskSnapshot(CONFIG_ROOT, {
      taskId,
      sessionId: `sess-a2ui-applications-complex-${suffix}`,
      status: 'completed',
      prompt: '帮我做一个复杂的只读 AI 产品动态运营看板，能在小 K 里直接查看。内容要包含标题、说明、多个指标、列表、表格和结论，不要只给我一段文字。',
      materials: [],
      events: [
        { type: 'task_started', taskId },
        {
          type: 'canvas_tool_call',
          toolName: DASHBOARD_TOOL_NAME,
          input,
          displayInputSummary: `[A2UI] ${title} - ${sections.length} sections, ${ack.payloadSize}`,
          toolUseId: `tool-render-ui-complex-${suffix}`,
          eventId: `event-render-ui-complex-${suffix}`,
          ts: now - 2000,
        },
        {
          type: 'canvas_tool_result',
          toolName: DASHBOARD_TOOL_NAME,
          toolUseId: `tool-render-ui-complex-${suffix}`,
          ok: true,
          response: JSON.stringify({ ok: true, artifactPath: ack.artifactPath, mimeType: A2UI_MIME_TYPE }),
          eventId: `event-render-ui-result-complex-${suffix}`,
          ts: now - 1500,
        },
        {
          type: 'artifact_recorded',
          artifactId: `artifact-a2ui-applications-complex-${suffix}`,
          kind: 'a2ui',
          label: `applications-a2ui-complex-${suffix}.a2ui.json`,
          filePath: ack.artifactPath,
          previewAvailable: true,
          turnId: `turn-a2ui-applications-complex-${suffix}`,
          creator: `tool:${DASHBOARD_TOOL_NAME}`,
          mimeType: A2UI_MIME_TYPE,
        },
        { type: 'result', result: { summary: '复杂 A2UI 看板已生成并验证。', artifacts: [] } },
      ],
      result: { summary: '复杂 A2UI 看板已生成并验证。', artifacts: [] },
      createdAt: now - 3000,
      updatedAt: now - 1000,
    });

    const browser = await chromium.connectOverCDP(CDP_URL);
    try {
      const context = browser.contexts()[0];
      const page = context.pages().find((candidate) => candidate.url().includes('app.asar/dist/renderer/index.html'))
        ?? context.pages()[0]
        ?? await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.bringToFront();
      await page.waitForLoadState('domcontentloaded');
      await seedThread(page, {
        id: threadId,
        title,
        status: 'completed',
        mode: 'work',
        createdAt: now - 5000,
        updatedAt: now,
        starred: false,
        gtdBucket: 'inbox',
        pinnedAt: null,
        currentTaskId: taskId,
        taskIds: [taskId],
      });

      await page.evaluate((id) => {
        window.location.hash = `#/t/${id}`;
      }, threadId);

      await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('覆盖产品情报、风险、下一步动作和执行优先级')).toBeVisible();
      await expect(page.getByText('追踪产品')).toBeVisible();
      await expect(page.getByText('12', { exact: true })).toBeVisible();
      await expect(page.getByText('高优先级信号').first()).toBeVisible();
      await expect(page.getByText('5', { exact: true })).toBeVisible();
      await expect(page.getByText('待跟进事项')).toBeVisible();
      await expect(page.getByText('7', { exact: true })).toBeVisible();
      await expect(page.getByText('本周核心观察')).toBeVisible();
      await expect(page.getByText('把高优先级信号转成项目任务。')).toBeVisible();
      await expect(page.getByRole('cell', { name: 'Alpha Code' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'IDE 工作流增强' })).toBeVisible();
      await expect(page.getByRole('cell', { name: 'P0' })).toBeVisible();
      await expect(page.getByRole('cell', { name: '创建跟进任务' })).toBeVisible();
      await expect(page.getByText('结论：优先验证 P0 信号')).toBeVisible();
      await expect(page.getByText(`[A2UI] ${title} - ${sections.length} sections, ${ack.payloadSize}`)).toBeVisible();
      await expect(page.getByRole('button', { name: new RegExp(`✓\\s+${DASHBOARD_TOOL_NAME}`) })).toHaveCount(0);
      await expect(page.getByRole('button', { name: new RegExp(`✓\\s+dashboard\\s+\\[A2UI\\]\\s+${title}`) })).toBeVisible();
      await expect(page.getByText('payloadBytes')).toHaveCount(0);
      await expect(page.getByText('output_path')).toHaveCount(0);

      await page.screenshot({ path: 'test-results/a2ui-artifact-installed-applications.png' });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
