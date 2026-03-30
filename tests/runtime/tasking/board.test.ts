import { describe, expect, it } from 'vitest';
import { SessionTaskBoard } from '../../../src/runtime/tasking/board.js';

describe('session task board', () => {
  it('creates and lists workflow tasks newest-first within a session', () => {
    const board = new SessionTaskBoard('cli');

    const first = board.create('sess_1', { title: 'Inspect failing tests' });
    const second = board.create('sess_1', { title: 'Patch runtime hook handling' });

    expect(board.list('sess_1').map((task) => task.taskId)).toEqual([second.taskId, first.taskId]);
    expect(board.get('sess_1', first.taskId)).toMatchObject({
      taskId: first.taskId,
      title: 'Inspect failing tests',
      source: 'cli',
      status: 'queued',
    });
  });

  it('updates status and appends progress notes', () => {
    const board = new SessionTaskBoard('cli');
    const task = board.create('sess_1', { title: 'Review diff' });

    const updated = board.update('sess_1', task.taskId, {
      status: 'running',
      note: 'Opened the changed files',
    });

    expect(updated).toMatchObject({
      taskId: task.taskId,
      status: 'running',
      latestEvent: 'Opened the changed files',
      notes: ['Opened the changed files'],
    });
  });

  it('does not expose tasks across sessions', () => {
    const board = new SessionTaskBoard('cli');
    const task = board.create('sess_1', { title: 'Hidden task' });

    expect(board.get('sess_2', task.taskId)).toBeUndefined();
    expect(board.update('sess_2', task.taskId, { status: 'completed' })).toBeUndefined();
  });
});
