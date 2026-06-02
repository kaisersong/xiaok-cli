import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ActivityTimeline } from '../../renderer/src/components/projects/ActivityTimeline';

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    lastEvent: null,
    agents: [{ id: 'xiaok', name: 'xiaok' }],
  }),
}));

afterEach(() => {
  cleanup();
});

function renderTimeline(activities: any[], workflowRuns: any[] = []) {
  return render(
    <LocaleProvider>
      <ActivityTimeline
        project={{ id: 'proj-story', name: '写一个AI工作小故事', status: 'active' } as any}
        activities={activities}
        humanActions={[]}
        workflowRuns={workflowRuns}
      />
    </LocaleProvider>
  );
}

describe('ActivityTimeline detail visibility', () => {
  it('shows the concrete task failure error message', () => {
    renderTimeline([
      {
        type: 'task.failed',
        taskTitle: '设计故事核心冲突与角色',
        agent: 'xiaok',
        failureReason: 'agent_error',
        errorMessage: 'CLI and LLM both failed to generate output for "设计故事核心冲突与角色"',
        ts: '2026-05-18T05:40:22.839Z',
      },
    ]);

    expect(screen.getByText('任务失败')).toBeInTheDocument();
    expect(screen.getByText(/CLI and LLM both failed/)).toBeInTheDocument();
  });

  it('shows failed quality review feedback', () => {
    renderTimeline([
      {
        type: 'task.quality_reviewed',
        taskTitle: '撰写故事初稿',
        passed: false,
        feedback: '提交的产出物是一份交付报告，而不是故事初稿本身。',
        failureClass: 'quality_content_failed',
        action: 'rework',
        ts: '2026-05-18T05:41:49.005Z',
      },
    ]);

    expect(screen.getByText(/提交的产出物是一份交付报告/)).toBeInTheDocument();
  });

  it('merges workflow runs into the same chronological timeline as swarm events', () => {
    renderTimeline([
      {
        type: 'task.progress',
        taskTitle: '先执行的任务',
        agent: 'xiaok',
        ts: 1770000001000,
      },
      {
        type: 'workflow.run.completed',
        projectId: 'proj-story',
        workflowRunId: 'wf-agent-review',
        workflowId: 'agent-review-smoke',
        status: 'completed',
        ts: 1770000002000,
      },
      {
        type: 'task.done',
        taskTitle: '后执行的任务',
        agent: 'xiaok',
        ts: 1770000003000,
      },
    ], [
      {
        id: 'wf-agent-review',
        projectId: 'proj-story',
        workflowId: 'agent-review-smoke',
        title: 'Agent 工作流 smoke',
        strategy: 'workflow',
        source: 'builtin-smoke',
        status: 'completed',
        createdAt: 1770000002000,
        updatedAt: 1770000002000,
        startedAt: 1770000002000,
        completedAt: 1770000002000,
        cancelledAt: null,
        requestedBy: 'human',
        approval: { required: false, status: 'not_required', budget: null, approvedBy: null, decidedAt: null },
        phases: [],
        nodes: [],
        summary: { total: 3, completed: 3, failed: 0, blocked: 0, running: 0, pending: 0, progress: 1, primaryMessage: 'Review gate passed' },
        gateDecision: { status: 'passed', reason: '诊断材料可用', evidenceRefs: [] },
      },
    ]);

    expect(screen.queryByText('工作流运行记录')).not.toBeInTheDocument();

    const entries = screen.getAllByTestId('activity-timeline-entry');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent('Swarm');
    expect(entries[0]).toHaveTextContent('先执行的任务');
    expect(entries[1]).toHaveTextContent('Workflow');
    expect(entries[1]).toHaveTextContent('Agent 复核诊断');
    expect(entries[1]).toHaveTextContent('Review gate passed');
    expect(entries[2]).toHaveTextContent('Swarm');
    expect(entries[2]).toHaveTextContent('后执行的任务');
  });

  it('labels raw workflow activity events as workflow logs when no run snapshot exists', () => {
    renderTimeline([
      {
        type: 'workflow.run.started',
        projectId: 'proj-story',
        workflowRunId: 'wf-running',
        workflowId: 'agent-review-smoke',
        ts: 1770000004000,
      },
    ]);

    const entry = screen.getByTestId('activity-timeline-entry');
    expect(entry).toHaveTextContent('Workflow');
    expect(entry).not.toHaveTextContent('Swarm');
  });

  it('shows the concrete workflow node blocked reason from raw workflow logs', () => {
    renderTimeline([
      {
        type: 'workflow.node.blocked',
        projectId: 'proj-story',
        workflowRunId: 'wf-parallel',
        workflowId: 'parallel-report',
        nodeId: 'script-agent-1',
        reason: 'Premature close',
        ts: 1770000005000,
      },
    ]);

    const entry = screen.getByTestId('activity-timeline-entry');
    expect(entry).toHaveTextContent('工作流节点阻塞');
    expect(entry).toHaveTextContent('Workflow');
    expect(entry).toHaveTextContent('Premature close');
  });
});
