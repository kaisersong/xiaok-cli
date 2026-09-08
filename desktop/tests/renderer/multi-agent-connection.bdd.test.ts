import { describe, expect, it, vi } from 'vitest';
import { MultiAgentConnection } from '../../renderer/src/lib/multi-agent-connection';
import type { MultiAgentDesktopAPI, MultiAgentGroupSnapshot, MultiAgentTransport } from '../../shared/multi-agent-types';

const snapshot: MultiAgentGroupSnapshot = { threadId: 't', activeGroupId: 'g', threadRevision: 1,
  group: { groupId: 'g', threadId: 't', bootId: 'boot', historicalOnly: false, createdAt: 1,
    lastSeq: 1, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null },
  root: null, agents: [], residentAgents: [], nextAgentCursor: null,
  lastSeq: 1, counts: { total: 0, running: 0, completed: 0, failed: 0, unread: 0 } };
describe('BDD: renderer connection owns one subscription and bounded replay', () => {
  it.each(['subscribe', 'refresh'] as const)('U3 Given a runtime error arrives while %s is awaiting a captured healthy snapshot, Then the old response cannot clear that error', async origin => {
    let listener!: (event: MultiAgentTransport) => void, subscriptionId = '', resolvePending!: (value: any) => void;
    const healthy = { ...snapshot, lastSeq: 0 };
    const api = { subscribeMultiAgents: vi.fn((input, handler) => {
      listener = handler; subscriptionId = input.subscriptionId;
      return origin === 'subscribe' ? new Promise(resolve => { resolvePending = resolve; }) : Promise.resolve({ subscriptionId, snapshot: healthy });
    }), getMultiAgentSnapshot: vi.fn(() => new Promise(resolve => { resolvePending = resolve; })),
      getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      if (origin === 'refresh') {
        await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live')); connection.refresh();
        await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
      }
      listener({ subscriptionId, envelope: { channel: 'runtime_error', groupId: 'g', code: 'multi_agent_persistence_failed' } });
      resolvePending(origin === 'subscribe' ? { subscriptionId, snapshot: healthy } : healthy);
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('error'));
      expect(connection.getSnapshot().error).toBe('multi_agent_persistence_failed');
    } finally { stop(); }
  });

  it('U7 Given status advances during a snapshot request, Then the lower-S response can still carry a newer independent activity revision', async () => {
    let listener!: (event: MultiAgentTransport) => void, subscriptionId = '', resolveSnapshot!: (value: MultiAgentGroupSnapshot) => void;
    const row = { id: 'a', parentId: 'root_g', turn: 1, turnId: 'turn-1', status: 'running', phase: 'starting', activityRevision: 2, toolsCompleted: 2 };
    const initial = { ...snapshot, lastSeq: 0, agents: [row] } as MultiAgentGroupSnapshot;
    const api = { subscribeMultiAgents: vi.fn(async (input, handler) => { listener = handler; subscriptionId = input.subscriptionId; return { subscriptionId, snapshot: initial }; }),
      getMultiAgentSnapshot: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve; })).mockImplementation(() => new Promise(() => {})),
      getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live')); connection.refresh();
      await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
      listener({ subscriptionId, envelope: { schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 1, eventId: 'tools', agentId: 'a', timestamp: 1,
        kind: 'tool_finished', payload: { agent: { ...row, toolsCompleted: 7 } as never } } });
      resolveSnapshot({ ...initial, agents: [{ ...row, activityRevision: 5, phase: 'model', toolsCompleted: 2 }] } as MultiAgentGroupSnapshot);
      await vi.waitFor(() => expect(connection.getSnapshot().projection.agents[0]).toMatchObject({ activityRevision: 5, phase: 'model', toolsCompleted: 7, status: 'running' }));
      expect(connection.getSnapshot().projection.statusSeq).toBe(1);
    } finally { resolveSnapshot?.(initial); stop(); }
  });
  it('U3 Given an authoritative empty group, Then a late old-group status cannot create ghost rows or a refresh loop', async () => {
    let listener!: (event: MultiAgentTransport) => void, subscriptionId = '';
    const empty = { ...snapshot, group: null, activeGroupId: null, lastSeq: 0 };
    const api = { subscribeMultiAgents: vi.fn(async (input, handler) => { listener = handler; subscriptionId = input.subscriptionId; return { subscriptionId, snapshot: empty }; }),
      getMultiAgentSnapshot: vi.fn(async () => empty), getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
      listener({ subscriptionId, envelope: { schemaVersion: 1, channel: 'durable', groupId: 'old', seq: 1, eventId: 'old', agentId: 'a', timestamp: 1, kind: 'status',
        payload: { agent: { id: 'a', parentId: 'root_old', turn: 1, status: 'completed' } as never } } });
      await new Promise(resolve => setTimeout(resolve, 220));
      expect(connection.getSnapshot().projection).toMatchObject({ agents: [], statusSeq: 0, groupId: null });
      expect(api.getMultiAgentSnapshot).not.toHaveBeenCalled(); expect(api.getMultiAgentEvents).not.toHaveBeenCalled();
      connection.refresh();
      await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
    } finally { stop(); }
  });

  it('U3 Given a snapshot with a conflicting boot, Then the owner stops with an error and does not automatically request it again', async () => {
    const initial = { ...snapshot, lastSeq: 0, group: { ...snapshot.group!, bootId: 'boot-1' } };
    const api = { subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot: initial })),
      getMultiAgentSnapshot: vi.fn(async () => ({ ...initial, group: { ...initial.group, bootId: 'boot-2' } })),
      getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live')); connection.refresh();
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('error'));
      expect(connection.getSnapshot().projection.snapshot?.group?.bootId).toBe('boot-1');
      expect(connection.getSnapshot().error).toBe('multi_agent_group_boot_mismatch');
      await new Promise(resolve => setTimeout(resolve, 220));
      expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });
  it.each(['resync', 'active-group'] as const)('U3 Given %s changes after a snapshot was captured, Then its stale response cannot acknowledge the later refresh obligation', async kind => {
    let listener!: (event: MultiAgentTransport) => void, subscriptionId = '', resolveSnapshot!: (value: MultiAgentGroupSnapshot) => void;
    const row = { id: 'a', parentId: 'root_g', turn: 1, turnId: 'turn-1', status: 'running', resourcesReleased: false };
    const initial = { ...snapshot, lastSeq: 0, agents: [row] } as MultiAgentGroupSnapshot;
    const groupId = kind === 'active-group' ? 'h' : 'g';
    const captured = { ...initial, activeGroupId: groupId, threadRevision: kind === 'active-group' ? 2 : 1, group: { ...initial.group!, groupId } } as MultiAgentGroupSnapshot;
    const terminal = { ...row, parentId: `root_${groupId}`, status: 'completed', resourcesReleased: true };
    const api = { subscribeMultiAgents: vi.fn(async (input, handler) => { listener = handler; subscriptionId = input.subscriptionId; return { subscriptionId, snapshot: initial }; }),
      getMultiAgentSnapshot: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveSnapshot = resolve; }))
        .mockResolvedValue({ ...captured, lastSeq: 1, agents: [terminal] }),
      getMultiAgentEvents: vi.fn(async () => ({ items: [{ schemaVersion: 1, channel: 'durable', groupId, seq: 1, eventId: 'terminal', agentId: 'a', timestamp: 1, kind: 'status', payload: { agent: terminal } }], headSeq: 1, hasMore: false, nextAfterSeq: 1 })),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
      if (kind === 'active-group') listener({ subscriptionId, envelope: { channel: 'group_changed', threadId: 't', threadRevision: 2, oldGroupId: 'g', newGroupId: 'h' } });
      else connection.refresh();
      await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
      listener({ subscriptionId, envelope: kind === 'resync' ? { channel: 'resync_required', groupId }
        : { schemaVersion: 1, channel: 'durable', groupId, seq: 1, eventId: 'terminal', agentId: 'a', timestamp: 1, kind: 'status', payload: { agent: terminal as never } } });
      resolveSnapshot(captured);
      await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(connection.getSnapshot().projection.agents[0]?.status).toBe('completed'));
      expect(connection.getSnapshot().projection.groupId).toBe(groupId);
      expect(connection.getSnapshot().projection.resyncRequired).toBe(false);
    } finally { resolveSnapshot?.(captured); stop(); }
  });

  it('U3 Given replay discovers a message while the pump is awaiting a page, Then it schedules the newly required summary snapshot without a later push', async () => {
    const api = { subscribeMultiAgents: vi.fn(async input => ({ subscriptionId: input.subscriptionId, snapshot })),
      getMultiAgentSnapshot: vi.fn(async () => ({ ...snapshot, counts: { ...snapshot.counts, unread: 4 } })),
      getMultiAgentEvents: vi.fn(async () => ({ items: [{ schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 1, eventId: 'unread', agentId: 'a', timestamp: 1, kind: 'message_sent', payload: {} }], headSeq: 1, hasMore: false, nextAfterSeq: 1 })),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    // Subscribe captures the status watermark before the message fact. A later
    // page may contain a status beyond that checkpoint, without another push.
    vi.mocked(api.getMultiAgentEvents).mockResolvedValue({ items: [
      { schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 1, eventId: 'early', agentId: 'a', timestamp: 1, kind: 'output', payload: {} },
      { schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 2, eventId: 'unread', agentId: 'a', timestamp: 2, kind: 'message_sent', payload: {} },
    ], headSeq: 2, hasMore: false, nextAfterSeq: 2 });
    vi.mocked(api.getMultiAgentSnapshot).mockResolvedValue({ ...snapshot, lastSeq: 2, counts: { ...snapshot.counts, unread: 4 } });
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().projection.snapshot?.counts.unread).toBe(4));
      expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1);
    } finally { stop(); }
  });

  it('U7 Given live activity arrives after snapshot capture but before subscribe resolves, Then it survives initial installation with no later event', async () => {
    const row = { id: 'a', parentId: 'root_g', turn: 1, turnId: 'turn-1', status: 'running', phase: 'starting', activityRevision: 2 };
    const api = { subscribeMultiAgents: vi.fn(async (input, listener) => {
      const result = { subscriptionId: input.subscriptionId, snapshot: { ...snapshot, lastSeq: 0, agents: [row] } };
      listener({ subscriptionId: input.subscriptionId, envelope: { schemaVersion: 1, channel: 'activity', groupId: 'g', agentId: 'a', turnId: 'turn-1', activityRevision: 3, timestamp: 5, phase: 'model' } });
      await Promise.resolve(); return result;
    }), getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
      expect(connection.getSnapshot().projection.agents[0]).toMatchObject({ phase: 'model', activityRevision: 3 });
      expect(api.getMultiAgentEvents).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it('A24 Given message facts with no output, Then the existing push owner refreshes main counts once instead of polling or guessing', async () => {
    let listener!: (event: MultiAgentTransport) => void, subscriptionId = '';
    const api = { subscribeMultiAgents: vi.fn(async (input, handler) => { listener = handler; subscriptionId = input.subscriptionId; return { subscriptionId, snapshot: { ...snapshot, lastSeq: 0 } }; }),
      getMultiAgentSnapshot: vi.fn(async () => ({ ...snapshot, counts: { ...snapshot.counts, unread: 3 } })),
      getMultiAgentEvents: vi.fn(), unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'), stop = connection.start();
    await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
    listener({ subscriptionId, envelope: { schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 1, eventId: 'message', agentId: 'a', timestamp: 1, kind: 'message_sent', payload: {} } });
    await vi.waitFor(() => expect(connection.getSnapshot().projection.snapshot?.counts.unread).toBe(3));
    expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1); expect(api.getMultiAgentEvents).not.toHaveBeenCalled(); stop();
  });
  it('U1/U3 Given initial subscription failure, When the user reconnects, Then a fresh subscription becomes live and the original owner cleanup stops it', async () => {
    const api = { subscribeMultiAgents: vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async input => ({ subscriptionId: input.subscriptionId, snapshot: { ...snapshot, lastSeq: 0 } })),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); const stop = connection.start();
    await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('error'));
    connection.refresh();
    await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
    expect(api.subscribeMultiAgents).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(api.subscribeMultiAgents).mock.calls;
    expect(calls[1][0].subscriptionId).not.toBe(calls[0][0].subscriptionId);
    stop(); expect(api.unsubscribeMultiAgents).toHaveBeenCalledWith({ subscriptionId: calls[1][0].subscriptionId });
  });

  it('A18/U7 Given a group with only its root, Then child-count summary stays zero and cannot open an empty Agents surface', async () => {
    const root = { id: 'root_g', parentId: null, status: 'running' } as MultiAgentGroupSnapshot['root'];
    const api = { subscribeMultiAgents: async (input: { subscriptionId: string }) => ({ subscriptionId: input.subscriptionId,
      snapshot: { ...snapshot, root, agents: [root], lastSeq: 0, counts: { ...snapshot.counts, total: 1 } } }),
      unsubscribeMultiAgents: async () => {} } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); const stop = connection.start();
    await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
    expect(connection.getSummary().total).toBe(0); stop();
  });
  it('A10/U3 Given an event arrives during subscribe, Then initial snapshot and replay preserve all contiguous details', async () => {
    const api = {
      subscribeMultiAgents: vi.fn(async (input, handler) => {
        handler({ subscriptionId: input.subscriptionId, envelope: { schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 2, eventId: 'e2', agentId: 'a', timestamp: 2, kind: 'output', payload: { text: 'live' } } });
        return { subscriptionId: input.subscriptionId, snapshot };
      }),
      getMultiAgentSnapshot: vi.fn(async () => snapshot),
      getMultiAgentEvents: vi.fn(async () => ({ items: [{ schemaVersion: 1, channel: 'durable', groupId: 'g', seq: 1, eventId: 'e1', agentId: 'a', timestamp: 1, kind: 'output', payload: { text: 'early' } }], nextAfterSeq: 1, headSeq: 2, hasMore: true })),
      unsubscribeMultiAgents: vi.fn(async () => {}),
    } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); const stop = connection.start();
    await vi.waitFor(() => expect(connection.getSnapshot().projection.detailSeq).toBe(2));
    expect(connection.details('a').map(event => event.seq)).toEqual([1, 2]);
    expect(api.getMultiAgentEvents).toHaveBeenCalledTimes(1); stop();
  });

  it('U3 Given stop before ready and a new connection generation, Then the late snapshot and every old channel cannot overwrite the new view', async () => {
    let resolveFirst!: (value: unknown) => void; let oldListener!: (event: MultiAgentTransport) => void; let oldId = '';
    const api = {
      subscribeMultiAgents: vi.fn().mockImplementationOnce((input, listener) => { oldListener = listener; oldId = input.subscriptionId; return new Promise(resolve => { resolveFirst = resolve; }); })
        .mockImplementation(async input => ({ subscriptionId: input.subscriptionId, snapshot: { ...snapshot, lastSeq: 0 } })),
      getMultiAgentEvents: vi.fn(async () => ({ items: [], nextAfterSeq: 0, headSeq: 0, hasMore: false })),
      unsubscribeMultiAgents: vi.fn(async () => {}),
    } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); const firstStop = connection.start(); firstStop();
    const stop = connection.start(); await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live'));
    resolveFirst({ subscriptionId: oldId, snapshot: { ...snapshot, lastSeq: 999 } });
    oldListener({ subscriptionId: oldId, envelope: { channel: 'runtime_error', groupId: 'g', code: 'foreign' } });
    await Promise.resolve(); expect(connection.getSnapshot().projection.statusSeq).toBe(0); expect(connection.getSnapshot().error).toBeNull(); stop();
  });

  it('U3 Given an old explicit refresh is pending, Then switching connection generation rejects its late snapshot and keeps the new scope', async () => {
    let resolveOld!: (value: MultiAgentGroupSnapshot) => void;
    const api = { subscribeMultiAgents: vi.fn().mockImplementationOnce(async input => ({ subscriptionId: input.subscriptionId, snapshot: { ...snapshot, lastSeq: 0 } }))
      .mockImplementation(async input => ({ subscriptionId: input.subscriptionId, snapshot: { ...snapshot, lastSeq: 0, activeGroupId: 'new', threadRevision: 2, group: { ...snapshot.group!, groupId: 'new' } } })),
      getMultiAgentSnapshot: vi.fn(() => new Promise(resolve => { resolveOld = resolve; })), getMultiAgentEvents: vi.fn(),
      unsubscribeMultiAgents: vi.fn(async () => {}) } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); let stop = connection.start();
    try {
      await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('live')); connection.refresh();
      await vi.waitFor(() => expect(api.getMultiAgentSnapshot).toHaveBeenCalledTimes(1));
      stop = connection.start(); await vi.waitFor(() => expect(connection.getSnapshot().projection.groupId).toBe('new'));
      resolveOld({ ...snapshot, lastSeq: 999, runtimeError: 'old-error' }); await Promise.resolve();
      expect(connection.getSnapshot().projection).toMatchObject({ groupId: 'new', threadRevision: 2, statusSeq: 0, error: null });
      expect(api.getMultiAgentEvents).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('U1 Given a nonadvancing event page below head, Then replay fails visibly instead of spinning or pretending the missing range was applied', async () => {
    const api = { subscribeMultiAgents: async (input: { subscriptionId: string }) => ({ subscriptionId: input.subscriptionId, snapshot }),
      getMultiAgentEvents: vi.fn(async () => ({ items: [], nextAfterSeq: 0, headSeq: 1, hasMore: true })), unsubscribeMultiAgents: async () => {} } as unknown as MultiAgentDesktopAPI;
    const connection = new MultiAgentConnection(api, 't'); const stop = connection.start();
    await vi.waitFor(() => expect(connection.getSnapshot().phase).toBe('error'));
    expect(connection.getSnapshot().projection.detailSeq).toBe(0); expect(api.getMultiAgentEvents).toHaveBeenCalledTimes(1); stop();
  });
});
