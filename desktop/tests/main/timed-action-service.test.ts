import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionService } from '../../electron/timed-action-service.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('TimedActionService', () => {
  let rootDir: string;
  let store: TimedActionStore;
  let service: TimedActionService;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-action-service-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
    service = new TimedActionService(store, { now: () => 1_000 });
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('creates reminder business records as notify timed actions', () => {
    const reminder = service.createReminder('喝水', 60_000, 'Asia/Shanghai');
    const action = store.getAction(reminder.reminderId);

    expect(action?.executor.kind).toBe('notify');
    expect(action?.trigger).toEqual({ kind: 'once', at: 60_000 });
    expect(service.listReminders()).toEqual([
      expect.objectContaining({ reminderId: reminder.reminderId, content: '喝水', status: 'pending' }),
    ]);
  });

  it('creates interval scheduled tasks as agent timed actions with safety defaults', () => {
    const created = service.createScheduledTask({
      name: '检查 OpenAI本月分析',
      description: '每 5 分钟检查项目状态',
      prompt: '检查项目',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      source: 'agent',
    });

    const action = store.getAction(created.id);
    expect(created.frequency).toBe('interval');
    expect(service.listScheduledTasks()[0].description).toBe('每 5 分钟检查项目状态');
    expect(created.scheduleConfig).toEqual({ intervalMinutes: 5 });
    expect(action?.executor.kind).toBe('agent_task');
    expect(action?.nextDueAt).toBe(301_000);
    expect(action?.policy).toMatchObject({
      maxRuns: 288,
      maxConsecutiveFailures: 3,
      minIntervalMinutes: 0.5,
    });
    expect(action?.policy.expiresAt).toBe(1_000 + 24 * 60 * 60_000);
  });

  it('creates loop schedules as TimedAction loop executors', () => {
    const created = service.createLoopSchedule({
      loopId: 'user-loop-1',
      title: 'Weekly Loop',
      description: 'Runs a markdown loop every day.',
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      now: 1_000,
    });

    const action = store.getAction(created.id);
    expect(created).toMatchObject({
      title: 'Weekly Loop',
      executor: { kind: 'loop', loopId: 'user-loop-1' },
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      source: 'user',
      userApprovedAuto: false,
      nextDueAt: expect.any(Number),
    });
    expect(action).toMatchObject({
      id: created.id,
      title: 'Weekly Loop',
      description: 'Runs a markdown loop every day.',
      executor: { kind: 'loop', loopId: 'user-loop-1' },
      policy: { maxConsecutiveFailures: 3 },
      nextDueAt: created.nextDueAt,
    });
    expect(service.listLoopSchedules()).toEqual([
      expect.objectContaining({
        id: created.id,
        executor: { kind: 'loop', loopId: 'user-loop-1' },
      }),
    ]);
  });

  it('lists loop-backed schedules in the schedule-owned task view without copying loop prompt', () => {
    service.createLoopSchedule({
      id: 'loop-schedule-1',
      loopId: 'user-loop-1',
      title: 'Weekly Loop',
      description: 'Runs a markdown loop every day.',
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      now: 1_000,
    });

    expect(service.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: 'loop-schedule-1',
        name: 'Weekly Loop',
        description: 'Runs a markdown loop every day.',
        executorKind: 'loop',
        loopId: 'user-loop-1',
        prompt: '',
        frequency: 'daily',
        scheduleConfig: { hour: 9, minute: 30 },
        status: 'active',
      }),
    ]);
  });

  it('updates scheduled task definition fields without losing runtime linkage', () => {
    const task = service.createScheduledTask({
      name: '每日检查',
      description: '旧描述',
      prompt: '旧 prompt',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      source: 'user',
    });
    const [claimed] = store.claimDueActions(task.nextRunAt!, 1);
    store.markRunRunning(task.id, claimed.runId, task.nextRunAt!);
    store.finishRunSuccess(task.id, claimed.runId, task.nextRunAt! + 1_000, { runtimeTaskId: 'task_runtime_1' });

    const updated = service.updateScheduledTask({
      id: task.id,
      name: '每周检查',
      description: '新描述',
      prompt: '新 prompt',
      trigger: { kind: 'weekly', dayOfWeek: 5, hour: 18, minute: 30 },
      now: task.nextRunAt! + 2_000,
    });

    expect(updated).toMatchObject({
      id: task.id,
      name: '每周检查',
      description: '新描述',
      prompt: '新 prompt',
      frequency: 'weekly',
      scheduleConfig: { dayOfWeek: 5, hour: 18, minute: 30 },
      runtimeTaskId: 'task_runtime_1',
    });
    expect(service.listScheduledTasks()[0]).toMatchObject({
      id: task.id,
      description: '新描述',
      prompt: '新 prompt',
      runtimeTaskId: 'task_runtime_1',
    });
  });

  it('updates loop-backed schedule trigger fields without replacing the loop executor', () => {
    service.createLoopSchedule({
      id: 'loop-schedule-1',
      loopId: 'user-loop-1',
      title: 'Weekly Loop',
      description: 'Runs a markdown loop every day.',
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      now: 1_000,
    });

    const updated = service.updateScheduledTask({
      id: 'loop-schedule-1',
      name: 'Weekday Loop',
      description: 'Runs on weekdays.',
      prompt: 'renderer stale prompt should be ignored',
      trigger: { kind: 'weekdays', hour: 10, minute: 15 },
      now: 2_000,
    });

    expect(updated).toMatchObject({
      id: 'loop-schedule-1',
      name: 'Weekday Loop',
      description: 'Runs on weekdays.',
      executorKind: 'loop',
      loopId: 'user-loop-1',
      prompt: '',
      frequency: 'weekdays',
      scheduleConfig: { hour: 10, minute: 15 },
    });
    expect(store.getAction('loop-schedule-1')).toMatchObject({
      executor: { kind: 'loop', loopId: 'user-loop-1' },
      trigger: { kind: 'weekdays', hour: 10, minute: 15 },
    });
  });

  it('cancels loop-backed schedules through the schedule-owned service', () => {
    service.createLoopSchedule({
      id: 'loop-schedule-1',
      loopId: 'user-loop-1',
      title: 'Weekly Loop',
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      now: 1_000,
    });

    expect(service.cancelScheduledTask('loop-schedule-1', 'user deleted schedule')).toBe(true);
    expect(store.getAction('loop-schedule-1')).toMatchObject({
      status: 'cancelled',
      lastError: 'user deleted schedule',
    });
  });

  it('pauses and resumes loop-backed schedules through the schedule-owned service', () => {
    service.createLoopSchedule({
      id: 'loop-schedule-1',
      loopId: 'user-loop-1',
      title: 'Weekly Loop',
      trigger: { kind: 'daily', hour: 9, minute: 30 },
      now: 1_000,
    });

    const paused = service.setScheduledTaskStatus('loop-schedule-1', 'paused', 2_000);
    expect(paused).toMatchObject({
      id: 'loop-schedule-1',
      status: 'paused',
      executorKind: 'loop',
      loopId: 'user-loop-1',
    });
    expect(store.getAction('loop-schedule-1')).toMatchObject({
      status: 'paused',
      nextDueAt: undefined,
      lastError: 'paused_by_user',
    });

    const resumed = service.setScheduledTaskStatus('loop-schedule-1', 'active', 3_000);
    expect(resumed).toMatchObject({
      id: 'loop-schedule-1',
      status: 'active',
      executorKind: 'loop',
      loopId: 'user-loop-1',
    });
    expect(store.getAction('loop-schedule-1')).toMatchObject({
      status: 'active',
      lastError: undefined,
    });
    expect(store.getAction('loop-schedule-1')?.nextDueAt).toBeGreaterThanOrEqual(3_000);
  });

  it('summarizes duplicate loop schedule bindings without choosing an arbitrary primary', () => {
    service.createLoopSchedule({
      id: 'loop-schedule-a',
      loopId: 'user-loop-1',
      title: 'Morning Loop',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      now: 1_000,
    });
    service.createLoopSchedule({
      id: 'loop-schedule-b',
      loopId: 'user-loop-1',
      title: 'Evening Loop',
      trigger: { kind: 'daily', hour: 18, minute: 0 },
      now: 2_000,
    });
    service.setScheduledTaskStatus('loop-schedule-b', 'paused', 3_000);

    expect(service.listLoopScheduleBindings()).toEqual([
      {
        loopId: 'user-loop-1',
        kind: 'multiple',
        count: 2,
        activeCount: 1,
        actionIds: ['loop-schedule-a', 'loop-schedule-b'],
        schedules: [
          expect.objectContaining({
            id: 'loop-schedule-a',
            title: 'Morning Loop',
            status: 'active',
          }),
          expect.objectContaining({
            id: 'loop-schedule-b',
            title: 'Evening Loop',
            status: 'paused',
          }),
        ],
      },
    ]);
  });

  it('returns a recoverable conflict when a scheduled task edit is based on a stale derived view', () => {
    const task = service.createScheduledTask({
      name: '每日检查',
      description: '旧描述',
      prompt: '旧 prompt',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
      source: 'user',
    });
    const openedFromView = task as typeof task & {
      updatedAt: number;
      automationStoreVersion?: number;
    };
    const openedVersion = store.getAutomationStoreVersion();

    const externalUpdate = service.updateScheduledTask({
      id: task.id,
      name: '已经被别处修改',
      description: '外部描述',
      prompt: '外部 prompt',
      trigger: { kind: 'daily', hour: 10, minute: 0 },
      now: 2_000,
    });
    expect(externalUpdate).toMatchObject({
      id: task.id,
      name: '已经被别处修改',
      prompt: '外部 prompt',
    });
    expect(store.getAutomationStoreVersion()).toBeGreaterThan(openedVersion);

    const staleUpdate = service.updateScheduledTask({
      id: task.id,
      name: '旧视图覆盖',
      description: '旧视图描述',
      prompt: '旧视图 prompt',
      trigger: { kind: 'weekly', dayOfWeek: 5, hour: 18, minute: 30 },
      expectedUpdatedAt: openedFromView.updatedAt,
      expectedAutomationStoreVersion: openedVersion,
      now: 3_000,
    } as never);

    expect(staleUpdate).toEqual({
      ok: false,
      code: 'stale_automation_view',
      recoverable: true,
      message: 'This automation changed elsewhere. Review the latest values before saving again.',
      sourceVersions: { timedActionStore: store.getAutomationStoreVersion() },
      current: expect.objectContaining({
        id: task.id,
        name: '已经被别处修改',
        prompt: '外部 prompt',
      }),
    });
    expect(service.listScheduledTasks()[0]).toMatchObject({
      id: task.id,
      name: '已经被别处修改',
      prompt: '外部 prompt',
    });
  });

  it('rejects agent interval tasks below the minimum interval', () => {
    expect(() => service.createScheduledTask({
      name: '过密检查',
      prompt: '检查项目',
      trigger: { kind: 'interval', intervalMinutes: 0.25 },
      source: 'agent',
    })).toThrow('intervalMinutes must be at least 0.5');
  });

  it('deletes agent-created interval scheduled tasks when they are cancelled after running', () => {
    const task = service.createScheduledTask({
      name: '外贸趋势分析项目进度检查',
      prompt: '检查项目，完成时取消自动任务',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      source: 'agent',
    });
    const [claimed] = store.claimDueActions(301_000, 1);
    expect(claimed?.action.id).toBe(task.id);
    store.markRunRunning(task.id, claimed.runId, 301_000);
    store.finishRunSuccess(task.id, claimed.runId, 302_000, { runtimeTaskId: 'runtime-task' });
    expect(store.listRuns(task.id)).toHaveLength(1);
    expect(service.listScheduledTasks()[0]).toMatchObject({
      runtimeTaskId: 'runtime-task',
    });
    expect((service.listScheduledTasks()[0] as { threadId?: string }).threadId).toBeUndefined();

    expect(service.cancelScheduledTask(task.id, 'project completed')).toBe(true);

    expect(store.getAction(task.id)).toBeUndefined();
    expect(store.listRuns(task.id)).toEqual([]);
  });

  it('keeps user-created scheduled tasks as cancelled records instead of deleting them', () => {
    const task = service.createScheduledTask({
      name: '用户自己的每小时任务',
      prompt: '检查',
      trigger: { kind: 'interval', intervalMinutes: 60 },
      source: 'user',
    });

    expect(service.cancelScheduledTask(task.id, 'user cancelled')).toBe(true);

    expect(store.getAction(task.id)).toEqual(expect.objectContaining({
      id: task.id,
      status: 'cancelled',
    }));
  });

  it('lists only scheduled task business records for agent actions', () => {
    service.createReminder('提醒', 60_000, 'Asia/Shanghai');
    const task = service.createScheduledTask({
      name: '10 分钟后检查',
      prompt: '检查',
      trigger: { kind: 'once', at: 601_000 },
      source: 'agent',
    });

    expect(service.listScheduledTasks()).toEqual([
      expect.objectContaining({ id: task.id, name: '10 分钟后检查', frequency: 'manual' }),
    ]);
  });
});
