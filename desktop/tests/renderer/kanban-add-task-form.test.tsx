import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KanbanBoard } from '../../renderer/src/components/projects/KanbanBoard';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';

const mocks = vi.hoisted(() => ({
  humanAddTasks: vi.fn(),
}));

vi.mock('../../renderer/src/contexts/KSwarmContext', () => ({
  useKSwarm: () => ({
    agents: [{ id: 'xiaok-worker', name: 'Worker-Agent', roles: ['worker'] }],
    cancelTask: vi.fn(),
    markTaskDone: vi.fn(),
    humanAddTasks: mocks.humanAddTasks,
  }),
}));

function renderBoard() {
  return render(
    <LocaleProvider>
      <KanbanBoard project={{ id: 'project-1', name: '验证', status: 'created', tasks: [] } as any} />
    </LocaleProvider>,
  );
}

describe('KanbanBoard human task save', () => {
  beforeEach(() => {
    mocks.humanAddTasks.mockReset();
  });

  afterEach(() => cleanup());

  it('keeps the form and entered title visible when persistence fails', async () => {
    mocks.humanAddTasks.mockResolvedValue(false);
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: '新增需求' }));
    fireEvent.change(screen.getByRole('textbox', { name: '需求标题...' }), { target: { value: '来源核验' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(mocks.humanAddTasks).toHaveBeenCalled());
    expect(screen.getByDisplayValue('来源核验')).toBeInTheDocument();
    expect(screen.getByText('保存任务失败，请重试。')).toBeInTheDocument();
  });

  it('closes the form only after persistence succeeds', async () => {
    mocks.humanAddTasks.mockResolvedValue(true);
    renderBoard();

    fireEvent.click(screen.getByRole('button', { name: '新增需求' }));
    fireEvent.change(screen.getByRole('textbox', { name: '需求标题...' }), { target: { value: '来源核验' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(screen.queryByDisplayValue('来源核验')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '新增需求' })).toBeInTheDocument();
  });
});
