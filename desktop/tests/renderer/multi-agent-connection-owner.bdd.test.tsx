import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useMultiAgentConnection } from '../../renderer/src/hooks/useMultiAgentConnection';
import type { MultiAgentDesktopAPI, MultiAgentGroupSnapshot, MultiAgentTransport } from '../../shared/multi-agent-types';
const access = vi.hoisted(() => ({ api: undefined as MultiAgentDesktopAPI | undefined }));
vi.mock('../../renderer/src/shared/desktop', () => ({ getDesktopApi: () => access.api }));
const empty = (threadId = 't', hasAgentHistory = false): MultiAgentGroupSnapshot => ({ threadId, threadRevision: 1, activeGroupId: null,
  group: null, root: null, agents: [], residentAgents: [], nextAgentCursor: null, lastSeq: 0,
  counts: { total: 0, running: 0, completed: 0, failed: 0, unread: 0 }, hasAgentHistory } as MultiAgentGroupSnapshot);
afterEach(() => { cleanup(); access.api = undefined; });
describe('BDD: hook-owned main thread facts survive connection generations only within their scope', () => {
  it('does not subscribe for a native executor and releases the prior executor subscription', async () => {
    const api = { subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot: empty('t') })),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    access.api = api;
    const view = renderHook(({ enabled }) => useMultiAgentConnection('t', undefined, enabled), { initialProps: { enabled: false } });
    expect(api.subscribeMultiAgents).not.toHaveBeenCalled();
    expect(view.result.current.summary.needsRecovery).toBe(false);
    view.rerender({ enabled: true });
    await vi.waitFor(() => expect(view.result.current.summary.phase).toBe('live'));
    view.rerender({ enabled: false });
    expect(view.result.current.connection).toBeNull();
    expect(view.result.current.summary.needsRecovery).toBe(false);
    await vi.waitFor(() => expect(api.unsubscribeMultiAgents).toHaveBeenCalledOnce());
  });
  it('U1 Given same thread group change, Then confirmed history survives loading and stale false ACK while old stopped callbacks are ignored', async () => {
    let resolveSecond!: (value: any) => void;
    const subscriptions: Array<{ id: string; receive: (event: MultiAgentTransport) => void }> = [];
    const api = { subscribeMultiAgents: vi.fn((input, receive) => {
      subscriptions.push({ id: input.subscriptionId, receive });
      return subscriptions.length === 1 ? Promise.resolve({ subscriptionId: input.subscriptionId, snapshot: empty('t', true) })
        : new Promise(resolve => { resolveSecond = resolve; });
    }), unsubscribeMultiAgents: vi.fn(async () => {}), getMultiAgentEvents: vi.fn() } as unknown as MultiAgentDesktopAPI;
    access.api = api;
    const view = renderHook(({ groupId }) => useMultiAgentConnection('t', groupId), { initialProps: { groupId: undefined as string | undefined } });
    await vi.waitFor(() => expect(view.result.current.summary).toMatchObject({ phase: 'live', hasAgentHistory: true }));
    const old = view.result.current.connection;
    view.rerender({ groupId: 'history' });
    expect(view.result.current.connection).not.toBe(old);
    expect(view.result.current.summary).toMatchObject({ phase: 'loading', hasAgentHistory: true, historicalSelection: true });
    subscriptions[0].receive({ subscriptionId: subscriptions[0].id, envelope: { channel: 'group_changed', threadId: 't', threadRevision: 99,
      oldGroupId: null, newGroupId: null, threadDeleteState: 'deleted', hasAgentHistory: false } as never });
    resolveSecond({ subscriptionId: subscriptions[1].id, snapshot: { ...empty(), group: { groupId: 'history', historicalOnly: true } } });
    await vi.waitFor(() => expect(view.result.current.summary).toMatchObject({ phase: 'live', hasAgentHistory: true, deleted: false }));
  });
  it.each(['thread', 'api'] as const)('U1 Given a changed %s binding with the same hook, Then no history or tombstone is inherited before or after ACK', async scope => {
    const first = { subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot: empty(input.threadId, input.threadId === 't') })),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    access.api = first; const view = renderHook(({ threadId }) => useMultiAgentConnection(threadId), { initialProps: { threadId: 't' } });
    await vi.waitFor(() => expect(view.result.current.summary).toMatchObject({ hasAgentHistory: true }));
    if (scope === 'api') access.api = { ...first, subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot: empty(input.threadId) })) };
    view.rerender({ threadId: scope === 'thread' ? 'other' : 't' });
    expect(view.result.current.summary).toMatchObject({ hasAgentHistory: false, deleted: false });
    await vi.waitFor(() => expect(view.result.current.summary).toMatchObject({ phase: 'live', hasAgentHistory: false, needsRecovery: false }));
  });
  it('U1 Given no API or thread, Then unavailable state is not a false recovery entry', () => {
    const view = renderHook(() => useMultiAgentConnection());
    expect(view.result.current.summary).toMatchObject({ total: 0, needsRecovery: false, hasAgentHistory: false });
  });
});
