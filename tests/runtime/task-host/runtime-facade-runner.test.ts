import { describe, expect, it, vi } from 'vitest';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { createRuntimeFacadeTaskRunner } from '../../../src/runtime/task-host/runtime-facade-runner.js';
import type { MaterialRecord, TaskUnderstanding } from '../../../src/runtime/task-host/types.js';
import type { RuntimeEvent } from '../../../src/runtime/events.js';

describe('createRuntimeFacadeTaskRunner', () => {
  it('runs RuntimeFacade with material context and forwards scoped runtime hook events', async () => {
    const hooks = createRuntimeHooks();
    const runTurn = vi.fn(async (_request, _onChunk, signal?: AbortSignal) => {
      hooks.emit({
        type: 'breadcrumb_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        status: 'running',
        message: '正在生成方案大纲',
      });
      hooks.emit({
        type: 'breadcrumb_emitted',
        sessionId: 'other_session',
        turnId: 'turn_1',
        intentId: 'intent_2',
        stepId: 'step_2',
        status: 'running',
        message: '不应转发',
      });
      expect(signal?.aborted).toBe(false);
    });
    const emitted: RuntimeEvent[] = [];
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: { runTurn },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });

    await runner({
      taskId: 'task_1',
      sessionId: 'sess_1',
      prompt: '生成 A 客户方案 PPT',
      materials: [createMaterial()],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: (event) => {
        emitted.push(event);
      },
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 'sess_1',
      cwd: '/workspace/project',
      source: 'chat',
    });
    expect(runTurn.mock.calls[0]?.[0].input).toEqual([
      {
        type: 'text',
        text: [
          '任务目标：生成 A 客户方案 PPT',
          '任务类型：sales_deck',
          '预期交付物：可继续编辑的 PPT 初稿',
          '汇报对象：客户 CIO / 管理层',
          '材料：',
          '- mat_1 | A客户需求.md | customer_material | pending',
        ].join('\n'),
      },
    ]);
    expect(emitted).toEqual([{
      type: 'breadcrumb_emitted',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      intentId: 'intent_1',
      stepId: 'step_1',
      status: 'running',
      message: '正在生成方案大纲',
    }]);
  });

  it('unsubscribes runtime hooks after the runner finishes', async () => {
    const hooks = createRuntimeHooks();
    const emitted: RuntimeEvent[] = [];
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: {
        runTurn: async () => undefined,
      },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });

    await runner({
      taskId: 'task_1',
      sessionId: 'sess_1',
      prompt: '生成 A 客户方案 PPT',
      materials: [createMaterial()],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: (event) => {
        emitted.push(event);
      },
    });
    hooks.emit({
      type: 'breadcrumb_emitted',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      intentId: 'intent_1',
      stepId: 'step_1',
      status: 'running',
      message: 'late event',
    });

    expect(emitted).toEqual([]);
  });
});

function createMaterial(): MaterialRecord {
  return {
    materialId: 'mat_1',
    taskId: 'task_1',
    originalName: 'A客户需求.md',
    workspacePath: '/workspace/task_1/materials/mat_1.md',
    mimeType: 'text/markdown',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    role: 'customer_material',
    roleSource: 'user',
    parseStatus: 'pending',
    createdAt: 1,
  };
}

function createUnderstanding(): TaskUnderstanding {
  return {
    goal: '为 A 客户生成制造业数字化方案 PPT 初稿',
    deliverable: '可继续编辑的 PPT 初稿',
    taskType: 'sales_deck',
    audience: '客户 CIO / 管理层',
    inputs: [{ materialId: 'mat_1', name: 'A客户需求.md', role: 'customer_material', parseStatus: 'pending' }],
    missingInfo: ['报价表'],
    assumptions: ['报价相关页面先使用占位说明'],
    riskLevel: 'medium',
    suggestedPlan: [],
    nextAction: 'confirm_outline_direction',
  };
}
