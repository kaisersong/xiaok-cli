import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { buildHistoryFromTaskSnapshots, InProcessTaskRuntimeHost, type TaskRunner } from '../../../src/runtime/task-host/task-runtime-host.js';
import type { DesktopTaskEvent, MaterialRecord, TaskSnapshot } from '../../../src/runtime/task-host/types.js';

describe('InProcessTaskRuntimeHost', () => {
  let rootDir: string;
  let materialRegistry: MaterialRegistry;
  let snapshotStore: FileTaskSnapshotStore;
  let material: MaterialRecord;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `xiaok-task-runtime-host-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    const sourcePath = join(rootDir, 'source.md');
    writeFileSync(sourcePath, '# A 客户需求');
    materialRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 100,
    });
    snapshotStore = new FileTaskSnapshotStore(join(rootDir, 'snapshots'));
    material = await materialRegistry.importMaterial({
      taskId: 'seed_task',
      sourcePath,
      role: 'customer_material',
      roleSource: 'user',
    });
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates understanding, starts running immediately, and replays events for late subscribers', async () => {
    const runner = vi.fn<TaskRunner>(async () => undefined);
    const host = createHost(runner);

    const created = await host.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    expect(created.taskId).toBe('task_1');
    expect(created.understanding?.taskType).toBe('sales_deck');
    await waitFor(() => runner.mock.calls.length === 1);

    const replayed = await takeEvents(host.subscribeTask('task_1'), 2);
    expect(replayed).toEqual([
      { type: 'task_started', taskId: 'task_1' },
      { type: 'understanding_updated', understanding: created.understanding },
    ]);
    await waitFor(async () => (await host.getActiveTask()) === null);
  });

  it('marks a persisted running task as failed when no execution exists after restart', async () => {
    await snapshotStore.save({
      ...makeSnapshot({ taskId: 'task_stale', status: 'running', createdAt: 100, updatedAt: 200 }),
      understanding: {
        goal: '验证 workflow',
        deliverable: '报告',
        taskType: 'unknown',
        audience: '用户',
        inputs: [],
        missingInfo: [],
        assumptions: [],
        riskLevel: 'low',
        suggestedPlan: [],
        nextAction: 'execute',
      },
      events: [{ type: 'task_started', taskId: 'task_stale' }],
    });
    const restartedHost = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner: vi.fn<TaskRunner>(async () => undefined),
      now: () => 500,
      createTaskId: () => 'task_new',
      createSessionId: () => 'sess_new',
    });

    const recovered = await restartedHost.recoverTask('task_stale');

    expect(recovered.snapshot.status).toBe('failed');
    expect(recovered.snapshot.salvage?.reason).toBe('stale_running_task_recovered');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      { type: 'error', message: 'stale_running_task_recovered' },
    ]));
    expect(await restartedHost.getActiveTasks()).toEqual([]);
  });

  it('does not mark a currently executing running task as stale', async () => {
    let releaseRunner: (() => void) | undefined;
    const host = createHost(async () => {
      await new Promise<void>((resolve) => {
        releaseRunner = resolve;
      });
    });

    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'running');

    const recovered = await host.recoverTask('task_1');

    expect(recovered.snapshot.status).toBe('running');
    releaseRunner?.();
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
  });

  it('projects runtime events and persists completion without a confirmation step', async () => {
    const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
      emitRuntimeEvent({
        type: 'breadcrumb_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        status: 'running',
        message: '正在生成方案大纲',
      });
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        note: '已生成方案大纲',
      });
    });
    const host = createHost(runner);
    await host.createTask({
      prompt: '帮我基于这些材料，生成一版给 A 客户 CIO 汇报的制造业数字化方案 PPT 初稿。',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(() => runner.mock.calls.length === 1);
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('completed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      { type: 'progress', eventId: 'turn_1:step_1:breadcrumb', message: '正在生成方案大纲', stage: 'running' },
      { type: 'result', result: { summary: '已生成方案大纲', artifacts: [] } },
    ]));
    expect(await host.getActiveTask()).toBeNull();
  });

  it('delivers live projected progress to an active subscriber', async () => {
    let emitProgress: ((message: string) => void) | undefined;
    let finishRunner: (() => void) | undefined;
    const runner: TaskRunner = async ({ emitRuntimeEvent }) => {
      emitProgress = (message) => {
        emitRuntimeEvent({
          type: 'breadcrumb_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          status: 'running',
          message,
        });
      };
      await new Promise<void>((resolve) => {
        finishRunner = resolve;
      });
    };
    const host = createHost(runner);
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });
    const subscription = host.subscribeTask('task_1')[Symbol.asyncIterator]();
    await subscription.next();
    await subscription.next();

    await waitFor(() => Boolean(emitProgress));
    const liveEventPromise = subscription.next();
    emitProgress?.('正在匹配产品能力');

    await expect(liveEventPromise).resolves.toEqual({
      done: false,
      value: {
        type: 'progress',
        eventId: 'turn_1:step_1:breadcrumb',
        message: '正在匹配产品能力',
        stage: 'running',
      },
    });

    finishRunner?.();
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
    await subscription.return?.();
  });

  it('executes multiple tasks in parallel', async () => {
    let resolveTask1: (() => void) | undefined;
    let task2Ran = false;
    const runner: TaskRunner = async ({ taskId, emitRuntimeEvent }) => {
      if (taskId === 'task_1') {
        await new Promise<void>((resolve) => { resolveTask1 = resolve; });
      }
      task2Ran = task2Ran || taskId === 'task_2';
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: `sess_${taskId.slice(-1)}`,
        turnId: `turn_${taskId.slice(-1)}`,
        intentId: `intent_${taskId.slice(-1)}`,
        stepId: `step_${taskId.slice(-1)}`,
        note: `${taskId} 完成`,
      });
    };
    let taskOrd = 0;
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    await host.createTask({ prompt: '第一个任务', materials: [{ materialId: material.materialId }] });
    await waitFor(() => host.isExecutingForTest('task_1'));

    // Submit second task — should NOT cancel first, both run in parallel
    await host.createTask({ prompt: '第二个任务', materials: [{ materialId: material.materialId }] });
    await waitFor(async () => (await host.recoverTask('task_2')).snapshot.status === 'completed', 5000);

    // task_1 should still be running
    expect(host.isExecutingForTest('task_1')).toBe(true);
    expect(task2Ran).toBe(true);

    // Finish task_1
    resolveTask1?.();
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 5000);

    // Both active tasks should now be cleared
    const activeTasks = await host.getActiveTasks();
    expect(activeTasks).toEqual([]);
  });

  it('can recover an in-flight auto-started task after restart without a confirmation question', async () => {
    let releaseFirstRunner: (() => void) | undefined;
    const firstHost = createHost(async () => {
      await new Promise<void>((resolve) => {
        releaseFirstRunner = resolve;
      });
    });
    const created = await firstHost.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });
    await waitFor(() => firstHost.isExecutingForTest(created.taskId));
    releaseFirstRunner?.();

    const restartedRegistry = new MaterialRegistry({
      workspaceRoot: join(rootDir, 'workspace'),
      maxBytes: 1024 * 1024,
      now: () => 300,
    });
    const restartedStore = new FileTaskSnapshotStore(join(rootDir, 'snapshots'));
    const runner = vi.fn<TaskRunner>(async ({ materials, emitRuntimeEvent }) => {
      expect(materials.map((item) => item.originalName)).toEqual(['source.md']);
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: 'turn_1',
        intentId: 'intent_1',
        stepId: 'step_1',
        note: '恢复后已继续执行',
      });
    });
    const restartedHost = new InProcessTaskRuntimeHost({
      materialRegistry: restartedRegistry,
      snapshotStore: restartedStore,
      runner,
      now: () => 400,
      createTaskId: () => 'task_2',
      createSessionId: () => 'sess_2',
    });

    const recovered = await restartedHost.recoverTask('task_1');
    expect(recovered.snapshot.status).not.toBe('waiting_user');
    expect(recovered.snapshot.events.some((event) => event.type === 'needs_user')).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects unknown materials, stale answers, and missing task recovery', async () => {
    const host = createHost(async () => undefined);

    await expect(host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: 'missing_material' }],
    })).rejects.toThrow(/unknown material/i);

    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await expect(host.answerQuestion({
      taskId: 'task_1',
      answer: { questionId: 'missing_question', type: 'choice', choiceId: 'confirm' },
    })).rejects.toThrow(/question not found/i);

    await expect(host.recoverTask('missing_task')).rejects.toThrow(/task not found/i);
  });

  it('cancels active execution and aborts the runner', async () => {
    let observedAbort = false;
    const runner: TaskRunner = async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          observedAbort = true;
          resolve();
        }, { once: true });
      });
    };
    const host = createHost(runner);
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(() => host.isExecutingForTest('task_1'));
    await host.cancelTask('task_1');

    expect(observedAbort).toBe(true);
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('cancelled');
    expect(recovered.snapshot.salvage).toEqual({
      summary: ['任务已取消，可基于已识别的任务理解继续。'],
      reason: 'cancelled',
    });
    expect(await host.getActiveTask()).toBeNull();
  });

  it('persists failed snapshots with error event and salvage', async () => {
    const host = createHost(async () => {
      throw new Error('runner unavailable');
    });
    await host.createTask({
      prompt: '生成 A 客户方案 PPT',
      materials: [{ materialId: material.materialId }],
    });

    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'failed');
    const recovered = await host.recoverTask('task_1');
    expect(recovered.snapshot.status).toBe('failed');
    expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
      { type: 'error', message: 'runner unavailable' },
    ]));
    expect(recovered.snapshot.salvage).toEqual({
      summary: ['已保留任务理解', '已保留 1 个材料引用'],
      reason: 'runner unavailable',
    });
    expect(await host.getActiveTask()).toBeNull();
  });

  it('rebuilds history from persisted context task snapshots after host restart', async () => {
    let callCount = 0;
    let historyOnSecondCall: Array<{ role: string; content: string }> = [];
    const runner: TaskRunner = async ({ history, emitRuntimeEvent }) => {
      callCount++;
      if (callCount === 2) {
        historyOnSecondCall = history;
      }
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: `turn_${callCount}`,
        intentId: `intent_${callCount}`,
        stepId: `step_${callCount}`,
        note: `完成任务${callCount}`,
      });
    };
    let taskOrd = 0;
    const firstHost = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    const first = await firstHost.createTask({ prompt: '第一个任务', materials: [{ materialId: material.materialId }] });
    await waitFor(async () => (await firstHost.recoverTask(first.taskId)).snapshot.status === 'completed');

    const restartedHost = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    await restartedHost.createTask({
      prompt: '第二个任务',
      materials: [{ materialId: material.materialId }],
      context: { threadId: 'thread-a', taskIds: [first.taskId] },
    });
    await waitFor(async () => callCount === 2);
    await waitFor(async () => (await restartedHost.recoverTask('task_2')).snapshot.status === 'completed');

    expect(historyOnSecondCall.length).toBe(2);
    expect(historyOnSecondCall[0]).toEqual({ role: 'user', content: '第一个任务' });
    expect(historyOnSecondCall[1].role).toBe('assistant');
    expect(historyOnSecondCall[1].content).toContain('完成任务1');
    const recovered = await restartedHost.recoverTask('task_2');
    expect(recovered.snapshot.context).toEqual({
      threadId: 'thread-a',
      taskIds: ['task_1'],
      loadedTaskIds: ['task_1'],
      skipped: [],
    });
  });

  it('does not leak prior task history when context is omitted', async () => {
    let callCount = 0;
    let historyOnSecondCall: Array<{ role: string; content: string }> = [];
    const runner: TaskRunner = async ({ history, emitRuntimeEvent }) => {
      callCount++;
      if (callCount === 2) {
        historyOnSecondCall = history;
      }
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: `turn_${callCount}`,
        intentId: `intent_${callCount}`,
        stepId: `step_${callCount}`,
        note: `完成任务${callCount}`,
      });
    };
    let taskOrd = 0;
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    await host.createTask({ prompt: '第一个任务', materials: [{ materialId: material.materialId }] });
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');

    await host.createTask({ prompt: '第二个任务', materials: [{ materialId: material.materialId }] });
    await waitFor(async () => callCount === 2);
    await waitFor(async () => (await host.recoverTask('task_2')).snapshot.status === 'completed');

    expect(historyOnSecondCall).toEqual([]);
  });

  it('passes history from cancelled context task to the next runner call', async () => {
    let callCount = 0;
    let historyOnSecondCall: Array<{ role: string; content: string }> = [];
    const runner: TaskRunner = async ({ signal, history, emitRuntimeEvent }) => {
      callCount++;
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('task cancelled');
      }
      historyOnSecondCall = history;
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_2',
        turnId: 'turn_2',
        intentId: 'intent_2',
        stepId: 'step_2',
        note: '完成',
      });
    };
    let taskOrd = 0;
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    await host.createTask({ prompt: '每天晚上11点同步mydocs', materials: [{ materialId: material.materialId }] });
    await waitFor(() => host.isExecutingForTest('task_1'));
    await host.cancelTask('task_1');
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'cancelled');
    // Let finally block complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    await host.createTask({
      prompt: '不是mac定时任务，是xiaok定时任务',
      materials: [{ materialId: material.materialId }],
      context: { threadId: 'thread-a', taskIds: ['task_1'] },
    });
    await waitFor(async () => callCount === 2, 5000);
    await waitFor(async () => (await host.recoverTask('task_2')).snapshot.status === 'completed', 5000);

    expect(historyOnSecondCall.length).toBe(2);
    expect(historyOnSecondCall[0]).toEqual({ role: 'user', content: '每天晚上11点同步mydocs' });
    expect(historyOnSecondCall[1].role).toBe('assistant');
  });

  it('skips missing non-terminal and self context task ids with an audit trail', async () => {
    let callCount = 0;
    let historyOnSecondCall: Array<{ role: string; content: string }> = [];
    const runner: TaskRunner = async ({ history, emitRuntimeEvent }) => {
      callCount++;
      if (callCount === 2) {
        historyOnSecondCall = history;
      }
      emitRuntimeEvent({
        type: 'receipt_emitted',
        sessionId: 'sess_1',
        turnId: `turn_${callCount}`,
        intentId: `intent_${callCount}`,
        stepId: `step_${callCount}`,
        note: `完成任务${callCount}`,
      });
    };
    let taskOrd = 0;
    const host = new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => `task_${++taskOrd}`,
      createSessionId: () => `sess_${taskOrd}`,
    });

    await host.createTask({ prompt: '第一条可恢复上下文', materials: [{ materialId: material.materialId }] });
    await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed');
    await snapshotStore.save(makeSnapshot({ taskId: 'task_running', status: 'running', prompt: '还没结束' }));

    await host.createTask({
      prompt: '第二条输入',
      materials: [{ materialId: material.materialId }],
      context: { threadId: 'thread-a', taskIds: ['task_missing', 'task_running', 'task_2', 'task_1'] },
    });
    await waitFor(async () => callCount === 2);
    await waitFor(async () => (await host.recoverTask('task_2')).snapshot.status === 'completed');

    expect(historyOnSecondCall.map(message => message.content)).toEqual(['第一条可恢复上下文', '完成任务1']);
    const recovered = await host.recoverTask('task_2');
    expect(recovered.snapshot.context).toEqual({
      threadId: 'thread-a',
      taskIds: ['task_missing', 'task_running', 'task_2', 'task_1'],
      loadedTaskIds: ['task_1'],
      skipped: expect.arrayContaining([
        { taskId: 'task_missing', reason: 'missing' },
        { taskId: 'task_running', reason: 'non_terminal' },
        { taskId: 'task_2', reason: 'self' },
      ]),
    });
  });

  it('bounds reconstructed history by task count and text length', () => {
    const result = buildHistoryFromTaskSnapshots([
      makeSnapshot({ taskId: 'task_1', createdAt: 1, prompt: '第一条'.repeat(20), summary: '第一条完成'.repeat(20) }),
      makeSnapshot({ taskId: 'task_2', createdAt: 2, prompt: '第二条'.repeat(20), summary: '第二条完成'.repeat(20) }),
      makeSnapshot({ taskId: 'task_3', createdAt: 3, prompt: '第三条'.repeat(20), summary: '第三条完成'.repeat(20) }),
    ], {
      maxTasks: 2,
      maxUserChars: 12,
      maxAssistantChars: 16,
      maxTotalChars: 200,
    });

    expect(result.loadedTaskIds).toEqual(['task_2', 'task_3']);
    expect(result.skipped).toEqual([{ taskId: 'task_1', reason: 'too_old' }]);
    expect(result.history).toHaveLength(4);
    expect(result.history[0]).toEqual({ role: 'user', content: '第二条第二条第二条第二条[已截断，保留前 12 字符]' });
    expect(result.history[1].content).toContain('[已截断，保留前 16 字符]');
  });

  describe('deliverable gate integration', () => {
    it('blocks completion when the AHE artifact evidence guard sees no delivered artifact', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '已完成',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '生成 A 客户方案 PPT',
        materials: [{ materialId: material.materialId }],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'failed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.status).toBe('failed');
      expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'progress',
          stage: 'blocked',
          message: expect.stringContaining('artifact evidence'),
        }),
      ]));
      expect(await host.getActiveTask()).toBeNull();
    });

    it('allows operational completions without artifact evidence', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '已创建 xiaok 定时任务。',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '创建定时任务，每天晚上11点同步mydocs',
        materials: [],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
      ]));
    });

    it('allows CUA validation completions without treating screenshotHasImage as an image deliverable', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '{"usedTool":"xiaok_computer_use","screenshotHasImage":true,"errors":[]}',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '请使用 xiaok_computer_use 验证 CUA，最后汇报 screenshotHasImage',
        materials: [],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
      ]));
    });

    it('allows create_project orchestration completions when project_card evidence exists', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'pre_tool_use',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          toolName: 'create_project',
          toolInput: {
            name: 'Claude 本月动态分析',
            goal: '分析 Anthropic Claude 在 2026年5月的最新动态',
            memberCount: 2,
          },
          toolUseId: 'call_create_project',
        });
        emitRuntimeEvent({
          type: 'post_tool_use',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          toolName: 'create_project',
          toolInput: {},
          toolResponse: JSON.stringify({
            type: 'project_card',
            projectId: 'proj-1779259929302',
            name: 'Claude 本月动态分析',
            status: 'created',
          }),
          toolUseId: 'call_create_project',
        });
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '项目已创建成功，2 个智能体正在分工协作。',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '创建项目, 让2个智能体搞定本月Claude动态分析，输出报告',
        materials: [],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.status).toBe('completed');
      expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'canvas_tool_result',
          toolName: 'create_project',
          ok: true,
          response: expect.stringContaining('proj-1779259929302'),
        }),
      ]));
      expect(recovered.snapshot.events).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
      ]));
    });

    it('does not accept spoken project creation without project_card evidence', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '项目已创建成功。',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '创建项目, 让2个智能体搞定本月Claude动态分析，输出报告',
        materials: [],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'failed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
      ]));
    });

    it('continues to block direct report completions without artifact evidence', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'receipt_emitted',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          note: '报告已经写好。',
        });
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        aheGuards: { artifactEvidence: true },
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '写一份 Claude 本月动态分析报告',
        materials: [],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'failed', 3000);
      const recovered = await host.recoverTask('task_1');
      expect(recovered.snapshot.events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'error', message: 'Task is being completed without artifact evidence.' }),
      ]));
    });

    it('retries runner when built-in plan check detects incomplete steps', async () => {
      let callCount = 0;
      const runner = vi.fn<TaskRunner>(async ({ prompt, emitRuntimeEvent }) => {
        callCount++;
        if (callCount === 1) {
          // First run: report plan with incomplete steps, produce only report
          emitRuntimeEvent({
            type: 'progress_plan_reported',
            steps: [
              { id: 'step-1', label: '搜索信息', status: 'completed' },
              { id: 'step-2', label: '生成报告', status: 'completed' },
              { id: 'step-3', label: '生成演示文稿', status: 'running' },
            ],
          } as any);
          emitRuntimeEvent({
            type: 'artifact_recorded',
            sessionId: 'sess_1',
            turnId: 'turn_1',
            intentId: 'intent_1',
            stepId: 'step_1',
            artifactId: 'art_1',
            kind: 'report',
            label: 'Claude月度更新报告',
            filePath: '/tmp/report.md',
          } as any);
        } else {
          // Second run (retry): produce the presentation
          emitRuntimeEvent({
            type: 'artifact_recorded',
            sessionId: 'sess_1',
            turnId: 'turn_2',
            intentId: 'intent_2',
            stepId: 'step_2',
            artifactId: 'art_2',
            kind: 'presentation',
            label: '演示文稿',
            filePath: '/tmp/slides.pptx',
          } as any);
        }
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        // No completionGate — relies on built-in plan check
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '根据claude本月的更新生成报告和演示文档',
        materials: [{ materialId: material.materialId }],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);

      // Runner called twice: initial + retry
      expect(runner).toHaveBeenCalledTimes(2);
      expect(runner.mock.calls[1][0].prompt).toContain('遗漏了部分交付物');
    });

    it('does not retry when all plan steps are completed', async () => {
      const runner = vi.fn<TaskRunner>(async ({ emitRuntimeEvent }) => {
        emitRuntimeEvent({
          type: 'progress_plan_reported',
          steps: [
            { id: 's1', label: '生成报告', status: 'completed' },
            { id: 's2', label: '生成演示文稿', status: 'completed' },
          ],
        } as any);
        emitRuntimeEvent({
          type: 'artifact_recorded',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_1',
          artifactId: 'art_1',
          kind: 'report',
          label: '报告',
          filePath: '/tmp/report.md',
        } as any);
        emitRuntimeEvent({
          type: 'artifact_recorded',
          sessionId: 'sess_1',
          turnId: 'turn_1',
          intentId: 'intent_1',
          stepId: 'step_2',
          artifactId: 'art_2',
          kind: 'presentation',
          label: '演示文稿',
          filePath: '/tmp/slides.pptx',
        } as any);
      });

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '做一份报告和一份演示文稿',
        materials: [{ materialId: material.materialId }],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);

      expect(runner).toHaveBeenCalledTimes(1);
    });

    it('skips gate for single-deliverable prompts', async () => {
      const runner = vi.fn<TaskRunner>(async () => undefined);
      const gate = vi.fn(async () => ({ complete: false, missing: ['something'] }));

      let taskOrd = 0;
      const host = new InProcessTaskRuntimeHost({
        materialRegistry,
        snapshotStore,
        runner,
        completionGate: gate,
        now: () => 200,
        createTaskId: () => `task_${++taskOrd}`,
        createSessionId: () => `sess_${taskOrd}`,
      });

      await host.createTask({
        prompt: '帮我做一份报告',
        materials: [{ materialId: material.materialId }],
      });

      await waitFor(async () => (await host.recoverTask('task_1')).snapshot.status === 'completed', 3000);

      // Gate not called for single-deliverable prompt
      expect(runner).toHaveBeenCalledTimes(1);
      expect(gate).not.toHaveBeenCalled();
    });
  });

  function createHost(runner: TaskRunner): InProcessTaskRuntimeHost {
    return new InProcessTaskRuntimeHost({
      materialRegistry,
      snapshotStore,
      runner,
      now: () => 200,
      createTaskId: () => 'task_1',
      createSessionId: () => 'sess_1',
    });
  }
});

function makeSnapshot(overrides: Partial<TaskSnapshot> & { taskId: string; summary?: string }): TaskSnapshot {
  const taskId = overrides.taskId;
  const result = overrides.summary
    ? { summary: overrides.summary, artifacts: [] }
    : overrides.result;
  return {
    taskId,
    sessionId: `sess_${taskId}`,
    status: overrides.status ?? 'completed',
    prompt: overrides.prompt ?? `prompt ${taskId}`,
    materials: [],
    events: result ? [{ type: 'result', result }] : [],
    result,
    salvage: overrides.salvage,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? overrides.createdAt ?? 1,
  };
}

async function takeEvents(iterable: AsyncIterable<DesktopTaskEvent>, count: number): Promise<DesktopTaskEvent[]> {
  const events: DesktopTaskEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
    if (events.length >= count) {
      break;
    }
  }
  return events;
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
