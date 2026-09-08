import { describe, expect, it } from 'vitest';
import { MultiAgentProjection } from '../../renderer/src/lib/multi-agent-projection';
import type { DesktopAgentSnapshot, MultiAgentDurableEvent, MultiAgentGroupSnapshot } from '../../shared/multi-agent-types';

const agent = (status: DesktopAgentSnapshot['status'], turn = 1) => ({ id: 'a', parentId: 'root_g', status, turn, turnId: `turn-${turn}`, activityRevision: 2 } as DesktopAgentSnapshot);
const snapshot = (seq: number, status: DesktopAgentSnapshot['status'] = 'completed'): MultiAgentGroupSnapshot => ({ threadId: 't', activeGroupId: 'g', threadRevision: 1,
  group: { groupId: 'g', threadId: 't', bootId: 'boot', historicalOnly: false, createdAt: 1,
    lastSeq: seq, byteUsage: 0, currentRootEpoch: 1, nextRootEpoch: 2, mutationBlockedReason: null }, lastSeq: seq,
  root: null, agents: [agent(status)], residentAgents: [], nextAgentCursor: null, counts: { total: 1, running: status === 'running' ? 1 : 0, completed: status === 'completed' ? 1 : 0, failed: 0, unread: 0 } });
const event = (seq: number, status?: DesktopAgentSnapshot['status']): MultiAgentDurableEvent => ({ schemaVersion: 1, channel: 'durable', groupId: 'g', seq, eventId: `event-${seq}`, agentId: 'a', timestamp: seq,
  kind: status ? 'status' : 'output', payload: status ? { agent: agent(status) } : { text: `output-${seq}` } });

describe('BDD: bounded main-owned multi-agent projection', () => {
  it('U1 Given main confirmed history, Then lower-S or older false checkpoints and old pointers cannot retract it', () => {
    const projection = new MultiAgentProjection('t', 's');
    projection.install({ ...snapshot(10), hasAgentHistory: true } as MultiAgentGroupSnapshot);
    for (const incoming of [snapshot(9), { ...snapshot(11), threadRevision: 0 }, { ...snapshot(11), threadRevision: 2 }]) {
      projection.install({ ...incoming, hasAgentHistory: false } as MultiAgentGroupSnapshot);
      expect(projection.view().snapshot).toMatchObject({ hasAgentHistory: true });
    }
  });
  it.each([undefined, 'g'])('U1/A25 Given selection=%s, Then deleted thread control clears every group payload and no late ACK/page/error can resurrect it', selected => {
    const projection = new MultiAgentProjection('t', 's', selected);
    const old = { ...snapshot(1), hasAgentHistory: true } as MultiAgentGroupSnapshot;
    projection.install(old); projection.replay([event(1)]);
    const request = projection.beginAgentPage('next');
    projection.receive({ subscriptionId: 's', envelope: { channel: 'group_changed', threadId: 't', threadRevision: 3,
      oldGroupId: 'g', newGroupId: null, threadDeleteState: 'deleted', hasAgentHistory: false } as never });
    expect(projection.view()).toMatchObject({ groupId: null, agents: [], root: null, needsSnapshot: false,
      snapshot: { group: null, threadDeleteState: 'deleted', hasAgentHistory: false } });
    expect(projection.bufferSize()).toBe(0); expect(projection.details('a')).toEqual([]);
    expect(projection.installAgentPage([agent('running')], request)).toBe(false);
    projection.install(old); projection.replay([event(2, 'running')]);
    projection.receive({ subscriptionId: 's', envelope: event(3, 'running') });
    projection.fail('late transport failure'); projection.requestSnapshot();
    expect(projection.view()).toMatchObject({ groupId: null, agents: [], error: null, needsSnapshot: false,
      snapshot: { group: null, threadDeleteState: 'deleted', hasAgentHistory: false } });
  });
  it('U1 Given a historical selection before ACK, Then thread pending metadata does not require reading a possibly purged selected group', () => {
    const projection = new MultiAgentProjection('t', 's', 'g');
    projection.receive({ subscriptionId: 's', envelope: { channel: 'group_changed', threadId: 't', threadRevision: 3,
      oldGroupId: 'new', newGroupId: 'new', threadDeleteState: 'delete_pending', hasAgentHistory: true } as never });
    projection.install({ ...snapshot(0), hasAgentHistory: false } as MultiAgentGroupSnapshot);
    expect(projection.view()).toMatchObject({ activeGroupId: 'new', groupId: 'g', needsSnapshot: false,
      snapshot: { hasAgentHistory: true, threadDeleteState: 'delete_pending', threadRevision: 3 } });
  });
  it.each(['snapshot', 'status', 'tool_finished'] as const)('U7 Given newer live activity, Then a %s carrying an older checkpoint cannot roll the phase back', source => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0, 'running'));
    projection.receive({ subscriptionId: 's', envelope: { schemaVersion: 1, channel: 'activity', groupId: 'g', agentId: 'a', turnId: 'turn-1', activityRevision: 3, timestamp: 10, phase: 'model' } });
    if (source === 'snapshot') projection.install({ ...snapshot(1, 'running'), agents: [{ ...agent('running'), phase: 'starting' }] });
    else projection.receive({ subscriptionId: 's', envelope: { ...event(1), kind: source, payload: { agent: { ...agent('running'), phase: 'starting', toolsCompleted: 9 } } } });
    expect(projection.view().agents[0]).toMatchObject({ phase: 'model', activityRevision: 3, lastActivityAt: 10 });
    if (source !== 'snapshot') expect(projection.view().agents[0].toolsCompleted).toBe(9);
    projection.receive({ subscriptionId: 's', envelope: { ...event(2, 'completed'), payload: { agent: { ...agent('completed'), phase: 'settled' } } } });
    expect(projection.view().agents[0]).toMatchObject({ phase: 'settled', status: 'completed' });
  });
  it('U7 Given a new turn, Then it never inherits the old turn activity revision or tool', () => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0, 'running'));
    projection.receive({ subscriptionId: 's', envelope: { schemaVersion: 1, channel: 'activity', groupId: 'g', agentId: 'a', turnId: 'turn-1', activityRevision: 9, timestamp: 10, phase: 'tool', currentTool: 'old' } });
    projection.install({ ...snapshot(1, 'running'), agents: [{ ...agent('running', 2), phase: 'starting', activityRevision: 0 }] });
    expect(projection.view().agents[0]).toMatchObject({ turn: 2, phase: 'starting', activityRevision: 0 });
    expect(projection.view().agents[0].currentTool).toBeUndefined();
  });
  it('A25 Given newer thread revision with older S, Then deletion state advances independently and missing/old snapshots cannot unlock it', () => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(10));
    projection.install({ ...snapshot(9), threadRevision: 2, threadDeleteState: 'delete_pending' });
    expect(projection.view()).toMatchObject({ threadRevision: 2, statusSeq: 10, snapshot: { threadDeleteState: 'delete_pending' } });
    for (const revision of [1, 2, 3]) {
      projection.install({ ...snapshot(11), threadRevision: revision });
      expect(projection.view().snapshot?.threadDeleteState).toBe('delete_pending');
    }
    projection.install({ ...snapshot(12), threadRevision: 4, threadDeleteState: 'none' });
    expect(projection.view().snapshot?.threadDeleteState).toBe('delete_pending');
  });
  it('U3 Given two pages at the same cursor or a status change while reading, Then only the current unconsumed request can install', () => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0));
    const first = projection.beginAgentPage('cursor'), second = projection.beginAgentPage('cursor');
    expect(projection.installAgentPage([{ ...agent('completed'), taskName: 'latest' }], second)).toBe(true);
    expect(projection.installAgentPage([{ ...agent('failed'), taskName: 'old' }], first)).toBe(false);
    expect(projection.installAgentPage([agent('failed')], second)).toBe(false);
    expect(projection.view().agents[0].taskName).toBe('latest');
    const pending = projection.beginAgentPage('next');
    projection.receive({ subscriptionId: 's', envelope: event(1, 'running') });
    expect(projection.installAgentPage([agent('completed')], pending)).toBe(false);
    expect(projection.view().agents[0].status).toBe('running');
  });
  it.each(['message_sent', 'message_consumed'] as const)('A24 Given a %s event, Then it requests main counts instead of guessing unread locally', kind => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0));
    projection.receive({ subscriptionId: 's', envelope: { ...event(1), kind, payload: {} } });
    expect(projection.view().needsSnapshot).toBe(true); expect(projection.view().snapshot?.counts.unread).toBe(0);
  });
  it('U3 Given a conflicting boot on the same group, Then it fails closed without mixing activity incarnations', () => {
    const projection = new MultiAgentProjection('t', 's'); const initial = snapshot(0);
    projection.install({ ...initial, group: { ...initial.group!, bootId: 'boot-1' } });
    projection.install({ ...initial, lastSeq: 1, group: { ...initial.group!, bootId: 'boot-2' } });
    expect(projection.view().error).toContain('boot'); expect(projection.view().snapshot?.group?.bootId).toBe('boot-1');
  });
  it('U7 Given unmatched activity exceeds its small budget, Then overflow requests resync and cannot silently masquerade as a complete snapshot', () => {
    const projection = new MultiAgentProjection('t', 's');
    const requestedAt = projection.beginSnapshot();
    for (let index = 0; index < 17; index++) projection.receive({ subscriptionId: 's', envelope: { schemaVersion: 1, channel: 'activity', groupId: 'g',
      agentId: `unmatched-${index}`, turnId: 'turn-1', activityRevision: 3, timestamp: index, phase: 'tool' } });
    expect(projection.view().resyncRequired).toBe(true);
    projection.install(snapshot(0, 'running'), requestedAt); expect(projection.view().resyncRequired).toBe(true);
    projection.install(snapshot(0, 'running')); expect(projection.view().resyncRequired).toBe(false);
    projection.receive({ subscriptionId: 's', envelope: { schemaVersion: 1, channel: 'activity', groupId: 'g', agentId: 'a', turnId: 'next', activityRevision: 50, timestamp: 50, phase: 'tool' } });
    projection.receive({ subscriptionId: 's', envelope: { ...event(1), kind: 'status', payload: { agent: { ...agent('completed', 2), turnId: 'next', phase: 'settled' } } } });
    expect(projection.view().agents[0]).toMatchObject({ status: 'completed', phase: 'settled' });
  });
  it('U1 Given absolute tool counters delivered out of order and replayed twice, Then counters do not double and an old turn cannot overwrite the new turn', () => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0, 'running'));
    const first: MultiAgentDurableEvent = { ...event(1), kind: 'tool_finished', turnId: 'turn-1', payload: { agent: { ...agent('running'), toolsCompleted: 1 } } };
    const second: MultiAgentDurableEvent = { ...event(2), kind: 'tool_finished', turnId: 'turn-1', payload: { agent: { ...agent('running'), toolsCompleted: 2 } } };
    projection.receive({ subscriptionId: 's', envelope: second }); expect(projection.view().statusSeq).toBe(0);
    projection.receive({ subscriptionId: 's', envelope: first });
    expect(projection.view().agents[0].toolsCompleted).toBe(2);
    projection.replay([first, second, first, second]); expect(projection.view().agents[0].toolsCompleted).toBe(2);
    projection.receive({ subscriptionId: 's', envelope: { ...event(3, 'running'), payload: { agent: { ...agent('running', 2), toolsCompleted: 0 } } } });
    projection.receive({ subscriptionId: 's', envelope: { ...first, seq: 4, eventId: 'late-old-turn' } });
    expect(projection.view().agents[0]).toMatchObject({ turn: 2, toolsCompleted: 0 });
    const restored = new MultiAgentProjection('t', 'new-window');
    restored.install({ ...snapshot(4, 'running'), agents: [...projection.view().agents] });
    restored.replay([first, second]); expect(restored.view().agents[0]).toMatchObject({ turn: 2, toolsCompleted: 0 });
  });
  it('A10/U3 Given snapshot S=3 and detail C=0, When old status and output replay, Then details advance without rolling current status backwards', () => {
    const projection = new MultiAgentProjection('t', 's');
    projection.install(snapshot(3));
    projection.replay([event(1, 'running'), event(2), event(3, 'completed')]);
    expect(projection.view().agents[0].status).toBe('completed');
    expect(projection.view()).toMatchObject({ statusSeq: 3, detailSeq: 3 });
    expect(projection.details('a').map(item => item.seq)).toEqual([1, 2, 3]);
    projection.receive({ subscriptionId: 's', envelope: event(5, 'completed') });
    expect(projection.view().statusSeq).toBe(3);
    projection.receive({ subscriptionId: 's', envelope: event(4, 'running') });
    expect(projection.view()).toMatchObject({ statusSeq: 5, detailSeq: 5 });
    expect(projection.view().agents[0].status).toBe('completed');
  });

  it('A10/U3 Given live events before snapshot and foreign subscriptions, Then only the current subscription is buffered and applied after S', () => {
    const projection = new MultiAgentProjection('t', 's');
    projection.receive({ subscriptionId: 'foreign', envelope: event(2, 'failed') });
    projection.receive({ subscriptionId: 's', envelope: event(2, 'completed') });
    projection.install(snapshot(1, 'running')); projection.replay([event(1, 'running')]);
    expect(projection.view().agents[0].status).toBe('completed');
    expect(projection.view()).toMatchObject({ statusSeq: 2, detailSeq: 2 });
  });

  it('A10/U6 Given a historical selection and newer thread revision, Then old notices/snapshots cannot rewind the active pointer or switch the inspected group', () => {
    const projection = new MultiAgentProjection('t', 's', 'g'); projection.install(snapshot(1));
    projection.receive({ subscriptionId: 's', envelope: { channel: 'group_changed', threadId: 't', threadRevision: 3, oldGroupId: 'g', newGroupId: 'new' } });
    projection.install(snapshot(2));
    projection.receive({ subscriptionId: 'foreign', envelope: { channel: 'runtime_error', groupId: 'g', code: 'wrong' } });
    expect(projection.view()).toMatchObject({ threadRevision: 3, activeGroupId: 'new', groupId: 'g', error: null });
  });

  it('U3 Given a shared buffer overflow, Then it requests resync without advancing unapplied watermarks, and mounts only fifty details', () => {
    const projection = new MultiAgentProjection('t', 's', undefined, { maxEvents: 60, maxBytes: 1_000_000 }); projection.install(snapshot(0, 'running'));
    for (let seq = 2; seq <= 63; seq++) projection.receive({ subscriptionId: 's', envelope: event(seq) });
    expect(projection.view()).toMatchObject({ statusSeq: 0, detailSeq: 0, resyncRequired: true });
    expect(projection.bufferSize()).toBeLessThanOrEqual(60);
    projection.install(snapshot(100));
    for (let from = 1; from <= 100; from += 20) projection.replay(Array.from({ length: 20 }, (_, offset) => event(from + offset)));
    expect(projection.view().detailSeq).toBe(100); expect(projection.details('a')).toHaveLength(50); expect(projection.bufferSize()).toBeLessThanOrEqual(60);
  });

  it('U7 Given stale activity from an old turn, Then it neither rolls back a newer revision nor resurrects a terminal agent', () => {
    const projection = new MultiAgentProjection('t', 's'); projection.install(snapshot(0, 'running'));
    const activity = { schemaVersion: 1 as const, channel: 'activity' as const, groupId: 'g', agentId: 'a', turnId: 'turn-1', activityRevision: 3, timestamp: 10, phase: 'tool_running' };
    projection.receive({ subscriptionId: 's', envelope: { ...activity, turnId: 'old' } });
    expect(projection.view().agents[0].phase).toBeUndefined();
    projection.receive({ subscriptionId: 's', envelope: activity });
    expect(projection.view().agents[0].phase).toBe('tool_running');
    projection.receive({ subscriptionId: 's', envelope: event(1, 'completed') });
    projection.receive({ subscriptionId: 's', envelope: { ...activity, activityRevision: 9 } });
    expect(projection.view().agents[0].status).toBe('completed');
  });
});
