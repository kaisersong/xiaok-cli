import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';

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
    streamingText?: string;
    onToggleCanvas?: () => void;
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

async function renderEvent(event: { type: 'error'; message: string; code?: string; retryable?: boolean }, history = false) {
  mockGetThread.mockResolvedValue({ id: 'rep', title: 'test', status: history ? 'failed' : 'running', mode: 'work', createdAt: 1, updatedAt: 2, currentTaskId: 'task-rep', taskIds: ['task-rep'] });
  mockRecoverTask.mockResolvedValue({ snapshot: { taskId: 'task-rep', sessionId: 's', status: history ? 'failed' : 'running', prompt: 'original request', materials: [], events: history ? [event] : [], createdAt: 1, updatedAt: 2 } });
  let handler: ((event: unknown) => void) | undefined;
  mockSubscribeTask.mockImplementation((_id, next) => { handler = next; return () => {}; });
  render(<MemoryRouter initialEntries={['/t/rep']}><LocaleProvider><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider></MemoryRouter>);
  if (history) await screen.findByTestId('chat-messages');
  else { await waitFor(() => expect(handler).toBeTypeOf('function')); await act(async () => { handler!(event); }); }
}
it.each([false, true])('renders structured repetition with opaque message (history=%s)', async history => {
  await renderEvent({ type: 'error', message: 'model_failed: provider stream stopped', code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: false }, history);
  expect(await screen.findByRole('button', { name: '重新生成' })).toBeTruthy();
  expect(screen.getByText('检测到重复输出，已停止', { exact: false })).toBeTruthy();
});
it('does not treat an incidental mention as repetition', async () => {
  await renderEvent({ type: 'error', message: 'tool_failed: upstream said MODEL_TEXT_REPETITION_DETECTED' });
  expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
});
it('replays legacy prefix-only errors', async () => {
  await renderEvent({ type: 'error', message: 'model_failed: MODEL_TEXT_REPETITION_DETECTED' }, true);
  expect(await screen.findByRole('button', { name: '重新生成' })).toBeTruthy();
});

it('retryable true overrides a repetition code and prefix', async () => {
  await renderEvent({ type: 'error', message: 'MODEL_TEXT_REPETITION_DETECTED', code: 'MODEL_TEXT_REPETITION_DETECTED', retryable: true });
  expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
});
it('unknown codes cannot use legacy text fallback', async () => {
  await renderEvent({ type: 'error', message: 'MODEL_TEXT_REPETITION_DETECTED', code: 'OTHER' });
  expect(screen.queryByRole('button', { name: '重新生成' })).toBeNull();
});
