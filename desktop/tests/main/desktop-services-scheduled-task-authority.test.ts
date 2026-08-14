import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTimedActionTools } from '../../electron/desktop-services.js';
import { TimedActionService } from '../../electron/timed-action-service.js';
import { TimedActionStore } from '../../electron/timed-action-store.js';

describe('desktop scheduled task agent authority', () => {
  let rootDir: string;
  let store: TimedActionStore;
  let service: TimedActionService;

  beforeEach(() => {
    rootDir = join(tmpdir(), `xiaok-desktop-scheduled-authority-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(rootDir, { recursive: true });
    store = new TimedActionStore(join(rootDir, 'timed-actions.sqlite'));
    service = new TimedActionService(store, { now: () => 1_000 });
  });

  afterEach(() => {
    store.close();
    rmSync(rootDir, { recursive: true, force: true });
  });

  it('exposes only create and cancel as scheduled-task mutation tools and documents the cancellation denylist', () => {
    const tools = createTimedActionTools(service, 'Asia/Shanghai');
    const mutationNames = tools
      .filter(tool => tool.permission === 'write' && tool.definition.name.startsWith('scheduled_task_'))
      .map(tool => tool.definition.name)
      .sort();
    const cancelTool = tools.find(tool => tool.definition.name === 'scheduled_task_cancel');
    const createTool = tools.find(tool => tool.definition.name === 'scheduled_task_create');

    expect(mutationNames).toEqual(['scheduled_task_cancel', 'scheduled_task_create']);
    expect(cancelTool?.definition.description).toContain('严禁 agent 取消 user-owned 或 assistant-owned 定时任务');
    expect(cancelTool?.definition.description).toContain('只能请求取消由当前 agent 拥有的 interval 临时任务');
    expect(cancelTool?.definition.description).toContain('requestSource 和 ownerId');
    expect(createTool?.definition.description).not.toContain('必须调用 scheduled_task_cancel');
  });

  it('removes mandatory cancellation guidance from tool output and the desktop system prompt', async () => {
    const tools = createTimedActionTools(service, 'Asia/Shanghai');
    const createTool = tools.find(tool => tool.definition.name === 'scheduled_task_create');
    const result = await createTool!.execute({
      name: '检查项目',
      prompt: '检查项目是否完成',
      frequency: 'interval',
      interval_minutes: 5,
    });
    const source = readFileSync(join(__dirname, '../../electron/desktop-services.ts'), 'utf8');

    expect(result).toContain('cancellation is limited to the current agent-owned interval temporary task');
    expect(result).not.toContain('call scheduled_task_cancel when stop condition is met');
    expect(source).toContain('严禁 agent 取消 user-owned 或 assistant-owned 定时任务');
    expect(source).toContain('只能请求取消由当前 agent 拥有的 interval 临时任务');
    expect(source).not.toContain('停止条件满足时应要求调用 scheduled_task_cancel');
    expect(source).not.toContain('停止条件满足后调用 scheduled_task_cancel');
    expect(source).not.toContain('完成时调用 scheduled_task_cancel');
  });

  it('default-denies every agent sibling mutation against user-owned and assistant-owned scheduled tasks', () => {
    service.createScheduledTask({
      id: 'user-daily',
      name: '用户日报',
      prompt: '生成日报',
      trigger: { kind: 'daily', hour: 22, minute: 0 },
      source: 'user',
    });
    store.createAction({
      id: 'assistant-daily',
      title: '助理晚间复盘',
      trigger: { kind: 'daily', hour: 22, minute: 30 },
      executor: { kind: 'loop', loopId: 'personal-assistant-evening-reflection' },
      source: 'system',
      ownerKind: 'assistant',
      ownerId: 'default-personal-assistant',
      now: 0,
    });
    const request = { requestSource: 'agent' as const, ownerId: 'agent-task-1' };

    for (const id of ['user-daily', 'assistant-daily']) {
      expect(service.updateScheduledTask({
        id,
        name: '越权修改',
        trigger: { kind: 'daily', hour: 1, minute: 0 },
      }, request)).toBeUndefined();
      expect(service.setScheduledTaskStatus(id, 'paused', 1_000, request)).toBeUndefined();
      expect(service.cancelScheduledTask(id, '越权取消', request)).toBe(false);
      expect(service.approveAuto(id, request)).toBeUndefined();
      expect(service.revokeAuto(id, request)).toBeUndefined();
      expect(service.deleteScheduledTask(id, request)).toBe(false);
      expect(store.getAction(id)).toMatchObject({ status: 'active' });
    }
  });

  it('allows only matching-owner cancellation of an agent-owned interval temporary task', () => {
    store.createAction({
      id: 'agent-temp',
      title: '临时检查',
      trigger: { kind: 'interval', intervalMinutes: 5 },
      executor: { kind: 'agent_task', prompt: '检查项目' },
      source: 'agent',
      ownerKind: 'agent_task',
      ownerId: 'agent-task-1',
      policy: { expiresAt: 60_000 },
      now: 0,
    });
    const otherAgent = { requestSource: 'agent' as const, ownerId: 'agent-task-2' };
    const owner = { requestSource: 'agent' as const, ownerId: 'agent-task-1' };

    expect(service.cancelScheduledTask('agent-temp', 'wrong owner', otherAgent)).toBe(false);
    expect(service.updateScheduledTask({
      id: 'agent-temp',
      name: '不允许更新',
      trigger: { kind: 'interval', intervalMinutes: 10 },
    }, owner)).toBeUndefined();
    expect(service.setScheduledTaskStatus('agent-temp', 'paused', 1_000, owner)).toBeUndefined();
    expect(service.approveAuto('agent-temp', owner)).toBeUndefined();
    expect(service.revokeAuto('agent-temp', owner)).toBeUndefined();
    expect(service.deleteScheduledTask('agent-temp', owner)).toBe(false);
    expect(service.cancelScheduledTask('agent-temp', 'done', owner)).toBe(true);
    expect(store.getAction('agent-temp')).toBeUndefined();
  });

  it('binds create and cancel tool authority to the real tool execution taskId', async () => {
    const tools = createTimedActionTools(service, 'Asia/Shanghai');
    const createTool = tools.find(tool => tool.definition.name === 'scheduled_task_create')!;
    const cancelTool = tools.find(tool => tool.definition.name === 'scheduled_task_cancel')!;
    const created = JSON.parse(await createTool.execute({
      name: '临时检查', prompt: '检查状态', frequency: 'interval', interval_minutes: 5,
    }, { taskId: 'task-owner' } as never));

    expect(store.getAction(created.taskId)).toMatchObject({ ownerKind: 'agent_task', ownerId: 'task-owner' });
    await expect(cancelTool.execute({ task_id: created.taskId }, { taskId: 'task-other' } as never))
      .resolves.toContain('未找到自动任务');
    expect(store.getAction(created.taskId)).toBeDefined();
    await expect(cancelTool.execute({ task_id: created.taskId }, { taskId: 'task-owner' } as never))
      .resolves.toContain('已取消自动任务');
    expect(store.getAction(created.taskId)).toBeUndefined();
  });
});
