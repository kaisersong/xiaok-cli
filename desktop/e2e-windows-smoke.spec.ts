import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { expect, test } from '@playwright/test';

import { createMcpRuntimeClient } from '../src/ai/mcp/runtime/client.js';
import { createStdioMcpTransport, startMcpServerProcess } from '../src/ai/mcp/runtime/server-process.js';
import type { Config } from '../src/types.js';
import { buildPythonServerEnv } from './electron/python-runtime.js';
import { buildManagedXiaokAgentPayload } from './electron/managed-xiaok-agent.js';
import { createXiaokPoSeed, createXiaokWorkerSeed } from './shared/kswarm-seed-contract.js';

const APP_PATH = join(process.cwd(), 'release', 'win-unpacked', 'xiaok.exe');
const REPORT_FIXTURE = join(
  process.cwd(),
  '..',
  '..',
  'kai-xiaok-plugins',
  'plugins',
  'kai-report-creator',
  'mcp-servers',
  'report-renderer',
  'tests',
  'fixtures',
  'valid-mixed.report.md',
);
const SLIDE_FIXTURE = join(
  process.cwd(),
  '..',
  '..',
  'kai-xiaok-plugins',
  'plugins',
  'kai-slide-creator',
  'mcp-servers',
  'slide-renderer',
  'tests',
  'fixtures',
  'valid-brief.json',
);
const REPORT_PLUGIN_DIR = join(homedir(), '.xiaok', 'plugins', 'kai-report-creator');
const SLIDE_PLUGIN_DIR = join(homedir(), '.xiaok', 'plugins', 'kai-slide-creator');
const MANAGED_PYTHON = join(homedir(), '.xiaok', 'runtime', 'python-env', 'Scripts', 'python.exe');

function closeExistingWindowsDesktop(): void {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('taskkill', ['/IM', 'xiaok.exe', '/F'], { stdio: 'ignore' });
  } catch {
    // Ignore "process not found" and similar cleanup misses.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeManagedConfig(baseUrl: string): Config {
  return {
    schemaVersion: 2,
    defaultProvider: 'openai',
    defaultModelId: 'openai-default',
    providers: {
      openai: {
        type: 'first_party',
        protocol: 'openai_legacy',
        apiKey: 'sk-fake',
        baseUrl,
      },
    },
    models: {
      'openai-default': {
        provider: 'openai',
        model: 'fake-gpt',
        label: 'Fake GPT',
      },
    },
    defaultMode: 'interactive',
    channels: {},
  };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body ? JSON.parse(body) as Record<string, unknown> : {};
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function fakeOpenAiResponse(prompt: string): string {
  if (prompt.includes('只回答 "PASS" 或 "FAIL"') || prompt.includes('Only answer "PASS" or "FAIL"')) {
    return 'PASS';
  }

  if (prompt.includes('验收评估要求') || prompt.includes('Strict JSON (no markdown fences)')) {
    return JSON.stringify({
      passed: true,
      feedback: '交付结果满足项目目标和验收标准，内容完整，具备明确结论与实际细节。',
      planRevisionNeeded: false,
    });
  }

  if (prompt.includes('根据以下验收反馈') || prompt.includes('determine if plan revision is needed')) {
    return JSON.stringify({ needed: false });
  }

  if (prompt.includes('制定详细的执行计划') || prompt.includes('Create a detailed execution plan for this project')) {
    return JSON.stringify({
      analysis: '该项目目标明确，关键在于先形成一份结构完整、可阅读的 markdown 交付物，再由 PO 做质量验收和项目汇总。',
      successCriteria: [
        '形成至少一份具体的 markdown 报告',
        '交付内容使用中文并围绕项目目标展开',
        '项目最终产生可读取的 artifact',
      ],
      phases: [
        {
          id: 'phase-1',
          name: '执行与交付',
          items: [
            {
              id: 'item-1',
              title: '撰写测试报告',
              brief: '围绕项目目标生成一份具体的 markdown 报告，包含摘要、具体工作内容、建议与结论。',
              rationale: '需要产出可交付的核心结果。',
              assignedAgent: 'xiaok-worker',
              dependencies: [],
              acceptanceCriteria: '生成的 markdown 报告不少于 300 字，包含摘要、具体工作内容、建议与结论。',
            },
          ],
        },
      ],
    });
  }

  if (prompt.includes('项目所有任务已完成') || prompt.includes('All tasks are done. Produce a final project synthesis')) {
    return [
      '# 项目汇总',
      '',
      '## 结果概览',
      '',
      '- 已按计划完成任务拆解、执行、验收和汇总。',
      '- 交付物已经写入 artifacts 目录，可供后续预览与复用。',
    ].join('\n');
  }

  if (prompt.includes('请为以下已完成的任务生成交付报告') || prompt.includes('generate a deliverable report')) {
    return [
      '## 摘要',
      '',
      '本次任务已经完成，产出了一份围绕项目目标展开的具体 markdown 报告。',
      '',
      '## 具体工作内容',
      '',
      '1. 梳理项目目标与约束。',
      '2. 形成结构化交付内容。',
      '3. 输出后续建议与注意事项。',
      '',
      '## 技术方案',
      '',
      '- 使用结构化 markdown 组织内容。',
      '- 保持中文输出，便于项目内直接复用。',
      '',
      '## 交付物清单',
      '',
      '- 一份任务报告 markdown 文件。',
      '',
      '## 注意事项',
      '',
      '- 后续可以继续细化为正式汇报材料。',
    ].join('\n');
  }

  return '默认回复';
}

async function startFakeOpenAiServer() {
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const messages = Array.isArray(body.messages) ? body.messages as Array<{ content?: string }> : [];
      const prompt = messages.map((message) => String(message.content ?? '')).join('\n\n');
      requests.push(prompt);
      json(res, 200, {
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        model: body.model ?? 'fake-gpt',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: fakeOpenAiResponse(prompt) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
      return;
    }
    json(res, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to bind fake openai server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function createSmokeEnv(baseUrl: string) {
  const resultsRoot = join(process.cwd(), 'test-results');
  mkdirSync(resultsRoot, { recursive: true });
  const root = mkdtempSync(join(resultsRoot, 'windows-smoke-'));
  const configDir = join(root, 'xiaok-config');
  const workFolder = join(root, 'workspace');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(workFolder, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify(makeManagedConfig(baseUrl), null, 2)}\n`, 'utf8');

  return {
    root,
    workFolder,
    env: {
      ...process.env,
      XIAOK_CONFIG_DIR: configDir,
      INTENT_BROKER_DISABLE_CODEX_DISCOVERY: '1',
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function launchPackagedDesktop(env: NodeJS.ProcessEnv) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const processHandle: ChildProcessWithoutNullStreams = spawn(APP_PATH, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processHandle.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString());
  });
  processHandle.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString());
  });
  return {
    processHandle,
    stdout,
    stderr,
  };
}

function formatProcessLogs(stdout: string[], stderr: string[]): string {
  return [
    stdout.length > 0 ? `STDOUT:\n${stdout.join('')}` : 'STDOUT:<empty>',
    stderr.length > 0 ? `STDERR:\n${stderr.join('')}` : 'STDERR:<empty>',
  ].join('\n');
}

async function waitForCondition<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  errorMessage: string,
  intervalMs = 500,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T | undefined;
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastValue = await probe();
      lastError = undefined;
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(
    lastError
      ? `${errorMessage}: ${String(lastError)}`
      : `${errorMessage}: ${JSON.stringify(lastValue)}`,
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method || 'GET'} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function waitForServiceHealth(
  url: string,
  processHandle: ChildProcessWithoutNullStreams,
  stdout: string[],
  stderr: string[],
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (processHandle.exitCode != null) {
      throw new Error(`packaged app 提前退出，exit=${processHandle.exitCode}\n${formatProcessLogs(stdout, stderr)}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until the service is healthy or the app exits.
    }
    await delay(500);
  }
  throw new Error(`等待服务健康检查超时: ${url}\n${formatProcessLogs(stdout, stderr)}`);
}

async function withMcpClient<T>(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  run: (client: ReturnType<typeof createMcpRuntimeClient>) => Promise<T>,
): Promise<T> {
  const proc = startMcpServerProcess(command, args, { cwd, env });
  const transport = createStdioMcpTransport(proc.child);
  const client = createMcpRuntimeClient(transport);
  try {
    await client.initialize();
    return await run(client);
  } finally {
    transport.dispose();
    proc.dispose();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      proc.child.once('exit', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }
}

function parseJsonText<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

async function verifyBundledPluginRendering(tempRoot: string): Promise<void> {
  expect(existsSync(REPORT_PLUGIN_DIR)).toBe(true);
  expect(existsSync(SLIDE_PLUGIN_DIR)).toBe(true);
  expect(existsSync(MANAGED_PYTHON)).toBe(true);

  const reportManifest = JSON.parse(readFileSync(join(REPORT_PLUGIN_DIR, 'plugin.json'), 'utf8')) as { source?: string };
  const slideManifest = JSON.parse(readFileSync(join(SLIDE_PLUGIN_DIR, 'plugin.json'), 'utf8')) as { source?: string };
  expect(reportManifest.source).toBe('bundled');
  expect(slideManifest.source).toBe('bundled');

  const reportOutputPath = join(tempRoot, 'report-output.html');
  const reportIr = readFileSync(REPORT_FIXTURE, 'utf8');
  const reportBundlePath = join(REPORT_PLUGIN_DIR, 'mcp-servers', 'report-renderer', 'dist', 'server.bundle.js');
  const reportResult = await withMcpClient('node', [reportBundlePath], REPORT_PLUGIN_DIR, undefined, async (client) => {
    const raw = await client.callTool('render_report', {
      ir_content: reportIr,
      output_path: reportOutputPath,
    });
    return parseJsonText<{
      success: boolean;
      validation: { l0_passed: boolean; l1_passed: boolean; l2_passed: boolean };
    }>(raw);
  });
  expect(reportResult.success).toBe(true);
  expect(reportResult.validation).toMatchObject({ l0_passed: true, l1_passed: true, l2_passed: true });
  expect(readFileSync(reportOutputPath, 'utf8')).toContain('<!DOCTYPE html>');

  const slideOutputPath = join(tempRoot, 'slide-output.html');
  const slideBrief = readFileSync(SLIDE_FIXTURE, 'utf8');
  const slideServerPath = join(SLIDE_PLUGIN_DIR, 'mcp-servers', 'slide-renderer', 'server.py');
  const slideResult = await withMcpClient(
    MANAGED_PYTHON,
    [slideServerPath],
    SLIDE_PLUGIN_DIR,
    buildPythonServerEnv(),
    async (client) => {
      const raw = await client.callTool('render_slide', {
        brief_json: slideBrief,
        output_path: slideOutputPath,
      });
      return parseJsonText<{
        success: boolean;
        stats: { html_bytes: number; page_count: number };
        errors?: string[];
      }>(raw);
    },
  );
  expect(slideResult.success).toBe(true);
  expect(slideResult.stats.html_bytes).toBeGreaterThan(1000);
  expect(slideResult.stats.page_count).toBeGreaterThanOrEqual(5);
  expect(slideResult.errors ?? []).toEqual([]);
  expect(readFileSync(slideOutputPath, 'utf8')).toContain('<!DOCTYPE html>');
}

async function verifySimpleProjectLifecycle(workFolder: string): Promise<void> {
  const kswarmUrl = 'http://127.0.0.1:4400';
  const projectName = `SMOKE-${Date.now()}`;

  const agents = await waitForCondition(
    () => fetchJson<{ agents: Array<{ id: string; roles?: string[] }> }>(`${kswarmUrl}/agents`),
    (value) => {
      const ids = new Set(value.agents.map((agent) => agent.id));
      return ids.has('xiaok-po') && ids.has('xiaok-worker');
    },
    45_000,
    '等待种子智能体就绪失败',
  );
  const agentMap = new Map(agents.agents.map((agent) => [agent.id, agent]));
  expect(agentMap.get('xiaok-po')?.roles ?? []).toEqual(expect.arrayContaining(['project_owner']));
  expect(agentMap.get('xiaok-worker')?.roles ?? []).toEqual(expect.arrayContaining(['worker']));

  const created = await fetchJson<{
    ok: boolean;
    project: { id: string; poAgent: string; members: string[] };
  }>(`${kswarmUrl}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      goal: '生成一份简单但具体的中文测试报告',
      requirements: '所有输出使用中文，并在 artifacts 中产出 markdown 报告。',
      poAgent: 'xiaok-po',
      members: ['xiaok-worker'],
      workFolder,
    }),
  });
  expect(created.ok).toBe(true);
  expect(created.project.poAgent).toBe('xiaok-po');
  expect(created.project.members).toEqual(['xiaok-worker']);

  const planned = await waitForCondition(
    () => fetchJson<{
      plan: { phases?: Array<{ items?: Array<{ assignedAgent?: string }> }> } | null;
      tasks: Array<{ assignedAgent?: string }>;
    }>(`${kswarmUrl}/projects/${created.project.id}`),
    (value) => Boolean(value.plan?.phases?.length) && value.tasks.length > 0,
    120_000,
    '等待项目计划生成失败',
  );
  expect(planned.tasks.some((task) => task.assignedAgent === 'xiaok-worker')).toBe(true);

  await fetchJson(`${kswarmUrl}/projects/${created.project.id}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });

  const completed = await waitForCondition(
    () => fetchJson<{
      tasks: Array<{ status: string }>;
      workspace: { artifacts: Array<{ filename: string }> };
      project: { status: string };
    }>(`${kswarmUrl}/projects/${created.project.id}`),
    (value) => value.workspace.artifacts.length > 0
      && value.tasks.every((task) => task.status === 'done' || task.status === 'submitted'),
    180_000,
    '等待项目任务完成并产出 artifacts 失败',
    1_000,
  );

  expect(completed.project.status === 'active' || completed.project.status === 'delivered').toBe(true);
  expect(completed.workspace.artifacts.length).toBeGreaterThan(0);

  const firstArtifact = join(workFolder, 'artifacts', completed.workspace.artifacts[0]!.filename);
  expect(existsSync(firstArtifact)).toBe(true);
  expect(readFileSync(firstArtifact, 'utf8').length).toBeGreaterThan(120);
}

async function ensureSmokeSeedAgents(baseUrl: string): Promise<void> {
  const kswarmUrl = 'http://127.0.0.1:4400';
  const config = makeManagedConfig(baseUrl);
  const desiredAgents = [
    buildManagedXiaokAgentPayload(createXiaokPoSeed(), config),
    buildManagedXiaokAgentPayload(createXiaokWorkerSeed(), config),
  ];

  const current = await fetchJson<{ agents: Array<Record<string, unknown>> }>(`${kswarmUrl}/agents`);
  const currentMap = new Map(current.agents.map((agent) => [String(agent.id), agent]));

  for (const desired of desiredAgents) {
    if (!desired.id) {
      continue;
    }

    const existing = currentMap.get(desired.id);
    if (existing) {
      try {
        await fetchJson(`${kswarmUrl}/agents/${desired.id}/stop`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch {
        // Best effort stop before recreation.
      }
      await fetchJson(`${kswarmUrl}/agents/${desired.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
    }

    await fetchJson(`${kswarmUrl}/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(desired),
    });
  }
}

test.describe('Windows packaged desktop smoke', () => {
  test.skip(process.platform !== 'win32', '仅在 Windows 包装版上执行');
  test.skip(!existsSync(APP_PATH), `未找到桌面程序: ${APP_PATH}`);
  test.skip(!existsSync(REPORT_FIXTURE), `未找到 report fixture: ${REPORT_FIXTURE}`);
  test.skip(!existsSync(SLIDE_FIXTURE), `未找到 slide fixture: ${SLIDE_FIXTURE}`);

  test('packaged desktop can bootstrap plugins and deliver a simple project', async () => {
    test.setTimeout(300_000);

    const fakeOpenAi = await startFakeOpenAiServer();
    const smoke = createSmokeEnv(fakeOpenAi.baseUrl);
    closeExistingWindowsDesktop();
    const launched = launchPackagedDesktop(smoke.env);

    try {
      await waitForServiceHealth('http://127.0.0.1:4318/health', launched.processHandle, launched.stdout, launched.stderr, 45_000);
      await waitForServiceHealth('http://127.0.0.1:4400/health', launched.processHandle, launched.stdout, launched.stderr, 45_000);
      await ensureSmokeSeedAgents(fakeOpenAi.baseUrl);
      await verifyBundledPluginRendering(smoke.root);
      await verifySimpleProjectLifecycle(smoke.workFolder);
    } finally {
      try {
        launched.processHandle.kill();
      } catch {
        // Best effort shutdown.
      }
      closeExistingWindowsDesktop();
      smoke.cleanup();
      await fakeOpenAi.close();
    }
  });
});
