import { describe, expect, it } from 'vitest';
import { createRuntimeHooks } from '../../../src/runtime/hooks.js';
import { SessionTaskBoard } from '../../../src/runtime/tasking/board.js';
import { wireTaskBoardToRuntimeSync } from '../../../src/runtime/tasking/runtime-sync.js';

describe('task runtime sync', () => {
  it('updates the active task from runtime events', () => {
    const hooks = createRuntimeHooks();
    const board = new SessionTaskBoard('cli');
    const task = board.create('sess_1', {
      title: '整理客户材料',
      objective: '整理客户材料并生成方案',
      selectedSkills: ['solution-compose'],
      acceptanceCriteria: ['返回具体方案内容'],
    });

    wireTaskBoardToRuntimeSync({
      hooks,
      board,
      sessionId: 'sess_1',
      getActiveTaskId: () => task.taskId,
    });

    hooks.emit({
      type: 'tool_started',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'skill',
      toolInput: { name: 'solution-compose' },
    });

    hooks.emit({
      type: 'tool_finished',
      sessionId: 'sess_1',
      turnId: 'turn_1',
      toolName: 'skill',
      ok: false,
    });

    expect(board.get('sess_1', task.taskId)).toMatchObject({
      lastToolName: 'skill',
      blockedReason: 'tool skill returned an error',
    });
  });
});
