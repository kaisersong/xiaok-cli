import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

function renderKanban(tasks: any[]) {
  return render(
    <LocaleProvider>
      <KanbanBoard project={{ id: 'proj-story', name: '写一个AI工作小故事', status: 'active', tasks } as any} />
    </LocaleProvider>
  );
}

describe('KSwarm kanban failure visibility', () => {
  it('keeps failed and blocked tasks out of the completed column', () => {
    renderKanban([
      { id: 'done-task', title: '完成任务', status: 'done', assignedAgent: 'worker' },
      { id: 'failed-task', title: '失败任务', status: 'failed', assignedAgent: 'worker', failureReason: 'agent_error' },
      { id: 'blocked-task', title: '阻塞任务', status: 'blocked', assignedAgent: 'worker', blockedReason: '缺少实际内容' },
    ]);

    expect(within(screen.getByTestId('kanban-column-done')).getByText('完成任务')).toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-column-done')).queryByText('失败任务')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-column-done')).queryByText('阻塞任务')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-column-stopped')).getByText('失败任务')).toBeInTheDocument();
    expect(within(screen.getByTestId('kanban-column-stopped')).getByText('阻塞任务')).toBeInTheDocument();
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

    const stopped = screen.getByTestId('kanban-column-stopped');
    expect(within(stopped).getByText('阻塞')).toBeInTheDocument();
    expect(within(stopped).getByText(/产出物缺少实际内容/)).toBeInTheDocument();
  });

  it('does not expose advanced manual intervention actions on failed task cards', () => {
    renderKanban([
      { id: 'failed-task', title: '失败任务', status: 'failed', assignedAgent: 'worker', failureReason: 'agent_error' },
    ]);

    expect(screen.queryByRole('button', { name: /人工放行/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /跳过/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /换 Agent/ })).not.toBeInTheDocument();
  });
});
