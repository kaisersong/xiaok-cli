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
});
