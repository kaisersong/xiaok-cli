import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { ChatShell } from '../../renderer/src/components/ChatShell';
import { ChatInput } from '../../renderer/src/components/ChatInput';
import { GoalBar } from '../../renderer/src/components/GoalBar';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';
import type { DesktopGoalMutationResult, DesktopGoalProjection, GoalAttachmentRequest } from '../../electron/preload-api';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types';

const fixtures = vi.hoisted(() => ({ createTask: vi.fn(), createTaskWithFiles: vi.fn(), getThread: vi.fn(), recoverTask: vi.fn(), updateThreadTaskId: vi.fn(), subscribeTask: vi.fn(), files: [] as Array<{ filePath: string; name: string }> }));
vi.mock('../../renderer/src/api', () => ({ api: {
  createTask: fixtures.createTask, createTaskWithFiles: fixtures.createTaskWithFiles, getThread: fixtures.getThread,
  recoverTask: fixtures.recoverTask,
  updateThreadTitle: vi.fn(async () => {}), updateThreadTaskId: fixtures.updateThreadTaskId, subscribeTask: fixtures.subscribeTask, listSkills: vi.fn(async () => []),
} }));
vi.mock('../../renderer/src/layouts/AppLayout', () => ({ useSidebarCollapse: () => ({ collapsed: false, setCollapsed: vi.fn() }), AppLayout: () => null }));
vi.mock('../../renderer/src/components/ChatView', () => ({ ChatView: (props: { prompt: string; onPromptChange: (value: string) => void; onSubmit: ComponentProps<typeof ChatInput>['onSubmit']; messages: Array<{ id: string; content: string }>; thread: { currentTaskId: string | null }; status: string }) => <>
  <ChatInput value={props.prompt} onChange={props.onPromptChange} onSubmit={props.onSubmit} placeholder="draft" initialFiles={fixtures.files} />
  <div data-testid="messages">{props.messages.map(message => <p key={message.id}>{message.content}</p>)}</div>
  <output data-testid="current-task">{props.thread.currentTaskId}</output><output data-testid="task-status">{props.status}</output>
</> }));
vi.mock('../../renderer/src/components/TaskPanel', () => ({ TaskPanel: ({ goalContent }: { goalContent?: ReactNode }) => <div>{goalContent}</div> }));
vi.mock('../../renderer/src/components/CanvasPanel', () => ({ CanvasPanel: () => null }));
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Navigate() { const navigate = useNavigate(); return <button onClick={() => navigate('/t/B', { state: { draftPrompt: 'B draft', createGoal: true } })}>thread B</button>; }
async function shell(goal = false) {
  let mounted!: ReturnType<typeof render>;
  await act(async () => { mounted = render(<MemoryRouter initialEntries={[{ pathname: '/t/A', state: { draftPrompt: 'original draft', createGoal: goal } }]}>
    <LocaleProvider><Navigate /><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider>
  </MemoryRouter>); }); return mounted;
}
function projection(id: string): DesktopGoalProjection { return { activation: 'disarmed', state: {
  goalId: id, sessionId: 'A', revision: 1, epoch: 1, objective: 'new goal', expectedEvidenceKinds: ['answer'], status: 'active',
  turnsUsed: 0, tokensUsed: 0, activeWallClockMs: 0, budgetLimits: { turnLimit: 2 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 1,
} }; }
function attachmentReply(threadId: string, requestId?: string): DesktopGoalMutationResult {
  const goal = { ...projection(`goal-${threadId}`), state: { ...projection(`goal-${threadId}`).state, sessionId: threadId } };
  return { goal, preparedTask: { threadId, taskId: `task-${threadId}`, attachmentId: `attachment-${threadId}`,
    attachmentSource: { kind: 'request', requestId: requestId ?? null }, goalRef: { goalId: goal.state.goalId, revision: 1 },
    executionScope: { kind: 'goal_turn', origin: 'user', threadId, goalId: goal.state.goalId, epoch: 1, goalTurnId: `turn-${threadId}` },
    expiresAt: Date.now() + 60_000 } };
}
beforeEach(() => {
  localStorage.clear(); fixtures.files = []; fixtures.createTask.mockReset(); fixtures.createTaskWithFiles.mockReset();
  fixtures.subscribeTask.mockReset().mockImplementation(() => () => {});
  fixtures.recoverTask.mockReset();
  fixtures.updateThreadTaskId.mockReset().mockResolvedValue(undefined);
  fixtures.getThread.mockImplementation(async (id: string) => ({ id, title: id, status: 'idle', mode: 'work', createdAt: 1, updatedAt: 1,
    starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: null, taskIds: [] }));
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'xiaokDesktop'); _resetDesktopApiCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('W12 actual ChatShell and ChatInput retain rejected drafts', () => {
  it.each([false, true])('main denial preserves actual input and attachment=%s, with no automatic resubmit', async files => {
    if (files) fixtures.files = [{ filePath: 'D:\\draft.txt', name: 'draft.txt' }];
    const failure = new Error('multi_agent_permission_revoked'); fixtures.createTask.mockRejectedValue(failure); fixtures.createTaskWithFiles.mockRejectedValue(failure);
    await shell(); const input = screen.getByLabelText('draft');
    fireEvent.submit(input.closest('form')!); await act(async () => {});
    expect(input).toHaveValue('original draft'); expect(screen.getByTestId('messages')).toHaveTextContent('multi_agent_permission_revoked');
    if (files) expect(screen.getByText('draft.txt')).toBeVisible();
    expect(files ? fixtures.createTaskWithFiles : fixtures.createTask).toHaveBeenCalledTimes(1);
  });
  it('a late denial preserves a newer draft typed during the actual pending submit', async () => {
    const pending = deferred<{ taskId: string }>(); fixtures.createTask.mockReturnValue(pending.promise);
    await shell(); const input = screen.getByLabelText('draft'); fireEvent.submit(input.closest('form')!);
    fireEvent.change(input, { target: { value: 'newer user draft' } });
    await act(async () => pending.reject(new Error('multi_agent_permission_revoked')));
    expect(input).toHaveValue('newer user draft'); expect(fixtures.createTask).toHaveBeenCalledTimes(1);
  });
  it('A late failure after navigation cannot append an error or clear B draft', async () => {
    const pending = deferred<{ taskId: string }>(); fixtures.createTask.mockReturnValue(pending.promise);
    await shell(); fireEvent.submit(screen.getByLabelText('draft').closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('draft')).toHaveValue('B draft'));
    await act(async () => pending.reject(new Error('OLD_A_DENIAL')));
    expect(screen.getByLabelText('draft')).toHaveValue('B draft'); expect(screen.getByTestId('messages')).not.toHaveTextContent('OLD_A_DENIAL');
  });
  it('ordinary successful admission still clears the submitted draft once', async () => {
    fixtures.createTask.mockResolvedValue({ taskId: 'accepted-task' }); await shell();
    fireEvent.submit(screen.getByLabelText('draft').closest('form')!); await act(async () => {});
    expect(screen.getByLabelText('draft')).toHaveValue(''); expect(fixtures.createTask).toHaveBeenCalledTimes(1);
  });
  it('a success from unmounted A cannot clear the replacement B input', async () => {
    const pending = deferred<{ taskId: string }>(); fixtures.createTask.mockReturnValue(pending.promise);
    await shell(); fireEvent.submit(screen.getByLabelText('draft').closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('draft')).toHaveValue('B draft'));
    await act(async () => pending.resolve({ taskId: 'old-A-task' }));
    expect(screen.getByLabelText('draft')).toHaveValue('B draft');
  });
});

describe('W12 actual Goal form awaits authoritative acceptance', () => {
  it('the real parent swallowing a denied create keeps objective and criterion editable and visible', async () => {
    const createGoal = vi.fn(async () => { throw new Error('multi_agent_permission_revoked'); });
    window.xiaokDesktop = { getGoal: vi.fn(async () => null), createGoal, onGoalChanged: vi.fn(() => () => {}), onGoalTaskPrepared: vi.fn(() => () => {}) } as unknown as typeof window.xiaokDesktop;
    _resetDesktopApiCache(); await shell(true);
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'goal draft' } }); fireEvent.change(screen.getByLabelText('完成条件'), { target: { value: 'criterion draft' } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' })); await act(async () => {});
    expect(screen.getByLabelText('目标')).toHaveValue('goal draft'); expect(screen.getByLabelText('完成条件')).toHaveValue('criterion draft');
    expect(screen.getByRole('alert')).toHaveTextContent('multi_agent_permission_revoked'); expect(createGoal).toHaveBeenCalledTimes(1);
  });
  it('pending double click submits once; a returned void is not an accepted Goal; only real new Goal closes the form', async () => {
    const pending = deferred<void>(), onCreate = vi.fn(() => pending.promise);
    const mounted = render(<LocaleProvider><GoalBar goal={null} initialEditing onCreate={onCreate} /></LocaleProvider>);
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'goal draft' } });
    const button = screen.getByRole('button', { name: '确认创建' }); fireEvent.click(button); fireEvent.click(button);
    expect(screen.getByLabelText('目标')).toHaveValue('goal draft'); expect(onCreate).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve()); expect(screen.getByLabelText('目标')).toHaveValue('goal draft');
    mounted.rerender(<LocaleProvider><GoalBar goal={projection('new')} initialEditing onCreate={onCreate} /></LocaleProvider>);
    expect(screen.queryByLabelText('目标')).toBeNull(); expect(screen.getByText('new goal')).toBeVisible();
  });
  it.each(['reject', 'resolve', 'unmount'] as const)('late Goal create %s cannot populate or disable a new thread form', async outcome => {
    const pending = deferred<DesktopGoalMutationResult>();
    const createGoal = vi.fn((_input: GoalAttachmentRequest) => pending.promise), ack = vi.fn();
    window.xiaokDesktop = { getGoal: vi.fn(async () => null), createGoal, ackGoalTaskAttached: ack,
      onGoalChanged: vi.fn(() => () => {}), onGoalTaskPrepared: vi.fn(() => () => {}) } as unknown as typeof window.xiaokDesktop;
    _resetDesktopApiCache(); const mounted = await shell(true);
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'A objective' } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
    if (outcome === 'unmount') mounted.unmount();
    else {
      fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('目标')).toHaveValue(''));
      fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'B objective' } });
      fireEvent.change(screen.getByLabelText('完成条件'), { target: { value: 'B criterion' } });
    }
    await act(async () => outcome === 'reject' ? pending.reject(new Error('OLD_GOAL_DENIED'))
      : pending.resolve(attachmentReply('A', createGoal.mock.calls[0][0].requestId)));
    if (outcome !== 'unmount') {
      expect(screen.getByLabelText('目标')).toHaveValue('B objective'); expect(screen.getByLabelText('完成条件')).toHaveValue('B criterion');
      expect(screen.queryByText('OLD_GOAL_DENIED')).toBeNull(); expect(screen.getByRole('button', { name: '确认创建' })).toBeEnabled();
    }
    expect(ack).not.toHaveBeenCalled(); expect(createGoal).toHaveBeenCalledTimes(1);
  });
});

describe('W12 real attachment helper ACK keeps the original presentation scope', () => {
  function attachmentFixture() {
    const ackA = deferred<void>(), recoveryAfterFailure = deferred<{ snapshot: TaskSnapshot }>();
    const subscriptions = new Map<string, { release: ReturnType<typeof vi.fn>; listener: (event: unknown) => void }>();
    fixtures.subscribeTask.mockImplementation((taskId: string, listener: (event: unknown) => void) => {
      const release = vi.fn(); subscriptions.set(taskId, { release, listener }); return release;
    });
    const createGoal = vi.fn(async ({ threadId, requestId }: { threadId: string } & GoalAttachmentRequest) => attachmentReply(threadId, requestId));
    const getGoal = vi.fn(async (_threadId: string): Promise<DesktopGoalProjection | null> => null);
    const ackGoalTaskAttached = vi.fn(({ threadId }: { threadId: string }) => threadId === 'A' ? ackA.promise : Promise.resolve());
    const cancelTask = vi.fn(), cancelGoal = vi.fn();
    window.xiaokDesktop = { createGoal, getGoal, ackGoalTaskAttached, cancelTask, cancelGoal,
      onGoalChanged: vi.fn(() => () => {}), onGoalTaskPrepared: vi.fn(() => () => {}) } as unknown as typeof window.xiaokDesktop;
    _resetDesktopApiCache();
    return { ackA, getGoal, recoveryAfterFailure, subscriptions, createGoal, ackGoalTaskAttached, cancelTask, cancelGoal };
  }
  async function create(label: string) {
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: label } });
    fireEvent.click(screen.getByRole('button', { name: '确认创建' })); await act(async () => {});
  }
  it('same-thread ACK success keeps its one real subscription and binds the accepted task', async () => {
    const f = attachmentFixture(), mounted = await shell(true); await create('A objective');
    expect(f.ackGoalTaskAttached).toHaveBeenCalledExactlyOnceWith({ threadId: 'A', attachmentId: 'attachment-A' });
    expect(f.subscriptions.get('task-A')!.release).not.toHaveBeenCalled();
    await act(async () => f.subscriptions.get('task-A')!.listener({ type: 'progress', message: 'A active fact', eventId: 'A-live' }));
    await act(async () => f.ackA.resolve());
    expect(screen.getByTestId('current-task')).toHaveTextContent('task-A'); expect(screen.getByTestId('task-status')).toHaveTextContent('running');
    expect(f.subscriptions.get('task-A')!.release).not.toHaveBeenCalled();
    mounted.unmount(); expect(f.subscriptions.get('task-A')!.release).toHaveBeenCalledTimes(1);
    expect(f.cancelTask).not.toHaveBeenCalled(); expect(f.cancelGoal).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)('A late ACK %s cannot replace B task, error, draft or subscription', async outcome => {
    const f = attachmentFixture(), mounted = await shell(true); await create('A objective');
    fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('目标')).toHaveValue(''));
    await create('B objective'); expect(screen.getByTestId('current-task')).toHaveTextContent('task-B');
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'B newer draft' } });
    await act(async () => outcome === 'resolve' ? f.ackA.resolve() : f.ackA.reject(new Error('OLD_A_ATTACHMENT_FAILURE')));
    expect(screen.getByTestId('current-task')).toHaveTextContent('task-B'); expect(screen.queryByText('OLD_A_ATTACHMENT_FAILURE')).toBeNull();
    expect(screen.getByLabelText('draft')).toHaveValue('B newer draft');
    expect(f.getGoal.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
    expect(f.subscriptions.get('task-A')!.release).toHaveBeenCalledTimes(1); expect(f.subscriptions.get('task-B')!.release).not.toHaveBeenCalled();
    expect(f.cancelTask).not.toHaveBeenCalled(); expect(f.cancelGoal).not.toHaveBeenCalled();
    mounted.unmount(); expect(f.subscriptions.get('task-B')!.release).toHaveBeenCalledTimes(1);
  });
  it.each(['navigate', 'unmount'] as const)('scope %s releases its subscribed observer while ACK never settles, without cancelling execution', async action => {
    const f = attachmentFixture(), mounted = await shell(true); await create('A objective');
    expect(f.subscriptions.get('task-A')!.release).not.toHaveBeenCalled();
    if (action === 'unmount') mounted.unmount();
    else { fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await act(async () => {}); }
    expect(f.subscriptions.get('task-A')!.release).toHaveBeenCalledTimes(1);
    expect(f.cancelTask).not.toHaveBeenCalled(); expect(f.cancelGoal).not.toHaveBeenCalled();
    // Intentionally unresolved SDK receipt: observer cleanup must not await it.
  });
  it('a current A unknown ACK recovery read that resolves after navigation cannot populate B Goal or task state', async () => {
    const f = attachmentFixture(); await shell(true); await create('A objective');
    fixtures.recoverTask.mockReturnValueOnce(f.recoveryAfterFailure.promise);
    await act(async () => f.ackA.reject(new Error('A_CURRENT_ATTACHMENT_FAILURE')));
    await waitFor(() => expect(fixtures.recoverTask).toHaveBeenCalledExactlyOnceWith('task-A'));
    fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('目标')).toHaveValue(''));
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'B editing goal' } });
    await act(async () => f.recoveryAfterFailure.resolve({ snapshot: { taskId: 'task-A', sessionId: 'A', status: 'running',
      prompt: 'saved A', materials: [], events: [], createdAt: 1, updatedAt: 1,
      executionScope: attachmentReply('A').preparedTask.executionScope } }));
    expect(screen.getByLabelText('目标')).toHaveValue('B editing goal'); expect(screen.queryByText('new goal')).toBeNull();
    expect(f.subscriptions.get('task-A')!.release).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('task-status')).toHaveTextContent('idle');
    expect(f.getGoal.mock.calls.filter(([id]) => id === 'A')).toHaveLength(1);
  });
  it('same-thread delayed update still subscribes before sending its only attachment ACK', async () => {
    const f = attachmentFixture(), updateA = deferred<void>(); fixtures.updateThreadTaskId.mockReturnValueOnce(updateA.promise);
    const mounted = await shell(true); await create('A objective');
    expect(f.ackGoalTaskAttached).not.toHaveBeenCalled(); expect(f.subscriptions.has('task-A')).toBe(false);
    await act(async () => updateA.resolve());
    expect(f.ackGoalTaskAttached).toHaveBeenCalledExactlyOnceWith({ threadId: 'A', attachmentId: 'attachment-A' });
    expect(f.subscriptions.get('task-A')!.release).not.toHaveBeenCalled();
    await act(async () => f.ackA.resolve()); expect(screen.getByTestId('current-task')).toHaveTextContent('task-A');
    mounted.unmount(); expect(f.subscriptions.get('task-A')!.release).toHaveBeenCalledTimes(1);
  });
  it.each(['resolve', 'reject'] as const)('a late A thread update %s cannot ACK an attachment after navigation to B', async outcome => {
    const f = attachmentFixture(), updateA = deferred<void>();
    fixtures.updateThreadTaskId.mockImplementation((threadId: string) => threadId === 'A' ? updateA.promise : Promise.resolve());
    const mounted = await shell(true); await create('A objective'); expect(f.ackGoalTaskAttached).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'thread B' })); await waitFor(() => expect(screen.getByLabelText('目标')).toHaveValue(''));
    await create('B objective'); expect(screen.getByTestId('current-task')).toHaveTextContent('task-B');
    fireEvent.change(screen.getByLabelText('draft'), { target: { value: 'B newest draft' } });
    await act(async () => outcome === 'resolve' ? updateA.resolve() : updateA.reject(new Error('STALE_A_UPDATE_FAILURE')));
    expect(f.ackGoalTaskAttached).toHaveBeenCalledExactlyOnceWith({ threadId: 'B', attachmentId: 'attachment-B' });
    expect(f.subscriptions.has('task-A')).toBe(false); expect(f.subscriptions.get('task-B')!.release).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-task')).toHaveTextContent('task-B'); expect(screen.getByLabelText('draft')).toHaveValue('B newest draft');
    expect(screen.queryByText('STALE_A_UPDATE_FAILURE')).toBeNull(); expect(f.cancelTask).not.toHaveBeenCalled(); expect(f.cancelGoal).not.toHaveBeenCalled();
    mounted.unmount(); expect(f.subscriptions.get('task-B')!.release).toHaveBeenCalledTimes(1);
  });
});
