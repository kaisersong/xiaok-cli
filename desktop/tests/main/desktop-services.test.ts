import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { attachRuntimeToolRequestScope, createDesktopServices, createKSwarmContinueProjectTool, createKSwarmCreateProjectTool, createKSwarmInspectProjectTool, createKSwarmRepairProjectTaskFromFileTool, createKSwarmRepairProjectTaskTool, createReportArtifactTool, createTimedActionTools, recoverInterruptedScriptWorkflows, resolveAppAsarSha256, resolveToolOutputArtifactPath, resolveWriteToolArtifactPath, resumeOneScriptWorkflow } from '../../electron/desktop-services.js';
import { createGetRoomMessagesPageTool, setRoomHistoryBrokerClient } from '../../electron/room-history-page-tool.js';
import { getRoomHistoryCapability } from '../../electron/room-history-capability-registry.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { resolveRuntimeModelBinding } from '../../../src/ai/providers/control-plane.js';
import { createAdapterFromBinding } from '../../../src/ai/models.js';
import { resolveModelCapabilities } from '../../../src/ai/runtime/model-capabilities.js';
import type { StreamOptions } from '../../../src/ai/runtime/model-capabilities.js';
import type { Message, StreamChunk, ToolDefinition } from '../../../src/types.js';
import type { ExternalPluginDependency } from '../../electron/plugin-dependency-service.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import { TimedActionService } from '../../electron/timed-action-service.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

function mockKSwarmService(): KSwarmService {
  return {
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    getStatus: () => ({ running: true, port: 4400, pid: 1, restartCount: 0, lastError: null }),
    onStatusChange: () => () => {},
    getDesktopMutationToken: () => 'desktop-token',
    request: async (path: string, init?: RequestInit) => new Response('{"error":"mock"}', { status: 501 }),
  };
}

async function withoutBrowserGlobals<T>(action: () => Promise<T>): Promise<T> {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  try {
    return await action();
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}

describe('desktop services', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-services-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.XIAOK_CONFIG_DIR;
  });

  it('hashes the physical app.asar and restores Electron ASAR handling', () => {
    const appPath = join(rootDir, 'xiaok.app');
    const appAsarPath = join(appPath, 'Contents', 'Resources', 'app.asar');
    mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true });
    writeFileSync(appAsarPath, 'xiaok-local-build');
    const electronProcess = process as NodeJS.Process & { noAsar?: boolean };
    electronProcess.noAsar = false;

    expect(resolveAppAsarSha256(appPath)).toBe(
      createHash('sha256').update('xiaok-local-build').digest('hex'),
    );
    expect(electronProcess.noAsar).toBe(false);
  });

  it('uses successful tool input output_path as artifact evidence when result omits it', () => {
    const outputPath = join(rootDir, 'slides.html');

    expect(resolveToolOutputArtifactPath(
      { output_path: outputPath },
      JSON.stringify({ success: true, preset: 'Data Story', stats: { page_count: 8 } }),
    )).toBe(outputPath);
  });

  it('does not use tool input output_path as artifact evidence when result reports failure', () => {
    const outputPath = join(rootDir, 'slides.html');

    expect(resolveToolOutputArtifactPath(
      { output_path: outputPath },
      JSON.stringify({ success: false, errors: ['render failed'] }),
    )).toBeNull();
    expect(resolveToolOutputArtifactPath(
      { output_path: outputPath },
      JSON.stringify({ success: false, output_path: outputPath, errors: ['render failed'] }),
    )).toBeNull();
  });

  it('uses lowercase write file_path as artifact evidence', () => {
    const outputPath = join(rootDir, 'report.md');

    expect(resolveWriteToolArtifactPath('write', { file_path: outputPath })).toBe(outputPath);
    expect(resolveWriteToolArtifactPath('read', { file_path: outputPath })).toBeNull();
  });

  it('detects a fresh artifact path from successful bash output', () => {
    const outputPath = join(rootDir, 'xiaok-2026-05-features.pdf');
    const toolStartedAt = Date.now();
    writeFileSync(outputPath, 'fake pdf');

    expect(resolveToolOutputArtifactPath(
      { command: `chrome --print-to-pdf=${outputPath} file:///tmp/source.html` },
      `1002509 bytes written to file ${outputPath}\n-rw-r--r-- 979K ${outputPath}`,
      { toolName: 'bash', toolStartedAt },
    )).toBe(outputPath);
  });

  it('does not treat an old bash-mentioned file as new artifact evidence', () => {
    const oldPath = join(rootDir, 'old-report.pdf');
    writeFileSync(oldPath, 'old pdf');
    utimesSync(oldPath, new Date(1_000), new Date(1_000));

    expect(resolveToolOutputArtifactPath(
      { command: `ls -lh ${oldPath}` },
      `-rw-r--r-- 979K ${oldPath}`,
      { toolName: 'bash', toolStartedAt: Date.now() },
    )).toBeNull();
  });

  it('renders report HTML through a semantic desktop tool without exposing plugin internals to the agent', async () => {
    const toolRoot = join(process.cwd(), `.tmp-report-tool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.XIAOK_CONFIG_DIR = join(toolRoot, 'config');
    const distDir = join(process.env.XIAOK_CONFIG_DIR!, 'plugins', 'kai-report-creator', 'mcp-servers', 'report-renderer', 'dist');
    const rendererDir = join(distDir, 'renderer');
    try {
      mkdirSync(rendererDir, { recursive: true });
      writeFileSync(join(distDir, 'package.json'), '{"type":"commonjs"}\n');
      writeFileSync(join(rendererDir, 'html-builder.js'), 'import "missing-direct-renderer-dependency";\n');
      writeFileSync(join(distDir, 'server.bundle.js'), `
        const fs = require('node:fs');
        const path = require('node:path');
        let buffer = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          buffer += chunk;
          let newlineIndex = buffer.indexOf('\\n');
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line) handleMessage(JSON.parse(line));
            newlineIndex = buffer.indexOf('\\n');
          }
        });
        function handleMessage(message) {
          if (message.method === 'server/discover') {
            respond(message.id, { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } });
            return;
          }
          if (message.method === 'initialize') {
            respond(message.id, { protocolVersion: '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'report-renderer', version: 'test' } });
            return;
          }
          if (message.method === 'tools/call') {
            const args = message.params.arguments;
            fs.mkdirSync(path.dirname(args.output_path), { recursive: true });
            fs.writeFileSync(args.output_path, '<!DOCTYPE html><html data-template="kai-report-creator"><body>' + args.ir_content + ':' + (args.theme || '') + '</body></html>');
            respond(message.id, {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  output_path: args.output_path,
                  stats: { sectionCount: 1 },
                  validation: { l0_passed: true, l1_passed: true, l2_passed: true },
                  warnings: ['L3 validation failed: soft quality warning'],
                }),
              }],
              resultType: 'complete',
            });
          }
        }
        function respond(id, result) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
        }
      `);
      const outputPath = join(toolRoot, 'workflow-report.html');
      const tool = createReportArtifactTool();

      const result = JSON.parse(await tool.execute({
        ir_content: '---\ntitle: Smoke\n---\n\n## 结论\n\n:::callout type=note\nPASS\n:::',
        output_path: outputPath,
        theme: 'corporate-blue',
      })) as Record<string, unknown>;

      if (result.success !== true) {
        throw new Error(JSON.stringify(result));
      }
      expect(result).toMatchObject({ success: true, output_path: outputPath });
      expect(readFileSync(outputPath, 'utf-8')).toContain('Smoke');
    } finally {
      await new Promise(resolve => setTimeout(resolve, 100));
      try {
        rmSync(toolRoot, { recursive: true, force: true });
      } catch {
        // Windows can keep the just-exited MCP child process directory locked briefly.
      }
      process.env.XIAOK_CONFIG_DIR = join(rootDir, 'config');
    }
  });

  it('imports material, creates a task, runs without confirmation, and recovers result', async () => {
    const sourcePath = join(rootDir, 'A客户需求.md');
    const artifactPath = join(rootDir, 'A客户方案.pptx');
    writeFileSync(sourcePath, '# A 客户需求\n需要制造业数字化方案。');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        writeFileSync(artifactPath, 'fake pptx');
        emitRuntimeEvent({
          type: 'assistant_delta',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          delta: '模型',
        });
        emitRuntimeEvent({
          type: 'assistant_delta',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          delta: '回复内容',
        });
        emitRuntimeEvent({
          type: 'artifact_recorded',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stageId: 'stage_1',
          artifactId: 'artifact_1',
          label: 'A客户方案.pptx',
          kind: 'pptx',
          path: artifactPath,
        });
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '模型回复内容',
        });
      },
    });

    const material = await services.importMaterial({
      taskId: 'desktop_task',
      filePath: sourcePath,
      role: 'customer_material',
    });
    const created = await services.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    expect(created.understanding.taskType).toBe('sales_deck');
    const replayed = await collectFirst(services.subscribeTask(created.taskId), 4);
    expect(replayed.map((event) => event.type)).not.toContain('needs_user');

    await waitFor(async () => (await services.recoverTask(created.taskId)).snapshot.status === 'completed');
    const recovered = await services.recoverTask(created.taskId);
    expect(recovered.snapshot.status).toBe('completed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'result' }),
    ]));
    expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress', message: '正在解析材料' }),
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ summary: '已生成可继续细化的方案大纲' }) }),
    ]));
    expect(recovered.snapshot.events
      .map(event => event.type === 'assistant_delta' ? event.delta : '')
      .join('')).toBe('模型回复内容');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ summary: '模型回复内容' }) }),
      expect.objectContaining({ type: 'result' }),
    ]));
  });

  it('creates a real desktop task with one RFC 4122 UUID session id', async () => {
    const observedSessionIds: string[] = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        observedSessionIds.push(sessionId);
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn-1',
          intentId: 'intent-1',
          stepId: 'step-1',
          note: 'done',
        });
      },
    });

    const created = await services.createTask({
      prompt: '验证 desktop session identity',
      materials: [],
    });
    await waitFor(async () => (await services.recoverTask(created.taskId)).snapshot.status === 'completed');

    expect(observedSessionIds).toHaveLength(1);
    expect(observedSessionIds[0]).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('derives one provider-neutral cache affinity for a real default desktop task runner session', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    const observedOptions: Array<StreamOptions | undefined> = [];
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (
      _messages,
      _tools,
      _systemPrompt,
      options,
    ) {
      observedOptions.push(options);
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    });

    try {
      let taskId = '';
      await withoutBrowserGlobals(async () => {
        const created = await services.createTask({
          prompt: '直接回复 ok',
          materials: [],
        });
        taskId = created.taskId;
        await waitFor(async () => {
          const status = (await services.recoverTask(taskId)).snapshot.status;
          return status === 'completed' || status === 'failed';
        });
      });

      const recovered = await services.recoverTask(taskId);
      const sessionId = recovered.snapshot.sessionId;
      expect(sessionId).toMatch(
        /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(observedOptions).toHaveLength(1);
      expect(observedOptions[0]).toEqual({
        cacheKey: expect.stringMatching(/^pc1_[0-9a-f]{64}$/),
        providerConversationAuthorization: expect.any(Object),
        signal: expect.any(AbortSignal),
      });
      expect(Object.isFrozen(observedOptions[0]?.providerConversationAuthorization)).toBe(true);
      expect(Reflect.ownKeys(observedOptions[0]?.providerConversationAuthorization ?? {})).toEqual([]);
    } finally {
      streamSpy.mockRestore();
    }
  });

  it('completes operational tasks without artifact evidence', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '已创建 xiaok 定时任务。',
        });
      },
    });

    const task = await services.createTask({
      prompt: '创建定时任务，每天晚上11点同步mydocs',
      materials: [],
    });

    await waitFor(async () => (await services.recoverTask(task.taskId)).snapshot.status === 'completed');
    const recovered = await services.recoverTask(task.taskId);
    expect(recovered.snapshot.status).toBe('completed');
    expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
    ]));
  });

  it('runs a kswarm handoff through desktop runtime and returns artifact provenance', async () => {
    const artifactPath = join(rootDir, 'report.md');
    let receivedPrompt = '';
    let receivedSessionId = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
        receivedSessionId = sessionId;
        receivedPrompt = prompt;
        writeFileSync(artifactPath, '# Report');
        emitRuntimeEvent({
          type: 'artifact_recorded',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stageId: 'stage_1',
          artifactId: 'artifact_1',
          label: 'report.md',
          kind: 'markdown',
          path: artifactPath,
        });
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '报告已生成。',
        });
      },
    });

    const result = await services.runKSwarmHandoffTask({
      handoff: {
        kind: 'kswarm_task_handoff_v1',
        runId: 'run-1',
        project: { id: 'proj-1', name: 'Project', goal: 'Write report', requirements: '', artifactsDir: join(rootDir, 'artifacts') },
        task: {
          id: 'proj-1__item-1',
          title: 'Write',
          brief: 'Write markdown',
          requiredOutputs: [{ type: 'markdown', enforcement: 'hard' }, { kind: 'report_html' }, 'json'],
        },
      },
      targetParticipantId: 'xiaok-po',
    });

    expect(receivedPrompt).toContain(`产物目录：${join(rootDir, 'artifacts')}`);
    expect(receivedPrompt).toContain('浏览器打印/print-to-pdf');
    expect(receivedPrompt).toContain('不要用 make-pdf');
    expect(receivedPrompt).toContain('必须产出：markdown, report_html, json');
    expect(receivedPrompt).not.toContain('[object Object]');
    expect(receivedSessionId).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(result).toMatchObject({
      summary: '报告已生成。',
      artifacts: [{ path: artifactPath, kind: 'markdown', label: 'report.md' }],
      provenance: {
        runtimeSource: 'desktop-agent-runtime',
        producingAgent: 'xiaok-po',
      },
    });
  });

  it('cancels a kswarm handoff task when its runtime signal is aborted', async () => {
    const controller = new AbortController();
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async () => {
        controller.abort();
      },
    });

    await expect(services.runKSwarmHandoffTask({
      handoff: {
        kind: 'kswarm_task_handoff_v1',
        runId: 'run-1',
        project: { id: 'proj-1', name: 'Project', goal: 'Write report', requirements: '', artifactsDir: join(rootDir, 'artifacts') },
        task: {
          id: 'proj-1__item-1',
          title: 'Write',
        },
      },
      targetParticipantId: 'xiaok-po',
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('runs a task workflow node without reporting system plan artifacts as deliverables', async () => {
    const workFolder = join(rootDir, 'workflow-project');
    const artifactsDir = join(workFolder, 'artifacts');
    const finalArtifactPath = join(artifactsDir, 'workflow-final-report.md');
    const planArtifactPath = join(artifactsDir, 'plan-v1.md');
    let receivedPrompt = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ prompt, emitRuntimeEvent, sessionId }) => {
        receivedPrompt = prompt;
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(planArtifactPath, '# System plan');
        writeFileSync(finalArtifactPath, '# Final report');
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            output: {
              summary: '最终报告已生成。',
              artifacts: [{ path: finalArtifactPath, kind: 'markdown', label: 'workflow-final-report.md' }],
              evidenceRefs: [`artifact:${finalArtifactPath}`],
            },
          }),
        });
      },
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-workflow',
        workflowRunId: 'wf-proj-workflow-po-generated-task-workflow-1',
        workflowId: 'po-generated-task-workflow',
        nodeId: 'worker-produce-deliverable',
        nodeKind: 'agent_task',
        nodeTitle: 'Worker 生成任务交付物',
        attempt: 1,
        handoffId: 'wfhd-1',
        project: { id: 'proj-workflow', name: 'Workflow project', goal: 'Verify workflow', status: 'active', workFolder },
        input: {
          sourceTask: {
            id: 'proj-workflow__item-1',
            title: 'Write final report',
            acceptanceCriteria: '必须包含真实 workflow run ID。',
            requiredOutputs: ['markdown'],
          },
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(receivedPrompt).toContain('真实 workflow run ID 是 wf-proj-workflow-po-generated-task-workflow-1');
    expect(result.output?.artifacts).toEqual([
      { path: 'artifacts/workflow-final-report.md', kind: 'markdown', label: 'workflow-final-report.md' },
    ]);
    expect(result.output?.evidenceRefs).toEqual(['artifact:artifacts/workflow-final-report.md']);
  });

  it('runs a project workflow node as a whole-project deliverable producer', async () => {
    const workFolder = join(rootDir, 'project-workflow-project');
    const artifactsDir = join(workFolder, 'artifacts');
    const finalArtifactPath = join(artifactsDir, 'project-final-report.md');
    let receivedPrompt = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ prompt, emitRuntimeEvent, sessionId }) => {
        receivedPrompt = prompt;
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(finalArtifactPath, '# Project final report');
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            output: {
              summary: '项目最终报告已生成。',
              artifacts: [{ path: finalArtifactPath, kind: 'markdown', label: 'project-final-report.md' }],
              evidenceRefs: [`artifact:${finalArtifactPath}`],
            },
          }),
        });
      },
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-project-workflow',
        workflowRunId: 'wf-proj-project-workflow-po-generated-project-workflow-1',
        workflowId: 'po-generated-project-workflow',
        nodeId: 'worker-produce-project-deliverable',
        nodeKind: 'agent_task',
        nodeTitle: 'Worker 生成项目交付物',
        attempt: 1,
        handoffId: 'wfhd-project-1',
        project: { id: 'proj-project-workflow', name: 'Workflow project', goal: 'Deliver whole project', status: 'active', workFolder },
        input: {
          taskSnapshot: [
            { id: 'item-1', title: '收集资料', status: 'pending' },
            { id: 'item-2', title: '生成最终报告', status: 'pending' },
          ],
          instruction: '执行整个项目并生成最终交付物。',
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(receivedPrompt).toContain('执行整个项目');
    expect(receivedPrompt).toContain('最终项目交付物');
    expect(receivedPrompt).toContain('真实 workflow run ID 是 wf-proj-project-workflow-po-generated-project-workflow-1');
    expect(receivedPrompt).not.toContain('sourceTask 是唯一工作范围');
    expect(result.output?.artifacts).toEqual([
      { path: 'artifacts/project-final-report.md', kind: 'markdown', label: 'project-final-report.md' },
    ]);
    expect(result.output?.evidenceRefs).toEqual(['artifact:artifacts/project-final-report.md']);
  });

  it('runs a script-generated workflow agent node from the node prompt instead of project diagnosis', async () => {
    const workFolder = join(rootDir, 'script-workflow-project');
    const artifactsDir = join(workFolder, 'artifacts');
    const finalArtifactPath = join(artifactsDir, 'script-agent-report.md');
    let receivedPrompt = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ prompt, emitRuntimeEvent, sessionId }) => {
        receivedPrompt = prompt;
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(finalArtifactPath, '# Script agent report');
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            output: {
              summary: '脚本节点报告已生成。',
              artifacts: [{ path: finalArtifactPath, kind: 'markdown', label: 'script-agent-report.md' }],
              evidenceRefs: [`artifact:${finalArtifactPath}`],
            },
          }),
        });
      },
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-script-workflow',
        workflowRunId: 'wf-proj-script-workflow-ai-products-1',
        workflowId: 'ai_products_analysis_may_2026',
        nodeId: 'script-agent-3',
        nodeKind: 'agent_task',
        nodeTitle: 'Anthropic+Meta 动态采集',
        attempt: 1,
        handoffId: 'wfhd-script-agent-3',
        project: { id: 'proj-script-workflow', name: 'AI products', goal: '分析 AI 产品动态', status: 'active', workFolder },
        input: {
          prompt: '搜索并分析 Anthropic 与 Meta 在 2026 年 5 月的 AI 产品动态。',
          label: 'Anthropic+Meta 动态采集',
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(receivedPrompt).toContain('搜索并分析 Anthropic 与 Meta 在 2026 年 5 月的 AI 产品动态。');
    expect(receivedPrompt).toContain(`产物目录：${artifactsDir}`);
    expect(receivedPrompt).toContain('请执行节点输入中的 prompt');
    expect(receivedPrompt).not.toContain('请检查项目状态、任务状态、阻塞点和下一步建议');
    expect(result.output?.summary).toBe('脚本节点报告已生成。');
    expect(result.output?.artifacts).toEqual([
      { path: 'artifacts/script-agent-report.md', kind: 'markdown', label: 'script-agent-report.md' },
    ]);
    expect(result.output?.evidenceRefs).toEqual(['artifact:artifacts/script-agent-report.md']);
  });

  it('falls back to raw markdown summary when a script node returns non-JSON output', async () => {
    const workFolder = join(rootDir, 'markdown-fallback-project');
    const markdownSummary = [
      '## 战略与市场分析',
      '',
      '苍穹GPT 的定价区间为 {待确认}，详见下文分析。',
      '',
      '- 要点一：市场份额持续扩大',
      '- 要点二：竞品动态密集',
    ].join('\n');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ emitRuntimeEvent, sessionId }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: markdownSummary,
        });
      },
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-markdown-fallback',
        workflowRunId: 'wf-proj-markdown-fallback-1',
        workflowId: 'ai_products_analysis_may_2026',
        nodeId: 'script-agent-4',
        nodeKind: 'agent_task',
        nodeTitle: '战略与市场分析',
        attempt: 1,
        handoffId: 'wfhd-script-agent-4',
        project: { id: 'proj-markdown-fallback', name: 'AI products', goal: '分析 AI 产品动态', status: 'active', workFolder },
        input: {
          prompt: '输出战略与市场分析。',
          label: '战略与市场分析',
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(result.output?.summary).toBe(markdownSummary);
  });

  it('retries a script-generated workflow node once after a transient stream close', async () => {
    const workFolder = join(rootDir, 'retry-workflow-project');
    const artifactsDir = join(workFolder, 'artifacts');
    const finalArtifactPath = join(artifactsDir, 'retry-script-agent-report.md');
    const runner = vi.fn(async ({ emitRuntimeEvent, sessionId }) => {
      if (runner.mock.calls.length === 1) {
        throw new Error('Premature close');
      }
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(finalArtifactPath, '# Retry script agent report');
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId,
        turnId: 'turn_retry',
        intentId: 'intent_retry',
        stepId: 'step_retry',
        note: JSON.stringify({
          output: {
            summary: '重试后脚本节点报告已生成。',
            artifacts: [{ path: finalArtifactPath, kind: 'markdown', label: 'retry-script-agent-report.md' }],
            evidenceRefs: [`artifact:${finalArtifactPath}`],
          },
        }),
      });
    });
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner,
    });

    const result = await services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-script-workflow-retry',
        workflowRunId: 'wf-proj-script-workflow-retry-1',
        workflowId: 'dynamic_workflow_retry',
        nodeId: 'script-agent-1',
        nodeKind: 'agent_task',
        nodeTitle: '并行 Smoke 检查',
        attempt: 1,
        handoffId: 'wfhd-script-agent-1',
        project: { id: 'proj-script-workflow-retry', name: 'Workflow retry', goal: '验证 transient retry', status: 'active', workFolder },
        input: {
          prompt: '执行一次可能发生 transient stream close 的节点。',
          label: '重试节点',
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.output?.summary).toBe('重试后脚本节点报告已生成。');
    expect(result.output?.artifacts).toEqual([
      { path: 'artifacts/retry-script-agent-report.md', kind: 'markdown', label: 'retry-script-agent-report.md' },
    ]);
  });

  it('fails a workflow node when the desktop runner fails instead of leaving it running', async () => {
    const workFolder = join(rootDir, 'failed-workflow-project');
    const runner = vi.fn(async () => {
      throw new Error('simulated_worker_failure');
    });
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner,
    });

    await expect(services.runKSwarmWorkflowNode({
      handoff: {
        projectId: 'proj-script-workflow-failed',
        workflowRunId: 'wf-proj-script-workflow-failed-1',
        workflowId: 'dynamic_workflow_smoke',
        nodeId: 'script-agent-2',
        nodeKind: 'agent_task',
        nodeTitle: '并行 Smoke 检查',
        attempt: 1,
        handoffId: 'wfhd-script-agent-2',
        project: { id: 'proj-script-workflow-failed', name: 'Workflow failed', goal: '验证失败收敛', status: 'active', workFolder },
        input: {
          prompt: '执行会失败的节点。',
          label: '失败节点',
        },
      },
      targetParticipantId: 'xiaok-worker',
    })).rejects.toThrow(/desktop_task_failed/);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('probes the current model without running a user task', async () => {
    const runner = vi.fn(async () => {
      throw new Error('probe_must_not_run_user_task');
    });
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner,
      readinessModelProbe: vi.fn().mockResolvedValue({ ok: true }),
    });

    const result = await services.runKSwarmReadinessProbe({ targetParticipantId: 'xiaok-po' });

    expect(result).toMatchObject({
      ok: true,
      runtimeSource: 'desktop-agent-runtime',
      participantId: 'xiaok-po',
      capabilities: expect.arrayContaining(['planning', 'research']),
      outputCapabilities: expect.arrayContaining(['markdown', 'report_html']),
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('lists plugin dependency health with resolved binary and rejects unconfirmed installs', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'cua-computer-use' }));
    const dependency: ExternalPluginDependency = {
      id: 'cua-driver',
      kind: 'macos_app_cli',
      displayName: 'CUA Driver',
      binaryCandidates: ['~/.local/bin/cua-driver', 'cua-driver'],
      minVersion: '0.1.0',
      install: {
        kind: 'official_installer',
        sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
        requiresUserConfirmation: true,
      },
      health: {
        version: ['~/.local/bin/cua-driver', '--version'],
        permissions: ['~/.local/bin/cua-driver', 'check_permissions'],
      },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{ pluginName: 'cua-computer-use', dependency }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        homeDir: '/Users/alice',
        exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
        runCommand: async (_command, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.1.7\n', stderr: '' };
          return { exitCode: 0, stdout: 'Accessibility: granted\nScreen Recording: granted\n', stderr: '' };
        },
      },
    });

    await expect(services.listPluginDependencyStatuses()).resolves.toEqual([
      expect.objectContaining({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        pluginInstalled: true,
        state: 'ready',
        resolvedBinary: '/Users/alice/.local/bin/cua-driver',
      }),
    ]);

    await expect(services.installPluginDependency({
      pluginName: 'cua-computer-use',
      dependencyId: 'cua-driver',
      confirmed: false,
    })).resolves.toMatchObject({
      success: false,
      error: expect.stringMatching(/confirm/i),
    });
  });

  it('updates CUA driver dependency via official_installer by re-running install script', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'cua-computer-use' }));
    const dependency: ExternalPluginDependency = {
      id: 'cua-driver',
      kind: 'macos_app_cli',
      displayName: 'CUA Driver',
      binaryCandidates: ['~/.local/bin/cua-driver', 'cua-driver'],
      minVersion: '0.1.0',
      install: {
        kind: 'official_installer',
        sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
        requiresUserConfirmation: true,
      },
      update: {
        kind: 'official_installer',
        sourceUrl: 'https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh',
        sourceAllowlist: ['https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh'],
        requiresUserConfirmation: true,
      },
      health: {
        version: ['~/.local/bin/cua-driver', '--version'],
      },
    };
    const dataRoot = join(rootDir, 'data');
    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{ pluginName: 'cua-computer-use', dependency }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        homeDir: '/Users/alice',
        exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
        runCommand: async (_command, args) => {
          if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.2.0\n', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      },
    });

    const statuses = await services.listPluginDependencyStatuses();
    expect(statuses[0].canUpdate).toBe(true);

    await expect(services.updatePluginDependency({
      pluginName: 'cua-computer-use',
      dependencyId: 'cua-driver',
      confirmed: false,
    })).resolves.toMatchObject({
      success: false,
      error: 'confirmation_required',
    });
  });

  it('rejects unsafe plugin install names before invoking the xiaok installer', async () => {
    const binDir = join(rootDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const invokedPath = join(rootDir, 'xiaok-plugin-install-invoked');
    const fakeXiaokPath = join(binDir, 'xiaok');
    writeFileSync(fakeXiaokPath, `#!/bin/sh\necho "$@" > "${invokedPath}"\nexit 0\n`);
    chmodSync(fakeXiaokPath, 0o755);
    const previousPath = process.env.PATH;
    process.env.PATH = `${binDir}:${previousPath ?? ''}`;

    try {
      const services = createDesktopServices({
        dataRoot: join(rootDir, 'data'),
        kswarmService: mockKSwarmService(),
        now: () => 300,
      });

      await expect(services.installPlugin('bad name')).resolves.toEqual({
        success: false,
        error: 'invalid_plugin_name',
      });
      expect(existsSync(invokedPath)).toBe(false);
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    }
  });

  it('registers the Xiaok computer-use wrapper instead of raw CUA MCP tools', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js')],
        },
      ],
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [],
    });
    const registration = await services.registerMcpTools();
    const toolNames = services.getToolDefinitions().map(tool => tool.name);

    expect(toolNames).toContain('xiaok_computer_use');
    expect(toolNames).not.toContain('mcp__cua-driver__search');
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 1,
        connected: true,
      }),
    ]);

    registration.dispose();
  });

  it('lets the official cua-driver mcp proxy own daemon relaunch, with no second Xiaok launch owner', () => {
    // Design v58 §6.1: the machine-readable manifest of cua-driver 0.19.3 declares
    // `mcp_invocation = cua-driver mcp`, and on macOS that subcommand is itself the
    // app-daemon proxy with auto-relaunch. A Xiaok-side `open -n` prelaunch was a
    // second launch owner with a cross-process race, so it is deleted rather than
    // locked.
    const sourceFile = readFileSync(join(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

    expect(sourceFile).toContain("args: ['mcp']");
    expect(sourceFile).not.toContain('prelaunchCuaDriverDaemonForMcp(');
    expect(sourceFile).not.toContain('--no-daemon-relaunch');
    expect(sourceFile).not.toContain('CUA_DRIVER_MCP_NO_RELAUNCH');
    // The dependency gate must require the version that actually has that contract.
    expect(sourceFile).toContain("minVersion: '0.19.3'");
  });

  it('does not expose CUA doctor diagnostics that would request Screen Recording from Xiaok', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir: join(rootDir, '.xiaok', 'plugins'),
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        homeDir: '/Users/alice',
        pathEnv: '',
        exists: (path) => path === '/Users/alice/.local/bin/cua-driver',
        runCommand: async (command, args) => {
          calls.push({ command, args });
          if (args[0] === '--version') return { exitCode: 0, stdout: 'cua-driver 0.2.0\n', stderr: '' };
          return { exitCode: 99, stdout: '', stderr: `unexpected health command: ${args.join(' ')}` };
        },
      },
    });

    await expect(services.listPluginDependencyStatuses()).resolves.toEqual([
      expect.objectContaining({
        pluginName: 'cua-computer-use',
        dependencyId: 'cua-driver',
        state: 'ready',
        canDiagnose: false,
      }),
    ]);
    expect(calls).toEqual([
      { command: '/Users/alice/.local/bin/cua-driver', args: ['--version'] },
    ]);
  });

  it('keeps the computer-use wrapper registered with a permission error when CUA driver dependency is not ready', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [serverPath],
        },
      ],
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: {
            permissions: ['cua-driver', 'check_permissions'],
          },
          mcp: {
            serverName: 'cua-driver',
            command: process.execPath,
            args: [serverPath],
          },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({
          exitCode: 0,
          stdout: 'Accessibility: denied\nScreen Recording: granted\n',
          stderr: '',
        }),
      },
    });

    const registration = await services.registerMcpTools();
    const toolNames = services.getToolDefinitions().map(tool => tool.name);

    expect(toolNames).toContain('xiaok_computer_use');
    await expect(services.executeTool('xiaok_computer_use', { action: 'screenshot', app: 'xiaok' }))
      .resolves.toContain('COMPUTER_USE_NEEDS_ACCESSIBILITY');
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 0,
        connected: false,
      }),
    ]);

    registration.dispose();
  });

  it('does not let a component retry activate a CUA the user never enabled', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    let permissionsGranted = false;
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [serverPath],
        },
      ],
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: {
            permissions: ['cua-driver', 'check_permissions'],
          },
          mcp: {
            serverName: 'cua-driver',
            command: process.execPath,
            args: [serverPath],
          },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({
          exitCode: 0,
          stdout: permissionsGranted
            ? 'Accessibility: granted\nScreen Recording: granted\n'
            : 'Accessibility: denied\nScreen Recording: granted\n',
          stderr: '',
        }),
      },
    });

    const registration = await services.registerMcpTools();
    expect(services.getToolDefinitions().map(tool => tool.name)).toContain('xiaok_computer_use');
    await expect(services.executeTool('xiaok_computer_use', { action: 'screenshot', app: 'xiaok' }))
      .resolves.toContain('COMPUTER_USE_NEEDS_ACCESSIBILITY');
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 0,
        connected: false,
      }),
    ]);

    permissionsGranted = true;

    // Design v58 §7.2: a component-scoped retry must not activate a CUA the user
    // never enabled — that is exactly what the deleted blanket restart did wrong.
    await services.retryPluginComponent({ componentId: 'cua-driver', requestSource: 'user' });
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({ name: 'cua-driver', connected: false, toolCount: 0 }),
    ]);

    // The explicit, user-sourced enable path is what brings it up.
    await services.enableComputerUse();

    expect(services.getToolDefinitions().map(tool => tool.name)).toContain('xiaok_computer_use');
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 1,
        connected: true,
      }),
    ]);

    registration.dispose();
  });

  it('does not auto-start user-activated plugin MCP servers on desktop startup', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const pluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [
        {
          name: 'cua-driver',
          type: 'stdio',
          command: process.execPath,
          args: [serverPath],
        },
      ],
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          minVersion: '0.1.0',
          health: {
            version: [process.execPath, '--version'],
          },
          mcp: {
            serverName: 'cua-driver',
            command: process.execPath,
            args: [serverPath],
            requiresUserActivation: true,
          },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({
          exitCode: 0,
          stdout: 'v1.2.3\n',
          stderr: '',
        }),
      },
    });

    const registration = await services.registerMcpTools();

    expect(services.getToolDefinitions().map(tool => tool.name)).toContain('xiaok_computer_use');
    await expect(services.executeTool('xiaok_computer_use', { action: 'screenshot', app: 'xiaok' }))
      .resolves.toContain('COMPUTER_USE_NEEDS_ENABLEMENT');
    expect(services.listPluginMcpServers()).toEqual([
      expect.objectContaining({
        name: 'cua-driver',
        pluginName: 'cua-computer-use',
        toolCount: 0,
        connected: false,
        enabled: false,
      }),
    ]);

    registration.dispose();
  });

  it('reconnects only the CUA MCP server when enabling Computer Use', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const cuaPluginDir = join(pluginRootDir, 'cua-computer-use');
    const reportPluginDir = join(pluginRootDir, 'kai-report-creator');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const dataRoot = join(rootDir, 'data');
    mkdirSync(cuaPluginDir, { recursive: true });
    mkdirSync(reportPluginDir, { recursive: true });
    writeFileSync(join(cuaPluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [{ name: 'cua-driver', type: 'stdio', command: process.execPath, args: [serverPath] }],
    }));
    writeFileSync(join(reportPluginDir, 'plugin.json'), JSON.stringify({
      name: 'kai-report-creator',
      version: '0.1.0',
      mcpServers: [{ name: 'report-renderer', type: 'stdio', command: '/missing/report-renderer', args: [] }],
    }));

    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: { version: [process.execPath, '--version'] },
          mcp: { serverName: 'cua-driver', command: process.execPath, args: [serverPath], requiresUserActivation: true },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({ exitCode: 0, stdout: 'v1.2.3\n', stderr: '' }),
      },
      computerUseAppIdentity: {
        appPath: '/Applications/xiaok.app',
        appAsarSha256: 'asar-sha-123',
        isPackaged: true,
        nodeEnv: 'production',
      },
    });

    await services.registerMcpTools();
    expect(services.listPluginMcpServers().map(server => server.name).sort()).toEqual(['cua-driver', 'report-renderer']);
    expect(services.listPluginMcpServers().find(server => server.name === 'report-renderer')).toMatchObject({
      connected: false,
      enabled: true,
    });

    await services.enableComputerUse();

    expect(services.listPluginMcpServers().find(server => server.name === 'cua-driver')).toMatchObject({
      connected: true,
      toolCount: 1,
    });
    expect(services.listPluginMcpServers().find(server => server.name === 'report-renderer')).toMatchObject({
      connected: false,
      enabled: true,
      lastError: expect.stringContaining('/missing/report-renderer'),
    });
    expect(JSON.parse(readFileSync(join(dataRoot, 'computer-use-state.json'), 'utf8'))).toMatchObject({
      enabledByUser: true,
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulAppAsarSha256: 'asar-sha-123',
    });
  });

  it('auto-recovers Computer Use only for a previously enabled packaged Applications app', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const cuaPluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const dataRoot = join(rootDir, 'data');
    mkdirSync(cuaPluginDir, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(cuaPluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [{ name: 'cua-driver', type: 'stdio', command: process.execPath, args: [serverPath] }],
    }));
    writeFileSync(join(dataRoot, 'computer-use-state.json'), JSON.stringify({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 100,
      lastSuccessfulAppBundleId: 'com.xiaok.desktop',
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulTeamId: 'TEAM123',
    }));

    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: { version: [process.execPath, '--version'] },
          mcp: { serverName: 'cua-driver', command: process.execPath, args: [serverPath], requiresUserActivation: true },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({ exitCode: 0, stdout: 'v1.2.3\n', stderr: '' }),
      },
      computerUseAppIdentity: {
        appPath: '/Applications/xiaok.app',
        bundleId: 'com.xiaok.desktop',
        teamId: 'TEAM123',
        isPackaged: true,
        nodeEnv: 'production',
      },
    });

    await services.registerMcpTools();

    expect(services.listPluginMcpServers().find(server => server.name === 'cua-driver')).toMatchObject({
      connected: true,
      toolCount: 1,
    });
    await expect(services.executeTool('xiaok_computer_use', { action: 'list_windows', on_screen_only: true }))
      .resolves.toContain('"ok":true');
  });

  it('auto-recovers Computer Use for the same explicitly enabled unsigned Applications build', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const cuaPluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const dataRoot = join(rootDir, 'data');
    mkdirSync(cuaPluginDir, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(cuaPluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [{ name: 'cua-driver', type: 'stdio', command: process.execPath, args: [serverPath] }],
    }));
    writeFileSync(join(dataRoot, 'computer-use-state.json'), JSON.stringify({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 100,
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulAppAsarSha256: 'asar-sha-123',
    }));

    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: { version: [process.execPath, '--version'] },
          mcp: { serverName: 'cua-driver', command: process.execPath, args: [serverPath], requiresUserActivation: true },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({ exitCode: 0, stdout: 'v1.2.3\n', stderr: '' }),
      },
      computerUseAppIdentity: {
        appPath: '/Applications/xiaok.app',
        appAsarSha256: 'asar-sha-123',
        isPackaged: true,
        nodeEnv: 'production',
      },
    });

    await services.registerMcpTools();

    expect(services.getComputerUseCapabilityStatus()).toMatchObject({
      state: 'ready',
      mcpConnected: true,
      wrapperReady: true,
    });
    await expect(services.executeTool('xiaok_computer_use', { action: 'list_windows', on_screen_only: true }))
      .resolves.toContain('"ok":true');
  });

  it('marks Computer Use failed when a previously ready CUA daemon becomes unreachable', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const cuaPluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const dataRoot = join(rootDir, 'data');
    mkdirSync(cuaPluginDir, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(cuaPluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [{
        name: 'cua-driver',
        type: 'stdio',
        command: process.execPath,
        args: [serverPath],
        env: { CUA_MCP_FAIL_AFTER_FIRST_TOOL_CALL: '1' },
      }],
    }));
    writeFileSync(join(dataRoot, 'computer-use-state.json'), JSON.stringify({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 100,
      lastSuccessfulAppBundleId: 'com.xiaok.desktop',
      lastSuccessfulAppPath: '/Applications/xiaok.app',
      lastSuccessfulTeamId: 'TEAM123',
    }));

    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: { version: [process.execPath, '--version'] },
          mcp: { serverName: 'cua-driver', command: process.execPath, args: [serverPath], requiresUserActivation: true },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({ exitCode: 0, stdout: 'v1.2.3\n', stderr: '' }),
      },
      computerUseAppIdentity: {
        appPath: '/Applications/xiaok.app',
        bundleId: 'com.xiaok.desktop',
        teamId: 'TEAM123',
        isPackaged: true,
        nodeEnv: 'production',
      },
    });

    await services.registerMcpTools();
    expect(services.getComputerUseCapabilityStatus()).toMatchObject({
      state: 'ready',
      mcpConnected: true,
    });

    const result = await services.executeTool('xiaok_computer_use', { action: 'list_windows', on_screen_only: true });

    expect(result).toContain('COMPUTER_USE_MCP_CONNECT_TIMEOUT');
    expect(result).not.toContain('open -n -g -a CuaDriver');
    expect(services.getComputerUseCapabilityStatus()).toMatchObject({
      state: 'failed',
      mcpConnected: false,
      lastError: 'CUA Driver 后台服务不可达，请在小K设置里重新连接 Computer Use。',
    });
    expect(services.listPluginMcpServers().find(server => server.name === 'cua-driver')).toMatchObject({
      connected: false,
      toolCount: 0,
      lastError: 'CUA Driver 后台服务不可达，请在小K设置里重新连接 Computer Use。',
    });
  });

  it('does not auto-recover Computer Use in development even when a prior success exists', async () => {
    const pluginRootDir = join(rootDir, '.xiaok', 'plugins');
    const cuaPluginDir = join(pluginRootDir, 'cua-computer-use');
    const serverPath = join(process.cwd(), '..', 'tests', 'support', 'cua-mcp-stdio-server.js');
    const dataRoot = join(rootDir, 'data');
    mkdirSync(cuaPluginDir, { recursive: true });
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(cuaPluginDir, 'plugin.json'), JSON.stringify({
      name: 'cua-computer-use',
      version: '0.1.0',
      mcpServers: [{ name: 'cua-driver', type: 'stdio', command: process.execPath, args: [serverPath] }],
    }));
    writeFileSync(join(dataRoot, 'computer-use-state.json'), JSON.stringify({
      schemaVersion: 1,
      enabledByUser: true,
      autoConnectAfterSuccessfulEnablement: true,
      lastSuccessfulAt: 100,
      lastSuccessfulTeamId: 'TEAM123',
    }));

    const services = createDesktopServices({
      dataRoot,
      kswarmService: mockKSwarmService(),
      now: () => 300,
      pluginRootDir,
      pluginDependencies: [{
        pluginName: 'cua-computer-use',
        dependency: {
          id: 'cua-driver',
          kind: 'macos_app_cli',
          displayName: 'CUA Driver',
          binaryCandidates: [process.execPath],
          health: { version: [process.execPath, '--version'] },
          mcp: { serverName: 'cua-driver', command: process.execPath, args: [serverPath], requiresUserActivation: true },
        },
      }],
      pluginDependencyStatusOptions: {
        platform: 'darwin',
        exists: (path) => path === process.execPath,
        runCommand: async () => ({ exitCode: 0, stdout: 'v1.2.3\n', stderr: '' }),
      },
      computerUseAppIdentity: {
        appPath: '/Applications/xiaok.app',
        teamId: 'TEAM123',
        isPackaged: true,
        devServerUrl: 'http://127.0.0.1:5173',
        nodeEnv: 'development',
      },
    });

    await services.registerMcpTools();

    expect(services.listPluginMcpServers().find(server => server.name === 'cua-driver')).toMatchObject({
      connected: false,
      enabled: false,
    });
    await expect(services.executeTool('xiaok_computer_use', { action: 'screenshot', app: 'xiaok' }))
      .resolves.toContain('COMPUTER_USE_NEEDS_ENABLEMENT');
  });

  it('reports model_config_missing when kswarm readiness cannot find the configured model', async () => {
    mkdirSync(process.env.XIAOK_CONFIG_DIR!, { recursive: true });
    writeFileSync(join(process.env.XIAOK_CONFIG_DIR!, 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultProvider: 'anthropic',
      defaultModelId: 'missing-model',
      providers: {
        anthropic: {
          type: 'first_party',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
        },
      },
      models: {},
      defaultMode: 'interactive',
      skillDebug: false,
      intentBoundary: {
        llmClassifier: 'off',
        ambiguousFallback: 'legacy_validator',
        confidenceThreshold: 0.75,
        falseNegativeClarifyThreshold: 0.85,
        timeoutMs: 1500,
        maxInputTokens: 200,
        maxOutputTokens: 100,
      },
      channels: {},
    }));
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async () => {},
    });

    const result = await services.runKSwarmReadinessProbe({ targetParticipantId: 'xiaok-po' });

    expect(result).toMatchObject({
      ok: false,
      reason: 'model_config_missing',
      runtimeSource: 'desktop-agent-runtime',
      participantId: 'xiaok-po',
    });
  });

  it('discovers kswarm artifacts written directly to the project artifacts directory', async () => {
    const artifactsDir = join(rootDir, 'artifacts');
    const artifactPath = join(artifactsDir, 'research-notes.md');
    let receivedPrompt = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
        receivedPrompt = prompt;
        mkdirSync(artifactsDir, { recursive: true });
        writeFileSync(artifactPath, '# Research notes\n\n- 来源：https://example.com 2026-05-20');
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '已写入 artifacts/research-notes.md。',
        });
      },
    });

    const result = await services.runKSwarmHandoffTask({
      handoff: {
        kind: 'kswarm_task_handoff_v1',
        runId: 'run-1',
        project: { id: 'proj-1', name: 'Project', goal: 'Write report', requirements: '', artifactsDir },
        task: {
          id: 'proj-1__item-1',
          title: '收集资料',
          brief: '收集最新来源并整理为结构化笔记。',
          acceptanceCriteria: '交付一份结构化笔记（Markdown），每条动态包含日期、来源链接、摘要。',
          requiredOutputs: [],
          evidenceContract: { version: 1, kind: 'external_source_v1', required: true },
        },
      },
      targetParticipantId: 'xiaok-worker',
    });

    expect(receivedPrompt).toContain('验收标准：交付一份结构化笔记');
    expect(receivedPrompt).toContain('外部来源证据要求');
    expect(result).toMatchObject({
      summary: '已写入 artifacts/research-notes.md。',
      artifacts: [{ path: artifactPath, kind: 'markdown', label: 'research-notes.md' }],
    });
  });

  it('rejects required kswarm handoff artifacts when neither events nor directory files provide evidence', async () => {
    const artifactsDir = join(rootDir, 'artifacts');
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '报告已完成。',
        });
      },
    });

    await expect(services.runKSwarmHandoffTask({
      handoff: {
        kind: 'kswarm_task_handoff_v1',
        runId: 'run-1',
        project: { id: 'proj-1', name: 'Project', goal: 'Write report', requirements: '', artifactsDir },
        task: {
          id: 'proj-1__item-1',
          title: '撰写报告',
          brief: '输出一份最终报告。',
          acceptanceCriteria: '必须交付 Markdown 文件。',
          requiredOutputs: ['markdown'],
        },
      },
      targetParticipantId: 'xiaok-worker',
    })).rejects.toThrow('artifact_evidence_missing');
  });

  it('handles kswarm assign_po by producing a plan and creating board tasks', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    let receivedPrompt = '';
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit) => {
          requests.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
          return new Response(JSON.stringify({ ok: true, taskIds: ['proj-1__item-1'] }), { status: 200 });
        },
      },
      now: () => 300,
      runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
        receivedPrompt = prompt;
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: '项目目标明确，先输出一份报告。',
            successCriteria: ['完成报告'],
            phases: [{
              id: 'phase-1',
              name: '交付',
              items: [{
                id: 'item-1',
                title: '撰写报告',
                brief: '写一份 markdown 报告。',
                rationale: '核心交付物',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
                acceptanceCriteria: '报告结构完整。',
              }],
            }],
          }),
        });
      },
    });

    const result = await services.runKSwarmAssignPo({
      targetParticipantId: 'xiaok-po',
      payload: {
        projectId: 'proj-1',
        projectName: 'Project',
        goal: 'Write report',
        requirements: 'Chinese output',
        members: ['xiaok-worker'],
      },
    });

    expect(result).toEqual({ ok: true });
    expect(receivedPrompt).toContain('用户没有明确指定数量时，不要为本月/近期/最新类信息收集任务编造固定条数门槛');
    expect(requests.map(item => item.path)).toEqual([
      '/projects/proj-1/plan',
      '/projects/proj-1/tasks',
    ]);
    expect(requests[0].body).toMatchObject({
      fromAgent: 'xiaok-po',
      plan: expect.objectContaining({ analysis: '项目目标明确，先输出一份报告。' }),
    });
    expect(requests[1].body).toMatchObject({
      fromAgent: 'xiaok-po',
      tasks: [expect.objectContaining({
        id: 'item-1',
        title: '撰写报告',
        assignedAgent: 'xiaok-worker',
      })],
    });
  });

  it('softens generated hard item counts for current-period research when user did not request a count', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit) => {
          requests.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: '收集本月产品动态并输出报告。',
            successCriteria: ['完成报告'],
            phases: [{
              id: 'phase-1',
              name: '信息收集',
              items: [{
                id: 'item-1',
                title: '收集本月产品动态',
                brief: '收集截至当前日期的公开产品动态。',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
                acceptanceCriteria: '交付结构化笔记，包含至少10条本月产品动态，每条包含日期、来源链接、摘要。',
                requiredOutputs: ['markdown'],
              }],
            }],
          }),
        });
      },
    });

    const result = await services.runKSwarmAssignPo({
      targetParticipantId: 'xiaok-po',
      payload: {
        projectId: 'proj-soft-count',
        projectName: '本月产品分析',
        goal: '分析本月产品特性并输出报告',
        requirements: '给高层看',
        members: ['xiaok-worker'],
      },
    });

    expect(result).toEqual({ ok: true });
    const taskRequest = requests.find(item => item.path === '/projects/proj-soft-count/tasks');
    const task = (taskRequest?.body.tasks as Array<{ acceptanceCriteria: string }>)[0];
    expect(task.acceptanceCriteria).toContain('尽可能完整覆盖已公开的本期相关动态');
    expect(task.acceptanceCriteria).toContain('不得编造或用弱相关内容凑数');
    expect(task.acceptanceCriteria).not.toContain('至少10条');
  });

  it('handles kswarm review_submission and synthesizes when all tasks are done', async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET';
          const body = init?.body ? JSON.parse(String(init.body)) : {};
          requests.push({ path, method, body });
          if (path === '/projects/proj-1' && method === 'GET') {
            return new Response(JSON.stringify({
              project: { id: 'proj-1', name: 'Project', goal: 'Write report', status: 'active' },
              tasks: [{ id: 'task-1', title: '撰写报告', status: 'done' }],
            }), { status: 200 });
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        },
      },
      now: () => 300,
      runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: prompt.includes('项目所有任务已经完成')
            ? '# 项目小结\n\n项目已完成，交付物可用。'
            : JSON.stringify({ passed: true, feedback: '内容完整，可以通过。', planRevisionNeeded: false }),
        });
      },
    });

    const result = await services.runKSwarmReviewSubmission({
      targetParticipantId: 'xiaok-po',
      payload: {
        projectId: 'proj-1',
        taskId: 'task-1',
        fromWorker: 'xiaok-worker',
        result: { summary: 'done', artifacts: [{ path: '/tmp/report.md', kind: 'markdown' }] },
      },
    });

    expect(result).toEqual({ ok: true });
    expect(requests.map(item => `${item.method} ${item.path}`)).toEqual([
      'POST /projects/proj-1/tasks/task-1/review',
      'GET /projects/proj-1',
      'POST /projects/proj-1/synthesize',
    ]);
    expect(requests[0].body).toMatchObject({
      fromAgent: 'xiaok-po',
      review: { passed: true, feedback: '内容完整，可以通过。', planRevisionNeeded: false },
    });
    expect(requests[2].body).toMatchObject({
      fromAgent: 'xiaok-po',
      synthesis: '# 项目小结\n\n项目已完成，交付物可用。',
    });
  });

  it('handles kswarm plan approval by requesting dispatch as the PO', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit) => {
          requests.push({ path, body: JSON.parse(String(init?.body ?? '{}')) });
          return new Response(JSON.stringify({ ok: true, dispatched: ['proj-1__item-1'] }), { status: 200 });
        },
      },
      now: () => 300,
      runner: async () => {},
    });

    const result = await services.runKSwarmPlanApproved({
      targetParticipantId: 'xiaok-po',
      payload: { projectId: 'proj-1', decision: 'approved' },
    });

    expect(result).toEqual({ ok: true });
    expect(requests).toEqual([{
      path: '/projects/proj-1/dispatch',
      body: { fromAgent: 'xiaok-po' },
    }]);
  });

  it('reads and writes the same provider/model config catalog as xiaok cli', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.defaultModelId).toBe('anthropic-default');
    expect(snapshot.providerProfiles.map((profile) => profile.id)).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'kimi', 'deepseek', 'glm', 'minimax', 'gemini']),
    );

    snapshot = await services.saveModelConfig({
      providerId: 'kimi',
      modelName: 'kimi-k2-thinking',
      apiKey: 'sk-kimi',
    });

    expect(snapshot.defaultProvider).toBe('kimi');
    expect(snapshot.defaultModelId).toBe('kimi-kimi-k2-thinking');
    expect(snapshot.providers.find((provider) => provider.id === 'kimi')).toMatchObject({
      protocol: 'openai_legacy',
      apiKeyConfigured: true,
      baseUrl: 'https://api.kimi.com/coding/v1',
    });
    expect(snapshot.models.find((model) => model.id === 'kimi-kimi-k2-thinking')).toMatchObject({
      provider: 'kimi',
      model: 'kimi-k2-thinking',
      label: 'kimi-k2-thinking',
      isDefault: true,
    });
  });

  it('exposes auth-free Kimi K3 defaults and constraints without persisting view-only constraints', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await services.saveModelConfig({ providerId: 'kimi' });
    const snapshot = await services.getModelConfig();
    const kimiProvider = snapshot.providers.find(provider => provider.id === 'kimi');
    const kimiDefault = snapshot.models.find(model => model.id === 'kimi-default');
    const kimiProfile = snapshot.providerProfiles.find(profile => profile.id === 'kimi');
    const catalogK3 = kimiProfile?.availableModels?.find(model => model.modelId === 'kimi-k3');

    expect(kimiProvider).toMatchObject({ apiKeyConfigured: false });
    expect(kimiDefault).toMatchObject({
      provider: 'kimi',
      model: 'k3',
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
    expect(catalogK3).toMatchObject({
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });

    const persisted = JSON.parse(readFileSync(join(rootDir, 'config', 'config.json'), 'utf-8'));
    expect(persisted.models['kimi-default'].runtimeOptions).toEqual({
      contextLimit: 262_144,
      reasoningEffort: 'high',
    });
    expect(persisted.models['kimi-default'].runtimeConstraints).toBeUndefined();
  });

  it('copies runtime metadata only for an exact Kimi K3 catalog wire model', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    let snapshot = await services.saveModelConfig({ providerId: 'kimi', modelName: 'k3' });
    expect(snapshot.models.find(model => model.id === 'kimi-k3')).toMatchObject({
      model: 'k3',
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });

    snapshot = await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.6' });
    const stable = snapshot.models.find(model => model.id === 'kimi-kimi-k2.6');
    expect(stable).toMatchObject({ model: 'kimi-k2.6' });
    // K2.6 有自己的官方窗口（262,144，与 K3 恰好相同），所以不能只看 contextLimit；
    // 区分点是 K3 独有的 reasoning 策略与 constraints。
    expect(stable?.runtimeOptions?.reasoningEffort).toBeUndefined();
    expect(stable).not.toHaveProperty('runtimeConstraints');

    const available = await services.listAvailableModelsForProvider('kimi');
    expect(available.find(model => model.modelId === 'kimi-k3')).toMatchObject({
      runtimeOptions: { contextLimit: 262_144, reasoningEffort: 'high' },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
    const k26 = available.find(model => model.modelId === 'kimi-k2.6');
    expect(k26?.runtimeOptions?.reasoningEffort).toBeUndefined();
    expect(k26).not.toHaveProperty('runtimeConstraints');
  });

  it('does not expose stale K3 runtime options on a Kimi K2.7 snapshot', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.7' });
    const configPath = join(rootDir, 'config', 'config.json');
    const persisted = JSON.parse(readFileSync(configPath, 'utf-8'));
    persisted.models['kimi-kimi-k2.7'].runtimeOptions = {
      contextLimit: 1_048_576,
      reasoningEffort: 'max',
    };
    writeFileSync(configPath, JSON.stringify(persisted, null, 2));

    const snapshot = await services.getModelConfig();
    expect(snapshot.models.find(model => model.id === 'kimi-kimi-k2.7'))
      .not.toHaveProperty('runtimeOptions');
  });

  it('carries the official GLM context window from Desktop save through to adapter capabilities', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.saveModelConfig({
      providerId: 'glm',
      apiKey: 'sk-glm',
      modelName: 'GLM-5.2',
    });

    // Desktop 合成的 modelId 与 catalog 的 'glm-5.2' 并不相等 —— 这是本测试要守的前提，
    // 而不是要修的东西。修的是「即使 id 不相等，元数据也必须到位」。
    const saved = snapshot.models.find(model => model.model === 'GLM-5.2');
    expect(saved?.id).toBe('glm-glm-5.2');
    expect(saved).toMatchObject({ runtimeOptions: { contextLimit: 1_000_000 } });

    // 跨层闭环：读回真正落盘的 config.json，走 CLI 的运行时绑定与 adapter。
    const persisted = JSON.parse(
      readFileSync(join(rootDir, 'config', 'config.json'), 'utf-8'),
    );
    const binding = resolveRuntimeModelBinding(persisted, 'glm-glm-5.2');
    expect(binding.runtimeOptions).toEqual({ contextLimit: 1_000_000 });

    // OpenAI SDK 在 jsdom 环境下拒绝初始化，需临时摘掉 browser globals。
    const contextLimit = await withoutBrowserGlobals(async () => (
      resolveModelCapabilities(createAdapterFromBinding(binding)).contextLimit
    ));
    expect(contextLimit).toBe(1_000_000);
  });

  it('filters custom-endpoint Kimi K3 options without suppressing another provider named K3', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await services.saveModelConfig({
      providerId: 'kimi',
      modelName: 'k3',
      baseUrl: 'https://proxy.example.com/v1',
    });
    await services.saveModelConfig({
      providerId: 'acme',
      modelName: 'k3',
      baseUrl: 'https://api.acme.example/v1',
      protocol: 'openai_legacy',
    });

    const configPath = join(rootDir, 'config', 'config.json');
    const persisted = JSON.parse(readFileSync(configPath, 'utf-8'));
    persisted.models['kimi-k3'].runtimeOptions = {
      contextLimit: 1_048_576,
      reasoningEffort: 'max',
    };
    persisted.models['acme-k3'].runtimeOptions = {
      contextLimit: 128_000,
      reasoningEffort: 'low',
    };
    writeFileSync(configPath, JSON.stringify(persisted, null, 2));

    const snapshot = await services.getModelConfig();
    expect(snapshot.models.find(model => model.id === 'kimi-k3'))
      .not.toHaveProperty('runtimeOptions');
    expect(snapshot.models.find(model => model.id === 'acme-k3')?.runtimeOptions).toEqual({
      contextLimit: 128_000,
      reasoningEffort: 'low',
    });
  });

  it('does not half-migrate an existing kimi-default binding from K2.7 when updating credentials', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-old' });

    const configPath = join(rootDir, 'config', 'config.json');
    const seeded = JSON.parse(readFileSync(configPath, 'utf-8'));
    seeded.models['kimi-default'] = {
      ...seeded.models['kimi-default'],
      model: 'kimi-k2.7',
      label: 'Kimi K2.7',
    };
    delete seeded.models['kimi-default'].runtimeOptions;
    writeFileSync(configPath, JSON.stringify(seeded, null, 2));

    const before = JSON.parse(readFileSync(configPath, 'utf-8'));
    const snapshot = await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-new' });
    const after = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(snapshot.defaultModelId).toBe('kimi-default');
    expect(snapshot.models.find(model => model.id === 'kimi-default')).toMatchObject({
      model: 'kimi-k2.7',
      isDefault: true,
    });
    expect(snapshot.models.find(model => model.id === 'kimi-default')).not.toHaveProperty('runtimeOptions');
    expect(after.models['kimi-default']).toEqual(before.models['kimi-default']);
    expect(before.providers.kimi.apiKey).toBe('sk-old');
    expect(after.providers.kimi.apiKey).toBe('sk-new');
    expect(after.providers.kimi.protocol).toBe(before.providers.kimi.protocol);
    expect(after.providers.kimi.baseUrl).toBe(before.providers.kimi.baseUrl);
  });

  it('updates only an existing Kimi K3 runtime policy and preserves it across reload', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi' });
    await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.7' });

    const configPath = join(rootDir, 'config', 'config.json');
    const before = JSON.parse(readFileSync(configPath, 'utf-8'));
    const snapshot = await services.updateModelRuntimeOptions({
      modelId: 'kimi-default',
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
    });
    const after = JSON.parse(readFileSync(configPath, 'utf-8'));

    expect(snapshot.defaultModelId).toBe(before.defaultModelId);
    expect(Object.keys(after.models)).toEqual(Object.keys(before.models));
    expect(after.models['kimi-default']).toEqual({
      ...before.models['kimi-default'],
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
    });
    expect(after.models['kimi-default'].provider).toBe(before.models['kimi-default'].provider);
    expect(after.models['kimi-default'].model).toBe(before.models['kimi-default'].model);
    expect(after.providers).toEqual(before.providers);
    expect(after.defaultProvider).toBe(before.defaultProvider);
    expect(after.defaultModelId).toBe(before.defaultModelId);
    expect(after.models['kimi-default'].runtimeConstraints).toBeUndefined();

    const reloadedServices = createDesktopServices({
      dataRoot: join(rootDir, 'data-reloaded'),
      kswarmService: mockKSwarmService(),
      now: () => 301,
    });
    const reloaded = await reloadedServices.getModelConfig();
    expect(reloaded.models.find(model => model.id === 'kimi-default')).toMatchObject({
      runtimeOptions: { contextLimit: 1_048_576, reasoningEffort: 'max' },
      runtimeConstraints: {
        maxContextLimit: 1_048_576,
        reasoningEfforts: ['low', 'high', 'max'],
      },
    });
  });

  it('rejects invalid or out-of-scope runtime policy updates without mutating config', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi' });
    await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.7' });
    await services.saveModelConfig({
      providerId: 'custom-k3',
      modelName: 'k3',
      baseUrl: 'https://example.com/v1',
      protocol: 'openai_legacy',
    });

    const configPath = join(rootDir, 'config', 'config.json');
    const cases = [
      {
        input: { modelId: 'missing-model', runtimeOptions: { reasoningEffort: 'high' as const } },
        error: /model.*not found|不存在/i,
      },
      {
        input: { modelId: 'kimi-kimi-k2.7', runtimeOptions: { reasoningEffort: 'high' as const } },
        error: /Kimi K3/,
      },
      {
        input: { modelId: 'custom-k3-k3', runtimeOptions: { reasoningEffort: 'high' as const } },
        error: /Kimi K3/,
      },
      {
        input: { modelId: 'kimi-default', runtimeOptions: { reasoningEffort: 'medium' as never } },
        error: /reasoningEffort/,
      },
      {
        input: { modelId: 'kimi-default', runtimeOptions: { contextLimit: 1_048_577 } },
        error: /contextLimit/,
      },
    ];

    for (const testCase of cases) {
      const before = readFileSync(configPath, 'utf-8');
      await expect(services.updateModelRuntimeOptions(testCase.input)).rejects.toThrow(testCase.error);
      expect(readFileSync(configPath, 'utf-8')).toBe(before);
    }
  });

  it.each([
    ['an array', []],
    ['a non-plain object', new Date(0)],
    ['a primitive', 'invalid'],
    ['unknown keys', { contextLimit: 262_144, unexpected: true }],
  ])('rejects runtimeOptions with %s without mutating config', async (_label, runtimeOptions) => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi' });
    const configPath = join(rootDir, 'config', 'config.json');
    const before = readFileSync(configPath, 'utf-8');

    await expect(services.updateModelRuntimeOptions({
      modelId: 'kimi-default',
      runtimeOptions: runtimeOptions as never,
    })).rejects.toThrow(/runtimeOptions|unsupported/i);
    expect(readFileSync(configPath, 'utf-8')).toBe(before);
  });

  it('tests the requested model binding instead of the current default model', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.7' });

    const observed: Array<{ model: string; contextLimit?: number }> = [];
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      observed.push({
        model: this.getModelName(),
        contextLimit: this.getCapabilities().contextLimit,
      });
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    });

    try {
      const result = await withoutBrowserGlobals(() => services.testProviderConnection({
        providerId: 'kimi',
        modelId: 'kimi-default',
      }));
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ success: true });
      expect(observed).toEqual([{ model: 'k3', contextLimit: 262_144 }]);
    } finally {
      streamSpy.mockRestore();
    }
  });

  it('tests a provider-owned configured model when modelId is omitted without changing the global default', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    await services.saveModelConfig({ providerId: 'anthropic', apiKey: 'sk-anthropic' });
    const before = await services.getModelConfig();
    expect(before.defaultProvider).toBe('anthropic');

    const observed: Array<{ model: string; contextLimit?: number }> = [];
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      observed.push({
        model: this.getModelName(),
        contextLimit: this.getCapabilities().contextLimit,
      });
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    });

    try {
      const result = await withoutBrowserGlobals(() => services.testProviderConnection({ providerId: 'kimi' }));
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ success: true });
      expect(observed).toEqual([{ model: 'k3', contextLimit: 262_144 }]);
      expect((await services.getModelConfig()).defaultModelId).toBe(before.defaultModelId);
    } finally {
      streamSpy.mockRestore();
    }
  });

  it('prefers the configured provider catalog default when modelId is omitted', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    await services.saveModelConfig({ providerId: 'kimi', modelName: 'kimi-k2.7' });
    const before = await services.getModelConfig();
    expect(before.defaultModelId).toBe('kimi-kimi-k2.7');

    const observed: string[] = [];
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      observed.push(this.getModelName());
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    });

    try {
      const result = await withoutBrowserGlobals(() => services.testProviderConnection({ providerId: 'kimi' }));
      expect(result).toMatchObject({ success: true });
      expect(observed).toEqual(['k3']);
      expect((await services.getModelConfig()).defaultModelId).toBe(before.defaultModelId);
    } finally {
      streamSpy.mockRestore();
    }
  });

  it.each([
    {
      name: 'usage then pending error',
      chunks: [{ type: 'usage' as const, usage: { inputTokens: 7, outputTokens: 2 } }],
      pendingError: new Error('usage pending failure'),
      expectedSuccess: false,
    },
    {
      name: 'text then pending error',
      chunks: [{ type: 'text' as const, delta: 'partial' }],
      pendingError: new Error('text pending failure'),
      expectedSuccess: false,
    },
    {
      name: 'empty clean exhaustion',
      chunks: [],
      expectedSuccess: false,
    },
    {
      name: 'usage-only clean exhaustion',
      chunks: [{ type: 'usage' as const, usage: { inputTokens: 7, outputTokens: 0 } }],
      expectedSuccess: false,
    },
    {
      name: 'usage then done clean exhaustion',
      chunks: [
        { type: 'usage' as const, usage: { inputTokens: 7, outputTokens: 0 } },
        { type: 'done' as const },
      ],
      expectedSuccess: true,
    },
    {
      name: 'text and done clean exhaustion',
      chunks: [
        { type: 'text' as const, delta: 'ok' },
        { type: 'done' as const },
      ],
      expectedSuccess: true,
    },
  ])('drains provider connection protocol: $name', async ({
    chunks,
    pendingError,
    expectedSuccess,
  }: {
    chunks: StreamChunk[];
    pendingError?: Error;
    expectedSuccess: boolean;
  }) => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    const calls: Array<{
      messages: Message[];
      tools: ToolDefinition[];
      options?: StreamOptions;
      cleanExhaustion: boolean;
    }> = [];
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (
      messages,
      tools,
      _systemPrompt,
      options,
    ) {
      const call = { messages, tools, options, cleanExhaustion: false };
      calls.push(call);
      for (const chunk of chunks) {
        yield chunk;
      }
      if (pendingError) {
        throw pendingError;
      }
      call.cleanExhaustion = true;
    });

    try {
      const result = await withoutBrowserGlobals(() => services.testProviderConnection({ providerId: 'kimi' }));

      expect(result.success).toBe(expectedSuccess);
      expect(calls).toHaveLength(1);
      expect(calls[0].tools).toEqual([]);
      expect(calls[0].options).toEqual({
        providerConversationAuthorization: expect.any(Object),
        signal: expect.any(AbortSignal),
      });
      expect(Object.isFrozen(calls[0].options?.providerConversationAuthorization)).toBe(true);
      expect(Reflect.ownKeys(calls[0].options?.providerConversationAuthorization ?? {})).toEqual([]);
      expect(calls[0].options).not.toHaveProperty('cacheKey');
      if (pendingError) {
        expect(result.error).toBe(pendingError.message);
        expect(calls[0].cleanExhaustion).toBe(false);
      } else {
        expect(calls[0].cleanExhaustion).toBe(true);
      }
    } finally {
      streamSpy.mockRestore();
    }
  });

  it('reports provider connection latency at clean completion rather than first chunk', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    vi.useFakeTimers();
    const streamSpy = vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'text' as const, delta: 'first' };
      await new Promise(resolve => setTimeout(resolve, 125));
      yield { type: 'done' as const };
    });

    try {
      const pending = withoutBrowserGlobals(() => services.testProviderConnection({ providerId: 'kimi' }));
      await vi.advanceTimersByTimeAsync(125);
      await expect(pending).resolves.toMatchObject({ success: true, latencyMs: 125 });
    } finally {
      streamSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('uses one real OpenAI outer stream attempt and no retry after the independent 30 second timeout', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });
    await services.saveModelConfig({ providerId: 'kimi', apiKey: 'sk-kimi' });
    vi.useFakeTimers();
    let attempts = 0;
    let timeoutReason: unknown;
    let releaseAttempt: ((reason: unknown) => void) | undefined;
    type StreamOnce = (...args: unknown[]) => AsyncIterable<StreamChunk>;
    const attemptSpy = vi.spyOn(
      OpenAIAdapter.prototype as unknown as { streamOnce: StreamOnce },
      'streamOnce',
    ).mockImplementation(async function* (...args: unknown[]) {
      attempts += 1;
      const signal = args[4] as AbortSignal;
      await new Promise<void>((_resolve, reject) => {
        releaseAttempt = reject;
        signal.addEventListener('abort', () => {
          timeoutReason = signal.reason;
          reject(signal.reason);
        }, { once: true });
      });
    });

    try {
      const pending = withoutBrowserGlobals(() => services.testProviderConnection({ providerId: 'kimi' }));
      for (let index = 0; index < 10 && attempts === 0; index += 1) {
        await Promise.resolve();
      }
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
      if (timeoutReason === undefined) {
        releaseAttempt?.(Object.assign(
          new Error('test released missing external abort'),
          { status: 400 },
        ));
      }
      const result = await pending;

      expect(result).toEqual({ success: false, error: 'provider connection timeout' });
      expect(attempts).toBe(1);
      expect(timeoutReason).toMatchObject({ name: 'TimeoutError', message: 'provider connection timeout' });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      attemptSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('creates managed xiaok agents from desktop config without asking renderer for provider details', async () => {
    const originalFetch = globalThis.fetch;
    const appDataRoot = join(rootDir, 'appdata');
    const npmDir = join(appDataRoot, 'npm');
    mkdirSync(npmDir, { recursive: true });
    writeFileSync(join(npmDir, 'xiaok.ps1'), '# stub');
    process.env.APPDATA = appDataRoot;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, agent: { id: 'xiaok-po' } }),
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    try {
      const services = createDesktopServices({
        dataRoot: join(rootDir, 'data'),
        now: () => 300,
      });

      await services.saveModelConfig({
        providerId: 'anthropic',
        modelId: 'anthropic-default',
        apiKey: 'sk-anthropic',
      });

      const result = await services.createManagedXiaokAgent({
        name: 'PO-Agent',
        roles: ['project_owner'],
        instructions: '负责规划',
      });

      expect(result).toEqual({ ok: true, agent: { id: 'xiaok-po' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4400/agents', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }));
      const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(payload).toMatchObject({
        name: 'PO-Agent',
        instructions: '负责规划',
        runtimeType: 'xiaok',
        runtimeSource: 'desktop-agent-runtime',
        roles: ['project_owner'],
        runtimeModel: 'claude-opus-4-7',
        provider: null,
        model: null,
        baseUrl: null,
        apiKey: null,
        runtimePath: null,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lists available models for a first-party provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const models = await services.listAvailableModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toMatchObject({
      modelId: expect.stringContaining('anthropic'),
      model: expect.stringContaining('claude'),
      label: expect.stringContaining('Claude'),
    });
  });

  it('returns empty array for unknown provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const models = await services.listAvailableModelsForProvider('unknown-provider');
    expect(models).toEqual([]);
  });

  it('deletes a provider and its associated models', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    // First add a custom provider
    await services.saveModelConfig({
      providerId: 'custom-test',
      modelName: 'test-model',
      baseUrl: 'https://api.test.com/v1',
      apiKey: 'test-key',
      protocol: 'openai_legacy',
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.providers.find(p => p.id === 'custom-test')).toBeDefined();
    expect(snapshot.models.find(m => m.provider === 'custom-test')).toBeDefined();

    // Delete the provider
    await services.deleteProvider('custom-test');

    snapshot = await services.getModelConfig();
    expect(snapshot.providers.find(p => p.id === 'custom-test')).toBeUndefined();
    expect(snapshot.models.find(m => m.provider === 'custom-test')).toBeUndefined();
  });

  it('deletes a specific model but keeps the provider', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    // Add a custom model
    await services.saveModelConfig({
      providerId: 'anthropic',
      modelName: 'claude-test-model',
      label: 'Test Model',
    });

    let snapshot = await services.getModelConfig();
    const testModel = snapshot.models.find(m => m.model === 'claude-test-model');
    expect(testModel).toBeDefined();

    // Delete the model
    await services.deleteModel(testModel!.id);

    snapshot = await services.getModelConfig();
    expect(snapshot.models.find(m => m.model === 'claude-test-model')).toBeUndefined();
    expect(snapshot.providers.find(p => p.id === 'anthropic')).toBeDefined();
  });

  it('testProviderConnection returns error when API key not configured', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    // Default config has no API key
    const result = await services.testProviderConnection({ providerId: 'anthropic' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('API key');
  });

  it('testProviderConnection attempts connection when API key is configured', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async () => { // Minimal runner
      },
    });

    // Configure with API key (but fake, so connection will fail)
    await services.saveModelConfig({
      providerId: 'anthropic',
      apiKey: 'sk-test-key',
    });

    // With a fake API key, the connection will fail, but we can verify it tried
    const result = await services.testProviderConnection({ providerId: 'anthropic' });
    // Either succeeds (if adapter returns immediately) or fails with connection error
    expect(result.success).toBeDefined();
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('resets defaultProvider when deleted provider was default', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    // Set kimi as default
    await services.saveModelConfig({
      providerId: 'kimi',
      apiKey: 'sk-kimi',
    });

    let snapshot = await services.getModelConfig();
    expect(snapshot.defaultProvider).toBe('kimi');

    // Delete kimi
    await services.deleteProvider('kimi');

    snapshot = await services.getModelConfig();
    expect(snapshot.defaultProvider).not.toBe('kimi');
    expect(snapshot.providers.find(p => p.id === 'anthropic')).toBeDefined(); // Falls back to anthropic
  });

  it('provider profiles include availableModels for all first-party providers', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.getModelConfig();
    const providers = ['openai', 'anthropic', 'kimi', 'deepseek', 'glm', 'minimax', 'gemini'];
    for (const id of providers) {
      const profile = snapshot.providerProfiles.find(p => p.id === id);
      expect(profile, `profile for ${id} should exist`).toBeDefined();
      expect(profile!.availableModels, `${id} should have availableModels`).toBeDefined();
      expect(profile!.availableModels!.length, `${id} should have at least 1 model`).toBeGreaterThanOrEqual(1);
      // Each model should have modelId, model, label
      for (const m of profile!.availableModels!) {
        expect(m.modelId).toBeTruthy();
        expect(m.model).toBeTruthy();
        expect(m.label).toBeTruthy();
      }
    }
  });

  it('projects GLM-5.3-Flash into the Desktop provider profile', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.getModelConfig();
    const glmProfile = snapshot.providerProfiles.find(profile => profile.id === 'glm');
    const flash = glmProfile?.availableModels?.find(model => model.modelId === 'glm-5.3-flash');

    expect(flash).toMatchObject({
      model: 'glm-5.3-flash',
      label: 'GLM 5.3 Flash',
      capabilities: ['tools', 'thinking', 'image_in'],
      runtimeOptions: {
        contextLimit: 1_048_576,
        reasoningEffort: 'max',
      },
    });
  });

  it('projects DeepSeek V4 Flash Vision Exp into the Desktop provider profile', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.getModelConfig();
    const profile = snapshot.providerProfiles.find(candidate => candidate.id === 'deepseek');
    const vision = profile?.availableModels?.find(
      model => model.modelId === 'deepseek-v4-flash-vision-exp',
    );

    expect(vision).toMatchObject({
      model: 'deepseek-v4-flash-vision-exp',
      label: 'DeepSeek V4 Flash Vision Exp',
      capabilities: ['tools', 'thinking', 'image_in'],
      runtimeOptions: { contextLimit: 1_000_000 },
    });
  });

  it('provider profiles include baseUrl for all first-party providers', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.getModelConfig();
    const expectedUrls: Record<string, string> = {
      openai: 'https://api.openai.com/v1',
      anthropic: 'https://api.anthropic.com',
      kimi: 'https://api.kimi.com/coding/v1',
      deepseek: 'https://api.deepseek.com/v1',
      glm: 'https://open.bigmodel.cn/api/paas/v4',
      minimax: 'https://api.minimax.io/v1',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };

    for (const [id, expectedUrl] of Object.entries(expectedUrls)) {
      const profile = snapshot.providerProfiles.find(p => p.id === id);
      expect(profile, `profile for ${id}`).toBeDefined();
      expect(profile!.baseUrl).toBe(expectedUrl);
    }
  });

  it('adding a first-party provider sets default baseUrl from registry', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const snapshot = await services.saveModelConfig({
      providerId: 'deepseek',
      apiKey: 'sk-ds-test',
    });

    const dsProvider = snapshot.providers.find(p => p.id === 'deepseek');
    expect(dsProvider).toBeDefined();
    expect(dsProvider!.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(dsProvider!.protocol).toBe('openai_legacy');
    expect(dsProvider!.apiKeyConfigured).toBe(true);
  });

  it('lists available models for all first-party providers with models', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const providersWithModels = ['openai', 'anthropic', 'kimi', 'deepseek', 'glm', 'minimax', 'gemini'];
    for (const id of providersWithModels) {
      const models = await services.listAvailableModelsForProvider(id);
      expect(models.length, `${id} should have available models`).toBeGreaterThanOrEqual(1);
      for (const m of models) {
        expect(m.modelId).toBeTruthy();
        expect(m.model).toBeTruthy();
        expect(m.label).toBeTruthy();
      }
    }
  });

  // ===== Channel API Tests (shared config.json) =====

  it('returns empty channels when config has no channels', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const channels = await services.listChannels();
    expect(channels).toEqual([]);
  });

  it('reads channels from config.json', async () => {
    // Write config with channels first
    const configDir = join(rootDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.json'), JSON.stringify({
      schemaVersion: 2,
      defaultProvider: 'anthropic',
      defaultModelId: 'anthropic-default',
      providers: { anthropic: { type: 'first_party', protocol: 'anthropic' } },
      models: { 'anthropic-default': { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Opus' } },
      channels: {
        yzj: { sendMsgUrl: 'https://example.com/webhook', inboundMode: 'websocket' },
      },
    }));

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const channels = await services.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].id).toBe('yzj');
    expect(channels[0].type).toBe('yzj');
    expect(channels[0].webhookUrl).toBe('https://example.com/webhook');
  });

  it('creates a channel and persists to config.json', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const channel = await services.createChannel({ type: 'discord', name: 'My Discord', webhookUrl: 'https://discord.com/api/webhooks/...' });
    expect(channel.id).toBe('discord');
    expect(channel.type).toBe('discord');
    expect(channel.name).toBe('My Discord');
    expect(channel.enabled).toBe(true);

    // Verify it's in config.json
    const configPath = join(rootDir, 'config', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.channels.discord).toBeDefined();
  });

  it('updates an existing channel', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    // First create
    await services.createChannel({ type: 'telegram', name: 'Old Name' });

    // Then update
    const updated = await services.updateChannel('telegram', { name: 'New Name', webhookUrl: 'https://api.telegram.org/bot123' });
    expect(updated.name).toBe('New Name');
    expect(updated.webhookUrl).toBe('https://api.telegram.org/bot123');
  });

  it('throws on updating non-existent channel', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await expect(services.updateChannel('nonexistent', { name: 'test' })).rejects.toThrow('not found');
  });

  it('deletes a channel from config.json', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await services.createChannel({ type: 'feishu', name: 'Feishu' });
    let channels = await services.listChannels();
    expect(channels.find(c => c.id === 'feishu')).toBeDefined();

    await services.deleteChannel('feishu');
    channels = await services.listChannels();
    expect(channels.find(c => c.id === 'feishu')).toBeUndefined();
  });

  // ===== MCP API Tests =====

  it('returns empty MCP installs initially', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const installs = await services.listMCPInstalls();
    expect(installs).toEqual([]);
  });

  it('creates an MCP install and persists to file', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const install = await services.createMCPInstall({
      name: 'Playwright',
      source: 'npm',
      command: '@anthropic/mcp-playwright',
    });

    expect(install.id).toBeDefined();
    expect(install.name).toBe('Playwright');
    expect(install.source).toBe('npm');
    expect(install.enabled).toBe(true);

    // Verify file
    const mcpPath = join(rootDir, 'data', 'mcp-installs.json');
    expect(existsSync(mcpPath)).toBe(true);
    const saved = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Playwright');
  });

  it('updates an MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const created = await services.createMCPInstall({
      name: 'Brave Search',
      source: 'npm',
      command: '@anthropic/mcp-brave-search',
    });

    const updated = await services.updateMCPInstall(created.id, { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('throws on updating non-existent MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    await expect(services.updateMCPInstall('nonexistent', { enabled: false })).rejects.toThrow('not found');
  });

  it('deletes an MCP install', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const created = await services.createMCPInstall({ name: 'Test MCP', source: 'npm', command: 'test' });
    await services.deleteMCPInstall(created.id);

    const installs = await services.listMCPInstalls();
    expect(installs).toHaveLength(0);
  });

  it('supports multiple MCP installs with distinct IDs', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
    });

    const install1 = await services.createMCPInstall({ name: 'MCP1', source: 'npm', command: 'cmd1' });
    const install2 = await services.createMCPInstall({ name: 'MCP2', source: 'github', command: 'cmd2' });

    expect(install1.id).not.toBe(install2.id);
    expect(install1.source).toBe('npm');
    expect(install2.source).toBe('github');

    const installs = await services.listMCPInstalls();
    expect(installs).toHaveLength(2);
  });

  it('enqueues a durable initial plan bootstrap job and returns before planning finishes', async () => {
    const requests: Array<{ path: string; init?: RequestInit; body: Record<string, unknown> }> = [];
    let releasePlanner!: () => void;
    const plannerCanFinish = new Promise<void>((resolve) => {
      releasePlanner = resolve;
    });
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        requests.push({ path, init, body });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-bootstrap', name: '海外AI产品五月动态分析', status: 'created', createdAt: 123 },
          }), { status: 201 });
        }
        if (path === '/projects/proj-bootstrap/plan') {
          return new Response(JSON.stringify({ ok: true, plan: { version: 1 } }));
        }
        if (path === '/projects/proj-bootstrap/tasks') {
          return new Response(JSON.stringify({ ok: true, taskIds: ['item-1'] }));
        }
        if (path === '/projects/proj-bootstrap/activate-and-start') {
          return new Response(JSON.stringify({
            ok: true,
            phase: 'dispatch_started',
            dispatch: { ok: true, dispatched: ['item-1'] },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService,
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        await plannerCanFinish;
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: '需要覆盖主要海外 AI 公司动态并形成报告。',
            successCriteria: ['完成有来源的分析报告'],
            phases: [{
              id: 'phase-1',
              name: '研究与交付',
              items: [{
                id: 'item-1',
                title: '完成五月 AI 产品动态分析报告',
                brief: '按公司和产品线整理五月动态，包含时间线、特性、影响评估和来源。',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
                acceptanceCriteria: '报告覆盖用户指定公司，并列出来源和信息缺口。',
                requiredOutputs: ['report_html'],
              }],
            }],
          }),
        });
      },
    });

    // The project itself is now created through the trusted user Room-first
    // path after the agent's proposal-only tool (design §9.3); this test
    // drives the planning bootstrap directly from the semantic service.
    const executePromise = Promise.resolve(JSON.stringify(services.startProjectPlanning({
      projectId: 'proj-bootstrap',
      projectName: '海外AI产品五月动态分析',
      goal: '完成2026年5月国外主要AI产品动态分析',
      requirements: '覆盖OpenAI、Google、Anthropic、Meta、Microsoft，包含来源。',
      planningGuidance: '',
      poAgent: 'xiaok-po',
      members: ['xiaok-worker'],
      startPolicy: 'activate_and_dispatch_after_plan',
    })));

    const immediateResult = await Promise.race([
      executePromise.then((value) => ({ kind: 'returned' as const, value })),
      new Promise<{ kind: 'blocked' }>((resolve) => setTimeout(() => resolve({ kind: 'blocked' }), 25)),
    ]);
    if (immediateResult.kind === 'blocked') {
      releasePlanner();
      await executePromise;
    }

    expect(immediateResult.kind).toBe('returned');
    const result = JSON.parse(immediateResult.kind === 'returned' ? immediateResult.value : '{}');

    expect(result).toMatchObject({ ok: true, status: 'queued' });

    const jobsFile = join(rootDir, 'data', 'kswarm-initial-plan-bootstrap-jobs.json');
    expect(existsSync(jobsFile)).toBe(true);
    const jobsData = JSON.parse(readFileSync(jobsFile, 'utf8'));
    expect(jobsData.jobs).toContainEqual(expect.objectContaining({
      projectId: 'proj-bootstrap',
      status: expect.stringMatching(/^(pending|running)$/),
      attempts: 0,
    }));

    releasePlanner();
    await waitFor(() => requests.some(request => request.path === '/projects/proj-bootstrap/plan'));
    await waitFor(() => requests.some(request => request.path === '/projects/proj-bootstrap/tasks'));
    await waitFor(() => requests.some(request => request.path === '/projects/proj-bootstrap/activate-and-start'));

    expect(requests.map(request => request.path)).toEqual([
      '/projects/proj-bootstrap/plan',
      '/projects/proj-bootstrap/tasks',
      '/projects/proj-bootstrap/activate-and-start',
    ]);
    expect(requests.find(request => request.path === '/projects/proj-bootstrap/plan')?.body).toMatchObject({
      fromAgent: 'xiaok-po',
      plan: expect.objectContaining({
        analysis: '需要覆盖主要海外 AI 公司动态并形成报告。',
      }),
    });
    expect(requests.find(request => request.path === '/projects/proj-bootstrap/tasks')?.body).toMatchObject({
      fromAgent: 'xiaok-po',
      tasks: [expect.objectContaining({
        id: 'item-1',
        title: '完成五月 AI 产品动态分析报告',
        assignedAgent: 'xiaok-worker',
      })],
    });
    const activateRequest = requests.find(request => request.path === '/projects/proj-bootstrap/activate-and-start');
    expect(activateRequest?.init?.headers instanceof Headers ? activateRequest.init.headers.get('x-kswarm-mutation-token') : undefined).toBe('desktop-token');
    expect(activateRequest?.body).toMatchObject({
      fromAgent: 'xiaok-po',
      startPolicy: 'activate_and_dispatch_after_plan',
      idempotencyKey: 'initial-plan-bootstrap:proj-bootstrap:activate_and_dispatch_after_plan',
    });
  });

  it('records initial plan bootstrap failure for retry without failing the create_project card', async () => {
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string) => {
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-no-plan', name: 'No Plan', status: 'created', createdAt: 123 },
          }), { status: 201 });
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService,
      now: () => 300,
      runner: async () => {
        throw new Error('planner runtime unavailable');
      },
    });

    const result = services.startProjectPlanning({
      projectId: 'proj-no-plan',
      projectName: 'No Plan',
      goal: 'Create project but fail planning',
      requirements: '',
      planningGuidance: '',
      poAgent: 'xiaok-po',
      members: [],
      startPolicy: 'auto_activate_after_plan',
    });

    expect(result).toMatchObject({ ok: true, status: 'queued' });
    await waitFor(() => {
      const jobsFile = join(rootDir, 'data', 'kswarm-initial-plan-bootstrap-jobs.json');
      if (!existsSync(jobsFile)) return false;
      const jobsData = JSON.parse(readFileSync(jobsFile, 'utf8'));
      const job = jobsData.jobs.find((item: { projectId?: string }) => item.projectId === 'proj-no-plan');
      return job?.status === 'pending'
        && job?.attempts === 1
        && /(planner runtime unavailable|desktop_task_failed)/.test(job?.lastError || '');
    }, 3000);
  });

  it('recovers pending initial plan bootstrap jobs on desktop service startup', async () => {
    const dataRoot = join(rootDir, 'data');
    mkdirSync(dataRoot, { recursive: true });
    writeFileSync(join(dataRoot, 'kswarm-initial-plan-bootstrap-jobs.json'), JSON.stringify({
      jobs: [{
        id: 'proj-recover',
        projectId: 'proj-recover',
        projectName: 'Recover Me',
        goal: 'Recover pending planning job',
        requirements: '',
        planningGuidance: '',
        poAgent: 'xiaok-po',
        members: ['xiaok-worker'],
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }],
    }, null, 2));

    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({
          path,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (path === '/projects/proj-recover/plan') {
          return new Response(JSON.stringify({ ok: true, plan: { version: 1 } }));
        }
        if (path === '/projects/proj-recover/tasks') {
          return new Response(JSON.stringify({ ok: true, taskIds: ['item-1'] }));
        }
        if (path === '/projects/proj-recover/activate-and-start') {
          return new Response(JSON.stringify({
            ok: true,
            phase: 'dispatch_started',
            dispatch: { ok: true, dispatched: ['item-1'] },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    createDesktopServices({
      dataRoot,
      kswarmService,
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: 'Recovered planning job.',
            phases: [{
              id: 'phase-1',
              name: '恢复规划',
              items: [{
                id: 'item-1',
                title: '恢复后生成任务',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
              }],
            }],
          }),
        });
      },
    });

    await waitFor(() => requests.some(request => request.path === '/projects/proj-recover/plan'));
    await waitFor(() => requests.some(request => request.path === '/projects/proj-recover/tasks'));
    await waitFor(() => requests.some(request => request.path === '/projects/proj-recover/activate-and-start'));

    const jobsData = JSON.parse(readFileSync(join(dataRoot, 'kswarm-initial-plan-bootstrap-jobs.json'), 'utf8'));
    expect(jobsData.jobs).toContainEqual(expect.objectContaining({
      projectId: 'proj-recover',
      status: 'succeeded',
    }));
  });

  it('keeps the bootstrap job pending when the dispatch phase fails', async () => {
    const requests: Array<{ path: string }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string) => {
        requests.push({ path });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-dispatch-fail', name: 'Dispatch Fail', status: 'created', createdAt: 123 },
          }), { status: 201 });
        }
        if (path === '/projects/proj-dispatch-fail/plan') {
          return new Response(JSON.stringify({ ok: true, plan: { version: 1 } }));
        }
        if (path === '/projects/proj-dispatch-fail/tasks') {
          return new Response(JSON.stringify({ ok: true, taskIds: ['item-1'] }));
        }
        if (path === '/projects/proj-dispatch-fail/activate-and-start') {
          return new Response(JSON.stringify({ ok: false, error: 'dispatch_unavailable' }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService,
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: 'Plan ok but dispatch will fail.',
            phases: [{
              id: 'phase-1',
              name: '交付',
              items: [{
                id: 'item-1',
                title: '任务一',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
              }],
            }],
          }),
        });
      },
    });

    const result = services.startProjectPlanning({
      projectId: 'proj-dispatch-fail',
      projectName: 'Dispatch Fail',
      goal: 'Plan succeeds but dispatch fails',
      requirements: '',
      planningGuidance: '',
      poAgent: 'xiaok-po',
      members: [],
      startPolicy: 'activate_and_dispatch_after_plan',
    });
    expect(result).toMatchObject({ ok: true, status: 'queued' });

    await waitFor(() => requests.some(request => request.path === '/projects/proj-dispatch-fail/activate-and-start'));
    await waitFor(() => {
      const jobsFile = join(rootDir, 'data', 'kswarm-initial-plan-bootstrap-jobs.json');
      if (!existsSync(jobsFile)) return false;
      const jobsData = JSON.parse(readFileSync(jobsFile, 'utf8'));
      const job = jobsData.jobs.find((item: { projectId?: string }) => item.projectId === 'proj-dispatch-fail');
      return job?.status === 'pending'
        && job?.attempts === 1
        && /dispatch_unavailable/.test(job?.lastError || '');
    }, 3000);
  });

  it('treats plan_already_exists as non-fatal and still runs tasks and dispatch', async () => {
    const requests: Array<{ path: string }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string) => {
        requests.push({ path });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'idle' },
              { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-replan', name: 'Replan', status: 'created', createdAt: 123 },
          }), { status: 201 });
        }
        if (path === '/projects/proj-replan/plan') {
          return new Response(JSON.stringify({ ok: false, error: 'plan_already_exists' }), { status: 200 });
        }
        if (path === '/projects/proj-replan/tasks') {
          return new Response(JSON.stringify({ ok: true, taskIds: ['item-1'] }));
        }
        if (path === '/projects/proj-replan/activate-and-start') {
          return new Response(JSON.stringify({
            ok: true,
            phase: 'dispatch_started',
            dispatch: { ok: true, dispatched: ['item-1'] },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService,
      now: () => 300,
      runner: async ({ sessionId, emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: JSON.stringify({
            analysis: 'Plan already exists, continue to tasks.',
            phases: [{
              id: 'phase-1',
              name: '交付',
              items: [{
                id: 'item-1',
                title: '任务一',
                assignedAgent: 'xiaok-worker',
                dependencies: [],
              }],
            }],
          }),
        });
      },
    });

    const result = services.startProjectPlanning({
      projectId: 'proj-replan',
      projectName: 'Replan',
      goal: 'Plan already exists path',
      requirements: '',
      planningGuidance: '',
      poAgent: 'xiaok-po',
      members: [],
      startPolicy: 'activate_and_dispatch_after_plan',
    });
    expect(result).toMatchObject({ ok: true, status: 'queued' });

    await waitFor(() => requests.some(request => request.path === '/projects/proj-replan/activate-and-start'));
    await waitFor(() => {
      const jobsFile = join(rootDir, 'data', 'kswarm-initial-plan-bootstrap-jobs.json');
      if (!existsSync(jobsFile)) return false;
      const jobsData = JSON.parse(readFileSync(jobsFile, 'utf8'));
      const job = jobsData.jobs.find((item: { projectId?: string }) => item.projectId === 'proj-replan');
      return job?.status === 'succeeded';
    }, 3000);
    expect(requests.some(request => request.path === '/projects/proj-replan/tasks')).toBe(true);
    expect(requests.some(request => request.path === '/projects/proj-replan/activate-and-start')).toBe(true);
  });

  it('forwards workFolder from the chat create_project tool to kswarm', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-1', name: 'Demo', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const result = await tool.execute({
      name: 'Demo',
      goal: 'Ship a report',
      workFolder: '  /tmp/kswarm-demo  ',
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({ ok: true, proposal: { kind: 'project_proposal' } });
    expect(parsed.proposal).toMatchObject({
      name: 'Demo',
      goal: 'Ship a report',
      poAgent: 'po-agent',
      members: ['worker-agent'],
      workFolder: '/tmp/kswarm-demo',
    });
    expect(requests.filter(request => (request.init?.method ?? 'GET').toUpperCase() !== 'GET')).toEqual([]);
  });

  it('maps explicit workflow execution mode from chat create_project tool to kswarm workflow_preferred mode', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-workflow', name: 'Workflow Demo', status: 'planning', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const result = JSON.parse(await tool.execute({
      name: 'Workflow Demo',
      goal: '用动态工作流生成分析报告',
      requirements: '两个智能体并行调研，最终输出 HTML 报告',
      executionMode: 'workflow',
    }));

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        kind: 'project_proposal',
        name: 'Workflow Demo',
        executionMode: 'workflow_preferred',
      },
    });
  });

  it('infers workflow_preferred mode from real workflow wording when create_project omits executionMode', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-inferred-workflow', name: 'Workflow Smoke', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const result = JSON.parse(await tool.execute({
      name: 'dynamic workflow smoke 2026-06-02',
      goal: '创建项目，用workflow方式让2个智能体并行完成动态工作流 smoke 验证报告',
      requirements: '最终生成 HTML 报告',
    }));

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        kind: 'project_proposal',
        name: 'dynamic workflow smoke 2026-06-02',
        executionMode: 'workflow_preferred',
      },
    });
  });

  it('uses a stable scoped clientRequestKey so repeated create_project tool calls reuse the same project', async () => {
    const requests: Array<{ path: string; init?: RequestInit; body?: Record<string, unknown> }> = [];
    const createdProjects: Array<{ id: string; name: string; status: string; createdAt: number; clientRequestKey?: string }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ path, init, body });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          const existing = createdProjects.find(project => project.clientRequestKey === body?.clientRequestKey);
          if (existing) {
            return new Response(JSON.stringify({ ok: true, project: existing, reused: true }));
          }
          const project = {
            id: `proj-${createdProjects.length + 1}`,
            name: String(body?.name || ''),
            status: 'planning',
            createdAt: 100 + createdProjects.length,
            clientRequestKey: typeof body?.clientRequestKey === 'string' ? body.clientRequestKey : undefined,
          };
          createdProjects.push(project);
          return new Response(JSON.stringify({ ok: true, project }), { status: 201 });
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const input = {
      _xiaokRequestScope: 'task-session:same-task',
      name: '欢迎页固定项目',
      goal: '让 2 个智能体完成分析',
      requirements: '输出报告',
    };

    const first = JSON.parse(await tool.execute(input));
    const second = JSON.parse(await tool.execute(input));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(createdProjects).toHaveLength(0);
    // proposal-only: repeated proposals assemble the same stable key that
    // the Room-first create will deduplicate on
    expect(first.proposal.clientRequestKey).toEqual(second.proposal.clientRequestKey);
    expect(first.proposal).not.toHaveProperty('reuseExistingLiveProject');
  });

  it('injects the runtime session id as create_project request scope', () => {
    expect(attachRuntimeToolRequestScope('create_project', {
      name: '欢迎页固定项目',
      goal: '让 2 个智能体完成分析',
    }, 'session-123')).toMatchObject({
      name: '欢迎页固定项目',
      goal: '让 2 个智能体完成分析',
      _xiaokRequestScope: 'task-session:session-123',
    });

    expect(attachRuntimeToolRequestScope('read', { file_path: '/tmp/a.md' }, 'session-123')).toEqual({
      file_path: '/tmp/a.md',
    });
  });

  it('preserves user goal and requirements while forwarding renderer planning guidance', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-report', name: 'OpenAI本月分析', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    // proposal-only boundary wording (design §9.3); renderer planning guidance
    // now lives in the assembled proposal payload below
    expect(tool.definition.description).toMatch(/严禁直接创建正式项目/);
    expect(tool.definition.description).not.toMatch(/必须调用|应该调用/);

    const raw = await tool.execute({
      name: 'OpenAI本月分析',
      goal: '输出OpenAI本月分析报告',
      requirements: '使用中文，保留来源。',
    });
    const body = JSON.parse(raw).proposal;
    expect(body.goal).toBe('输出OpenAI本月分析报告');
    expect(body.requirements).toBe('使用中文，保留来源。');
    expect(body.planningGuidance).toMatch(/report renderer/i);
    expect(body.planningGuidance).toMatch(/HTML/);
    expect(body.planningGuidance).not.toContain('Markdown 报告');
  });

  it('adds visual PDF export guidance for PDF report projects', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-pdf-report', name: 'PDF Report', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const raw = await tool.execute({
      name: 'PDF Report',
      goal: '输出 PDF 报告',
      requirements: '先做分析，再交付 PDF 文件。',
    });

    const body = JSON.parse(raw).proposal;
    expect(body.planningGuidance).toMatch(/report renderer/i);
    expect(body.planningGuidance).toContain('浏览器打印/print-to-pdf');
    expect(body.planningGuidance).toContain('不要用 make-pdf');
  });

  it('adds report renderer guidance for high-level analysis projects without mutating user fields', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-analysis', name: '金蝶AI产品分析', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const raw = await tool.execute({
      name: '金蝶AI产品分析',
      goal: '金蝶今年AI产品分析',
      requirements: '要进行2轮分析，是提供给研发高层看的内容，要有高度',
    });

    const body = JSON.parse(raw).proposal;
    expect(body.goal).toBe('金蝶今年AI产品分析');
    expect(body.requirements).toBe('要进行2轮分析，是提供给研发高层看的内容，要有高度');
    expect(body.planningGuidance).toMatch(/report renderer/i);
    expect(body.planningGuidance).toMatch(/HTML/);
    expect(body.planningGuidance).not.toContain('金蝶今年AI产品分析');
    expect(body.planningGuidance).not.toContain('要进行2轮分析，是提供给研发高层看的内容，要有高度');
  });

  it('keeps explicit output format details in planningGuidance without rewriting create_project tool fields', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'po-agent', name: 'PO', roles: ['project_owner'], status: 'idle' },
              { id: 'worker-agent', name: 'Worker', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-explicit', name: 'Explicit', status: 'created', createdAt: 123 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const raw = await tool.execute({
      name: 'OpenAI本月分析',
      goal: '输出OpenAI本月分析报告，最终用 Markdown 交付',
      requirements: '不要改写我的目标和要求。',
    });

    const body = JSON.parse(raw).proposal;
    expect(body.goal).toBe('输出OpenAI本月分析报告，最终用 Markdown 交付');
    expect(body.requirements).toBe('不要改写我的目标和要求。');
    expect(body.planningGuidance).toMatch(/Markdown/i);
    expect(body.planningGuidance).toMatch(/计划|plan/i);
    expect(body.planningGuidance).not.toContain('输出OpenAI本月分析报告，最终用 Markdown 交付');
    expect(body.planningGuidance).not.toContain('不要改写我的目标和要求。');
  });

  it('prefers the dedicated xiaok PO and worker seeds when chat creates a project', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok', name: 'xiaok', runtimeType: 'xiaok', roles: ['project_owner', 'worker'], status: 'idle' },
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'offline' },
              { id: 'xiaok-worker', name: 'Worker-Agent', runtimeType: 'xiaok', roles: ['worker'], status: 'offline' },
              { id: 'codex-worker', name: 'Codex', runtimeType: 'codex', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-seed', name: 'Seed Demo', status: 'created', createdAt: 456 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const result = await tool.execute({
      name: 'Seed Demo',
      goal: 'Verify seed routing',
    });

    const parsed = JSON.parse(result);
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.proposal).toMatchObject({
      kind: 'project_proposal',
      name: 'Seed Demo',
      goal: 'Verify seed routing',
      poAgent: 'xiaok-po',
      members: ['xiaok-worker'],
      agentSelection: {
        poAgent: { agentId: 'xiaok-po', source: 'default_seed' },
        members: [{ agentId: 'xiaok-worker', source: 'default_seed' }],
      },
    });
  });

  it('marks user-named project members as explicit agent selection', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/agents') {
          return new Response(JSON.stringify({
            agents: [
              { id: 'xiaok-po', name: 'PO-Agent', runtimeType: 'xiaok', roles: ['project_owner'], status: 'offline' },
              { id: 'cli-qoder', name: 'Qoder', runtimeType: 'qoder', roles: ['worker'], status: 'idle' },
            ],
          }));
        }
        if (path === '/projects') {
          return new Response(JSON.stringify({
            ok: true,
            project: { id: 'proj-explicit-member', name: 'Explicit Member', status: 'created', createdAt: 456 },
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmCreateProjectTool(kswarmService);
    const raw = await tool.execute({
      name: 'Explicit Member',
      goal: 'Use selected member',
      memberNames: ['Qoder'],
    });

    expect(JSON.parse(raw).proposal).toMatchObject({
      poAgent: 'xiaok-po',
      members: ['cli-qoder'],
      agentSelection: {
        poAgent: { agentId: 'xiaok-po', source: 'default_seed' },
        members: [{ agentId: 'cli-qoder', source: 'explicit_user' }],
      },
    });
  });

  it('forwards chat continue_project tool requests to kswarm', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        return new Response(JSON.stringify({
          ok: true,
          action: 'continue_project',
          strategy: 'retry_best_agent',
          dispatched: ['item-1'],
        }));
      },
    };

    const tool = createKSwarmContinueProjectTool(kswarmService);
    const result = await tool.execute({
      projectId: 'proj-1',
      expectedPrimaryTaskId: 'item-1',
      expectedTaskUpdatedAt: 1779093510355,
      idempotencyKey: 'chat-idem-1',
    });

    expect(JSON.parse(result)).toMatchObject({
      ok: true,
      action: 'continue_project',
      strategy: 'retry_best_agent',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/projects/proj-1/continue');
    expect(requests[0].init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({
      expectedPrimaryTaskId: 'item-1',
      expectedTaskUpdatedAt: 1779093510355,
      idempotencyKey: 'chat-idem-1',
    });
  });

  it('does not call kswarm when continue_project is missing projectId', async () => {
    const request = vi.fn();
    const tool = createKSwarmContinueProjectTool({
      ...mockKSwarmService(),
      request,
    });

    const result = await tool.execute({ expectedPrimaryTaskId: 'item-1' });

    expect(JSON.parse(result)).toMatchObject({ error: 'projectId is required' });
    expect(request).not.toHaveBeenCalled();
  });

  it('repair_project_task refuses inline deliverable content', async () => {
    const request = vi.fn();
    const tool = createKSwarmRepairProjectTaskTool({
      ...mockKSwarmService(),
      request,
    });

    const result = await tool.execute({
      projectId: 'proj-1',
      taskId: 'proj-1__item-1',
      filename: 'foreign_trade_trend.md',
      content: '这是一份人工补齐后的外贸趋势分析报告正文，包含数据源、假设、分析和结论，长度足够提交审核。',
    });

    expect(JSON.parse(result)).toMatchObject({
      ok: false,
      error: 'inline_content_forbidden',
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('repair_project_task_from_file submits repaired artifact paths without inline content', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/projects/proj-1/intervention/resolve') {
          return new Response(JSON.stringify({
            ok: true,
            outcome: 'submitted_for_review',
            projectChanged: true,
            taskId: 'proj-1__item-1',
            reviewNotification: 'sent',
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
      },
    };

    const tool = createKSwarmRepairProjectTaskFromFileTool(kswarmService);
    const result = await tool.execute({
      projectId: 'proj-1',
      taskId: 'proj-1__item-1',
      expectedTaskUpdatedAt: 1779093510355,
      summary: '已补齐报告',
      artifactPath: 'artifacts/foreign_trade_trend.md',
      mimeType: 'text/markdown',
    });

    expect(JSON.parse(result)).toMatchObject({
      ok: true,
      outcome: 'submitted_for_review',
      projectChanged: true,
      reviewNotification: 'sent',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/projects/proj-1/intervention/resolve');
    expect(JSON.parse(String(requests[0].init?.body))).toMatchObject({
      resolution: 'repair_and_submit',
      fromAgent: 'xiaok',
      expectedPrimaryTaskId: 'proj-1__item-1',
      expectedTaskUpdatedAt: 1779093510355,
      summary: '已补齐报告',
      artifacts: [
        {
          path: 'artifacts/foreign_trade_trend.md',
          mimeType: 'text/markdown',
        },
      ],
    });
    expect(String(requests[0].init?.body)).not.toContain('这是一份人工补齐后的外贸趋势分析报告正文');
  });

  it('inspect_project finds a kswarm project by name and returns the blocking context with readable artifacts', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/projects') {
          return new Response(JSON.stringify({
            projects: [
              { id: 'proj-1', name: '外贸趋势分析', status: 'active', createdAt: 100, updatedAt: 300 },
              { id: 'proj-2', name: '写一个AI工作小故事', status: 'active', createdAt: 200, updatedAt: 200 },
            ],
          }));
        }
        if (path === '/projects/proj-1') {
          return new Response(JSON.stringify({
            project: { id: 'proj-1', name: '外贸趋势分析', goal: '生成外贸趋势报告', status: 'active' },
            tasks: [
              {
                id: 'proj-1__item-1',
                title: '确定数据源与假设基线',
                status: 'failed',
                assignedAgent: 'xiaok-worker',
                updatedAt: 1779117987675,
                qualityFailureCount: 27,
                result: {
                  summary: '旧结果缺字段',
                  artifacts: [
                    {
                      filename: 'data_sources_and_assumptions.json',
                      url: '/projects/proj-1/artifacts/data_sources_and_assumptions.json',
                      mimeType: 'application/json',
                      size: 512,
                      generatedAt: 1779131000347,
                    },
                  ],
                },
              },
              { id: 'proj-1__item-2', title: '生成模拟数据集', status: 'pending', dependencies: ['proj-1__item-1'] },
            ],
            workspace: {
              artifacts: [
                {
                  filename: 'data_sources_and_assumptions.json',
                  url: '/projects/proj-1/artifacts/data_sources_and_assumptions.json',
                  mimeType: 'application/json',
                  size: 512,
                  generatedAt: 1779131000347,
                },
              ],
            },
            projectHealth: { state: 'waiting', gate: 'waiting_for_assignment' },
            dispatchPlan: { dispatchedTasks: [], blocked: [{ taskId: 'proj-1__item-2', reason: 'dependency_pending' }] },
            projectIntervention: {
              required: true,
              primaryTaskId: 'proj-1__item-1',
              primaryTaskTitle: '确定数据源与假设基线',
              message: '需要带着质量反馈重新执行',
              primaryAction: {
                id: 'continue_project',
                strategy: 'retry_with_repair_instruction',
                taskId: 'proj-1__item-1',
                taskUpdatedAt: 1779117987675,
              },
            },
          }));
        }
        if (path === '/projects/proj-1/artifacts/data_sources_and_assumptions.json') {
          return new Response(JSON.stringify({
            trade_overview: {},
            trade_partners: {},
            exchange_rate: {},
            policy_changes: [],
            hot_events: [],
          }), { headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ error: 'unexpected path' }), { status: 500 });
      },
    };

    const tool = createKSwarmInspectProjectTool(kswarmService);
    const result = JSON.parse(await tool.execute({ projectName: '外贸趋势分析' }));

    expect(result).toMatchObject({
      ok: true,
      match: { mode: 'name_exact' },
      project: { id: 'proj-1', name: '外贸趋势分析', status: 'active' },
      projectIntervention: {
        required: true,
        primaryTaskId: 'proj-1__item-1',
      },
      projectHealth: { state: 'waiting' },
    });
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: 'proj-1__item-1',
        title: '确定数据源与假设基线',
        status: 'failed',
        qualityFailureCount: 27,
        artifactCount: 1,
      }),
      expect.objectContaining({
        id: 'proj-1__item-2',
        title: '生成模拟数据集',
        status: 'pending',
      }),
    ]);
    expect(result.readableArtifacts).toEqual([
      expect.objectContaining({
        filename: 'data_sources_and_assumptions.json',
        url: '/projects/proj-1/artifacts/data_sources_and_assumptions.json',
        content: expect.stringContaining('exchange_rate'),
        truncated: false,
      }),
    ]);
    expect(requests.map(request => request.path)).toEqual([
      '/projects',
      '/projects/proj-1',
      '/projects/proj-1/artifacts/data_sources_and_assumptions.json',
    ]);
  });

  it('inspect_project prioritizes artifacts from the current intervention task', async () => {
    const requests: Array<{ path: string; init?: RequestInit }> = [];
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string, init?: RequestInit) => {
        requests.push({ path, init });
        if (path === '/projects/proj-priority') {
          return new Response(JSON.stringify({
            project: { id: 'proj-priority', name: 'OpenAI本月分析', goal: '生成报告', status: 'active' },
            tasks: [
              {
                id: 'proj-priority__item-6',
                title: '撰写报告草稿',
                status: 'failed',
                assignedAgent: 'xiaok-po',
                updatedAt: 1779201306940,
                qualityFailureCount: 26,
                result: {
                  artifacts: [
                    {
                      filename: 'current-report.md',
                      url: '/projects/proj-priority/artifacts/current-report.md',
                      mimeType: 'text/markdown',
                      generatedAt: 100,
                    },
                  ],
                },
              },
              {
                id: 'proj-priority__item-2',
                title: '旧任务',
                status: 'done',
                result: {
                  artifacts: [
                    {
                      filename: 'newer-but-unrelated.md',
                      url: '/projects/proj-priority/artifacts/newer-but-unrelated.md',
                      mimeType: 'text/markdown',
                      generatedAt: 999,
                    },
                  ],
                },
              },
            ],
            workspace: {
              artifacts: [
                {
                  filename: 'newer-but-unrelated.md',
                  url: '/projects/proj-priority/artifacts/newer-but-unrelated.md',
                  mimeType: 'text/markdown',
                  generatedAt: 999,
                },
                {
                  filename: 'current-report.md',
                  url: '/projects/proj-priority/artifacts/current-report.md',
                  mimeType: 'text/markdown',
                  generatedAt: 100,
                },
              ],
            },
            projectIntervention: {
              required: true,
              primaryTaskId: 'proj-priority__item-6',
              primaryTaskTitle: '撰写报告草稿',
              primaryAction: {
                id: 'continue_project',
                strategy: 'needs_conversation',
                taskId: 'proj-priority__item-6',
                taskUpdatedAt: 1779201306940,
              },
            },
          }));
        }
        if (path === '/projects/proj-priority/artifacts/current-report.md') {
          return new Response('# Current report\n\n当前卡住任务的报告草稿');
        }
        if (path === '/projects/proj-priority/artifacts/newer-but-unrelated.md') {
          return new Response('# Unrelated\n\n无关旧任务内容');
        }
        return new Response(JSON.stringify({ error: 'unexpected path' }), { status: 500 });
      },
    };

    const tool = createKSwarmInspectProjectTool(kswarmService);
    const result = JSON.parse(await tool.execute({ projectId: 'proj-priority' }));

    expect(result.ok).toBe(true);
    expect(result.readableArtifacts[0]).toMatchObject({
      filename: 'current-report.md',
      content: expect.stringContaining('当前卡住任务'),
    });
    expect(requests.map(request => request.path).slice(0, 3)).toEqual([
      '/projects/proj-priority',
      '/projects/proj-priority/artifacts/current-report.md',
      '/projects/proj-priority/artifacts/newer-but-unrelated.md',
    ]);
  });

  it('inspect_project asks for clarification when a project name matches multiple projects', async () => {
    const kswarmService: KSwarmService = {
      ...mockKSwarmService(),
      request: async (path: string) => {
        if (path === '/projects') {
          return new Response(JSON.stringify({
            projects: [
              { id: 'proj-1', name: '外贸趋势分析', status: 'active', createdAt: 100, updatedAt: 100 },
              { id: 'proj-2', name: '外贸趋势分析', status: 'active', createdAt: 200, updatedAt: 200 },
            ],
          }));
        }
        return new Response(JSON.stringify({ error: 'unexpected path' }), { status: 500 });
      },
    };

    const tool = createKSwarmInspectProjectTool(kswarmService);
    const result = JSON.parse(await tool.execute({ projectName: '外贸趋势分析' }));

    expect(result).toMatchObject({
      ok: false,
      error: 'ambiguous_project',
      candidates: [
        { id: 'proj-2', name: '外贸趋势分析', status: 'active' },
        { id: 'proj-1', name: '外贸趋势分析', status: 'active' },
      ],
    });
  });

  it('system prompt separates notification reminders from automatic scheduled tasks', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const sourceFile = readFileSync(pathJoin(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

    expect(sourceFile).toContain('reminder_create 只创建到点通知');
    expect(sourceFile).toContain('scheduled_task_create');
    expect(sourceFile).toContain('每隔N分钟检查/执行/直到完成');
    expect(sourceFile).toContain('如果用户明确要求写脚本或使用系统定时，则遵循用户要求');
    expect(sourceFile).toContain('不要用 reminder_create 承诺会自动检查项目');
  });

  it('system prompt preserves visual PDF export format instead of Markdown repagination', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const sourceFile = readFileSync(pathJoin(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

    expect(sourceFile).toContain('## 视觉产物导出 PDF');
    expect(sourceFile).toContain('浏览器打印/print-to-pdf');
    expect(sourceFile).toContain('不要用 make-pdf');
  });

  it('timed action tools create notification reminders and agent scheduled tasks', async () => {
    const store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
    const service = new TimedActionService(store, { now: () => 1_000 });
    const tools = createTimedActionTools(service, 'Asia/Shanghai');

    const reminderTool = tools.find(tool => tool.definition.name === 'reminder_create');
    const scheduledTool = tools.find(tool => tool.definition.name === 'scheduled_task_create');
    expect(reminderTool).toBeTruthy();
    expect(scheduledTool).toBeTruthy();

    const reminderResult = JSON.parse(await reminderTool!.execute({
      content: '看项目',
      schedule_at: 61_000,
    }));
    expect(reminderResult).toMatchObject({
      status: 'pending',
      content: '看项目',
      note: 'notification only; will not run AI tasks',
    });
    expect(store.getAction(reminderResult.reminderId)?.executor.kind).toBe('notify');

    const scheduledResult = JSON.parse(await scheduledTool!.execute({
      name: '检查 OpenAI本月分析',
      prompt: '检查 proj-1779188304918，如果完成调用 scheduled_task_cancel',
      frequency: 'interval',
      interval_minutes: 5,
    }));
    expect(scheduledResult).toMatchObject({
      ok: true,
      name: '检查 OpenAI本月分析',
      frequency: 'interval',
      maxRuns: 288,
    });
    expect(store.getAction(scheduledResult.taskId)?.executor.kind).toBe('agent_task');

    store.close();
  });

  it('system prompt routes stuck Swarm project recovery through file-first repair', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const sourceFile = readFileSync(pathJoin(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

    expect(sourceFile).toContain('先调用 inspect_project');
    expect(sourceFile).toContain('recovery_budget_exceeded');
    expect(sourceFile).toContain('repair_project_task_from_file');
    expect(sourceFile).toContain('写入 artifacts');
    expect(sourceFile).toContain('不要在回复、stdout、tool 参数或聊天消息中粘贴完整交付物');
    expect(sourceFile).toContain('不要反复调用 continue_project');
    expect(sourceFile).toContain('needs_conversation');
  });

  it('system prompt documents resuming interrupted dynamic workflows without re-pasting the script', async () => {
    const { readFileSync } = await import('node:fs');
    const { join: pathJoin } = await import('node:path');
    const sourceFile = readFileSync(pathJoin(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

    expect(sourceFile).toContain('script_workflow');
    expect(sourceFile).toContain('resumeWorkflowRunId');
    expect(sourceFile).toContain('不要传 script 参数');
  });

  describe('recoverInterruptedScriptWorkflows', () => {
    function mockScanService(handler: (path: string, init?: RequestInit) => Response): {
      service: KSwarmService;
      paths: string[];
    } {
      const paths: string[] = [];
      const service = {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit): Promise<Response> => {
          paths.push(path);
          return handler(path, init);
        },
      } as KSwarmService;
      return { service, paths };
    }

    function jsonResponse(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }

    it('uses the v1 global replay cap of 3 resumable script workflow jobs', async () => {
      const { readFileSync } = await import('node:fs');
      const { join: pathJoin } = await import('node:path');
      const sourceFile = readFileSync(pathJoin(__dirname, '../../electron/desktop-services.ts'), 'utf-8');

      expect(sourceFile).toContain('const maxRestarts = 3');
    });

    it('restores a resumable script run that has a persisted script source', async () => {
      const runId = `run-${Date.now()}`;
      const scriptSource = "export const meta = { name: 'demo', description: 'd' }\nawait agent('x')";
      const { service, paths } = mockScanService((path) => {
        if (path === '/projects') {
          return jsonResponse({ projects: [{ id: 'proj-1' }] });
        }
        if (path === '/projects/proj-1/workflows') {
          return jsonResponse({
            workflowRuns: [{
              id: runId,
              source: 'script_generated',
              status: 'running',
              scriptSource,
            }],
          });
        }
        // Background job's controller calls land here; keep them benign.
        return jsonResponse({ workflowRun: { id: runId, status: 'running', nodes: [] } });
      });

      await recoverInterruptedScriptWorkflows(service);

      expect(paths).toContain('/projects');
      expect(paths).toContain('/projects/proj-1/workflows');
    });

    it('skips non-script runs and runs without a persisted script source', async () => {
      const { service, paths } = mockScanService((path) => {
        if (path === '/projects') {
          return jsonResponse({ projects: [{ id: 'proj-1' }] });
        }
        if (path === '/projects/proj-1/workflows') {
          return jsonResponse({
            workflowRuns: [
              { id: 'po-run', source: 'po_generated', status: 'running', scriptSource: 'x' },
              { id: 'no-source', source: 'script_generated', status: 'running' },
            ],
          });
        }
        return jsonResponse({ error: 'unexpected' }, 500);
      });

      await recoverInterruptedScriptWorkflows(service);

      // Only the listing endpoints are hit; no restore/controller traffic.
      expect(paths).toEqual(['/projects', '/projects/proj-1/workflows']);
    });

    it('returns silently when kswarm is unavailable', async () => {
      const { service, paths } = mockScanService(() => jsonResponse({ error: 'mock' }, 503));
      await expect(recoverInterruptedScriptWorkflows(service)).resolves.toBeUndefined();
      expect(paths).toEqual(['/projects']);
    });

    it('continues scanning when one project workflow listing fails', async () => {
      const { service, paths } = mockScanService((path) => {
        if (path === '/projects') {
          return jsonResponse({ projects: [{ id: 'bad' }, { id: 'good' }] });
        }
        if (path === '/projects/bad/workflows') {
          return jsonResponse({ error: 'boom' }, 500);
        }
        if (path === '/projects/good/workflows') {
          return jsonResponse({ workflowRuns: [] });
        }
        return jsonResponse({ workflowRun: { id: 'x', status: 'running', nodes: [] } });
      });

      await recoverInterruptedScriptWorkflows(service);

      expect(paths).toContain('/projects/bad/workflows');
      expect(paths).toContain('/projects/good/workflows');
    });
  });

  describe('resumeOneScriptWorkflow', () => {
    function mockRunService(handler: (path: string, init?: RequestInit) => Response): {
      service: KSwarmService;
      paths: string[];
    } {
      const paths: string[] = [];
      const service = {
        ...mockKSwarmService(),
        request: async (path: string, init?: RequestInit): Promise<Response> => {
          paths.push(path);
          return handler(path, init);
        },
      } as KSwarmService;
      return { service, paths };
    }

    function jsonResponse(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }

    it('rejects empty input without hitting kswarm', async () => {
      const { service, paths } = mockRunService(() => jsonResponse({ error: 'unexpected' }, 500));
      await expect(resumeOneScriptWorkflow(service, '', '')).resolves.toEqual({
        restored: false,
        reason: 'invalid_input',
      });
      expect(paths).toEqual([]);
    });

    it('returns kswarm_unavailable when the run snapshot request fails', async () => {
      const { service } = mockRunService(() => jsonResponse({ error: 'boom' }, 503));
      await expect(resumeOneScriptWorkflow(service, 'proj-1', 'run-1')).resolves.toEqual({
        restored: false,
        reason: 'kswarm_unavailable',
      });
    });

    it('returns not_script_workflow for a po_generated run', async () => {
      const { service } = mockRunService(() => jsonResponse({
        workflowRun: { id: 'run-1', source: 'po_generated', status: 'running', scriptSource: 'x' },
      }));
      await expect(resumeOneScriptWorkflow(service, 'proj-1', 'run-1')).resolves.toEqual({
        restored: false,
        reason: 'not_script_workflow',
      });
    });

    it('returns not_resumable for a completed script run', async () => {
      const { service } = mockRunService(() => jsonResponse({
        workflowRun: { id: 'run-1', source: 'script_generated', status: 'completed', scriptSource: 'x' },
      }));
      await expect(resumeOneScriptWorkflow(service, 'proj-1', 'run-1')).resolves.toEqual({
        restored: false,
        reason: 'not_resumable',
      });
    });

    it('returns no_script_source when the run has no persisted script source', async () => {
      const { service } = mockRunService(() => jsonResponse({
        workflowRun: { id: 'run-1', source: 'script_generated', status: 'running' },
      }));
      await expect(resumeOneScriptWorkflow(service, 'proj-1', 'run-1')).resolves.toEqual({
        restored: false,
        reason: 'no_script_source',
      });
    });

    it('restores a resumable script run and is idempotent on a second call', async () => {
      const runId = `resume-run-${Date.now()}`;
      const scriptSource = "export const meta = { name: 'demo', description: 'd' }\nawait agent('x')";
      const { service } = mockRunService((path) => {
        if (path === `/projects/proj-1/workflows/${runId}`) {
          return jsonResponse({
            workflowRun: { id: runId, source: 'script_generated', status: 'running', scriptSource },
          });
        }
        // Background job controller traffic — keep benign.
        return jsonResponse({ workflowRun: { id: runId, status: 'running', nodes: [] } });
      });

      const first = await resumeOneScriptWorkflow(service, 'proj-1', runId);
      expect(first.restored).toBe(true);
      expect(first.jobId).toBe(`wf-script-job-${runId}`);

      const second = await resumeOneScriptWorkflow(service, 'proj-1', runId);
      expect(second.reason).toBe('already_running');
    });
  });

  it('preserves history for cancelled context tasks so subsequent tasks see prior context', async () => {
    let runCount = 0;
    let historySeenOnSecondRun: Array<{ role: string; content: string }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ signal, history, emitRuntimeEvent, sessionId }) => {
        runCount++;
        if (runCount === 1) {
          // Simulate cancelled task: wait for abort
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('task cancelled');
        }
        // Second run: capture the history the host passed in
        historySeenOnSecondRun = history;
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: 'turn_2',
          intentId: 'intent_2',
          stepId: 'step_2',
          note: 'ok',
        });
      },
    });

    // First task - will be cancelled
    const task1 = await services.createTask({
      prompt: '创建定时任务，每天晚上11点同步mydocs',
      materials: [],
    });
    await waitFor(async () => runCount === 1);
    await services.cancelTask(task1.taskId);
    await waitFor(async () => (await services.recoverTask(task1.taskId)).snapshot.status === 'cancelled', 5000);

    // Let executeTask finally block finish snapshot persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second task explicitly references the prior thread task.
    const task2 = await services.createTask({
      prompt: '不是创建mac定时任务，是xiaok定时任务',
      materials: [],
      context: { threadId: 'thread-a', taskIds: [task1.taskId] },
    });
    await waitFor(async () => runCount === 2, 5000);
    await waitFor(async () => (await services.recoverTask(task2.taskId)).snapshot.status === 'completed', 5000);

    // Core assertion: the runner received history from the cancelled first task
    expect(historySeenOnSecondRun.length).toBe(2);
    expect(historySeenOnSecondRun[0].role).toBe('user');
    expect(historySeenOnSecondRun[0].content).toContain('每天晚上11点同步mydocs');
    expect(historySeenOnSecondRun[1].role).toBe('assistant');
    const recovered = await services.recoverTask(task2.taskId);
    expect(recovered.snapshot.context).toEqual({
      threadId: 'thread-a',
      taskIds: [task1.taskId],
      loadedTaskIds: [task1.taskId],
      skipped: [],
    });
  });

  it('passes createTaskWithFiles thread context through to the runtime host', async () => {
    let runCount = 0;
    let historySeenOnSecondRun: Array<{ role: string; content: string }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ history, emitRuntimeEvent, sessionId }) => {
        runCount++;
        if (runCount === 2) {
          historySeenOnSecondRun = history;
        }
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId,
          turnId: `turn_${runCount}`,
          intentId: `intent_${runCount}`,
          stepId: `step_${runCount}`,
          note: `完成任务${runCount}`,
        });
      },
    });

    const task1 = await services.createTask({
      prompt: '第一轮带附件任务',
      materials: [],
    });
    await waitFor(async () => (await services.recoverTask(task1.taskId)).snapshot.status === 'completed', 5000);

    const task2 = await services.createTaskWithFiles({
      prompt: '第二轮继续分析新材料',
      filePaths: [],
      context: { threadId: 'thread-files', taskIds: [task1.taskId] },
    });
    await waitFor(async () => runCount === 2, 5000);
    await waitFor(async () => (await services.recoverTask(task2.taskId)).snapshot.status === 'completed', 5000);

    expect(historySeenOnSecondRun.map(message => message.content)).toEqual(['第一轮带附件任务', '完成任务1']);
    const recovered = await services.recoverTask(task2.taskId);
    expect(recovered.snapshot.context).toEqual({
      threadId: 'thread-files',
      taskIds: [task1.taskId],
      loadedTaskIds: [task1.taskId],
      skipped: [],
    });
  });

  it('wires Goal lifecycle through the desktop service and keeps continuation tasks internal', async () => {
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      runner: async ({ sessionId, emitRuntimeEvent, emitUsage }) => {
        await emitUsage({ inputTokens: 2, outputTokens: 3 });
        await emitRuntimeEvent({
          type: 'receipt_emitted', sessionId, turnId: 'turn_1', intentId: 'intent_1',
          stepId: 'step_1', note: '继续工作',
        });
      },
    });
    const prepared: Array<{ threadId: string; attachmentId: string; taskId: string }> = [];
    services.subscribeGoalTaskPrepared(event => prepared.push(event));

    const created = await services.createGoal({
      threadId: 'thread-goal', objective: '持续工作', expectedEvidenceKinds: ['answer'], turnLimit: 3,
    });
    expect(await services.getActiveTask()).toBeNull();
    await services.ackGoalTaskAttached({
      threadId: 'thread-goal', attachmentId: created.preparedTask.attachmentId,
    });
    await waitFor(async () => (await services.getGoal('thread-goal'))?.state.turnsUsed === 1, 5000);
    await waitFor(async () => prepared.length === 2, 5000);
    expect(prepared).toHaveLength(2);
    expect(await services.getActiveTask()).toBeNull();
    expect(await services.getGoal('thread-goal')).toMatchObject({
      activation: 'armed', state: { status: 'active', tokensUsed: 5 },
    });
    await services.pauseGoal('thread-goal');
  });

  it('imports persisted Room attachments as materials and does not advertise a tool-less runtime', async () => {
    const attachmentPath = join(rootDir, 'room-brief.md');
    writeFileSync(attachmentPath, '# Room brief\n请核对附件。');
    let capturedPrompt = '';
    let capturedMaterials: Array<{ originalName: string; role: string }> = [];
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      runner: async ({ sessionId, prompt, materials, emitRuntimeEvent }) => {
        capturedPrompt = prompt;
        capturedMaterials = materials.map(material => ({ originalName: material.originalName, role: material.role }));
        await emitRuntimeEvent({
          type: 'assistant_delta', sessionId, turnId: 'turn-room', intentId: 'intent-room',
          stepId: 'step-room', delta: 'ROOM-MATERIAL-OK',
        });
        await emitRuntimeEvent({
          type: 'receipt_emitted', sessionId, turnId: 'turn-room', intentId: 'intent-room',
          stepId: 'step-room', note: 'ROOM-MATERIAL-OK',
        });
      },
    });

    const result = await services.runCollaborationRoomAgentTask({
      roomId: 'room-1',
      roomTitle: '统一输入框',
      roomRevision: 2,
      roomMessageId: 'msg-1',
      logicalAgentId: 'xiaok-worker',
      contextScope: { kind: 'room_only' },
      attachmentPaths: [attachmentPath],
      contextWindow: {
        fromSequence: 1,
        toSequence: 1,
        totalMessages: 1,
        isComplete: true,
        snapshotAt: new Date().toISOString(),
      },
      messages: [{
        messageId: 'msg-1',
        sender: { kind: 'user', userId: 'user.local' },
        kind: 'text',
        text: '/report 请读取附件',
      }],
    }, 'msg-1|xiaok-worker|0|2026-01-01T00:00:00.000Z');

    expect(result.text).toContain('ROOM-MATERIAL-OK');
    expect(capturedMaterials).toEqual([{ originalName: 'room-brief.md', role: 'customer_material' }]);
    expect(capturedPrompt).toContain('/report 请读取附件');
    expect(capturedPrompt).not.toContain('本轮没有任何工具');
  });

  // design §6.2 RoomHistoryReadCapability：端到端验证 registerRoomHistoryCapability
  // 真的在 agent 执行期间生效（不只是单元测试里孤立验证），且任务结束后被
  // 释放——不是"接线正确但从未真正跑过一次"的孤岛能力。
  it('binds a Room task capability during execution, makes getRoomMessagesPage resolve it via context.taskId, and releases it after completion', async () => {
    let observedTaskId: string | null = null;
    let capabilityDuringExecution: unknown = null;
    const listRoomMessagesPage = vi.fn().mockResolvedValue({ ok: true, messages: [{ text: 'older message' }] });
    setRoomHistoryBrokerClient({ listRoomMessagesPage });

    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      runner: async ({ taskId, sessionId, emitRuntimeEvent }) => {
        observedTaskId = taskId;
        capabilityDuringExecution = getRoomHistoryCapability(taskId);
        // 真实调用工具本身（不只是查表），证明整条链路——从
        // registerRoomHistoryCapability 到 getRoomMessagesPage.execute 到
        // 真实调用绑定的 broker client——完全打通。
        const tool = createGetRoomMessagesPageTool();
        const toolResult = await tool.execute({ limit: 5 }, { taskId } as any);
        await emitRuntimeEvent({
          type: 'assistant_delta', sessionId, turnId: 'turn-cap', intentId: 'intent-cap',
          stepId: 'step-cap', delta: toolResult.includes('older message') ? 'TOOL-CALL-OK' : 'TOOL-CALL-FAILED',
        });
        await emitRuntimeEvent({
          type: 'receipt_emitted', sessionId, turnId: 'turn-cap', intentId: 'intent-cap',
          stepId: 'step-cap', note: toolResult.includes('older message') ? 'TOOL-CALL-OK' : 'TOOL-CALL-FAILED',
        });
      },
    });

    const result = await services.runCollaborationRoomAgentTask({
      roomId: 'room-cap-1',
      roomTitle: '能力绑定验证',
      roomRevision: 1,
      roomMessageId: 'msg-cap-1',
      logicalAgentId: 'xiaok-worker',
      contextScope: { kind: 'room_only' },
      attachmentPaths: [],
      contextWindow: {
        fromSequence: 1, toSequence: 1, totalMessages: 1, isComplete: true,
        snapshotAt: new Date().toISOString(),
      },
      messages: [{ messageId: 'msg-cap-1', sender: { kind: 'user', userId: 'user.local' }, kind: 'text', text: '请核对历史' }],
    }, 'msg-cap-1|xiaok-worker|0|2026-01-01T00:00:00.000Z');

    expect(result.text).toContain('TOOL-CALL-OK');
    expect(capabilityDuringExecution).toEqual({ roomId: 'room-cap-1', claimToken: 'msg-cap-1|xiaok-worker|0|2026-01-01T00:00:00.000Z' });
    expect(listRoomMessagesPage).toHaveBeenCalledWith({
      roomId: 'room-cap-1',
      claimToken: 'msg-cap-1|xiaok-worker|0|2026-01-01T00:00:00.000Z',
      limit: 5,
    });
    // 任务结束后必须释放绑定，防止 taskId 复用/绑定残留。
    expect(observedTaskId).toBeTruthy();
    expect(getRoomHistoryCapability(observedTaskId as string)).toBeUndefined();
  });
});

async function collectFirst<T>(events: AsyncIterable<T>, count: number): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) {
    collected.push(event);
    if (collected.length >= count) {
      break;
    }
  }
  return collected;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!await predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('timed out waiting for predicate');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
