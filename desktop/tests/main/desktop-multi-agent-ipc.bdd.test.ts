// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { registerDesktopMultiAgentIpc } from '../../electron/desktop-multi-agent-ipc.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

describe('BDD: real multi-agent service behind authenticated semantic IPC', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-multi-ipc-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const store = new DesktopMultiAgentStore(join(root, 'state.sqlite')); cleanup.push(() => store.close());
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() }); cleanup.push(() => service.dispose());
    service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const group = store.createGroup('thread'); const rootId = `root_${group.groupId}`;
    const mainFrame = { url: 'file:///fixture/renderer/index.html' };
    const sent: Array<{ channel: string; data: unknown }> = [];
    const sender = Object.assign(new EventEmitter(), { id: 1, mainFrame, isDestroyed: () => false,
      send: (channel: string, data: unknown) => { sent.push({ channel, data }); } });
    const event = { sender, senderFrame: mainFrame };
    const handlers = new Map<string, (candidate: typeof event, input: unknown) => unknown>();
    const dispose = registerDesktopMultiAgentIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, {
      service, ready: Promise.resolve(), profileId: 'profile', workspaceId: 'workspace', cwd: root,
    }, { authorize: candidate => candidate.sender === sender && candidate.senderFrame === mainFrame && mainFrame.url === 'file:///fixture/renderer/index.html'
      ? { actorId: 'user' } : null });
    cleanup.push(dispose);
    const invoke = (key: string, input: unknown, caller = event) => Promise.resolve().then(() => handlers.get(`desktop:${key}`)!(caller, input));
    return { root, store, service, group, rootId, mainFrame, sender, event, sent, invoke };
  }

  it('U1 Given root-only and foreign-domain history, Then actual snapshot/list/subscribe IPC disclose only authorized thread facts', async () => {
    const f = setup();
    expect(await f.invoke('getMultiAgentSnapshot', { threadId: 'thread' })).toMatchObject({ hasAgentHistory: false, threadDeleteState: 'none' });
    expect(await f.invoke('listMultiAgentGroups', { threadId: 'thread' })).toEqual({ items: [], nextCursor: null });
    f.service.registerThread({ threadId: 'foreign', profileId: 'other-profile', workspaceId: 'other-workspace', cwd: f.root });
    const foreign = f.store.createGroup('foreign');
    f.store.putAgent(foreign.groupId, { id: 'foreign-child', parentId: `root_${foreign.groupId}`, taskName: 'foreign', canonicalName: '/root/foreign',
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
    expect(await f.invoke('getMultiAgentSnapshot', { threadId: 'thread', groupId: f.group.groupId })).toMatchObject({ hasAgentHistory: false });
    expect(await f.invoke('subscribeMultiAgents', { threadId: 'thread', subscriptionId: 'root-only' })).toMatchObject({ snapshot: { hasAgentHistory: false } });
    await expect(f.invoke('getMultiAgentSnapshot', { threadId: 'foreign' })).rejects.toThrow(/ownership/);
    await expect(f.invoke('getMultiAgentSnapshot', { threadId: 'thread', groupId: foreign.groupId })).rejects.toThrow(/scope/);
    await expect(f.invoke('getMultiAgentSnapshot', { threadId: 'thread', hasAgentHistory: true })).rejects.toThrow(/argument/);
    expect(f.store.getThread('foreign')).toMatchObject({ profileId: 'other-profile', workspaceId: 'other-workspace' });
  });

  it('U1 Given a selected historical group and another thread subscriber, Then pending/purge facts reach only the deleted thread and cannot authorize reading or recreating its old group', async () => {
    const f = setup(); const runner = vi.fn();
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(f.root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(f.root, 'materials'), maxBytes: 1024 }), runner });
    await f.service.initialize(host);
    f.store.putAgent(f.group.groupId, { id: 'old-child', parentId: f.rootId, taskName: 'old', canonicalName: '/root/old',
      depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
    f.store.putGroup({ ...f.store.requireGroup(f.group.groupId), historicalOnly: true }, true); f.store.clearActiveGroup('thread', f.group.groupId);
    const current = f.store.createGroup('thread');
    await f.invoke('subscribeMultiAgents', { threadId: 'other', subscriptionId: 'other-view' });
    const ready = await f.invoke('subscribeMultiAgents', { threadId: 'thread', groupId: f.group.groupId, subscriptionId: 'historical-view' });
    expect(ready).toMatchObject({ snapshot: { hasAgentHistory: true, group: { groupId: f.group.groupId, historicalOnly: true } } });
    expect(await f.invoke('listMultiAgentGroups', { threadId: 'thread' })).toMatchObject({ items: [{ groupId: f.group.groupId }], nextCursor: null });
    const revision = f.store.getThread('thread')!.threadRevision!;
    expect(await f.invoke('deleteMultiAgentThread', { threadId: 'thread', expectedThreadRevision: revision,
      operationId: `delete:${revision}:history`, confirmTerminate: true })).toMatchObject({ state: 'completed' });
    const envelopes = f.sent.map(item => item.data);
    expect(envelopes).toEqual([
      expect.objectContaining({ subscriptionId: 'historical-view', envelope: expect.objectContaining({ channel: 'group_changed', threadId: 'thread',
        oldGroupId: current.groupId, newGroupId: current.groupId, threadDeleteState: 'delete_pending', hasAgentHistory: true, threadRevision: revision + 1 }) }),
      expect.objectContaining({ subscriptionId: 'historical-view', envelope: expect.objectContaining({ channel: 'group_changed', threadId: 'thread',
        oldGroupId: current.groupId, newGroupId: null, threadDeleteState: 'deleted', hasAgentHistory: false, threadRevision: revision + 2 }) }),
    ]);
    expect(await f.invoke('getMultiAgentSnapshot', { threadId: 'thread' })).toMatchObject({ group: null, root: null, agents: [], hasAgentHistory: false, threadDeleteState: 'deleted' });
    await expect(f.invoke('getMultiAgentSnapshot', { threadId: 'thread', groupId: f.group.groupId })).rejects.toThrow(/unknown/);
    await expect(f.invoke('subscribeMultiAgents', { threadId: 'thread', groupId: f.group.groupId, subscriptionId: 'purged-view' })).rejects.toThrow(/unknown/);
    await expect(f.invoke('resetMultiAgentGroup', { threadId: 'thread', expectedGroupId: null, operationId: 'revive', confirmTerminate: true })).rejects.toThrow(/delet/);
    await expect(f.service.prepareRoot(host, 'thread', { prompt: 'must not revive', materials: [] })).rejects.toThrow(/delet/);
    expect(() => f.store.createGroup('thread')).toThrow(/delet/);
    expect(f.store.listGroups('thread').items).toEqual([]);
    expect(f.store.createGroup('other').threadId).toBe('other');
    expect(runner).not.toHaveBeenCalled();
  });

  it('A8/A22 Given a forged frame or ownership fields, When IPC reads or writes are invoked, Then they are rejected before any state is disclosed or changed', async () => {
    const fixture = setup();
    await expect(fixture.invoke('getMultiAgentSnapshot', { threadId: 'thread' }, { ...fixture.event, senderFrame: { ...fixture.mainFrame } })).rejects.toThrow(/unauthorized/);
    await expect(fixture.invoke('getMultiAgentSnapshot', { threadId: 'thread', workspaceId: 'forged' })).rejects.toThrow(/argument/);
    await expect(fixture.invoke('sendAgentMessage', { threadId: 'thread', groupId: fixture.group.groupId, agentId: fixture.rootId, operationId: 'op', expectedTurn: 0,
      message: 'forged', requestSource: 'user' })).rejects.toThrow(/argument/);
    expect(fixture.store.listMessages(fixture.group.groupId, fixture.rootId)).toEqual([]);
  });

  it('A15 Given a known stale control at the actual IPC handler, Then a structured refusal and its exact receipt cross the boundary without Error string classification', async () => {
    const f = setup();
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(f.root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(f.root, 'materials'), maxBytes: 1024 }), runner: vi.fn() });
    await f.service.initialize(host);
    const input = { threadId: 'thread', groupId: f.group.groupId, agentId: f.rootId, operationId: 'ipc-stale', expectedTurn: 99, message: 'not sent' };
    const result = await f.invoke('sendAgentMessage', input);
    expect(result).toMatchObject({ operationId: 'ipc-stale', state: 'completed', outcome: 'rejected', error: 'stale_expected_turn' });
    expect(await f.invoke('getMultiAgentOperation', { threadId: 'thread', groupId: f.group.groupId, operationId: 'ipc-stale' })).toMatchObject({ applyState: 'applied', result });
    expect(f.store.listMessages(f.group.groupId, f.rootId)).toEqual([]);
  });

  it('A10/U3 Given an installed subscription, When a snapshot is returned and a later event arrives, Then all channels carry its subscription ID and navigation revokes only the viewer', async () => {
    const fixture = setup();
    const result = await fixture.invoke('subscribeMultiAgents', { threadId: 'thread', subscriptionId: 'subscription-1', afterSeq: 0 }) as { subscriptionId: string; snapshot: { lastSeq: number } };
    expect(result.subscriptionId).toBe('subscription-1'); expect(result.snapshot.lastSeq).toBe(0);
    fixture.store.appendEvent(fixture.group.groupId, { agentId: fixture.rootId, kind: 'output', payload: { text: 'visible' } });
    expect(fixture.sent).toHaveLength(1);
    expect(fixture.sent[0]).toMatchObject({ channel: 'desktop:multiAgentEvent', data: { subscriptionId: 'subscription-1', envelope: { seq: 1 } } });
    fixture.sender.emit('did-start-navigation', {}, 'file:///foreign.html', false, true);
    fixture.store.appendEvent(fixture.group.groupId, { agentId: fixture.rootId, kind: 'output', payload: { text: 'not disclosed' } });
    expect(fixture.sent).toHaveLength(1);
    expect(fixture.store.getAgent(fixture.group.groupId, fixture.rootId)?.status).toBe('pending');
  });

  it('A10 Given duplicate or unsubscribed IDs, When another view subscribes, Then subscriptions remain isolated and closed windows do not leak listeners', async () => {
    const fixture = setup();
    await fixture.invoke('subscribeMultiAgents', { threadId: 'thread', subscriptionId: 'one' });
    await expect(fixture.invoke('subscribeMultiAgents', { threadId: 'thread', subscriptionId: 'one' })).rejects.toThrow(/duplicate/);
    await fixture.invoke('subscribeMultiAgents', { threadId: 'thread', subscriptionId: 'two' });
    await fixture.invoke('unsubscribeMultiAgents', { subscriptionId: 'one' });
    fixture.store.appendEvent(fixture.group.groupId, { agentId: fixture.rootId, kind: 'output', payload: { text: 'two only' } });
    expect(fixture.sent).toHaveLength(1); expect(fixture.sent[0].data).toMatchObject({ subscriptionId: 'two' });
    fixture.sender.emit('destroyed');
    fixture.store.appendEvent(fixture.group.groupId, { agentId: fixture.rootId, kind: 'output', payload: { text: 'none' } });
    expect(fixture.sent).toHaveLength(1);
  });

  it('A25 Given thread deletion IPC, Then reads retain ownership and mutation rejects foreign frames, injected authority and absent confirmation', async () => {
    const fixture = setup();
    expect(await fixture.invoke('getMultiAgentThreadDeletion', { threadId: 'thread' })).toMatchObject({ threadId: 'thread', threadRevision: 1, deleteState: 'none', operation: null });
    const input = { threadId: 'thread', expectedThreadRevision: 1, operationId: 'delete:1:nonce', confirmTerminate: true };
    await expect(fixture.invoke('deleteMultiAgentThread', input, { ...fixture.event, senderFrame: { ...fixture.mainFrame } })).rejects.toThrow(/unauthorized/);
    await expect(fixture.invoke('deleteMultiAgentThread', { ...input, requestSource: 'user' })).rejects.toThrow(/argument/);
    await expect(fixture.invoke('deleteMultiAgentThread', { ...input, path: fixture.group.groupId })).rejects.toThrow(/argument/);
    await expect(fixture.invoke('deleteMultiAgentThread', { ...input, confirmTerminate: false })).rejects.toThrow(/confirm/);
    expect(fixture.store.getThread('thread')?.deleteState).toBe('none');
  });

  it('A26/A37/A40 Given resource and reset IPC, Then it exposes bounded registered resources only and refuses injected source/path or missing confirmation', async () => {
    const fixture = setup(); const scope = { threadId: 'thread', groupId: fixture.group.groupId };
    expect(await fixture.invoke('getMultiAgentResources', scope)).toEqual({ items: [], nextCursor: null });
    await expect(fixture.invoke('getMultiAgentResources', scope, { ...fixture.event, senderFrame: { ...fixture.mainFrame } })).rejects.toThrow(/unauthorized/);
    await expect(fixture.invoke('resolveMultiAgentResource', { ...scope, resourceId: 'r', action: 'keep', operationId: 'op', path: '/not-accepted' })).rejects.toThrow(/argument/);
    await expect(fixture.invoke('resolveMultiAgentResource', { ...scope, resourceId: 'r', action: 'keep', operationId: 'op', requestSource: 'user' })).rejects.toThrow(/argument/);
    await expect(fixture.invoke('resetMultiAgentGroup', { threadId: 'thread', expectedGroupId: scope.groupId, operationId: 'reset', confirmTerminate: false })).rejects.toThrow(/confirm/);
    expect(fixture.store.activeGroup('thread')?.groupId).toBe(scope.groupId);
  });
});
