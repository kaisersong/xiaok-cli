import { describe, expect, it } from 'vitest';
import { SessionTaskBoard } from '../../../src/runtime/tasking/board.js';

describe('task delivery board', () => {
  it('stores task delivery fields and increments attempts on retry', () => {
    const board = new SessionTaskBoard('cli');
    const created = board.create('sess_1', {
      title: '整理客户材料',
      details: '把客户发来的材料整理成一版通用方案',
      objective: '把客户发来的材料整理成一版通用方案',
      deliverable: '一版可继续编辑的方案初稿',
      selectedSkills: ['solution-compose', 'doc-extract'],
      acceptanceCriteria: ['返回具体方案内容', '缺材料时明确说明阻塞'],
    });

    expect(created.objective).toBe('把客户发来的材料整理成一版通用方案');
    expect(created.attemptCount).toBe(1);
    expect(created.selectedSkills).toEqual(['solution-compose', 'doc-extract']);
    expect(created.acceptanceCriteria).toHaveLength(2);

    const updated = board.update('sess_1', created.taskId, {
      incrementAttempt: true,
      blockedReason: '缺少报价表',
      lastToolName: 'read',
      note: '等待用户补充报价表',
    });

    expect(updated?.attemptCount).toBe(2);
    expect(updated?.blockedReason).toBe('缺少报价表');
    expect(updated?.lastToolName).toBe('read');
  });

  it('normalizes blank objective on create and update', () => {
    const board = new SessionTaskBoard('cli');
    const created = board.create('sess_1', {
      title: '整理客户材料',
      objective: '   ',
    });

    expect(created.objective).toBe('整理客户材料');

    const updated = board.update('sess_1', created.taskId, {
      objective: '\n\t  ',
    });

    expect(updated?.objective).toBe('整理客户材料');
    expect(board.get('sess_1', created.taskId)?.objective).toBe('整理客户材料');
  });

  it('clears blocked reason when a task is resumed or completed', () => {
    const board = new SessionTaskBoard('cli');
    const created = board.create('sess_1', {
      title: '整理客户材料',
    });

    const blocked = board.update('sess_1', created.taskId, {
      blockedReason: '缺少报价表',
      note: '等待报价表',
    });

    expect(blocked?.blockedReason).toBe('缺少报价表');

    const resumed = board.update('sess_1', created.taskId, {
      status: 'running',
    });
    expect(resumed?.blockedReason).toBeUndefined();

    const blockedAgain = board.update('sess_1', created.taskId, {
      blockedReason: '缺少最终确认',
    });
    expect(blockedAgain?.blockedReason).toBe('缺少最终确认');

    const completed = board.update('sess_1', created.taskId, {
      status: 'completed',
    });
    expect(completed?.blockedReason).toBeUndefined();
  });

  it('preserves blocked reason for terminal blocked tasks', () => {
    const board = new SessionTaskBoard('cli');
    const failedTask = board.create('sess_1', {
      title: '整理客户材料',
    });

    board.update('sess_1', failedTask.taskId, {
      blockedReason: '缺少报价表',
    });

    const failed = board.update('sess_1', failedTask.taskId, {
      status: 'failed',
    });
    expect(failed?.blockedReason).toBe('缺少报价表');

    const cancelledTask = board.create('sess_1', {
      title: '整理客户材料',
    });

    board.update('sess_1', cancelledTask.taskId, {
      blockedReason: '缺少最终确认',
    });

    const cancelled = board.update('sess_1', cancelledTask.taskId, {
      status: 'cancelled',
    });
    expect(cancelled?.blockedReason).toBe('缺少最终确认');
  });

  it('copies updated delivery arrays before storing them', () => {
    const board = new SessionTaskBoard('cli');
    const created = board.create('sess_1', {
      title: '整理客户材料',
    });

    const selectedSkills = ['solution-compose'];
    const acceptanceCriteria = ['返回具体方案内容'];
    const updated = board.update('sess_1', created.taskId, {
      selectedSkills,
      acceptanceCriteria,
    });

    selectedSkills.push('doc-extract');
    acceptanceCriteria.push('缺材料时明确说明阻塞');

    expect(updated?.selectedSkills).toEqual(['solution-compose']);
    expect(updated?.acceptanceCriteria).toEqual(['返回具体方案内容']);

    const persisted = board.get('sess_1', created.taskId);
    expect(persisted?.selectedSkills).toEqual(['solution-compose']);
    expect(persisted?.acceptanceCriteria).toEqual(['返回具体方案内容']);
  });

  it('returns defensive copies of mutable fields from create, get, list, and update', () => {
    const board = new SessionTaskBoard('cli');
    const created = board.create('sess_1', {
      title: '整理客户材料',
      selectedSkills: ['solution-compose'],
      acceptanceCriteria: ['返回具体方案内容'],
    });

    created.selectedSkills.push('mutated-after-create');
    created.acceptanceCriteria.push('mutated-after-create');
    created.notes.push('mutated-note-after-create');
    expect(board.get('sess_1', created.taskId)?.selectedSkills).toEqual(['solution-compose']);
    expect(board.get('sess_1', created.taskId)?.acceptanceCriteria).toEqual(['返回具体方案内容']);
    expect(board.get('sess_1', created.taskId)?.notes).toEqual([]);

    const fetched = board.get('sess_1', created.taskId)!;
    fetched.selectedSkills.push('mutated-after-get');
    fetched.acceptanceCriteria.push('mutated-after-get');
    fetched.notes.push('mutated-note-after-get');
    expect(board.get('sess_1', created.taskId)?.selectedSkills).toEqual(['solution-compose']);
    expect(board.get('sess_1', created.taskId)?.acceptanceCriteria).toEqual(['返回具体方案内容']);
    expect(board.get('sess_1', created.taskId)?.notes).toEqual([]);

    const listed = board.list('sess_1')[0]!;
    listed.selectedSkills.push('mutated-after-list');
    listed.acceptanceCriteria.push('mutated-after-list');
    listed.notes.push('mutated-note-after-list');
    expect(board.get('sess_1', created.taskId)?.selectedSkills).toEqual(['solution-compose']);
    expect(board.get('sess_1', created.taskId)?.acceptanceCriteria).toEqual(['返回具体方案内容']);
    expect(board.get('sess_1', created.taskId)?.notes).toEqual([]);

    const updated = board.update('sess_1', created.taskId, {
      selectedSkills: ['doc-extract'],
      acceptanceCriteria: ['生成方案初稿'],
      note: '已生成方案初稿',
    })!;
    updated.selectedSkills.push('mutated-after-update');
    updated.acceptanceCriteria.push('mutated-after-update');
    updated.notes.push('mutated-note-after-update');
    expect(board.get('sess_1', created.taskId)?.selectedSkills).toEqual(['doc-extract']);
    expect(board.get('sess_1', created.taskId)?.acceptanceCriteria).toEqual(['生成方案初稿']);
    expect(board.get('sess_1', created.taskId)?.notes).toEqual(['已生成方案初稿']);
  });
});
