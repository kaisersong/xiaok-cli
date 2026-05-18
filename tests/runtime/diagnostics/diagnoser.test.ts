import { describe, expect, it } from 'vitest';
import { diagnoseTraceBundle, formatDiagnosisMarkdown } from '../../../src/runtime/diagnostics/diagnoser.js';
import type { TraceBundleV1 } from '../../../src/runtime/trace/schema.js';

function bundle(overrides: Partial<TraceBundleV1>): TraceBundleV1 {
  return {
    schemaVersion: 1,
    bundleId: 'trace_diag_1',
    createdAt: '2026-05-18T00:00:00.000Z',
    source: { app: 'kswarm' },
    scope: { kind: 'project', projectId: 'proj-1' },
    environment: {},
    turns: [],
    events: [],
    toolCalls: [],
    approvals: [],
    tasks: [],
    agents: [],
    artifacts: [],
    memoryRefs: [],
    skillEvidence: [],
    recovery: [],
    crashes: [],
    redactions: [],
    attachments: [],
    summary: {},
    ...overrides,
  };
}

describe('trace diagnoser', () => {
  it('reports active idle projects with blocked tasks as blocked_task', () => {
    const report = diagnoseTraceBundle(bundle({
      tasks: [
        { id: 'item-1', title: '资料整理', status: 'done' },
        { id: 'item-6', title: '对抗性评审', status: 'blocked', blockedReason: 'missing_review_evidence', failureCount: 3 },
        { id: 'item-7', title: '视觉风格', status: 'pending' },
      ],
      agents: [
        { id: 'claude', name: 'cli-Claude', status: 'idle' },
        { id: 'codex', name: 'cli-Codex', status: 'idle' },
      ],
      summary: { projectStatus: 'active' },
    }));

    expect(report.health).toBe('blocked');
    expect(report.primaryFinding).toMatchObject({
      category: 'blocked_task',
      severity: 'critical',
      evidenceIds: ['task:item-6'],
    });
    expect(report.recommendedActions.map((action) => action.id)).toEqual(
      expect.arrayContaining(['inspect_blocked_task', 'reassign_task', 'dispatch_unblocked_task']),
    );
  });

  it('reports completed tasks with missing artifact evidence', () => {
    const report = diagnoseTraceBundle(bundle({
      tasks: [
        { id: 'item-2', title: '生成初稿', status: 'done', artifacts: [] },
      ],
      artifacts: [],
    }));

    expect(report.health).toBe('failed');
    expect(report.primaryFinding).toMatchObject({
      category: 'empty_artifact',
      severity: 'critical',
      evidenceIds: ['task:item-2'],
    });
  });

  it('reports unresolved approval requests as waiting', () => {
    const report = diagnoseTraceBundle(bundle({
      events: [
        { id: 'approval-1', ts: '2026-05-18T00:00:00.000Z', source: 'cli', type: 'approval.required' },
      ],
    }));

    expect(report.health).toBe('waiting');
    expect(report.primaryFinding).toMatchObject({
      category: 'approval_wait',
      severity: 'high',
      evidenceIds: ['event:approval-1'],
    });
  });

  it('formats markdown with primary issue, evidence, and actions', () => {
    const report = diagnoseTraceBundle(bundle({
      tasks: [{ id: 'item-2', title: '生成初稿', status: 'done', artifacts: [] }],
      artifacts: [],
    }));

    expect(formatDiagnosisMarkdown(report)).toContain('## 主要问题');
    expect(formatDiagnosisMarkdown(report)).toContain('## 证据');
    expect(formatDiagnosisMarkdown(report)).toContain('## 建议动作');
  });
});
