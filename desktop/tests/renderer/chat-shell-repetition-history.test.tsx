import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

const { mockSubmitUserTask, mockCreateTask, mockCreateTaskWithFiles, mockGetThread, mockRecoverTask, mockSubscribeTask, mockUpdateThreadTaskId, mockUpdateThreadTitle } = vi.hoisted(() => ({
  mockSubmitUserTask: vi.fn(),
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
    submitUserTask: mockSubmitUserTask,
    createTask: mockCreateTask,
    createTaskWithFiles: mockCreateTaskWithFiles,
    getThread: mockGetThread,
    recoverTask: mockRecoverTask,
    getObservationTaskStatus: vi.fn().mockResolvedValue({ mode: 'off' }),
    getObservationPreconditions: vi.fn().mockResolvedValue({ ready: false }),
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
    streamingText,
    onToggleCanvas,
    historyContent,
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
      steps?: Array<{ toolUseId: string; toolName: string; status: string; response?: string }>;
      generatedFiles?: Array<{ filePath: string; name: string }>;
      result?: { artifacts?: Array<{ title: string; kind: string; mimeType?: string }> } | null;
    }>;
    generatedFiles?: Array<{ filePath: string; name: string }>;
    result?: { artifacts?: Array<{ title: string; kind: string; mimeType?: string }> } | null;
    streamingText?: string;
    historyContent?: ReactNode;
    onToggleCanvas?: () => void;
  }) => (
    <div>
      {historyContent}
      <textarea aria-label="chat-input" readOnly value={prompt} />
      <div data-testid="chat-status">{status}</div>
      <div data-testid="queued-text">{queuedText ?? ''}</div>
      <div data-testid="chat-messages">{messages?.map((message) => (
        <div key={message.id}>
          {message.content}
          {message.steps?.map(step => <span key={step.toolUseId}>{`${step.toolName}:${step.status}:${step.response}`}</span>)}
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
      <div data-testid="streaming-text">{streamingText ?? ''}</div>
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
      <button type="button" onClick={onToggleCanvas}>open-canvas</button>
    </div>
  ),
}));
vi.mock('../../renderer/src/components/CanvasPanel', () => ({
  CanvasPanel: ({ onClose }: { onClose: () => void }) => (
    <section data-testid="canvas-panel">
      <button type="button" onClick={onClose}>close-canvas</button>
    </section>
  ),
}));
vi.mock('../../renderer/src/components/TaskPanel', () => ({
  TaskPanel: ({ goalContent }: { goalContent?: ReactNode }) => (
    <aside data-testid="task-panel">{goalContent}</aside>
  ),
}));

vi.mock('../../renderer/src/layouts/AppLayout', () => ({
  useSidebarCollapse: () => ({ collapsed: false, setCollapsed: () => {} }),
  AppLayout: () => null,
}));

import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { ChatShell } from '../../renderer/src/components/ChatShell';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';

beforeEach(() => {
  mockSubmitUserTask.mockReset();
  mockCreateTask.mockReset();
  mockCreateTaskWithFiles.mockReset();
  // This suite exercises the wide chat layout. Unlike the global no-op mock,
  // report the measured region so production responsive behavior is exercised.
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {} disconnect() {}
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete window.xiaokDesktop;
  _resetDesktopApiCache();
});

// Exercise the real ChatShell paging callback, not a reimplementation of replay.
it.each([
  { currentRepeat: false, olderRepeat: true },
  { currentRepeat: true, olderRepeat: false },
  { currentRepeat: true, olderRepeat: true },
])('keeps current regeneration isolated while paging older history: %j', async ({ currentRepeat, olderRepeat }) => {
  const ids = Array.from({ length: 21 }, (_, index) => `page-task-${index}`);
  mockGetThread.mockResolvedValue({ id: 'paging', title: 'test', status: 'failed', mode: 'work', createdAt: 1, updatedAt: 2, currentTaskId: ids[20], taskIds: ids });
  mockRecoverTask.mockImplementation(async id => ({ snapshot: {
    taskId: id, sessionId: 's', status: id === ids[20] || id === ids[0] ? 'failed' : 'completed',
    prompt: id === ids[20] ? 'current request' : id === ids[0] ? 'older request' : `intermediate ${id}`,
    materials: [], createdAt: 1, updatedAt: 2,
    events: id === ids[20] || id === ids[0] ? [
      { type: 'canvas_tool_call', toolName: 'read_file', input: { path: '/fixture.txt' }, toolUseId: id, eventId: id + ':call' },
      { type: 'canvas_tool_result', toolName: 'read_file', toolUseId: id, ok: true, response: 'raw result ' + id },
      { type: 'assistant_delta', delta: 'retained partial ' + id },
      { type: 'error', message: (id === ids[20] ? currentRepeat : olderRepeat) ? 'MODEL_TEXT_REPETITION_DETECTED' : 'ordinary failure', retryable: false },
    ] : [],
  } }));
  render(<MemoryRouter initialEntries={['/t/paging']}><LocaleProvider><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider></MemoryRouter>);
  await screen.findByText('current request');
  expect(mockRecoverTask).toHaveBeenCalledTimes(20);
  expect(Boolean(screen.queryByRole('button', { name: '重新生成' }))).toBe(currentRepeat);
  fireEvent.click(screen.getByRole('button', { name: /加载更早记录/ }));
  await screen.findByText('older request');
  expect(mockRecoverTask).toHaveBeenCalledTimes(21);
  expect(screen.getByTestId('chat-messages')).toHaveTextContent('read_file:done:raw result ' + ids[0]);
  expect(screen.getByTestId('chat-messages')).toHaveTextContent('read_file:done:raw result ' + ids[20]);
  expect(screen.getByTestId('chat-messages')).toHaveTextContent('retained partial ' + ids[0]);
  expect(screen.getByTestId('chat-messages')).toHaveTextContent('retained partial ' + ids[20]);
  expect(screen.getByTestId('chat-status')).toHaveTextContent('failed');
  expect(Boolean(screen.queryByRole('button', { name: '重新生成' }))).toBe(currentRepeat);
  expect(mockCreateTask).not.toHaveBeenCalled();
  expect(mockSubmitUserTask).not.toHaveBeenCalled();
  if (currentRepeat) {
    mockSubmitUserTask.mockResolvedValue({ taskId: 'regenerated-current' });
    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(mockSubmitUserTask).toHaveBeenCalledWith(expect.objectContaining({ action: 'submit_new', gestureId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), input: expect.objectContaining({ kind: 'materials', prompt: 'current request', materials: [], context: { threadId: 'paging', taskIds: ids } }) })));
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockCreateTaskWithFiles).not.toHaveBeenCalled();
    expect(mockSubmitUserTask).toHaveBeenCalledTimes(1);
    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockCreateTaskWithFiles).not.toHaveBeenCalled();
  }
});
