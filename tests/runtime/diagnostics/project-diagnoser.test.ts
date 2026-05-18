import { describe, expect, it } from 'vitest';
import { diagnoseProjectSnapshot } from '../../../src/runtime/diagnostics/project-diagnoser.js';

describe('project diagnoser', () => {
  it('explains the technical-conference incident as a blocked project, not an active run', () => {
    const report = diagnoseProjectSnapshot({
      project: { id: 'proj-tech', name: '技术大会演讲报告', status: 'active' },
      tasks: [
        { id: 'item-1', title: '资料整理', status: 'done' },
        { id: 'item-2', title: '初稿', status: 'done' },
        { id: 'item-3', title: '深化', status: 'done' },
        { id: 'item-4', title: '结构', status: 'done' },
        { id: 'item-5', title: '内容', status: 'done' },
        { id: 'item-6', title: '对抗性评审与迭代修订', status: 'blocked', blockedReason: 'missing_review_evidence', qualityFailureCount: 3 },
        { id: 'item-7', title: '视觉风格', status: 'pending', dependencies: [] },
      ],
      agents: [
        { id: 'xiaok-po', name: 'PO', status: 'idle' },
        { id: 'cli-claude', name: 'Claude', status: 'idle' },
        { id: 'cli-codex', name: 'Codex', status: 'idle' },
      ],
      dispatchPlan: {
        dispatchable: [{ taskId: 'item-7', reason: 'no_dependencies' }],
        blocked: [{ taskId: 'item-6', reason: 'missing_review_evidence' }],
        waiting: [],
      },
      projectHealth: {
        status: 'blocked',
        primaryBlockedTaskId: 'item-6',
        message: '评审任务缺少证据',
      },
    });

    expect(report.health).toBe('blocked');
    expect(report.primaryFinding).toMatchObject({
      category: 'blocked_task',
      evidenceIds: ['task:item-6'],
    });
    expect(report.findings.map((finding) => finding.category)).toContain('dispatch_stalled');
    expect(report.recommendedActions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['dispatch_unblocked_task', 'split_or_reassign_review']),
    );
  });
});
