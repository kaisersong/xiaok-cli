import { describe, expect, it, vi } from 'vitest';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { createRuntimeFacadeTaskRunner } from '../../../src/runtime/task-host/runtime-facade-runner.js';
import type { MaterialRecord, TaskUnderstanding } from '../../../src/runtime/task-host/types.js';
import type { RuntimeEvent } from '../../../src/runtime/events.js';

describe('createRuntimeFacadeTaskRunner', () => {
  it('preserves an external full UUID through RuntimeFacade request and scoped runtime hook association', async () => {
    const sessionId = 'sess_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const hooks = createRuntimeHooks();
    const runTurn = vi.fn(async (_request, _onChunk, signal?: AbortSignal) => {
      hooks.emit({
        type: 'breadcrumb_emitted',
        sessionId,
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        status: 'running',
        message: '正在生成方案大纲',
      });
      hooks.emit({
        type: 'breadcrumb_emitted',
        sessionId: 'sess_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
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
      sessionId,
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
      sessionId,
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
      sessionId,
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

  it('waits for scoped runtime event persistence before resolving the runner', async () => {
    const hooks = createRuntimeHooks();
    let releasePersistence: (() => void) | undefined;
    const persistenceRelease = new Promise<void>((resolve) => { releasePersistence = resolve; });
    let markPersistenceStarted: (() => void) | undefined;
    const persistenceStarted = new Promise<void>((resolve) => { markPersistenceStarted = resolve; });
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: {
        runTurn: async () => {
          hooks.emit({
            type: 'breadcrumb_emitted',
            sessionId: 'sess_backpressure',
            turnId: 'turn_1',
            intentId: 'intent_1',
            stepId: 'step_1',
            status: 'running',
            message: '等待落盘',
          });
        },
      },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });
    let runnerSettled = false;

    const execution = runner({
      taskId: 'task_1',
      sessionId: 'sess_backpressure',
      prompt: '验证事件落盘',
      materials: [],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: async () => {
        markPersistenceStarted?.();
        await persistenceRelease;
      },
    }).finally(() => { runnerSettled = true; });

    await persistenceStarted;
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(runnerSettled).toBe(false);
    releasePersistence?.();
    await execution;
    expect(runnerSettled).toBe(true);
  });

  it('bounds synchronous assistant delta bursts before the async persistence chain', async () => {
    const hooks = createRuntimeHooks();
    const sessionId = 'sess_bounded_hook_queue';
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteRelease = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let markFirstWriteStarted: (() => void) | undefined;
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    const forwarded: RuntimeEvent[] = [];
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: {
        runTurn: async () => {
          for (let index = 0; index < 20_000; index += 1) {
            hooks.emit({
              type: 'assistant_delta',
              sessionId,
              turnId: 'turn_burst',
              intentId: 'intent_burst',
              stepId: 'step_burst',
              delta: '字',
            });
          }
        },
      },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });

    const execution = runner({
      taskId: 'task_burst',
      sessionId,
      prompt: '验证同步流式突发有界',
      materials: [],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: async (event) => {
        forwarded.push(event);
        if (forwarded.length === 1) {
          markFirstWriteStarted?.();
          await firstWriteRelease;
        }
      },
    });

    await firstWriteStarted;
    expect(forwarded).toHaveLength(1);
    releaseFirstWrite?.();
    await execution;

    const deltas = forwarded.filter((event): event is Extract<RuntimeEvent, { type: 'assistant_delta' }> => (
      event.type === 'assistant_delta'
    ));
    expect(deltas.length).toBeLessThanOrEqual(4);
    expect(deltas.map(event => event.delta).join('')).toBe('字'.repeat(20_000));
  });

  it('does not merge assistant deltas across a non-delta ordering barrier', async () => {
    const hooks = createRuntimeHooks();
    const sessionId = 'sess_hook_ordering';
    const forwarded: RuntimeEvent[] = [];
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: {
        runTurn: async () => {
          hooks.emit({
            type: 'assistant_delta', sessionId, turnId: 'turn_1', intentId: 'intent_1', stepId: 'step_1', delta: '前',
          });
          hooks.emit({
            type: 'breadcrumb_emitted', sessionId, turnId: 'turn_1', intentId: 'intent_1', stepId: 'step_1', status: 'running', message: '中',
          });
          hooks.emit({
            type: 'assistant_delta', sessionId, turnId: 'turn_1', intentId: 'intent_1', stepId: 'step_1', delta: '后',
          });
        },
      },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });

    await runner({
      taskId: 'task_ordering',
      sessionId,
      prompt: '验证事件顺序',
      materials: [],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: async (event) => { forwarded.push(event); },
    });

    expect(forwarded.map(event => event.type)).toEqual([
      'assistant_delta',
      'breadcrumb_emitted',
      'assistant_delta',
    ]);
    expect(forwarded.filter(event => event.type === 'assistant_delta').map(event => event.delta)).toEqual(['前', '后']);
  });

  it('reports a drain persistence failure after consuming the bounded queue', async () => {
    const hooks = createRuntimeHooks();
    const sessionId = 'sess_hook_write_failure';
    const runner = createRuntimeFacadeTaskRunner({
      runtimeFacade: {
        runTurn: async () => {
          hooks.emit({
            type: 'assistant_delta', sessionId, turnId: 'turn_1', intentId: 'intent_1', stepId: 'step_1', delta: '内容',
          });
        },
      },
      hooks,
      cwd: '/workspace/project',
      source: 'chat',
    });

    await expect(runner({
      taskId: 'task_write_failure',
      sessionId,
      prompt: '验证写失败',
      materials: [],
      understanding: createUnderstanding(),
      signal: new AbortController().signal,
      emitRuntimeEvent: async () => { throw new Error('event_store_unavailable'); },
    })).rejects.toThrow('event_store_unavailable');
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
