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
  window.localStorage.clear();
  window.sessionStorage.clear();
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

  it('restores a stored project-help draft when sidebar navigation has no route state', async () => {
    window.localStorage.setItem('xiaok.threadDraft.thread-help', JSON.stringify({
      threadId: 'thread-help',
      projectId: 'proj-1',
      projectName: '外贸趋势分析',
      draftPrompt: '请帮我诊断并推进外贸趋势分析。',
    }));
    mockGetThread.mockResolvedValue({
      id: 'thread-help',
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
      <MemoryRouter initialEntries={['/t/thread-help']}>
        <Routes>
          <Route path="/t/:taskId" element={<ChatShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('chat-input')).toHaveValue('请帮我诊断并推进外贸趋势分析。');
    });
  });

  it('migrates a matching legacy swarm context draft for an empty project-help thread', async () => {
    window.sessionStorage.setItem('xiaok.swarmContinueContext', JSON.stringify({
      projectId: 'proj-legacy',
      projectName: '外贸趋势分析',
      draftPrompt: '请帮我诊断这个历史空会话。',
    }));
    mockGetThread.mockResolvedValue({
      id: 'thread-legacy',
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
      <MemoryRouter initialEntries={['/t/thread-legacy']}>
        <Routes>
          <Route path="/t/:taskId" element={<ChatShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('chat-input')).toHaveValue('请帮我诊断这个历史空会话。');
    });
    const stored = JSON.parse(window.localStorage.getItem('xiaok.threadDraft.thread-legacy') || '{}');
    expect(stored.threadId).toBe('thread-legacy');
    expect(stored.projectId).toBe('proj-legacy');
    expect(stored.draftPrompt).toBe('请帮我诊断这个历史空会话。');
  });
});
