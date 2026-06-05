import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

import {
  REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE,
  createKSwarmRunDynamicWorkflowScriptTool,
} from '../../electron/kswarm-dynamic-workflow-script-tool.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmWorkflowNodeResultToBroker,
} from '../../electron/kswarm-runtime-bridge.js';

interface StartedProcess {
  child: ChildProcess;
  stop(): Promise<void>;
  logs(): string;
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
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }, 2_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill();
      });
    },
    logs() {
      return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    },
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${init?.method || 'GET'} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return await response.json() as T;
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
      if (predicate(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    lastError
      ? `condition not met within ${timeoutMs}ms: ${String(lastError)}`
      : `condition not met within ${timeoutMs}ms: ${JSON.stringify(lastValue)}`,
  );
}

async function startKSwarmForE2E(input: {
  brokerUrl: string;
  tempHome: string;
}): Promise<{ kswarm: StartedProcess; kswarmUrl: string }> {
  let lastLogs = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const kswarmPort = await reservePort();
    const kswarmUrl = `http://127.0.0.1:${kswarmPort}`;
    const kswarm = startNodeProcess(
      join(__dirname, '..', '..', '..', '..', 'kswarm'),
      ['src/server/index.js'],
      {
        ...process.env,
        BROKER_URL: input.brokerUrl,
        KSWARM_PORT: String(kswarmPort),
        HOME: input.tempHome,
        USERPROFILE: input.tempHome,
      },
    );
    try {
      await waitForCondition(
        () => fetchJson<{ ok: boolean; brokerConnected: boolean }>(`${kswarmUrl}/health`),
        (value) => value.ok === true && value.brokerConnected === true,
        10_000,
      );
      return { kswarm, kswarmUrl };
    } catch (error) {
      lastLogs = kswarm.logs();
      await kswarm.stop();
      if (lastLogs.includes('EADDRINUSE')) continue;
      throw error;
    }
  }
  throw new Error(`failed to start kswarm after port retries\n${lastLogs}`);
}

function createKSwarmHttpService(baseUrl: string): KSwarmService {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    getStatus: () => ({
      running: true,
      port: Number(new URL(baseUrl).port),
      pid: 1,
      restartCount: 0,
      lastError: null,
    }),
    onStatusChange: () => () => {},
    request: async (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),
  };
}

const workflowScript = REPORT_FINAL_REVIEW_WORKFLOW_SCRIPT_EXAMPLE;

describe('e2e: dynamic workflow script through KSwarm, broker, and desktop runtime bridge', () => {
  let tempRoot: string;
  let tempHome: string;
  let tempWorkFolder: string;

  beforeEach(() => {
    const baseDir = join(tmpdir(), 'xwk-e2e');
    mkdirSync(baseDir, { recursive: true });
    tempRoot = mkdtempSync(join(baseDir, 'run-'));
    tempHome = join(tempRoot, 'home');
    tempWorkFolder = join(tempRoot, 'workspace');
    mkdirSync(tempHome, { recursive: true });
    mkdirSync(tempWorkFolder, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates dynamic agent nodes and completes the script-generated workflow run', async () => {
    const brokerPort = await reservePort();
    const brokerUrl = `http://127.0.0.1:${brokerPort}`;
    const seenPrompts: string[] = [];
    let kswarm: StartedProcess | null = null;

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
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
    );
    const clients: Array<{ stop(): void }> = [];

    try {
      await waitForCondition(
        () => fetchJson<{ ok: boolean }>(`${brokerUrl}/health`),
        (value) => value.ok === true,
        20_000,
      );
      const startedKSwarm = await startKSwarmForE2E({ brokerUrl, tempHome });
      kswarm = startedKSwarm.kswarm;
      const kswarmUrl = startedKSwarm.kswarmUrl;
      const kswarmService = createKSwarmHttpService(kswarmUrl);

      const bridge = createKSwarmRuntimeBridge({
        runDesktopTask: async () => {
          throw new Error('unexpected_task_handoff');
        },
        runWorkflowNode: async ({ handoff }) => {
          const prompt = String(handoff.input?.prompt ?? '');
          seenPrompts.push(prompt);
          if (prompt.startsWith('读取报告、产物清单和用户要求')) {
            return {
              output: {
                summary: '报告交付物包含 HTML/PDF 目标，需复核事实、证据和交付合同。',
                prompt,
                evidenceRefs: ['requirements.md: 用户要求交付正式报告'],
              },
            };
          }
          if (prompt.includes('事实准确性复核')) {
            return { output: { summary: '事实复核通过', prompt, evidenceRefs: ['sources.md: 事实来源已核对'] } };
          }
          if (prompt.includes('证据链')) {
            return { output: { summary: '证据复核通过', prompt, evidenceRefs: ['sources.md: 引用日期可追溯'] } };
          }
          if (prompt.includes('格式、目标文件类型和交付合同')) {
            return { output: { summary: '格式合同复核通过', prompt, evidenceRefs: ['contract.md: HTML/PDF 交付合同满足'] } };
          }
          mkdirSync(join(tempWorkFolder, 'artifacts'), { recursive: true });
          writeFileSync(
            join(tempWorkFolder, 'artifacts', 'workflow-report.html'),
            '<!doctype html><html><head><meta charset="utf-8"><title>动态 Workflow 报告</title></head><body><h1>动态 Workflow 报告</h1><p>三路并行复核已通过。</p></body></html>\n',
          );
          writeFileSync(
            join(tempWorkFolder, 'artifacts', 'workflow-report.pdf'),
            '%PDF-1.4\n% xiaok dynamic workflow e2e pdf artifact\n',
          );
          return {
            output: {
              summary: '报告通过 final gate，HTML/PDF 产物已生成。',
              prompt,
              artifacts: [
                { path: 'artifacts/workflow-report.html', label: 'HTML 报告', type: 'report_html', mimeType: 'text/html' },
                { path: 'artifacts/workflow-report.pdf', label: 'PDF 报告', type: 'pdf', mimeType: 'application/pdf' },
              ],
              evidenceRefs: [
                'artifacts/workflow-report.html: E2E HTML 交付物',
                'artifacts/workflow-report.pdf: E2E PDF 交付物',
              ],
            },
          };
        },
        submitResult: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
        submitWorkflowNodeResult: (input) => submitKSwarmWorkflowNodeResultToBroker({
          brokerUrl,
          participantId: 'xiaok-desktop',
          logicalParticipantId: input.targetParticipantId || 'xiaok-worker',
          handoff: input.handoff,
          output: input.output,
          reviewDecision: input.reviewDecision,
        }),
      });
      const desktopHostClient = createKSwarmRuntimeBridgeBrokerClient({
        brokerUrl,
        participantId: 'xiaok-desktop',
        participantKind: 'service',
        alias: 'Xiaok Desktop',
        roles: ['desktop_runtime_host'],
        capabilities: ['project_diagnosis', 'writing'],
        bridge,
        WebSocketImpl: WebSocket as any,
      });
      await desktopHostClient.start();
      clients.push(desktopHostClient);

      await waitForCondition(
        () => fetchJson<{ participants: Array<{ participantId: string }> }>(`${brokerUrl}/participants`),
        (value) => value.participants.some(participant => participant.participantId === 'xiaok-desktop'),
        10_000,
      );

      const created = await fetchJson<{
        ok: boolean;
        project: { id: string; status: string };
      }>(`${kswarmUrl}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E 动态脚本工作流',
          goal: '验证动态 workflow script 可以通过真实 KSwarm 和 broker 跑完',
          requirements: '不依赖外部 LLM，使用桌面 runtime bridge 模拟 worker 输出。',
          poAgent: 'xiaok-po',
          members: ['xiaok-worker'],
          workFolder: tempWorkFolder,
          executionMode: 'workflow',
          autoStartPlanning: false,
        }),
      });
      expect(created.ok).toBe(true);
      await fetchJson(`${kswarmUrl}/projects/${created.project.id}/tasks/human`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tasks: [
            { title: '等待动态 workflow 覆盖完成的任务', assignedAgent: 'xiaok-worker', requiredOutputs: ['report_html'] },
          ],
        }),
      });

      const tool = createKSwarmRunDynamicWorkflowScriptTool(kswarmService);
      const output = JSON.parse(await tool.execute({
        projectId: created.project.id,
        script: workflowScript,
        requestedBy: 'e2e',
        assignedAgent: 'xiaok-worker',
      })) as {
        ok: boolean;
        status: string;
        workflowRunId: string;
        backgroundJob?: { status?: string };
        workflowRun: {
          nodes?: Array<{ id: string; status: string; output?: unknown; parallelGroupId?: string | null }>;
          parallelGroups?: Array<{ id: string; status: string; completedCount: number }>;
        };
      };

      expect(output.ok).toBe(true);
      expect(output.status).toBe('running');
      expect(output.backgroundJob?.status).toBe('running');
      expect(output.workflowRunId).toMatch(/^wf-/);

      const completedRun = await waitForCondition(
        () => fetchJson<{
          workflowRun: {
            status: string;
            scriptResult?: { summary?: string; artifacts?: Array<{ path?: string; type?: string }>; evidenceRefs?: string[] };
            gateDecision?: { status?: string };
            projectDelivery?: { status?: string };
            nodes?: Array<{ id: string; status: string; output?: unknown; parallelGroupId?: string | null }>;
            parallelGroups?: Array<{ id: string; status: string; completedCount: number }>;
          };
        }>(`${kswarmUrl}/projects/${created.project.id}/workflows/${output.workflowRunId}`),
        (value) => value.workflowRun.status === 'completed',
        20_000,
      );

      const scriptResult = completedRun.workflowRun.scriptResult ?? {};
      expect(scriptResult.summary).toBe('报告通过 final gate，HTML/PDF 产物已生成。');
      expect(scriptResult.artifacts?.map(artifact => artifact.path)).toEqual([
        'artifacts/workflow-report.html',
        'artifacts/workflow-report.pdf',
      ]);
      expect(scriptResult.evidenceRefs).toEqual([
        'artifacts/workflow-report.html: E2E HTML 交付物',
        'artifacts/workflow-report.pdf: E2E PDF 交付物',
      ]);
      expect(completedRun.workflowRun.gateDecision?.status).toBe('passed');
      expect(completedRun.workflowRun.projectDelivery?.status).toBe('delivered');
      expect(seenPrompts.length).toBe(5);
      expect(seenPrompts[0]).toContain('读取报告、产物清单和用户要求');
      expect(seenPrompts.slice(1, 4)).toEqual([
        '基于 报告交付物包含 HTML/PDF 目标，需复核事实、证据和交付合同。 做事实准确性复核，指出事实风险和证据缺口。',
        '从引用、来源、日期和可追溯性角度复核证据链。',
        '从结构、格式、目标文件类型和交付合同角度复核最终产物。',
      ]);
      expect(seenPrompts[4]).toContain('综合三路复核结论：事实复核通过；证据复核通过；格式合同复核通过');

      const nodes = completedRun.workflowRun.nodes ?? [];
      expect(nodes.find(node => node.id === 'script-runtime')?.status).toBe('completed');
      expect(nodes.find(node => node.id === 'script-agent-1')?.status).toBe('completed');
      expect(nodes.find(node => node.id === 'script-agent-2')?.status).toBe('completed');
      expect(nodes.find(node => node.id === 'script-agent-3')?.status).toBe('completed');
      expect(nodes.find(node => node.id === 'script-agent-4')?.status).toBe('completed');
      expect(nodes.find(node => node.id === 'script-agent-5')?.status).toBe('completed');
      expect(completedRun.workflowRun.parallelGroups?.[0]).toMatchObject({
        id: 'script-parallel-1',
        status: 'completed',
        completedCount: 3,
      });
      expect(nodes.filter(node => node.parallelGroupId === 'script-parallel-1').map(node => node.id)).toEqual([
        'script-agent-2',
        'script-agent-3',
        'script-agent-4',
      ]);

      // Part A: the real KSwarm run must persist the script source so the
      // orchestration can be resumed after a desktop/background-job restart.
      const persisted = await fetchJson<{
        workflowRun: { scriptSource?: string; scriptHash?: string };
      }>(`${kswarmUrl}/projects/${created.project.id}/workflows/${output.workflowRunId}`);
      expect(typeof persisted.workflowRun.scriptSource).toBe('string');
      expect(persisted.workflowRun.scriptSource ?? '').toMatch(/^export const meta/);
      expect(persisted.workflowRun.scriptHash ?? '').toMatch(/^[a-f0-9]{64}$/);

      const detail = await fetchJson<{
        project: { status: string; deliverable?: { artifacts?: Array<{ path?: string; label?: string; type?: string }> } | null };
        tasks: Array<{ status: string; result?: { artifacts?: Array<{ path?: string; label?: string; type?: string }> } | null }>;
      }>(`${kswarmUrl}/projects/${created.project.id}`);
      expect(detail.project.status).toBe('delivered');
      expect(detail.project.deliverable?.artifacts?.map(artifact => artifact.path)).toEqual([
        'artifacts/workflow-report.html',
        'artifacts/workflow-report.pdf',
      ]);
      expect(detail.tasks.map(task => task.status)).toEqual(['done']);
      expect(detail.tasks[0].result?.artifacts?.map(artifact => artifact.path)).toEqual([
        'artifacts/workflow-report.html',
        'artifacts/workflow-report.pdf',
      ]);
    } catch (error) {
      let brokerReplay = '';
      try {
        brokerReplay = JSON.stringify(await fetchJson(`${brokerUrl}/events/replay?limit=50`), null, 2);
      } catch (replayError) {
        brokerReplay = `failed to fetch broker replay: ${String(replayError)}`;
      }
      throw new Error([
        error instanceof Error ? error.stack || error.message : String(error),
        '--- desktop bridge seen prompts ---',
        JSON.stringify(seenPrompts, null, 2),
        '--- intent-broker replay ---',
        brokerReplay,
        '--- intent-broker logs ---',
        broker.logs(),
        '--- kswarm logs ---',
        kswarm?.logs() ?? '',
      ].join('\n'));
    } finally {
      for (const client of clients) client.stop();
      await kswarm?.stop();
      await broker.stop();
    }
  }, 90_000);
});
