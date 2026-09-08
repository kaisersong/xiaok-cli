// @vitest-environment node
import Module, { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
import type { MultiAgentDesktopAPI } from '../../shared/multi-agent-types.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { registerDesktopMultiAgentIpc } from '../../electron/desktop-multi-agent-ipc.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';

function setup(kind: 'typed' | 'packaged') {
  const listeners = new Set<(_event: unknown, payload: unknown) => void>();
  let resolveSubscribe!: (value: unknown) => void;
  let rejectSubscribe!: (error: Error) => void;
  const pending = new Promise((resolve, reject) => { resolveSubscribe = resolve; rejectSubscribe = reject; });
  const ipc = {
    invoke: vi.fn((channel: string) => {
      if (channel === 'desktop:subscribeMultiAgents') {
        expect(listeners.size).toBe(1);
        for (const listener of listeners) listener({}, { subscriptionId: 's1', envelope: { channel: 'runtime_error', groupId: 'g', code: 'early' } });
        return pending;
      }
      return Promise.resolve({ unsubscribed: true });
    }),
    on: vi.fn((_channel: string, listener: (_event: unknown, payload: unknown) => void) => { listeners.add(listener); }),
    off: vi.fn((_channel: string, listener: (_event: unknown, payload: unknown) => void) => { listeners.delete(listener); }),
  };
  let api: MultiAgentDesktopAPI;
  if (kind === 'typed') api = createPreloadApi(ipc);
  else {
    const require = createRequire(import.meta.url); const file = resolve('electron/preload.cjs');
    type ModuleLoader = (name: string, parent: unknown, main: boolean) => unknown;
    const moduleInternals = Module as unknown as { _load: ModuleLoader }; const original = moduleInternals._load;
    moduleInternals._load = ((name: string, parent: unknown, main: boolean) => name === 'electron'
      ? { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, exposed: MultiAgentDesktopAPI) => { api = exposed; } } }
      : original(name, parent, main));
    try { delete require.cache[file]; require(file); } finally { moduleInternals._load = original; delete require.cache[file]; }
  }
  return { api: api!, ipc, listeners, resolveSubscribe, rejectSubscribe };
}

describe.each(['typed', 'packaged'] as const)('BDD: %s multi-agent preload', kind => {
  it('U1 Given the real SQLite service and authenticated IPC, Then snapshot/ACK/history deletion fields cross this preload unchanged', async () => {
    const f = setup(kind); const root = mkdtempSync(join(tmpdir(), 'xiaok-history-preload-'));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: vi.fn() });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner: vi.fn() });
    const frame = {}; const sender = Object.assign(new EventEmitter(), { id: 71, mainFrame: frame, isDestroyed: () => false,
      send: (_channel: string, payload: unknown) => { for (const listener of f.listeners) listener({}, payload); } });
    const event = { sender, senderFrame: frame };
    const handlers = new Map<string, (candidate: typeof event, input: unknown) => unknown>();
    const dispose = registerDesktopMultiAgentIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } },
      { service, ready: Promise.resolve(), profileId: 'p', workspaceId: 'w', cwd: root }, { authorize: candidate => candidate.sender === sender ? { actorId: 'user' } : null });
    f.ipc.invoke.mockImplementation((channel: string, input?: unknown) => Promise.resolve().then(() => handlers.get(channel)!(event, input)));
    try {
      await service.initialize(host);
      expect(await f.api.getMultiAgentSnapshot({ threadId: 'thread' })).toMatchObject({ hasAgentHistory: false, group: null });
      const old = store.createGroup('thread');
      store.putAgent(old.groupId, { id: 'child', parentId: `root_${old.groupId}`, taskName: 'child', canonicalName: '/root/child',
        depth: 1, status: 'closed', turn: 1, resourcesReleased: true, activationState: 'settled' });
      store.putGroup({ ...store.requireGroup(old.groupId), historicalOnly: true }, true); store.clearActiveGroup('thread', old.groupId);
      expect(await f.api.getMultiAgentSnapshot({ threadId: 'thread' })).toMatchObject({ hasAgentHistory: true, group: null, activeGroupId: null });
      expect(await f.api.listMultiAgentGroups({ threadId: 'thread' })).toMatchObject({ items: [{ groupId: old.groupId }], nextCursor: null });
      const received = vi.fn();
      expect(await f.api.subscribeMultiAgents({ threadId: 'thread', groupId: old.groupId, subscriptionId: 's1' }, received)).toMatchObject({ snapshot: { hasAgentHistory: true } });
      const revision = store.getThread('thread')!.threadRevision!;
      expect(await f.api.deleteMultiAgentThread({ threadId: 'thread', expectedThreadRevision: revision,
        operationId: `delete:${revision}:preload`, confirmTerminate: true })).toMatchObject({ state: 'completed' });
      expect(received.mock.calls.map(([transport]) => transport)).toEqual([
        expect.objectContaining({ subscriptionId: 's1', envelope: expect.objectContaining({ channel: 'group_changed', hasAgentHistory: true, threadDeleteState: 'delete_pending' }) }),
        expect.objectContaining({ subscriptionId: 's1', envelope: expect.objectContaining({ channel: 'group_changed', hasAgentHistory: false, threadDeleteState: 'deleted' }) }),
      ]);
      expect(await f.api.getMultiAgentSnapshot({ threadId: 'thread' })).toMatchObject({ hasAgentHistory: false, group: null, threadDeleteState: 'deleted' });
      await expect(f.api.getMultiAgentSnapshot({ threadId: 'thread', groupId: old.groupId })).rejects.toThrow(/unknown/);
      await f.api.unsubscribeMultiAgents({ subscriptionId: 's1' });
      expect(f.listeners.size).toBe(0);
    } finally { dispose(); await host.drain(); await service.dispose(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it('A15 Given a structured known refusal, Then both preload entrypoints preserve outcome and code instead of converting it into a thrown transport error', async () => {
    const f = setup(kind);
    const result = { operationId: 'refused', state: 'completed', outcome: 'rejected', error: 'stale_expected_turn' };
    f.ipc.invoke.mockResolvedValue(result);
    const input = { threadId: 't', groupId: 'g', agentId: 'a', operationId: 'refused', expectedTurn: 1, message: 'draft' };
    for (const method of ['sendAgentMessage', 'followupAgent', 'interruptAgent', 'closeAgent'] as const) await expect(f.api[method](input)).resolves.toEqual(result);
  });
  it('A25 Given a deletion request, Then both preload entrypoints preserve the exact operation/revision and expose only semantic channels', async () => {
    const fixture = setup(kind); const scope = { threadId: 't' };
    const request = { ...scope, operationId: 'delete:2:nonce', expectedThreadRevision: 2, confirmTerminate: true as const };
    await fixture.api.getMultiAgentThreadDeletion(scope); await fixture.api.deleteMultiAgentThread(request);
    expect(fixture.ipc.invoke.mock.calls).toEqual([['desktop:getMultiAgentThreadDeletion', scope], ['desktop:deleteMultiAgentThread', request]]);
  });
  it('A26/A40 Given semantic resource and reset inputs, Then both preload builds route only their named channels without adding authority fields', async () => {
    const fixture = setup(kind);
    const resources = { threadId: 't', groupId: 'g' };
    const keep = { ...resources, resourceId: 'r', action: 'keep' as const, operationId: 'keep' };
    const reset = { threadId: 't', expectedGroupId: 'g', confirmTerminate: true as const, operationId: 'reset' };
    await fixture.api.getMultiAgentResources(resources);
    await fixture.api.resolveMultiAgentResource(keep);
    await fixture.api.resetMultiAgentGroup(reset);
    expect(fixture.ipc.invoke.mock.calls).toEqual([
      ['desktop:getMultiAgentResources', resources], ['desktop:resolveMultiAgentResource', keep], ['desktop:resetMultiAgentGroup', reset],
    ]);
  });
  it('A10 Given an event during subscribe, Then the listener receives it before ready and rejects every foreign subscription ID', async () => {
    const fixture = setup(kind); const received = vi.fn();
    const ready = fixture.api.subscribeMultiAgents({ threadId: 't', subscriptionId: 's1' }, received);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ envelope: expect.objectContaining({ code: 'early' }) }));
    for (const listener of fixture.listeners) listener({}, { subscriptionId: 'foreign', envelope: { channel: 'group_changed' } });
    expect(received).toHaveBeenCalledTimes(1);
    fixture.resolveSubscribe({ subscriptionId: 's1', snapshot: {} }); await ready;
    await fixture.api.unsubscribeMultiAgents({ subscriptionId: 's1' });
    expect(fixture.listeners.size).toBe(0);
  });

  it('A10 Given unsubscribe before ready, Then late main registration is revoked and no local listener remains', async () => {
    const fixture = setup(kind);
    const ready = fixture.api.subscribeMultiAgents({ threadId: 't', subscriptionId: 's1' }, vi.fn());
    await fixture.api.unsubscribeMultiAgents({ subscriptionId: 's1' });
    await expect(fixture.api.subscribeMultiAgents({ threadId: 't', subscriptionId: 's1' }, vi.fn())).rejects.toThrow(/duplicate/);
    fixture.resolveSubscribe({ subscriptionId: 's1', snapshot: {} });
    await expect(ready).rejects.toThrow(/cancelled/);
    expect(fixture.listeners.size).toBe(0);
    expect(fixture.ipc.invoke.mock.calls.filter(([channel]) => channel === 'desktop:unsubscribeMultiAgents')).toHaveLength(2);
  });

  it('A10 Given a refused subscription, Then the listener is removed and the same ID can be retried without leaking', async () => {
    const fixture = setup(kind);
    const ready = fixture.api.subscribeMultiAgents({ threadId: 't', subscriptionId: 's1' }, vi.fn());
    await expect(fixture.api.subscribeMultiAgents({ threadId: 't', subscriptionId: 's1' }, vi.fn())).rejects.toThrow(/duplicate/);
    fixture.rejectSubscribe(new Error('denied')); await expect(ready).rejects.toThrow('denied');
    expect(fixture.listeners.size).toBe(0);
  });
});
