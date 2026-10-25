// Install at desktop/tests/renderer/task7-consumer.test.tsx. Worker did not run it.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DesktopTaskEvent } from '../../../src/runtime/task-host/types';
const f = vi.hoisted(() => ({ getThread: vi.fn(), recoverTask: vi.fn(), createTask: vi.fn(), createTaskWithFiles: vi.fn(), subscribeTask: vi.fn(),
  answerQuestion: vi.fn(), cancelTask: vi.fn(), updateThreadTaskId: vi.fn(), updateThreadTitle: vi.fn(), selectMaterials: vi.fn(), getModelConfig: vi.fn(), listSkills: vi.fn() }));
vi.mock('../../renderer/src/api', () => ({ api: { ...f, getObservationTaskStatus: vi.fn(async () => ({ mode: 'unavailable' })), getObservationPreconditions: vi.fn(async () => ({ ready: false })) } }));
// Replace only external app-layout context. ChatShell, ChatView, ChatInput,
// TaskPanel and their semantic callbacks remain actual production components.
vi.mock('../../renderer/src/layouts/AppLayout', () => ({ useSidebarCollapse: () => ({ collapsed: false, setCollapsed: () => {} }), AppLayout: () => null }));
import { ChatShell } from '../../renderer/src/components/ChatShell';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { zh } from '../../renderer/src/locales/zh';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';
let observers: Array<{ id: string; handler: (event: DesktopTaskEvent) => void; release: ReturnType<typeof vi.fn> }>;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xiaok:locale', 'zh'); delete (window as unknown as { xiaokDesktop?: unknown }).xiaokDesktop; _resetDesktopApiCache();
  for (const mock of Object.values(f)) mock.mockReset(); observers = [];
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } unobserve() {} disconnect() {} });
  f.getThread.mockResolvedValue({ id: 'thread', title: 'history', mode: 'work', status: 'idle', createdAt: 1, updatedAt: 2, currentTaskId: 'old', taskIds: ['old'] });
  f.recoverTask.mockResolvedValue({ snapshot: { taskId: 'old', sessionId: 'thread', status: 'completed', prompt: 'previous topic', materials: [],
    events: [{ type: 'result', result: { summary: 'history visible', artifacts: [] } }], createdAt: 1, updatedAt: 2 } });
  f.createTask.mockResolvedValue({ taskId: 'new' }); f.createTaskWithFiles.mockResolvedValue({ taskId: 'new' });
  f.selectMaterials.mockResolvedValue({ filePaths: ['C:\\Users\\User\\context.md'] });
  f.listSkills.mockResolvedValue([]); f.getModelConfig.mockResolvedValue({ defaultProvider: 'test', defaultModelId: 'test', models: [], providers: [] });
  f.updateThreadTaskId.mockResolvedValue(undefined); f.updateThreadTitle.mockResolvedValue(undefined); f.answerQuestion.mockResolvedValue(undefined); f.cancelTask.mockResolvedValue(undefined);
  f.subscribeTask.mockImplementation((id, handler) => { const release = vi.fn(); observers.push({ id, handler, release }); return release; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as unknown as { xiaokDesktop?: unknown }).xiaokDesktop; _resetDesktopApiCache(); });
const deadline = { timeout: 1500 };
it.each([false, true])('real normal UI/ChatShell recovery -> files=%s create -> question answer -> cancel -> observer cleanup', async files => {
  const view = render(<MemoryRouter initialEntries={['/t/thread']}><LocaleProvider><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider></MemoryRouter>);
  await waitFor(() => expect(f.recoverTask).toHaveBeenCalledWith('old', 'history'), deadline);
  await screen.findByText('history visible', {}, deadline);
  if (files) { fireEvent.click(screen.getByRole('button', { name: zh.chatInput.attachFiles })); await waitFor(() => expect(f.selectMaterials).toHaveBeenCalledOnce(), deadline); }
  const textarea = screen.getByRole('textbox', { name: zh.chatView.replyPlaceholder });
  fireEvent.change(textarea, { target: { value: 'new request' } }); fireEvent.click(screen.getByRole('button', { name: zh.chatInput.send }));
  const create = files ? f.createTaskWithFiles : f.createTask;
  await waitFor(() => expect(create).toHaveBeenCalledOnce(), deadline);
  expect(create).toHaveBeenCalledWith(files ? { prompt: 'new request', filePaths: ['C:\\Users\\User\\context.md'], context: { threadId: 'thread', taskIds: ['old'] } }
    : { prompt: 'new request', materials: [], context: { threadId: 'thread', taskIds: ['old'] } });
  await waitFor(() => expect(observers.some(o => o.id === 'new')).toBe(true), deadline);
  expect(f.updateThreadTaskId).toHaveBeenCalledWith('thread', 'new');
  const observer = observers.findLast(o => o.id === 'new')!;
  await act(async () => observer.handler({ type: 'needs_user', question: { taskId: 'new', questionId: 'q', kind: 'confirm_understanding', prompt: 'question visible', choices: [{ id: 'yes', label: 'answer explicitly' }] } }));
  fireEvent.click(await screen.findByRole('button', { name: 'answer explicitly' }, deadline));
  await waitFor(() => expect(f.answerQuestion).toHaveBeenCalledWith({ taskId: 'new', answer: { questionId: 'q', type: 'choice', choiceId: 'yes' } }), deadline);
  await waitFor(() => expect(screen.queryByText('question visible')).toBeNull(), deadline);
  // The current production stop button has no accessible name; find its actual icon.
  const stop = view.container.querySelector('button svg.lucide-square')?.closest('button'); expect(stop).not.toBeNull(); fireEvent.click(stop!);
  await waitFor(() => expect(f.cancelTask).toHaveBeenCalledWith('new'), deadline);
  await waitFor(() => expect(screen.getByRole('button', { name: zh.chatInput.send })).toBeVisible(), deadline);
  view.unmount(); expect(observer.release).toHaveBeenCalledOnce();
}, 5000);
