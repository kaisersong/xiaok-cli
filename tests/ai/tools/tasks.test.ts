import { describe, expect, it } from 'vitest';
import { createTaskTools } from '../../../src/ai/tools/tasks.js';
import { SessionTaskBoard } from '../../../src/runtime/tasking/board.js';

describe('task tools', () => {
  it('creates and updates delivery-oriented task fields', async () => {
    const board = new SessionTaskBoard('cli');
    const tools = createTaskTools({ board, sessionId: 'sess_1' });
    const createTool = tools.find((tool) => tool.definition.name === 'task_create')!;
    const updateTool = tools.find((tool) => tool.definition.name === 'task_update')!;

    const created = JSON.parse(await createTool.execute({
      title: '整理客户材料',
      objective: '整理客户发来的材料并生成方案',
      deliverable: '一版方案初稿',
      selected_skills: ['solution-compose'],
      acceptance_criteria: ['返回具体方案内容'],
    })) as { taskId: string; deliverable: string; selectedSkills: string[] };

    expect(created.deliverable).toBe('一版方案初稿');
    expect(created.selectedSkills).toEqual(['solution-compose']);

    const failed = JSON.parse(await updateTool.execute({
      task_id: created.taskId,
      status: 'failed',
      blocked_reason: '缺少技术架构文档',
      last_tool_name: 'read',
    })) as { blockedReason: string; lastToolName: string };

    expect(failed.blockedReason).toBe('缺少技术架构文档');
    expect(failed.lastToolName).toBe('read');

    const updated = JSON.parse(await updateTool.execute({
      task_id: created.taskId,
      status: 'running',
      increment_attempt: true,
      last_tool_name: 'read',
    })) as { blockedReason: string; attemptCount: number; lastToolName: string };

    expect(updated.blockedReason).toBeUndefined();
    expect(updated.attemptCount).toBe(2);
    expect(updated.lastToolName).toBe('read');
  });

  it('clears blocked reason through task_update when unblocking a task', async () => {
    const board = new SessionTaskBoard('cli');
    const tools = createTaskTools({ board, sessionId: 'sess_1' });
    const createTool = tools.find((tool) => tool.definition.name === 'task_create')!;
    const updateTool = tools.find((tool) => tool.definition.name === 'task_update')!;

    const created = JSON.parse(await createTool.execute({
      title: '整理客户材料',
    })) as { taskId: string };

    const blocked = JSON.parse(await updateTool.execute({
      task_id: created.taskId,
      blocked_reason: '缺少技术架构文档',
    })) as { blockedReason: string };
    expect(blocked.blockedReason).toBe('缺少技术架构文档');

    const resumed = JSON.parse(await updateTool.execute({
      task_id: created.taskId,
      status: 'running',
      blocked_reason: '',
    })) as { blockedReason?: string; status: string };

    expect(resumed.status).toBe('running');
    expect(resumed.blockedReason).toBeUndefined();
  });

  it('creates, lists, gets, and updates workflow tasks for the current session', async () => {
    const board = new SessionTaskBoard('cli');
    const tools = new Map(
      createTaskTools({ board, sessionId: 'sess_1' }).map((tool) => [tool.definition.name, tool]),
    );

    const createdJson = await tools.get('task_create')!.execute({
      title: 'Investigate hook timeout',
      details: 'Focus on tool pre-hook failures',
    });
    const created = JSON.parse(createdJson) as { taskId: string; title: string; status: string };

    expect(created).toMatchObject({
      title: 'Investigate hook timeout',
      status: 'queued',
    });

    const listed = JSON.parse(await tools.get('task_list')!.execute({})) as Array<{ taskId: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.taskId).toBe(created.taskId);

    const fetched = JSON.parse(
      await tools.get('task_get')!.execute({ task_id: created.taskId }),
    ) as { taskId: string; title: string };
    expect(fetched).toMatchObject({
      taskId: created.taskId,
      title: 'Investigate hook timeout',
    });

    const updated = JSON.parse(
      await tools.get('task_update')!.execute({
        task_id: created.taskId,
        status: 'running',
        note: 'Checked the runtime wiring',
      }),
    ) as { status: string; latestEvent: string; notes: string[] };
    expect(updated).toMatchObject({
      status: 'running',
      latestEvent: 'Checked the runtime wiring',
      notes: ['Checked the runtime wiring'],
    });
  });

  it('returns an error when a task is missing in the current session', async () => {
    const board = new SessionTaskBoard('cli');
    const tools = new Map(
      createTaskTools({ board, sessionId: 'sess_1' }).map((tool) => [tool.definition.name, tool]),
    );

    await expect(tools.get('task_get')!.execute({ task_id: 'task_999' })).resolves.toContain('Error');
  });
});
