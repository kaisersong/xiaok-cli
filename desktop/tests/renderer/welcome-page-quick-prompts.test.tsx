import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const { mockCreateThread, mockCreateTask, mockCreateTaskWithFiles, mockUpdateThreadTaskId } = vi.hoisted(() => ({
  mockCreateThread: vi.fn(),
  mockCreateTask: vi.fn(),
  mockCreateTaskWithFiles: vi.fn(),
  mockUpdateThreadTaskId: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    createThread: mockCreateThread,
    createTask: mockCreateTask,
    createTaskWithFiles: mockCreateTaskWithFiles,
    updateThreadTaskId: mockUpdateThreadTaskId,
  },
}));

vi.mock('../../renderer/src/components/ChatInput', () => ({
  ChatInput: ({ onSubmit }: { onSubmit?: (text: string, files?: Array<{ filePath: string; name: string }>) => void }) => (
    <div data-testid="chat-input">
      <button
        type="button"
        onClick={() => onSubmit?.('做对抗性评审', [{ filePath: 'D:\\reports\\board-review.docx', name: 'board-review.docx' }])}
      >
        submit-files
      </button>
    </div>
  ),
}));

import { WelcomePage } from '../../renderer/src/components/WelcomePage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('WelcomePage quick prompts', () => {
  it('renders quick prompts in a flex-wrap layout with all items visible', () => {
    render(
      <MemoryRouter>
        <WelcomePage />
      </MemoryRouter>
    );

    const projectPrompt = '创建项目, 让2个智能体搞定本月国外主要AI产品动态分析';
    const oldProjectPrompt = '创建项目，让2个智能体搞定本月国外主要AI产品动态分析';
    const promptGrid = screen.getByTestId('quick-prompts');
    const projectButton = screen.getByRole('button', { name: projectPrompt });

    expect(screen.queryByRole('button', { name: oldProjectPrompt })).not.toBeInTheDocument();
    expect(promptGrid).toHaveClass('flex', 'flex-wrap', 'justify-center');
    expect(promptGrid.querySelectorAll('button')).toHaveLength(7);
    expect(projectButton).toHaveClass('whitespace-nowrap');
    expect(projectButton).toHaveAttribute('title', projectPrompt);
  });

  it('passes selected file names to the new thread route for visible attachment context', async () => {
    mockCreateThread.mockResolvedValue({
      id: 'thread-file',
      title: '做对抗性评审',
      status: 'idle',
      mode: 'work',
      createdAt: 1,
      updatedAt: 1,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: null,
      taskIds: [],
    });
    mockCreateTaskWithFiles.mockResolvedValue({ taskId: 'task-file' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<WelcomePage />} />
          <Route path="/t/:threadId" element={<RouteStateDump />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'submit-files' }));

    await waitFor(() => {
      expect(mockCreateTaskWithFiles).toHaveBeenCalledWith({
        prompt: '做对抗性评审',
        filePaths: ['D:\\reports\\board-review.docx'],
      });
      expect(screen.getByTestId('route-state')).toHaveTextContent('board-review.docx');
    });
  });
});

function RouteStateDump() {
  const location = useLocation();
  return <pre data-testid="route-state">{JSON.stringify(location.state)}</pre>;
}
