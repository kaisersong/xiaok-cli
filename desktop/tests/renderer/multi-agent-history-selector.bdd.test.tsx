import { Profiler, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ChatRightSurface } from '../../renderer/src/components/ChatRightSurface';
import { MultiAgentPanel } from '../../renderer/src/components/MultiAgentPanel';
import { LocaleProvider } from '../../renderer/src/contexts/LocaleContext';
import { useMultiAgentConnection } from '../../renderer/src/hooks/useMultiAgentConnection';
import type { DesktopMultiAgentGroup, MultiAgentDesktopAPI, MultiAgentGroupSnapshot, MultiAgentPage, MultiAgentSubscriptionResult, MultiAgentTransport } from '../../shared/multi-agent-types';

const access = vi.hoisted(() => ({ api: undefined as MultiAgentDesktopAPI | undefined }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => access.api }));

function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(label = 'old') {
  const group: DesktopMultiAgentGroup = { groupId: `${label}-history`, threadId: 'thread', bootId: 'boot', historicalOnly: true,
    createdAt: 1, lastSeq: 0, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null };
  const subscriptions: Array<{ subscriptionId: string; receive: (event: MultiAgentTransport) => void }> = [];
  const snapshot = (threadId: string, groupId?: string): MultiAgentGroupSnapshot => ({
    threadId, threadRevision: 1, activeGroupId: 'current-group', hasAgentHistory: true,
    group: { ...group, threadId, groupId: groupId ?? 'current-group', historicalOnly: Boolean(groupId) }, root: null,
    agents: [{ id: `${label}-${groupId ?? 'current'}-child`, parentId: `root_${groupId ?? 'current-group'}`, taskName: `${label} child`,
      canonicalName: 'reviewer', depth: 1, status: 'completed', turn: 1, createdAt: 1, resumable: !groupId,
      resourcesReleased: Boolean(groupId), executionActive: false, sessionResident: !groupId, runtimeResident: !groupId,
      cleanupPending: false, stopState: 'none', closeReason: null, activationState: 'settled', unreadMessages: 0 }],
    residentAgents: [], nextAgentCursor: null, lastSeq: 0,
    counts: { total: 1, running: 0, completed: 1, failed: 0, unread: 0 },
  });
  const api = {
    subscribeMultiAgents: vi.fn(async (input, receive) => {
      subscriptions.push({ subscriptionId: input.subscriptionId, receive });
      return { subscriptionId: input.subscriptionId, snapshot: snapshot(input.threadId, input.groupId) };
    }),
    unsubscribeMultiAgents: vi.fn(async () => {}),
    listMultiAgentGroups: vi.fn(async () => ({ items: [group], nextCursor: `${label}-cursor` })),
    getMultiAgentSnapshot: vi.fn(async input => snapshot(input.threadId, input.groupId)),
    getMultiAgentEvents: vi.fn(), resetMultiAgentGroup: vi.fn(), followupAgent: vi.fn(),
  } as unknown as MultiAgentDesktopAPI;
  const holdNextSubscription = () => {
    const pending = deferred<MultiAgentSubscriptionResult>(); let result!: MultiAgentSubscriptionResult;
    vi.mocked(api.subscribeMultiAgents).mockImplementationOnce((input, receive) => {
      subscriptions.push({ subscriptionId: input.subscriptionId, receive });
      result = { subscriptionId: input.subscriptionId, snapshot: snapshot(input.threadId, input.groupId) };
      return pending.promise;
    });
    return { resolve: () => pending.resolve(result), reject: pending.reject };
  };
  return { api, group, subscriptions, holdNextSubscription };
}

/** Real ChatShell composition boundary: only main API data/transport is controlled. */
function Harness({ threadId = 'thread' }: { threadId?: string }) {
  const [selection, setSelection] = useState<{ threadId: string; groupId?: string } | null>(null);
  const state = useMultiAgentConnection(threadId, selection?.threadId === threadId ? selection.groupId : undefined);
  return <LocaleProvider><ChatRightSurface key={threadId} threadId={threadId} agentCount={state.summary.total}
    hasAgentHistory={state.summary.hasAgentHistory} needsRecovery={state.summary.needsRecovery}
    historicalSelection={state.summary.historicalSelection} deleted={state.summary.deleted}
    canvasOpen={false} canvasRequestId={0} canvasExpanded={false}
    agentsContent={state.connection && state.api ? <MultiAgentPanel connection={state.connection} api={state.api}
      onSelectGroup={groupId => setSelection({ threadId, groupId })} /> : null}>
    <input aria-label="composer" />
  </ChatRightSurface></LocaleProvider>;
}

let width = 900;
beforeEach(() => {
  width = 900;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  // Supply JSDOM geometry only; production focus ownership and visibility stay real.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) if (getComputedStyle(node).display === 'none') return [] as unknown as DOMRectList;
    return [{ width: 10, height: 10 }] as unknown as DOMRectList;
  });
});
afterEach(() => { cleanup(); access.api = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openHistory() {
  await vi.waitFor(() => expect(document.querySelector('.chat-right-entry')).not.toBeNull());
  const entry = document.querySelector<HTMLButtonElement>('.chat-right-entry')!;
  if (entry.getAttribute('aria-expanded') !== 'true') fireEvent.click(entry);
  fireEvent.click(screen.getByRole('button', { name: '执行组历史' }));
  await vi.waitFor(() => expect(document.querySelector('.multi-agent-history')).not.toBeNull());
  return within(document.querySelector<HTMLElement>('.multi-agent-history')!);
}

describe('BDD: thread-scoped history selector keeps focus without inheriting authority', () => {
  it.each([899, 900])('U2/U6 Given a %s px surface, Then selecting history and returning current preserve the exact selector button before and after delayed ACK', async viewport => {
    width = viewport; const setup = fixture(); access.api = setup.api; render(<Harness />);
    const selector = await openHistory(); const choice = selector.getByRole('button', { name: /old-hist/ });
    const historicalAck = setup.holdNextSubscription(); choice.focus(); fireEvent.click(choice);
    await vi.waitFor(() => expect(setup.api.subscribeMultiAgents).toHaveBeenCalledTimes(2));
    expect(choice.isConnected).toBe(true); expect(choice).toHaveFocus();
    await act(async () => historicalAck.resolve());
    expect(choice).toHaveFocus(); expect(screen.getByText('历史记录，只读')).toBeVisible();
    expect(screen.getByRole('button', { name: '继续执行' })).toBeDisabled();
    const current = screen.getByRole('button', { name: '当前执行组' }); const currentAck = setup.holdNextSubscription();
    current.focus(); fireEvent.click(current);
    await vi.waitFor(() => expect(setup.api.subscribeMultiAgents).toHaveBeenCalledTimes(3));
    expect(current.isConnected).toBe(true); expect(current).toHaveFocus();
    await act(async () => currentAck.resolve()); expect(current).toHaveFocus();
    expect(screen.queryByText('历史记录，只读')).toBeNull();
    expect(setup.api.listMultiAgentGroups).toHaveBeenCalledTimes(1);
    expect(setup.api.resetMultiAgentGroup).not.toHaveBeenCalled(); expect(setup.api.followupAgent).not.toHaveBeenCalled();
  });

  it('U1/U2 Given a historical subscription fails, Then the focused selector remains, the failure is visible and mutations stay disabled', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); const selector = await openHistory();
    const choice = selector.getByRole('button', { name: /old-hist/ }); const pending = setup.holdNextSubscription();
    choice.focus(); fireEvent.click(choice); await act(async () => pending.reject(new Error('history connection offline')));
    expect(choice.isConnected).toBe(true); expect(choice).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('history connection offline');
    expect(screen.getByRole('button', { name: '当前执行组' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '新建执行组' })).toBeDisabled();
    expect(setup.api.resetMultiAgentGroup).not.toHaveBeenCalled();
  });

  it('U2 Given the user moves focus to the composer while history ACK is pending, Then successful hydration does not steal it back', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); const selector = await openHistory();
    const choice = selector.getByRole('button', { name: /old-hist/ }); const pending = setup.holdNextSubscription();
    choice.focus(); fireEvent.click(choice); screen.getByLabelText('composer').focus();
    await act(async () => pending.resolve()); expect(screen.getByLabelText('composer')).toHaveFocus();
  });

  it.each(['api', 'thread'] as const)('U1/U6 Given the %s identity changes during a history page read, Then old rows/cursor disappear and its late response cannot enter the new scope', async change => {
    const original = fixture(); access.api = original.api; let changing = false; const staleCommits: boolean[] = [];
    const mount = (threadId = 'thread') => <Profiler id="scope" onRender={() => {
      if (changing) staleCommits.push(Boolean(document.querySelector('.multi-agent-history')));
    }}><Harness threadId={threadId} /></Profiler>;
    const view = render(mount()); await openHistory();
    const pending = deferred<MultiAgentPage<DesktopMultiAgentGroup>>();
    vi.mocked(original.api.listMultiAgentGroups).mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '更早的执行组' }));
    expect(original.api.listMultiAgentGroups).toHaveBeenLastCalledWith({ threadId: 'thread', cursor: 'old-cursor' });
    const next = fixture('new'); const nextApi = change === 'api' ? next.api : original.api;
    access.api = nextApi; changing = true; view.rerender(mount(change === 'thread' ? 'new-thread' : 'thread')); changing = false;
    expect(staleCommits.length).toBeGreaterThan(0); expect(staleCommits).not.toContain(true);
    expect(document.querySelector('.multi-agent-history')).toBeNull();
    expect(screen.queryByRole('button', { name: '更早的执行组' })).toBeNull();
    await act(async () => pending.resolve({ items: [{ ...original.group, groupId: 'late-old-group' }], nextCursor: 'late-old-cursor' }));
    expect(document.querySelector('.multi-agent-history')).toBeNull();
    vi.mocked(nextApi.listMultiAgentGroups).mockResolvedValue({ items: [next.group], nextCursor: null });
    const callsBefore = vi.mocked(nextApi.listMultiAgentGroups).mock.calls.length;
    const selector = await openHistory(); expect(selector.getByRole('button', { name: /new-hist/ })).toBeVisible();
    expect(screen.queryByText(/late-old-group/)).toBeNull(); expect(screen.queryByRole('button', { name: '更早的执行组' })).toBeNull();
    expect(nextApi.listMultiAgentGroups).toHaveBeenCalledTimes(callsBefore + 1);
    expect(nextApi.listMultiAgentGroups).toHaveBeenLastCalledWith({ threadId: change === 'thread' ? 'new-thread' : 'thread', cursor: undefined });
  });

  it('A25/U6 Given deleted metadata arrives during history pagination, Then the selector is cleared and a late list cannot resurrect it', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); await openHistory();
    const pending = deferred<MultiAgentPage<DesktopMultiAgentGroup>>();
    vi.mocked(setup.api.listMultiAgentGroups).mockImplementationOnce(() => pending.promise);
    const next = screen.getByRole('button', { name: '更早的执行组' }); next.focus(); fireEvent.click(next);
    const subscription = setup.subscriptions.at(-1)!;
    act(() => subscription.receive({ subscriptionId: subscription.subscriptionId, envelope: { channel: 'group_changed',
      threadId: 'thread', threadRevision: 2, oldGroupId: 'current-group', newGroupId: null, threadDeleteState: 'deleted', hasAgentHistory: false } }));
    await vi.waitFor(() => expect(document.querySelector('.chat-right-entry')).toBeNull());
    expect(document.querySelector('.multi-agent-history')).toBeNull(); expect(screen.getByLabelText('composer')).toHaveFocus();
    await act(async () => pending.resolve({ items: [setup.group], nextCursor: 'late-cursor' }));
    expect(document.querySelector('.multi-agent-history')).toBeNull(); expect(document.querySelector('.chat-right-entry')).toBeNull();
  });

  it('U2/U6 Given a thread history page is pending while selecting a group, Then the connection change does not invalidate that same-scope page', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); const selector = await openHistory();
    const pending = deferred<MultiAgentPage<DesktopMultiAgentGroup>>();
    vi.mocked(setup.api.listMultiAgentGroups).mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '更早的执行组' }));
    const choice = selector.getByRole('button', { name: /old-hist/ }); choice.focus(); fireEvent.click(choice);
    await screen.findByText('历史记录，只读');
    await act(async () => pending.resolve({ items: [{ ...setup.group, groupId: 'next-page-group' }], nextCursor: null }));
    expect(screen.getByRole('button', { name: /next-pag/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '执行组历史' })).toHaveFocus();
    expect(setup.api.listMultiAgentGroups).toHaveBeenCalledTimes(2);
  });

  it('U3 Given two same-scope page requests resolve out of order, Then only the newest single page and cursor survive without stealing external focus', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); await openHistory();
    const older = deferred<MultiAgentPage<DesktopMultiAgentGroup>>(), newer = deferred<MultiAgentPage<DesktopMultiAgentGroup>>();
    vi.mocked(setup.api.listMultiAgentGroups).mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    fireEvent.click(screen.getByRole('button', { name: '更早的执行组' })); fireEvent.click(screen.getByRole('button', { name: '更早的执行组' }));
    screen.getByLabelText('composer').focus();
    await act(async () => newer.resolve({ items: [{ ...setup.group, groupId: 'newest-page-group' }], nextCursor: null }));
    await act(async () => older.resolve({ items: [setup.group], nextCursor: 'stale-cursor' }));
    expect(screen.getByRole('button', { name: /newest-p/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /old-hist/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '更早的执行组' })).toBeNull(); expect(screen.getByLabelText('composer')).toHaveFocus();
  });

  it('U2/U3 Given the last history page removes the focused next-page button, Then focus returns to the stable history control and rows remain page-bounded', async () => {
    const setup = fixture(); access.api = setup.api; render(<Harness />); await openHistory();
    const pending = deferred<MultiAgentPage<DesktopMultiAgentGroup>>();
    vi.mocked(setup.api.listMultiAgentGroups).mockImplementationOnce(() => pending.promise);
    const next = screen.getByRole('button', { name: '更早的执行组' }); next.focus(); fireEvent.click(next);
    await act(async () => pending.resolve({ items: [{ ...setup.group, groupId: 'last-page-group' }], nextCursor: null }));
    expect(screen.queryByRole('button', { name: '更早的执行组' })).toBeNull();
    expect(screen.getByRole('button', { name: '执行组历史' })).toHaveFocus();
    const selector = within(document.querySelector<HTMLElement>('.multi-agent-history')!);
    expect(selector.getByRole('button', { name: /last-pag/ })).toBeVisible();
    expect(selector.queryByRole('button', { name: /old-hist/ })).toBeNull();
  });
});
