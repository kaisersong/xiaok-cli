import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimedActionService } from '../../electron/timed-action-service.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('TimedActionService mutation authority', () => {
  let rootDir: string;
  let store: TimedActionStore;
  let service: TimedActionService;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-timed-authority-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
    service = new TimedActionService(store, { now: () => 1_000 });
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('denies every scheduled-task mutation from an agent against assistant-owned work', () => {
    store.createAction({
      id: 'assistant-daily', title: '晚间复盘', trigger: { kind: 'daily', hour: 22, minute: 30 },
      executor: { kind: 'loop', loopId: 'personal-assistant-evening-reflection' }, source: 'system',
      ownerKind: 'assistant', ownerId: 'default-personal-assistant', now: 0,
    });

    const agent = { requestSource: 'agent' as const, ownerId: 'agent-task-1' };
    expect(service.updateScheduledTask({
      id: 'assistant-daily', name: 'hijacked', trigger: { kind: 'daily', hour: 1, minute: 0 },
    }, agent)).toBeUndefined();
    expect(service.setScheduledTaskStatus('assistant-daily', 'paused', 1_000, agent)).toBeUndefined();
    expect(service.cancelScheduledTask('assistant-daily', 'hijack', agent)).toBe(false);
    expect(service.approveAuto('assistant-daily', agent)).toBeUndefined();
    expect(service.revokeAuto('assistant-daily', agent)).toBeUndefined();
    expect(service.deleteScheduledTask('assistant-daily', agent)).toBe(false);
    expect(store.getAction('assistant-daily')).toMatchObject({ title: '晚间复盘', status: 'active' });
  });

  it('allows an agent to cancel only its own temporary interval task and no reminder owned by a user', () => {
    store.createAction({
      id: 'agent-temp', title: 'temporary', trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'agent_task', prompt: 'check' }, source: 'agent', ownerKind: 'agent_task', ownerId: 'agent-task-1',
      policy: { expiresAt: 60_000 }, now: 0,
    });
    const reminder = service.createReminder('喝水', 60_000, 'Asia/Shanghai', {
      ownerKind: 'user', ownerId: 'desktop-user', requestSource: 'user',
    });

    expect(service.cancelScheduledTask('agent-temp', 'done', { requestSource: 'agent', ownerId: 'agent-task-1' })).toBe(true);
    expect(service.cancelReminder(reminder.reminderId, { requestSource: 'agent', ownerId: 'agent-task-1' })).toBe(false);
    expect(store.getAction(reminder.reminderId)?.status).toBe('active');
  });
});
