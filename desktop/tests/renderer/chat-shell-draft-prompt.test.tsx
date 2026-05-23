import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockCreateTask, mockGetThread, mockRecoverTask, mockSubscribeTask, mockUpdateThreadTaskId, mockUpdateThreadTitle } = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockGetThread: vi.fn(),
  mockRecoverTask: vi.fn(),
  mockSubscribeTask: vi.fn(() => () => {}),
  mockUpdateThreadTaskId: vi.fn(),
  mockUpdateThreadTitle: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    createTask: mockCreateTask,
    getThread: mockGetThread,
    recoverTask: mockRecoverTask,
    subscribeTask: mockSubscribeTask,
    updateThreadTaskId: mockUpdateThreadTaskId,
    updateThreadTitle: mockUpdateThreadTitle,
  },
}));

vi.mock('../../renderer/src/components/ChatView', () => ({
  ChatView: ({
    prompt,
    queuedText,
    status,
    onQueue,
    onSubmit,
    messages,
  }: {
    prompt: string;
    queuedText?: string | null;
    status?: string;
    onQueue?: (text: string) => void;
    onSubmit?: (text: string) => void;
    messages?: Array<{ id: string; role: string; content: string }>;
  }) => (
    <div>
      <textarea aria-label="chat-input" readOnly value={prompt} />
      <div data-testid="chat-status">{status}</div>
      <div data-testid="queued-text">{queuedText ?? ''}</div>
      <div data-testid="chat-messages">{messages?.map((message) => (
        <div key={message.id}>{message.content}</div>
      ))}</div>
      <button type="button" onClick={() => onSubmit?.('触发提交')}>submit-now</button>
      <button type="button" onClick={() => onQueue?.('第二条输入')}>queue-second</button>
    </div>
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

  it('drains a queued prompt after the running task completes', async () => {
    let subscribedHandler: ((event: { type: string; result?: { summary: string; artifacts: unknown[] } }) => void) | null = null;
    mockGetThread.mockResolvedValue({
      id: 'thread-queued',
      title: 'Queued prompt thread',
      status: 'running',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-running',
      taskIds: ['task-running'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-running',
        sessionId: 'sess-running',
        status: 'running',
        prompt: '第一条输入',
        materials: [],
        events: [{ type: 'task_started', taskId: 'task-running' }],
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mockSubscribeTask.mockImplementation((_taskId, handler) => {
      subscribedHandler = handler as typeof subscribedHandler;
      return () => {};
    });
    mockCreateTask.mockResolvedValue({ taskId: 'task-second' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/t/thread-queued']}>
        <Routes>
          <Route path="/t/:taskId" element={<ChatShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('running');
      expect(mockSubscribeTask).toHaveBeenCalledWith('task-running', expect.any(Function));
    });

    fireEvent.click(screen.getByRole('button', { name: 'queue-second' }));

    await waitFor(() => {
      expect(screen.getByTestId('queued-text')).toHaveTextContent('第二条输入');
    });

    act(() => {
      subscribedHandler?.({ type: 'result', result: { summary: '第一条完成', artifacts: [] } });
    });

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({ prompt: '第二条输入', materials: [] });
    });
    expect(mockUpdateThreadTaskId).toHaveBeenCalledWith('thread-queued', 'task-second');
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

  it('sanitizes provider authentication errors before rendering submit failures', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-auth-error',
      title: 'Auth error thread',
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
    mockUpdateThreadTitle.mockResolvedValue(undefined);
    mockCreateTask.mockRejectedValue(new Error('Error: 401 {"error":{"type":"authentication_error","message":"The API Key appears to be invalid or may have expired. Please verify your credentials and try again."},"type":"error"}'));

    render(
      <MemoryRouter initialEntries={['/t/thread-auth-error']}>
        <Routes>
          <Route path="/t/:taskId" element={<ChatShell />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('idle');
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit-now' }));

    await waitFor(() => {
      expect(screen.getByText(/API Key 无效或已过期/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/authentication_error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/The API Key appears/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Failed:/)).not.toBeInTheDocument();
  });
});
