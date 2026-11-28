import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChatShell } from '../../renderer/src/components/ChatShell';
import { openConversation } from '../../renderer/src/lib/conversation-open';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { zh } from '../../renderer/src/locales/zh';

const api = vi.hoisted(() => ({
  getThread: vi.fn(),
  recoverTask: vi.fn(),
  subscribeTask: vi.fn(),
  hasTaskHistoryPresentation: vi.fn(() => false),
  hasLocalLegacyTaskArchive: vi.fn(() => false),
}));
vi.mock('../../renderer/src/api', () => ({ api }));
vi.mock('../../renderer/src/layouts/AppLayout', () => ({
  useSidebarCollapse: () => ({ collapsed: false, setCollapsed() {} }),
}));
vi.mock('../../renderer/src/components/ChatRightSurface', () => ({
  ChatRightSurface: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
vi.mock('../../renderer/src/components/ChatView', () => ({
  ChatView: ({ thread, messages, historyContent }: {
    thread: { title: string };
    messages: { id: string; content: string }[];
    historyContent?: React.ReactNode;
  }) => (
    <section aria-label={thread.title}>
      {historyContent}
      {messages.map(message => <div key={message.id}>{message.content}</div>)}
    </section>
  ),
}));

function record(id: string, taskIds: string[]) {
  return { id, title: id, status: 'idle', mode: 'work', createdAt: 1, updatedAt: 1,
    starred: false, gtdBucket: 'inbox', pinnedAt: null, taskIds, currentTaskId: taskIds.at(-1) };
}

function recovery(taskId: string, status = 'completed') {
  return { snapshot: { taskId, sessionId: taskId, status, prompt: taskId,
    materials: [], events: [], createdAt: 1, updatedAt: 1 } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function Navigation({ ids }: { ids: string[] }) {
  const navigate = useNavigate();
  return <>{ids.map(id => <button key={id} onClick={() => openConversation(navigate, id)}>{'Open ' + id}</button>)}</>;
}

function open(id: string, ids = [id]) {
  render(<MemoryRouter initialEntries={['/t/' + id]}>
    <LocaleProvider>
      <Navigation ids={ids} />
      <Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes>
    </LocaleProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  api.getThread.mockReset();
  api.recoverTask.mockReset();
  api.subscribeTask.mockReset();
  window.localStorage.setItem('xiaok:locale', 'zh');
  api.subscribeTask.mockReturnValue(() => {});
  api.recoverTask.mockImplementation(async id => recovery(id));
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem('xiaok:locale');
});

it('drops the leftover loading mask before getThread and shows the record while the latest recovery is pending', async () => {
  const thread = deferred<ReturnType<typeof record>>();
  api.getThread.mockReturnValue(thread.promise);
  api.recoverTask.mockReturnValueOnce(new Promise(() => {}));
  open('record-first');
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  await act(async () => thread.resolve(record('record-first', ['pending-latest'])));
  expect(screen.getByRole('region', { name: 'record-first' })).toBeVisible();
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  expect(api.recoverTask).toHaveBeenCalledWith('pending-latest', 'record-first');
});

it('clears a leftover mask immediately when switching to another conversation before getThread returns', async () => {
  const first = deferred<ReturnType<typeof record>>();
  const second = deferred<ReturnType<typeof record>>();
  api.getThread.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  open('stuck-a', ['stuck-a', 'ready-b']);
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open ready-b' }));
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  await act(async () => second.resolve(record('ready-b', ['b-turn'])));
  expect(await screen.findByText('b-turn')).toBeVisible();
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
});

it('reloads the current stuck conversation on a second click and paints the body without waiting behind the mask', async () => {
  const first = deferred<ReturnType<typeof record>>();
  const second = deferred<ReturnType<typeof record>>();
  api.getThread.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  open('stuck-same', ['stuck-same']);
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  expect(api.getThread).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Open stuck-same' }));
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  await waitFor(() => expect(api.getThread).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve(record('stuck-same', ['same-turn'])));
  expect(await screen.findByText('same-turn')).toBeVisible();
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
});

it('paints and subscribes to the latest turn while an older recovery stays pending', async () => {
  api.getThread.mockResolvedValue(record('hung-older', ['hung-turn', 'live-turn']));
  api.recoverTask.mockImplementation(async id => id === 'hung-turn'
    ? new Promise(() => {}) : recovery(id, 'running'));
  open('hung-older');

  expect(await screen.findByText('live-turn')).toBeVisible();
  await waitFor(() => expect(api.recoverTask).toHaveBeenCalledWith('hung-turn', undefined));
  expect(api.subscribeTask).toHaveBeenCalledWith('live-turn', expect.any(Function), 0);
  expect(screen.getByText('live-turn')).toBeVisible();
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
});

it('prepends the completed first page without overwriting live results', async () => {
  const earlier = deferred<ReturnType<typeof recovery>>();
  api.getThread.mockResolvedValue(record('finishing-page', ['earlier-turn', 'current-turn']));
  let latestWasVisibleWhenOlderStarted = false;
  api.recoverTask.mockImplementation(async id => {
    if (id !== 'earlier-turn') return recovery(id, 'running');
    latestWasVisibleWhenOlderStarted = screen.queryByText('current-turn') !== null;
    return earlier.promise;
  });
  open('finishing-page');

  await waitFor(() => expect(api.recoverTask).toHaveBeenCalledWith('earlier-turn', undefined));
  expect(latestWasVisibleWhenOlderStarted).toBe(true);
  const receive = api.subscribeTask.mock.calls[0][1];
  await act(async () => receive({ type: 'result', result: { summary: 'live result', artifacts: [] } }));
  expect(screen.getByText('live result')).toBeVisible();
  await act(async () => earlier.resolve(recovery('earlier-turn')));
  const conversation = within(screen.getByRole('region', { name: 'finishing-page' }));
  expect(conversation.getByText('earlier-turn')).toBeVisible();
  expect(conversation.getByText('current-turn')).toBeVisible();
  expect(conversation.getByText('live result')).toBeVisible();
  expect(screen.getByRole('region', { name: 'finishing-page' })).toHaveTextContent('earlier-turncurrent-turnlive result');
  expect(api.subscribeTask).toHaveBeenCalledTimes(1);
});

it('isolates a late result from the previous thread and reopens cached messages immediately', async () => {
  const late = deferred<ReturnType<typeof recovery>>();
  const reopen = deferred<ReturnType<typeof record>>();
  api.getThread.mockResolvedValueOnce(record('cached-b', ['b-turn']))
    .mockResolvedValueOnce(record('thread-a', ['a-older', 'a-turn']))
    .mockReturnValueOnce(reopen.promise);
  api.recoverTask.mockImplementation(async id => id === 'a-older' ? late.promise : recovery(id));
  open('cached-b', ['thread-a', 'cached-b']);
  await screen.findByText('b-turn');

  fireEvent.click(screen.getByRole('button', { name: 'Open thread-a' }));
  expect(screen.queryByText('b-turn')).toBeNull();
  expect(await screen.findByText('a-turn')).toBeVisible();
  await waitFor(() => expect(api.recoverTask).toHaveBeenCalledWith('a-older', undefined));

  fireEvent.click(screen.getByRole('button', { name: 'Open cached-b' }));
  expect(screen.getByText('b-turn')).toBeVisible();
  expect(screen.queryByText('a-turn')).toBeNull();
  expect(screen.queryByRole('region', { name: 'thread-a' })).toBeNull();
  expect(screen.queryByText(zh.chatShell.threadLoading)).toBeNull();
  await act(async () => late.resolve(recovery('a-older')));
  expect(screen.queryByText('a-older')).toBeNull();
  expect(screen.getByText('b-turn')).toBeVisible();
});

it('keeps the error and reload flow when getThread fails', async () => {
  api.getThread.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(record('retry-thread', ['retry-turn']));
  open('retry-thread');
  expect(await screen.findByRole('alert')).toHaveTextContent(zh.chatShell.threadLoadFailed);
  fireEvent.click(screen.getByRole('button', { name: zh.chatShell.reloadThread }));
  expect(await screen.findByText('retry-turn')).toBeVisible();
  expect(screen.queryByText(zh.chatShell.threadLoadFailed)).toBeNull();
});
