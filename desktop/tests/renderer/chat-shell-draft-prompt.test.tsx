import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockCreateTask, mockCreateTaskWithFiles, mockGetThread, mockRecoverTask, mockSubscribeTask, mockUpdateThreadTaskId, mockUpdateThreadTitle } = vi.hoisted(() => ({
  mockCreateTask: vi.fn(),
  mockCreateTaskWithFiles: vi.fn(),
  mockGetThread: vi.fn(),
  mockRecoverTask: vi.fn(),
  mockSubscribeTask: vi.fn(() => () => {}),
  mockUpdateThreadTaskId: vi.fn(),
  mockUpdateThreadTitle: vi.fn(),
}));

vi.mock('../../renderer/src/api', () => ({
  api: {
    createTask: mockCreateTask,
    createTaskWithFiles: mockCreateTaskWithFiles,
    getThread: mockGetThread,
    recoverTask: mockRecoverTask,
    subscribeTask: mockSubscribeTask,
    updateThreadTaskId: mockUpdateThreadTaskId,
    updateThreadTitle: mockUpdateThreadTitle,
  },
}));

const DASHBOARD_TOOL_NAME = ['render', 'ui'].join('_');

vi.mock('../../renderer/src/components/ChatView', () => ({
  ChatView: ({
    prompt,
    queuedText,
    status,
    onQueue,
    onSubmit,
    messages,
    generatedFiles,
    result,
  }: {
    prompt: string;
    queuedText?: string | null;
    status?: string;
    onQueue?: (text: string) => void;
    onSubmit?: (text: string, files?: Array<{ filePath: string; name: string }>) => void;
    messages?: Array<{
      id: string;
      role: string;
      content: string;
      generatedFiles?: Array<{ filePath: string; name: string }>;
      result?: { artifacts?: Array<{ title: string; kind: string; mimeType?: string }> } | null;
    }>;
    generatedFiles?: Array<{ filePath: string; name: string }>;
    result?: { artifacts?: Array<{ title: string; kind: string; mimeType?: string }> } | null;
  }) => (
    <div>
      <textarea aria-label="chat-input" readOnly value={prompt} />
      <div data-testid="chat-status">{status}</div>
      <div data-testid="queued-text">{queuedText ?? ''}</div>
      <div data-testid="chat-messages">{messages?.map((message) => (
        <div key={message.id}>
          {message.content}
          {message.generatedFiles?.map((file) => (
            <span key={file.filePath}>{file.name}</span>
          ))}
          {message.result?.artifacts?.map((artifact) => (
            <span key={`${artifact.kind}:${artifact.title}`}>
              {artifact.kind}:{artifact.title}:{artifact.mimeType}
            </span>
          ))}
        </div>
      ))}</div>
      <div data-testid="current-result-artifacts">{result?.artifacts?.map((artifact) => (
        <span key={`${artifact.kind}:${artifact.title}`}>
          {artifact.kind}:{artifact.title}:{artifact.mimeType}
        </span>
      ))}</div>
      <div data-testid="generated-files">{generatedFiles?.map((file) => (
        <div key={file.filePath}>{file.name}</div>
      ))}</div>
      <button type="button" onClick={() => onSubmit?.('触发提交')}>submit-now</button>
      <button type="button" onClick={() => onSubmit?.('带附件提交', [{ filePath: '/tmp/context.md', name: 'context.md' }])}>submit-files</button>
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

vi.mock('../../renderer/src/layouts/AppLayout', () => ({
  useSidebarCollapse: () => ({ collapsed: false, setCollapsed: () => {} }),
  AppLayout: () => null,
}));

import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
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
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('chat-input')).toHaveValue('请诊断外贸趋势分析，并在安全时调用 continue_project。');
    });
    expect(mockGetThread).toHaveBeenCalledWith('thread-draft');
  });

  it('shows the selected file name on the initial user message from WelcomePage', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-file-visible',
      title: '做对抗性评审',
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
        pathname: '/t/thread-file-visible',
        state: {
          initialPrompt: '做对抗性评审',
          initialFiles: [{ filePath: 'D:\\reports\\board-review.docx', name: 'board-review.docx' }],
        },
      }]}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('做对抗性评审');
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('附件: board-review.docx');
    });
  });

  it('hides scheduled task system prompt lines and shows a light execution-time notice', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-scheduled',
      title: 'AI日报',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-scheduled-ai-daily',
      taskIds: ['task-scheduled-ai-daily'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-scheduled-ai-daily',
        sessionId: 'sess-scheduled-ai-daily',
        status: 'completed',
        prompt: [
          '[SYSTEM: 这是用户设置的自动定时任务，请给出友好简洁的回复。]',
          '[SYSTEM: scheduled_task_id=scheduled-ai-daily; timed_action_id=scheduled-ai-daily; timed_action_title=AI日报]',
          '[SYSTEM: scheduled_due_at=2026-06-16T00:00:00.000Z; claimed_at=2026-06-16T00:00:19.948Z; overdue_ms=19948]',
          '[SYSTEM: 如果本次任务的停止条件已经满足，必须调用 scheduled_task_cancel 取消 scheduled_task_id；agent 创建的 interval 临时任务会被删除，避免继续执行。]',
          '',
          '给我当天的AI日报',
          '',
          '[SYSTEM: 本次自动任务唯一正确的 scheduled_task_id 是 scheduled-ai-daily。如果用户 prompt 中出现其他 scheduled_task_id，必须忽略其他 ID；停止条件满足时调用 scheduled_task_cancel(task_id="scheduled-ai-daily")，Xiaok 会删除该临时任务。]',
        ].join('\n'),
        materials: [],
        events: [{ type: 'result', result: { summary: '已生成日报', artifacts: [] } }],
        result: { summary: '已生成日报', artifacts: [] },
        createdAt: 1781568019950,
        updatedAt: 1781568040864,
      },
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-scheduled']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('给我当天的AI日报');
    });
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('定时任务「AI日报」');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('计划执行');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('实际执行');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('scheduled_task_id');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('timed_action_id');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('停止条件已经满足');
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
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('running');
      expect(mockSubscribeTask).toHaveBeenCalledWith('task-running', expect.any(Function), expect.anything());
    });

    fireEvent.click(screen.getByRole('button', { name: 'queue-second' }));

    await waitFor(() => {
      expect(screen.getByTestId('queued-text')).toHaveTextContent('第二条输入');
    });

    act(() => {
      subscribedHandler?.({ type: 'result', result: { summary: '第一条完成', artifacts: [] } });
    });

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({
        prompt: '第二条输入',
        materials: [],
        context: { threadId: 'thread-queued', taskIds: ['task-running'] },
      });
    });
    expect(mockUpdateThreadTaskId).toHaveBeenCalledWith('thread-queued', 'task-second');
  });

  it('submits existing thread task ids as context when continuing a thread', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-existing',
      title: 'Existing thread',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-old',
      taskIds: ['task-old'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-old',
        sessionId: 'sess-old',
        status: 'completed',
        prompt: '上一轮输入',
        materials: [],
        events: [{ type: 'result', result: { summary: '上一轮完成', artifacts: [] } }],
        result: { summary: '上一轮完成', artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mockCreateTask.mockResolvedValue({ taskId: 'task-new' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/t/thread-existing']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('idle');
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit-now' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({
        prompt: '触发提交',
        materials: [],
        context: { threadId: 'thread-existing', taskIds: ['task-old'] },
      });
    });
    expect(mockUpdateThreadTaskId).toHaveBeenCalledWith('thread-existing', 'task-new');
  });

  it('submits existing thread task ids as context when continuing with files', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-files',
      title: 'Existing thread with files',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-old',
      taskIds: ['task-old'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-old',
        sessionId: 'sess-old',
        status: 'completed',
        prompt: '上一轮输入',
        materials: [],
        events: [{ type: 'result', result: { summary: '上一轮完成', artifacts: [] } }],
        result: { summary: '上一轮完成', artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mockCreateTaskWithFiles.mockResolvedValue({ taskId: 'task-file-new' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/t/thread-files']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('idle');
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit-files' }));

    await waitFor(() => {
      expect(mockCreateTaskWithFiles).toHaveBeenCalledWith({
        prompt: '带附件提交',
        filePaths: ['/tmp/context.md'],
        context: { threadId: 'thread-files', taskIds: ['task-old'] },
      });
    });
    expect(mockUpdateThreadTaskId).toHaveBeenCalledWith('thread-files', 'task-file-new');
  });

  it('does not carry previous generated files into the next running turn', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-artifact-scope',
      title: 'Existing thread with generated file',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-old',
      taskIds: ['task-old'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-old',
        sessionId: 'sess-old',
        status: 'completed',
        prompt: '第一轮输入',
        materials: [],
        events: [
          { type: 'task_started', taskId: 'task-old' },
          {
            type: 'canvas_tool_call',
            toolName: 'Write',
            input: { file_path: '/tmp/old-turn.md' },
            toolUseId: 'tool-old-write',
            eventId: 'event-old-write',
          },
          {
            type: 'canvas_tool_result',
            toolName: 'Write',
            toolUseId: 'tool-old-write',
            ok: true,
            response: 'ok',
            eventId: 'event-old-write-result',
          },
          { type: 'result', result: { summary: '第一轮完成', artifacts: [] } },
        ],
        result: { summary: '第一轮完成', artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mockCreateTask.mockResolvedValue({ taskId: 'task-new' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);

    render(
      <MemoryRouter initialEntries={['/t/thread-artifact-scope']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('old-turn.md');
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit-now' }));

    await waitFor(() => {
      expect(mockCreateTask).toHaveBeenCalledWith({
        prompt: '触发提交',
        materials: [],
        context: { threadId: 'thread-artifact-scope', taskIds: ['task-old'] },
      });
    });
    expect(screen.getByTestId('chat-status')).toHaveTextContent('running');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('old-turn.md');
    expect(screen.getByTestId('generated-files')).not.toHaveTextContent('old-turn.md');
  });

  it('shows only files generated by the current running turn', async () => {
    let subscribedHandler: ((event: { type: string; [key: string]: unknown }) => void) | null = null;
    mockGetThread.mockResolvedValue({
      id: 'thread-current-file',
      title: 'Existing thread with current generated file',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-old',
      taskIds: ['task-old'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-old',
        sessionId: 'sess-old',
        status: 'completed',
        prompt: '第一轮输入',
        materials: [],
        events: [
          { type: 'task_started', taskId: 'task-old' },
          {
            type: 'canvas_tool_call',
            toolName: 'Write',
            input: { file_path: '/tmp/old-turn.md' },
            toolUseId: 'tool-old-write',
            eventId: 'event-old-write',
          },
          { type: 'result', result: { summary: '第一轮完成', artifacts: [] } },
        ],
        result: { summary: '第一轮完成', artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    });
    mockCreateTask.mockResolvedValue({ taskId: 'task-new' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);
    mockSubscribeTask.mockImplementation((_taskId, handler) => {
      subscribedHandler = handler as typeof subscribedHandler;
      return () => {};
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-current-file']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('old-turn.md');
    });

    fireEvent.click(screen.getByRole('button', { name: 'submit-now' }));

    await waitFor(() => {
      expect(mockSubscribeTask).toHaveBeenCalledWith('task-new', expect.any(Function));
    });

    act(() => {
      subscribedHandler?.({
        type: 'canvas_tool_call',
        toolName: 'Write',
        input: { file_path: '/tmp/current-turn.pdf' },
        toolUseId: 'tool-current-write',
        eventId: 'event-current-write',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('generated-files')).toHaveTextContent('current-turn.pdf');
    });
    expect(screen.getByTestId('generated-files')).not.toHaveTextContent('old-turn.md');
  });

  it('replays A2UI artifacts recorded before a result even when the final result has no artifacts', async () => {
    mockGetThread.mockResolvedValue({
      id: 'thread-a2ui-replay',
      title: 'A2UI replay',
      status: 'idle',
      mode: 'work',
      createdAt: 1779000000000,
      updatedAt: 1779000000000,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-a2ui',
      taskIds: ['task-a2ui'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-a2ui',
        sessionId: 'sess-a2ui',
        status: 'completed',
        prompt: '生成 A2UI 看板',
        materials: [],
        events: [
          { type: 'task_started', taskId: 'task-a2ui' },
          {
            type: 'artifact_recorded',
            artifactId: 'artifact-a2ui',
            kind: 'a2ui',
            label: 'ops.a2ui.json',
            filePath: '/tmp/ops.a2ui.json',
            previewAvailable: true,
            turnId: 'turn-a2ui',
            creator: `tool:${DASHBOARD_TOOL_NAME}`,
            mimeType: 'application/vnd.xiaok.a2ui+json',
          },
          { type: 'result', result: { summary: '已生成 A2UI 看板', artifacts: [] } },
        ],
        result: { summary: '已生成 A2UI 看板', artifacts: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-a2ui-replay']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('a2ui:ops.a2ui.json:application/vnd.xiaok.a2ui+json');
    });
  });

  it('merges live A2UI artifact_recorded events into an empty final result', async () => {
    let subscribedHandler: ((event: { type: string; [key: string]: unknown }) => void) | null = null;
    mockGetThread.mockResolvedValue({
      id: 'thread-a2ui-live',
      title: 'A2UI live',
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
    mockCreateTask.mockResolvedValue({ taskId: 'task-a2ui-live' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);
    mockUpdateThreadTitle.mockResolvedValue(undefined);
    mockSubscribeTask.mockImplementation((_taskId, handler) => {
      subscribedHandler = handler as typeof subscribedHandler;
      return () => {};
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-a2ui-live']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'submit-now' }));

    await waitFor(() => {
      expect(mockSubscribeTask).toHaveBeenCalledWith('task-a2ui-live', expect.any(Function));
    });

    act(() => {
      subscribedHandler?.({
        type: 'artifact_recorded',
        artifactId: 'artifact-a2ui-live',
        kind: 'a2ui',
        label: 'live.a2ui.json',
        filePath: '/tmp/live.a2ui.json',
        previewAvailable: true,
        turnId: 'turn-a2ui-live',
        creator: `tool:${DASHBOARD_TOOL_NAME}`,
        mimeType: 'application/vnd.xiaok.a2ui+json',
      });
      subscribedHandler?.({
        type: 'result',
        result: { summary: '已生成 live A2UI', artifacts: [] },
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('current-result-artifacts')).toHaveTextContent('a2ui:live.a2ui.json:application/vnd.xiaok.a2ui+json');
    });
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
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
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
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
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
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
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

  it('replays persisted quota failures and restores failed status', async () => {
    const failureReason = '429 您已达到每周/每月使用上限，您的限额将在 2026-07-15 14:18:50 重置。';
    mockGetThread.mockResolvedValue({
      id: 'thread-quota-failed',
      title: '找 YC 合伙人的分享内容',
      status: 'idle',
      mode: 'work',
      createdAt: 1784078843232,
      updatedAt: 1784078866125,
      starred: false,
      gtdBucket: 'inbox',
      pinnedAt: null,
      currentTaskId: 'task-quota-failed',
      taskIds: ['task-quota-failed'],
    });
    mockRecoverTask.mockResolvedValue({
      snapshot: {
        taskId: 'task-quota-failed',
        sessionId: 'sess-quota-failed',
        status: 'failed',
        prompt: '找YC合伙人diana hu最新的视频的关键内容，how to build an ai native company，详细的内容',
        materials: [],
        events: [
          { type: 'task_started', taskId: 'task-quota-failed' },
          { type: 'assistant_delta', delta: '已找到视频，正在整理。' },
          { type: 'progress', message: '正在整理视频摘要，这条尾部进度不应保留。', stage: 'working', eventId: 'event-trailing-progress' },
          { type: 'error', message: failureReason },
          { type: 'task_terminal', status: 'failed' },
        ],
        createdAt: 1784078843232,
        updatedAt: 1784078866125,
      },
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-quota-failed']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('chat-status')).toHaveTextContent('failed');
      expect(screen.getByTestId('chat-messages')).toHaveTextContent('额度已达上限');
    });
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('已找到视频，正在整理。');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('2026-07-15 14:18:50');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('切换');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('正在整理视频摘要，这条尾部进度不应保留。');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('429');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('每周/每月');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('Error: 429');
    expect(mockSubscribeTask).not.toHaveBeenCalled();
  });

  it('shows localized live failures and preserves partial assistant output', async () => {
    let subscribedHandler: ((event: { type: string; delta?: string; message?: string; eventId?: string }) => void) | null = null;
    mockGetThread.mockResolvedValue({
      id: 'thread-live-failed',
      title: 'Live failure',
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
    mockCreateTask.mockResolvedValue({ taskId: 'task-live-failed' });
    mockUpdateThreadTaskId.mockResolvedValue(undefined);
    mockSubscribeTask.mockImplementation((_taskId, handler) => {
      subscribedHandler = handler as typeof subscribedHandler;
      return () => {};
    });

    render(
      <MemoryRouter initialEntries={['/t/thread-live-failed']}>
        <LocaleProvider>
          <Routes>
            <Route path="/t/:taskId" element={<ChatShell />} />
          </Routes>
        </LocaleProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('chat-status')).toHaveTextContent('idle'));
    fireEvent.click(screen.getByRole('button', { name: 'submit-now' }));
    await waitFor(() => expect(mockSubscribeTask).toHaveBeenCalledWith('task-live-failed', expect.any(Function)));

    const failureReason = '429 您已达到每周/每月使用上限，您的限额将在 2026-07-15 14:18:50 重置。';
    act(() => {
      subscribedHandler?.({
        type: 'progress',
        message: '正在整理视频摘要，这条 live 进度不应保留。',
        eventId: 'event-live-trailing-progress',
      });
      subscribedHandler?.({ type: 'assistant_delta', delta: '已找到视频，正在整理。' });
      subscribedHandler?.({ type: 'error', message: failureReason });
      subscribedHandler?.({ type: 'error', message: failureReason });
    });

    await waitFor(() => expect(screen.getByTestId('chat-status')).toHaveTextContent('failed'));
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('已找到视频，正在整理。');
    expect(screen.getByTestId('chat-messages')).toHaveTextContent('额度已达上限');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('正在整理视频摘要，这条 live 进度不应保留。');
    expect(screen.getByTestId('chat-messages').textContent?.match(/任务执行失败/g) ?? []).toHaveLength(1);
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('429');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('每周/每月');
    expect(screen.getByTestId('chat-messages')).not.toHaveTextContent('Error: 429');
  });
});
