import { describe, expect, it } from 'vitest';
import { createTaskTools } from '../../../src/ai/tools/tasks.js';
import { SessionTaskBoard } from '../../../src/runtime/tasking/board.js';

describe('task tools', () => {
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
