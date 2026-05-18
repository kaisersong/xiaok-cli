import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGetThread } = vi.hoisted(() => ({
  mockGetThread: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    getThread: mockGetThread,
    recoverTask: vi.fn(),
    subscribeTask: vi.fn(() => () => {}),
  },
}));

vi.mock('../../renderer/src/components/ChatView', () => ({
  ChatView: ({ prompt }: { prompt: string }) => (
    <textarea aria-label="chat-input" readOnly value={prompt} />
  ),
}));
vi.mock('../../renderer/src/components/CanvasPanel', () => ({
  CanvasPanel: () => null,
}));
vi.mock('../../renderer/src/components/TaskPanel', () => ({
  TaskPanel: () => null,
}));

import { ChatShell } from '../../renderer/src/components/ChatShell';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatShell draft prompt navigation state', () => {
  it('loads draftPrompt into the chat input without creating a task', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-draft',
      title: '让小K帮忙：外贸趋势分析',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: null,
      taskIds: [],
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/t/thread-draft',
        state: { draftPrompt: '请诊断外贸趋势分析，并在安全时调用 continue_project。' },
      }]}>
        <Routes>
          <Route path="/t/:taskId" element={<ChatShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('chat-input')).toHaveValue('请诊断外贸趋势分析，并在安全时调用 continue_project。');
    });
    expect(mockGetThread).toHaveBeenCalledWith('thread-draft');
  });
});
