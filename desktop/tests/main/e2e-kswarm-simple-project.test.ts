import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import type { Config } from '../../../src/types.js';
import { buildManagedXiaokAgentPayload } from '../../electron/managed-xiaok-agent.js';

interface StartedProcess {
  child: ChildProcess;
  stop(): Promise<void>;
  logs(): string;
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

async function reservePort(): Promise<number> {
  const server = createServer((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('failed to reserve local port');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function startNodeProcess(cwd: string, args: string[], env: NodeJS.ProcessEnv): StartedProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return {
    child,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }, 2_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        if (!child.killed) {
          child.kill();
        }
      });
    },
    logs() {
      return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    },
  };
}

async function waitForCondition<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
  intervalMs = 300,
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
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    lastError
      ? `condition not met within ${timeoutMs}ms: ${String(lastError)}`
      : `condition not met within ${timeoutMs}ms: ${JSON.stringify(lastValue)}`,
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method || 'GET'} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
}

async function cleanupKswarmAgents(apiBase: string, homeDir: string): Promise<void> {
  try {
    const list = await fetchJson<{ agents: Array<{ id: string }> }>(`${apiBase}/agents`);
    for (const agent of list.agents) {
      try {
        await fetchJson(`${apiBase}/agents/${agent.id}/stop`, { method: 'POST' });
      } catch {
        // ignore cleanup failures
      }
    }
  } catch {
    // ignore API cleanup failures
  }

  try {
    const agentsPath = join(homeDir, '.kswarm', 'agents.json');
    if (!existsSync(agentsPath)) return;
    const content = JSON.parse(readFileSync(agentsPath, 'utf8')) as { agents?: Array<{ runtimeId?: string }> };
    for (const agent of content.agents ?? []) {
      const match = /^pid-(\d+)$/.exec(agent.runtimeId ?? '');
      if (!match) continue;
      try {
        process.kill(Number(match[1]), 'SIGTERM');
      } catch {
        // ignore stale pids
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

describe('e2e: kswarm simple project with managed xiaok agents', () => {
  let tempRoot: string;
  let tempHome: string;
  let tempWorkFolder: string;

  beforeEach(() => {
    const baseDir = join(process.cwd(), '.tmp', 'kswarm-e2e');
    mkdirSync(baseDir, { recursive: true });
    tempRoot = mkdtempSync(join(baseDir, 'run-'));
    tempHome = join(tempRoot, 'home');
    tempWorkFolder = join(tempRoot, 'workspace');
    mkdirSync(tempHome, { recursive: true });
    mkdirSync(tempWorkFolder, { recursive: true });
    writeFileSync(join(tempWorkFolder, 'README.md'), '# simple project fixture\n', 'utf8');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates a project with PO + worker and produces artifact output end-to-end', async () => {
    const fakeOpenAi = await startFakeOpenAiServer();
    const brokerPort = await reservePort();
    const kswarmPort = await reservePort();
    const brokerUrl = `http://127.0.0.1:${brokerPort}`;
    const kswarmUrl = `http://127.0.0.1:${kswarmPort}`;

    const broker = startNodeProcess(
      join(__dirname, '..', '..', '..', '..', 'intent-broker'),
      ['--experimental-sqlite', 'src/cli.js'],
      {
        ...process.env,
        PORT: String(brokerPort),
        INTENT_BROKER_DB: join(tempRoot, 'intent-broker.db'),
        INTENT_BROKER_DISABLE_CODEX_DISCOVERY: '1',
        INTENT_BROKER_PERSISTED_SESSION_REFRESH_INTERVAL_MS: '0',
        INTENT_BROKER_CONFIG: join(tempRoot, 'intent-broker.config.json'),
        INTENT_BROKER_LOCAL_CONFIG: join(tempRoot, 'intent-broker.local.json'),
        INTENT_BROKER_HEARTBEAT_PATH: join(tempRoot, 'intent-broker.heartbeat.json'),
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    );
    const kswarm = startNodeProcess(
      join(__dirname, '..', '..', '..', '..', 'kswarm'),
      ['src/server/index.js'],
      {
        ...process.env,
        BROKER_URL: brokerUrl,
        KSWARM_API: kswarmUrl,
        KSWARM_PORT: String(kswarmPort),
        WORK_DELAY: '50',
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    );

    try {
      await waitForCondition(
        () => fetchJson<{ ok: boolean }>(`${brokerUrl}/health`),
        (value) => value.ok === true,
        20_000,
      );
      await waitForCondition(
        () => fetchJson<{ ok: boolean; brokerConnected: boolean }>(`${kswarmUrl}/health`),
        (value) => value.ok === true && value.brokerConnected === true,
        20_000,
      );

      const config = makeManagedConfig(fakeOpenAi.baseUrl);
      const poPayload = buildManagedXiaokAgentPayload(
        {
          id: 'xiaok-po',
          name: 'PO-Agent',
          instructions: '负责制定计划、验收结果和项目汇总。',
          roles: ['project_owner'],
        },
        config,
      );
      const workerPayload = buildManagedXiaokAgentPayload(
        {
          id: 'xiaok-worker',
          name: 'Worker-Agent',
          instructions: '负责执行任务并提交高质量 markdown 交付物。',
          roles: ['worker'],
        },
        config,
      );

      expect(poPayload.runtimeType).toBe('xiaok');
      expect(poPayload.provider).toBe('openai');
      expect(poPayload.runtimePath).toBeNull();

      await fetchJson(`${kswarmUrl}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(poPayload),
      });
      await fetchJson(`${kswarmUrl}/agents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(workerPayload),
      });

      const agents = await fetchJson<{ agents: Array<{ id: string; roles?: string[] }> }>(`${kswarmUrl}/agents`);
      expect(agents.agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(['xiaok-po', 'xiaok-worker']));

      const created = await fetchJson<{
        ok: boolean;
        project: { id: string; poAgent: string; members: string[]; status: string };
      }>(`${kswarmUrl}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E 简单项目',
          goal: '生成一份简单但具体的中文测试报告',
          requirements: '所有输出使用中文，并在 artifacts 中产出 markdown 报告。',
          poAgent: 'xiaok-po',
          members: ['xiaok-worker'],
          workFolder: tempWorkFolder,
        }),
      });

      expect(created.ok).toBe(true);
      expect(created.project.poAgent).toBe('xiaok-po');
      expect(created.project.members).toEqual(['xiaok-worker']);

      await waitForCondition(
        () => fetchJson<{ participants: Array<{ participantId: string }> }>(`${kswarmUrl}/participants`),
        (value) => {
          const ids = new Set(value.participants.map((participant) => participant.participantId));
          return ids.has('xiaok-po') && ids.has('xiaok-worker');
        },
        20_000,
      );

      const planned = await waitForCondition(
        () => fetchJson<{
          plan: { phases?: Array<{ items?: Array<{ assignedAgent?: string }> }> } | null;
          tasks: Array<{ assignedAgent?: string }>;
          project: { status: string };
        }>(`${kswarmUrl}/projects/${created.project.id}`),
        (value) => Boolean(value.plan?.phases?.length) && value.tasks.length > 0,
        30_000,
      );
      expect(planned.project.status === 'planning' || planned.project.status === 'created').toBe(true);
      expect(planned.tasks.some((task) => task.assignedAgent === 'xiaok-worker')).toBe(true);

      await fetchJson(`${kswarmUrl}/projects/${created.project.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      const completed = await waitForCondition(
        () => fetchJson<{
          project: { status: string };
          tasks: Array<{ status: string }>;
          workspace: { artifacts: Array<{ filename: string }> };
        }>(`${kswarmUrl}/projects/${created.project.id}`),
        (value) => value.workspace.artifacts.length > 0
          && value.tasks.every((task) => task.status === 'done' || task.status === 'submitted'),
        45_000,
      );

      expect(completed.workspace.artifacts.length).toBeGreaterThan(0);
      expect(completed.project.status === 'active' || completed.project.status === 'delivered').toBe(true);

      const artifactsDir = join(tempWorkFolder, 'artifacts');
      const artifactFiles = completed.workspace.artifacts.map((artifact) => artifact.filename);
      expect(artifactFiles.length).toBeGreaterThan(0);
      const firstArtifact = join(artifactsDir, artifactFiles[0]);
      expect(existsSync(firstArtifact)).toBe(true);
      expect(readFileSync(firstArtifact, 'utf8').length).toBeGreaterThan(120);

      expect(fakeOpenAi.requests.some((prompt) => prompt.includes('制定详细的执行计划') || prompt.includes('Create a detailed execution plan'))).toBe(true);
      expect(fakeOpenAi.requests.some((prompt) => prompt.includes('生成交付报告') || prompt.includes('deliverable report'))).toBe(true);
    } finally {
      await cleanupKswarmAgents(kswarmUrl, tempHome);
      await kswarm.stop();
      await broker.stop();
      await fakeOpenAi.close();
    }
  }, 90_000);
});
