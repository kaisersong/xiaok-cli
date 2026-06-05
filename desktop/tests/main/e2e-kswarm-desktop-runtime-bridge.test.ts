import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

import { createDesktopServices } from '../../electron/desktop-services.js';
import {
  createKSwarmRuntimeBridge,
  createKSwarmRuntimeBridgeBrokerClient,
  submitKSwarmRuntimeResultToBroker,
} from '../../electron/kswarm-runtime-bridge.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';

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
    getStatus: () => ({ running: true, port: Number(new URL(baseUrl).port), pid: 1, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {},
    request: async (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init),
  };
}

function emitReceipt(input: { sessionId: string; emitRuntimeEvent: (event: any) => void }, note: string): void {
  input.emitRuntimeEvent({
    type: 'receipt_emitted',
    sessionId: input.sessionId,
    turnId: 'turn_1',
    intentId: 'intent_1',
    stepId: 'step_1',
    note,
  });
}

function parseArtifactDir(prompt: string): string {
  const line = prompt.split('\n').find(item => item.startsWith('产物目录：'));
  const dir = line?.replace('产物目录：', '').trim();
  if (!dir) throw new Error('artifact_dir_missing_in_prompt');
  return dir;
}

describe('e2e: kswarm uses desktop runtime bridge for PO and worker execution', () => {
  let tempRoot: string;
  let tempHome: string;
  let tempWorkFolder: string;

  beforeEach(() => {
    const baseDir = join('/tmp', 'xwk-runtime-e2e');
    mkdirSync(baseDir, { recursive: true });
    tempRoot = mkdtempSync(join(baseDir, 'run-'));
    tempHome = join(tempRoot, 'home');
    tempWorkFolder = join(tempRoot, 'workspace');
    mkdirSync(tempHome, { recursive: true });
    mkdirSync(tempWorkFolder, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(tempRoot, 'config');
  });

  afterEach(() => {
    delete process.env.XIAOK_CONFIG_DIR;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('plans, dispatches, executes, reviews, and synthesizes without KSwarm executing agent work itself', async () => {
    const brokerPort = await reservePort();
    const brokerUrl = `http://127.0.0.1:${brokerPort}`;
    let kswarmUrl = '';
    const dataRoot = join(tempRoot, 'desktop-data');
    const workerArtifactPath = join(tempWorkFolder, 'artifacts', 'e2e-runtime-bridge-report.md');

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
    let kswarm: StartedProcess | null = null;

    const clients: Array<{ stop(): void }> = [];
    try {
      await waitForCondition(
        () => fetchJson<{ ok: boolean }>(`${brokerUrl}/health`),
        (value) => value.ok === true,
        20_000,
      );
      const startedKSwarm = await startKSwarmForE2E({ brokerUrl, tempHome });
      kswarm = startedKSwarm.kswarm;
      kswarmUrl = startedKSwarm.kswarmUrl;

      const kswarmService = createKSwarmHttpService(kswarmUrl);
      const services = createDesktopServices({
        dataRoot,
        kswarmService,
        now: () => Date.now(),
        runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
          if (prompt.includes('KSwarm PO 规划任务')) {
            emitReceipt({ sessionId, emitRuntimeEvent }, JSON.stringify({
              analysis: '用一个 worker 任务生成可验收报告，再由 PO 做收尾。',
              successCriteria: ['产出 markdown 报告', 'PO 验收通过', '项目有正式小结'],
              phases: [{
                id: 'phase-1',
                name: '执行与交付',
                items: [{
                  id: 'item-1',
                  title: '撰写端到端验证报告',
                  brief: '生成一份中文 markdown 报告，证明 desktop runtime bridge 能完成 KSwarm worker 任务。',
                  assignedAgent: 'xiaok-worker',
                  dependencies: [],
                  acceptanceCriteria: '报告必须包含目标、过程、结果三部分。',
                  requiredOutputs: ['markdown'],
                }],
              }],
            }));
            return;
          }

          if (prompt.includes('KSwarm 项目任务执行')) {
            const artifactsDir = parseArtifactDir(prompt);
            mkdirSync(artifactsDir, { recursive: true });
            writeFileSync(workerArtifactPath, [
              '# 端到端验证报告',
              '',
              '## 目标',
              '',
              '验证 KSwarm 只负责项目调度，实际 PO 与 Worker 执行都通过 xiaok desktop runtime bridge 完成。',
              '',
              '## 过程',
              '',
              '项目创建后由 PO 生成结构化计划，用户审批后 KSwarm 派发任务，desktop worker 读取 handoff 文件并写入本报告。',
              '',
              '## 结果',
              '',
              '报告文件已经写入项目 artifacts 目录，后续由 PO 进行标准验收并触发项目小结。',
            ].join('\n'));
            emitRuntimeEvent({
              type: 'artifact_recorded',
              sessionId,
              turnId: 'turn_1',
              intentId: 'intent_1',
              stageId: 'stage_1',
              artifactId: 'artifact_1',
              label: 'e2e-runtime-bridge-report.md',
              kind: 'markdown',
              path: workerArtifactPath,
            });
            emitReceipt({ sessionId, emitRuntimeEvent }, '端到端验证报告已生成。');
            return;
          }

          if (prompt.includes('KSwarm PO 验收任务提交')) {
            emitReceipt({ sessionId, emitRuntimeEvent }, JSON.stringify({
              passed: true,
              feedback: '产物包含目标、过程、结果，且存在 markdown 文件证据。',
              failureClass: null,
              planRevisionNeeded: false,
            }));
            return;
          }

          if (prompt.includes('KSwarm 项目收尾')) {
            emitReceipt({ sessionId, emitRuntimeEvent }, [
              '# 项目小结',
              '',
              '本项目已经完成计划、派发、执行、验收和交付收尾。最终产物位于 artifacts 目录，可直接查看。',
            ].join('\n'));
            return;
          }

          emitReceipt({ sessionId, emitRuntimeEvent }, 'ok');
        },
      });
      const runtimeBridge = {
        ...createKSwarmRuntimeBridge({
          allowedRoots: [join(tempHome, '.kswarm', 'handoff-packages')],
          runDesktopTask: (input) => services.runKSwarmHandoffTask(input),
          submitResult: (input) => submitKSwarmRuntimeResultToBroker({
            brokerUrl,
            participantId: 'xiaok-desktop',
            logicalParticipantId: input.targetParticipantId || 'xiaok-worker',
            projectId: input.projectId,
            taskId: input.taskId,
            runId: input.runId,
            result: input.result,
          }),
        }),
        handleAssignPo: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmAssignPo(input),
        handleReviewSubmission: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReviewSubmission(input),
        handlePlanApproved: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmPlanApproved(input),
        handleReadinessProbe: (input: { payload: Record<string, unknown>; targetParticipantId?: string }) => services.runKSwarmReadinessProbe(input),
      };
      const desktopHostClient = createKSwarmRuntimeBridgeBrokerClient({
        brokerUrl,
        participantId: 'xiaok-desktop',
        participantKind: 'service',
        alias: 'Xiaok Desktop',
        roles: ['desktop_runtime_host'],
        capabilities: ['planning', 'review', 'writing', 'reporting'],
        bridge: runtimeBridge,
        WebSocketImpl: WebSocket as any,
      });
      await desktopHostClient.start();
      clients.push(desktopHostClient);

      await waitForCondition(
        () => fetchJson<{ participants: Array<{ participantId: string }> }>(`${brokerUrl}/participants`),
        (value) => {
          const ids = new Set(value.participants.map(participant => participant.participantId));
          return ids.has('xiaok-desktop');
        },
        10_000,
      );

      const created = await fetchJson<{
        ok: boolean;
        project: { id: string; poAgent: string; members: string[]; status: string; workFolder?: string };
      }>(`${kswarmUrl}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'E2E Desktop Runtime Bridge',
          goal: '验证 KSwarm 项目通过 xiaok desktop runtime 完成端到端闭环',
          requirements: '输出中文 markdown 报告，并在完成后写项目小结。',
          poAgent: 'xiaok-po',
          members: ['xiaok-worker'],
          workFolder: tempWorkFolder,
        }),
      });
      expect(created.ok).toBe(true);

      const planned = await waitForCondition(
        () => fetchJson<{
          plan: { phases?: Array<{ items?: Array<{ assignedAgent?: string }> }> } | null;
          tasks: Array<{ assignedAgent?: string }>;
          project: { status: string; workFolder?: string };
        }>(`${kswarmUrl}/projects/${created.project.id}`),
        (value) => Boolean(value.plan?.phases?.length) && value.tasks.length === 1,
        20_000,
      );
      expect(planned.project.status).toBe('planning');
      expect(planned.project.workFolder).toBe(tempWorkFolder);
      expect(planned.tasks[0]?.assignedAgent).toBe('xiaok-worker');

      await fetchJson(`${kswarmUrl}/projects/${created.project.id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      const delivered = await waitForCondition(
        () => fetchJson<{
          project: { status: string; summary?: string | null };
          tasks: Array<{ status: string; result?: { artifacts?: Array<{ path?: string; filename?: string }> } }>;
          workspace: { artifacts: Array<{ filename: string }> };
        }>(`${kswarmUrl}/projects/${created.project.id}`),
        (value) => value.project.status === 'delivered' && value.tasks.every(task => task.status === 'done'),
        30_000,
      );

      expect(delivered.workspace.artifacts.map(artifact => artifact.filename)).toEqual(expect.arrayContaining([
        'plan-v1.md',
        'e2e-runtime-bridge-report.md',
        'synthesis.md',
      ]));
      expect(existsSync(workerArtifactPath)).toBe(true);
      expect(readFileSync(workerArtifactPath, 'utf8')).toContain('desktop runtime bridge');

      const participants = await fetchJson<{ participants: Array<{ participantId: string }> }>(`${brokerUrl}/participants`);
      const participantIds = participants.participants.map(participant => participant.participantId);
      expect(participantIds).toEqual(expect.arrayContaining(['kswarm-hub', 'xiaok-desktop']));
      expect(participantIds).not.toEqual(expect.arrayContaining(['xiaok-po', 'xiaok-worker']));
      expect(participantIds.some(id => id.startsWith('xiaok-po@proj-'))).toBe(false);
      expect(participantIds.some(id => id.startsWith('xiaok-worker@inst-'))).toBe(false);
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.stack || error.message : String(error),
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
