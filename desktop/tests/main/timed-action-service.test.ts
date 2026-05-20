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
      prompt: '检查项目',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      source: 'agent',
    });

    const action = store.getAction(created.id);
    expect(action?.executor.kind).toBe('agent_task');
    expect(action?.nextDueAt).toBe(301_000);
    expect(action?.policy).toMatchObject({
      maxRuns: 288,
      maxConsecutiveFailures: 3,
      minIntervalMinutes: 5,
    });
    expect(action?.policy.expiresAt).toBe(1_000 + 24 * 60 * 60_000);
  });

  it('rejects agent interval tasks below the minimum interval', () => {
    expect(() => service.createScheduledTask({
      name: '过密检查',
      prompt: '检查项目',
      trigger: { kind: 'interval', intervalMinutes: 1 },
      source: 'agent',
    })).toThrow('intervalMinutes must be at least 5');
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
