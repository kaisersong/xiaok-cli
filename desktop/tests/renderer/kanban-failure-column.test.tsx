import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { KanbanBoard } from '../../renderer/src/components/projects/KanbanBoard';

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    agents: [{ id: 'worker', name: 'Worker' }],
    cancelTask: vi.fn(),
    markTaskDone: vi.fn(),
    humanAddTasks: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
});

function renderKanban(tasks: any[], onStartTaskWorkflow?: (taskId: string) => void, projectOverrides: Record<string, unknown> = {}) {
  return render(
    <LocaleProvider>
      <KanbanBoard project={{ id: 'proj-story', name: '写一个AI工作小故事', status: 'active', tasks, ...projectOverrides } as any} onStartTaskWorkflow={onStartTaskWorkflow} />
    </LocaleProvider>
  );
}

describe('KSwarm kanban failure visibility', () => {
  it('shows start time for active and review tasks, and completion time for done tasks', () => {
    const activeStartedAt = Date.parse('2026-05-19T10:11:00+08:00');
    const reviewStartedAt = Date.parse('2026-05-19T11:12:00+08:00');
    const completedAt = Date.parse('2026-05-19T12:13:00+08:00');

    renderKanban([
      { id: 'pending-task', title: '待处理任务', status: 'pending', assignedAgent: 'worker', createdAt: activeStartedAt },
      { id: 'active-task', title: '进行中任务', status: 'in_progress', assignedAgent: 'worker', startedAt: activeStartedAt },
      { id: 'review-task', title: '待审核任务', status: 'submitted', assignedAgent: 'worker', startedAt: reviewStartedAt, updatedAt: Date.parse('2026-05-19T11:50:00+08:00') },
      { id: 'done-task', title: '完成任务', status: 'done', assignedAgent: 'worker', completedAt },
    ]);

    const pending = screen.getByTestId('kanban-column-pending');
    const active = screen.getByTestId('kanban-column-active');
    const review = screen.getByTestId('kanban-column-review');
    const done = screen.getByTestId('kanban-column-done');

    expect(within(pending).queryByText(/时间/)).not.toBeInTheDocument();
    expect(within(active).getByText('启动时间 05/19 10:11')).toBeInTheDocument();
    expect(within(review).getByText('启动时间 05/19 11:12')).toBeInTheDocument();
    expect(within(done).getByText('完成时间 05/19 12:13')).toBeInTheDocument();
  });

  it('shows failed and blocked tasks in the done column with distinct styling', () => {
    renderKanban([
      { id: 'done-task', title: '完成任务', status: 'done', assignedAgent: 'worker' },
      { id: 'failed-task', title: '失败任务', status: 'failed', assignedAgent: 'worker', failureReason: 'agent_error' },
      { id: 'blocked-task', title: '阻塞任务', status: 'blocked', assignedAgent: 'worker', blockedReason: '缺少实际内容' },
    ]);

    const done = screen.getByTestId('kanban-column-done');
    expect(within(done).getByText('完成任务')).toBeInTheDocument();
    expect(within(done).getByText('失败任务')).toBeInTheDocument();
    expect(within(done).getByText('阻塞任务')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-column-stopped')).not.toBeInTheDocument();
  });

  it('shows a readable failure reason on stopped task cards', () => {
    renderKanban([
      {
        id: 'blocked-task',
        title: '定义真实性基准并收集素材',
        status: 'blocked',
        assignedAgent: 'worker',
        blockedReason: '产出物缺少实际内容，请重新提交可读文本。',
      },
    ]);

    const done = screen.getByTestId('kanban-column-done');
    expect(within(done).getByText('阻塞')).toBeInTheDocument();
    expect(within(done).getByText(/产出物缺少实际内容/)).toBeInTheDocument();
  });

  it('does not expose advanced manual intervention actions on failed task cards', () => {
    renderKanban([
      { id: 'failed-task', title: '失败任务', status: 'failed', assignedAgent: 'worker', failureReason: 'agent_error' },
    ]);

    expect(screen.queryByRole('button', { name: /人工放行/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /跳过/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /换 Agent/ })).not.toBeInTheDocument();
  });

  it('keeps metadata-only pending tasks out of the kanban columns and counts', () => {
    renderKanban([
      { id: 'valid-pending', title: '有效待处理任务', status: 'pending', assignedAgent: 'worker' },
      { id: 'metadata-only', status: 'pending', assignedAgent: 'ghost-agent' },
    ]);

    const pending = screen.getByTestId('kanban-column-pending');
    expect(within(pending).getByText('有效待处理任务')).toBeInTheDocument();
    expect(within(pending).queryByText('ghost-agent')).not.toBeInTheDocument();
    expect(within(pending).getByText('1')).toBeInTheDocument();
  });

  it('uses description as the card title for legacy tasks without title', () => {
    renderKanban([
      {
        id: 'description-only',
        description: '只有描述的历史任务也应该可读',
        status: 'pending',
        assignedAgent: 'worker',
      },
    ]);

    const pending = screen.getByTestId('kanban-column-pending');
    expect(within(pending).getByText('只有描述的历史任务也应该可读')).toBeInTheDocument();
    expect(within(pending).getByText('Worker')).toBeInTheDocument();
    expect(within(pending).getByText('1')).toBeInTheDocument();
  });

  it('exposes task-level workflow execution on task cards when provided', () => {
    const onStartTaskWorkflow = vi.fn();

    renderKanban([
      { id: 'workflow-task', title: '需要复核的复杂任务', status: 'pending', assignedAgent: 'worker' },
    ], onStartTaskWorkflow);

    fireEvent.click(screen.getByRole('button', { name: '用工作流执行' }));

    expect(onStartTaskWorkflow).toHaveBeenCalledWith('workflow-task');
  });

  it('shows the recorded task execution strategy on task cards', () => {
    renderKanban([
      {
        id: 'workflow-task',
        title: '需要复核的复杂任务',
        status: 'dispatched',
        assignedAgent: 'worker',
        execution: {
          strategy: 'workflow',
          modeSource: 'auto_selector',
          reasonCode: 'delivery_review',
          workflowRunId: 'wf-1',
          selectedAt: 1770000000000,
        },
      },
      {
        id: 'direct-task',
        title: '整理会议纪要',
        status: 'pending',
        assignedAgent: 'worker',
        execution: {
          strategy: 'direct',
          modeSource: 'project_default',
          reasonCode: 'simple_direct',
          workflowRunId: null,
          selectedAt: 1770000000000,
        },
      },
    ]);

    const active = screen.getByTestId('kanban-column-active');
    const pending = screen.getByTestId('kanban-column-pending');
    expect(within(active).getByText('工作流执行')).toBeInTheDocument();
    expect(within(active).getByText('交付复核')).toBeInTheDocument();
    expect(within(pending).getByText('快速执行')).toBeInTheDocument();
  });

  it('shows the project workflow-preferred execution preview before task dispatch records execution', () => {
    renderKanban([
      {
        id: 'workflow-preview-task',
        title: '验证任务级工作流',
        status: 'pending',
        assignedAgent: 'worker',
      },
    ], undefined, { executionMode: 'workflow_preferred' });

    const pending = screen.getByTestId('kanban-column-pending');
    expect(within(pending).getByText('工作流执行')).toBeInTheDocument();
    expect(within(pending).getByText('高质量')).toBeInTheDocument();
  });
});
