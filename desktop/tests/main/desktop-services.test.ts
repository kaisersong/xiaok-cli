import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices, createKSwarmContinueProjectTool, createKSwarmCreateProjectTool, createKSwarmInspectProjectTool, createKSwarmRepairProjectTaskFromFileTool, createKSwarmRepairProjectTaskTool, createTimedActionTools } from '../../electron/desktop-services.js';
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
    request: async (path: string, init?: RequestInit) => new Response('{"error":"mock"}', { status: 501 }),
  };
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
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'assistant_delta', delta: '模型' }),
      expect.objectContaining({ type: 'assistant_delta', delta: '回复内容' }),
      expect.objectContaining({ type: 'result', result: expect.objectContaining({ summary: '模型回复内容' }) }),
      expect.objectContaining({ type: 'result' }),
    ]));
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
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner: async ({ sessionId, prompt, emitRuntimeEvent }) => {
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
    expect(receivedPrompt).toContain('必须产出：markdown, report_html, json');
    expect(receivedPrompt).not.toContain('[object Object]');
    expect(result).toMatchObject({
      summary: '报告已生成。',
      artifacts: [{ path: artifactPath, kind: 'markdown', label: 'report.md' }],
      provenance: {
        runtimeSource: 'desktop-agent-runtime',
        producingAgent: 'xiaok-po',
      },
    });
  });

  it('runs a side-effect-free kswarm readiness probe', async () => {
    const runner = vi.fn(async () => {
      throw new Error('probe_must_not_run_user_task');
    });
    const services = createDesktopServices({
      dataRoot: join(rootDir, 'data'),
      kswarmService: mockKSwarmService(),
      now: () => 300,
      runner,
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
      minimax: 'https://api.minimax.chat/v1',
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

    expect(JSON.parse(result)).toMatchObject({ type: 'project_card', projectId: 'proj-1' });
    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
      name: 'Demo',
      goal: 'Ship a report',
      poAgent: 'po-agent',
      members: ['worker-agent'],
      workFolder: '/tmp/kswarm-demo',
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
    expect(tool.definition.description).toMatch(/报告.*report renderer.*HTML/i);
    expect(tool.definition.description).toMatch(/演示文稿|幻灯片/);
    expect(tool.definition.description).toMatch(/slide renderer.*HTML/i);

    await tool.execute({
      name: 'OpenAI本月分析',
      goal: '输出OpenAI本月分析报告',
      requirements: '使用中文，保留来源。',
    });

    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    const body = JSON.parse(String(createRequest?.init?.body));
    expect(body.goal).toBe('输出OpenAI本月分析报告');
    expect(body.requirements).toBe('使用中文，保留来源。');
    expect(body.planningGuidance).toMatch(/report renderer/i);
    expect(body.planningGuidance).toMatch(/HTML/);
    expect(body.planningGuidance).not.toContain('Markdown 报告');
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
    await tool.execute({
      name: '金蝶AI产品分析',
      goal: '金蝶今年AI产品分析',
      requirements: '要进行2轮分析，是提供给研发高层看的内容，要有高度',
    });

    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    const body = JSON.parse(String(createRequest?.init?.body));
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
    await tool.execute({
      name: 'OpenAI本月分析',
      goal: '输出OpenAI本月分析报告，最终用 Markdown 交付',
      requirements: '不要改写我的目标和要求。',
    });

    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    const body = JSON.parse(String(createRequest?.init?.body));
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

    expect(JSON.parse(result)).toMatchObject({ type: 'project_card', projectId: 'proj-seed', memberCount: 1 });
    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
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
    await tool.execute({
      name: 'Explicit Member',
      goal: 'Use selected member',
      memberNames: ['Qoder'],
    });

    const createRequest = requests.find(request => request.path === '/projects');
    expect(createRequest).toBeTruthy();
    expect(JSON.parse(String(createRequest?.init?.body))).toMatchObject({
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

  it('preserves history for cancelled tasks so subsequent tasks see prior context', async () => {
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

    // Let executeTask finally block finish recording history
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Second task
    const task2 = await services.createTask({
      prompt: '不是创建mac定时任务，是xiaok定时任务',
      materials: [],
    });
    await waitFor(async () => runCount === 2, 5000);
    await waitFor(async () => (await services.recoverTask(task2.taskId)).snapshot.status === 'completed', 5000);

    // Core assertion: the runner received history from the cancelled first task
    expect(historySeenOnSecondRun.length).toBe(2);
    expect(historySeenOnSecondRun[0].role).toBe('user');
    expect(historySeenOnSecondRun[0].content).toContain('每天晚上11点同步mydocs');
    expect(historySeenOnSecondRun[1].role).toBe('assistant');
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
