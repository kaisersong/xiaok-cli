// @vitest-environment node
import Module, { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreloadApi } from '../../electron/preload-api.js';
import { authorizationFixture, authorizationRequest, failNextAuthorizationCommit } from '../fixtures/multi-agent-authorization.js';

function preload(kind: 'typed' | 'packaged') {
  const listeners = new Map<string, Set<(event: unknown, data: any) => void>>();
  const emit = (channel: string, data: unknown) => { for (const listener of listeners.get(channel) ?? []) listener({}, data); };
  const ipc = {
    invoke: vi.fn<(channel: string, input?: any) => Promise<any>>(async () => ({ unsubscribed: true })),
    on: vi.fn((channel: string, listener: (event: unknown, data: any) => void) => {
      const channelListeners = listeners.get(channel) ?? new Set(); channelListeners.add(listener); listeners.set(channel, channelListeners);
    }),
    off: vi.fn((channel: string, listener: (event: unknown, data: any) => void) => { listeners.get(channel)?.delete(listener); }),
  };
  // The shell API is intentionally discovered at runtime so missing semantic
  // entrypoints fail at the real preload boundary, not at TS compilation.
  let api: Record<string, (...args: any[]) => any>;
  if (kind === 'typed') api = createPreloadApi(ipc) as unknown as typeof api;
  else {
    const require = createRequire(import.meta.url), file = resolve('electron/preload.cjs');
    type Loader = (name: string, parent: unknown, main: boolean) => unknown;
    const internals = Module as unknown as { _load: Loader }, original = internals._load;
    internals._load = (name, parent, main) => name === 'electron'
      ? { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_key: string, value: typeof api) => { api = value; } } }
      : original(name, parent, main);
    try { delete require.cache[file]; require(file); }
    finally { internals._load = original; delete require.cache[file]; }
  }
  const call = (name: string, ...args: unknown[]) => {
    expect(api[name], `missing production ${kind} preload ${name}`).toBeTypeOf('function');
    return api[name]!(...args);
  };
  return { call, ipc, emit, count: () => [...listeners.values()].reduce((count, set) => count + set.size, 0) };
}

describe.each(['typed', 'packaged'] as const)('W12/W16 %s workspace authorization preload', kind => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('AP keeps metadata/input-page reads and one-shot decisions on their distinct named channels', async () => {
    const p = preload(kind), scope = { threadId: 'thread', groupId: 'group', approvalId: 'approval' };
    await p.call('getMultiAgentApproval', scope);
    await p.call('getMultiAgentApproval', { ...scope, inputOffset: 0 });
    await p.call('decideMultiAgentApproval', { ...scope, operationId: 'decision-original', decision: 'approve' });
    expect(p.ipc.invoke.mock.calls).toEqual([
      ['desktop:getMultiAgentApproval', scope], ['desktop:getMultiAgentApproval', { ...scope, inputOffset: 0 }],
      ['desktop:decideMultiAgentApproval', { ...scope, operationId: 'decision-original', decision: 'approve' }],
    ]);
  });

  it('reads only the fixed local execution workspace, without parameters derived from a thread or authorization', async () => {
    const p = preload(kind);
    p.ipc.invoke.mockResolvedValue({ cwd: 'C:\\workspace\\<plain>&text' });
    expect(await p.call('getLocalExecutionWorkspace', {})).toEqual({ cwd: 'C:\\workspace\\<plain>&text' });
    expect(p.ipc.invoke.mock.calls).toEqual([['desktop:getLocalExecutionWorkspace', {}]]);
  });

  it('routes only the named getter/setter/operation channels, without synthesizing authority or changing the original retry', async () => {
    const p = preload(kind), request = { operationId: 'exec-auth:boot:2:original', expectedPermissionRevision: 2, executionAllowed: true, confirm: true };
    await p.call('getLocalExecutionAuthorization', {});
    await p.call('setLocalExecutionAuthorization', request);
    await p.call('getLocalExecutionAuthorizationOperation', { operationId: request.operationId });
    expect(p.ipc.invoke.mock.calls).toEqual([
      ['desktop:getLocalExecutionAuthorization', {}], ['desktop:setLocalExecutionAuthorization', request],
      ['desktop:getLocalExecutionAuthorizationOperation', { operationId: request.operationId }],
    ]);
  });

  it('installs before invoke and transports early unknown including the original pending operation only to its subscription', async () => {
    const p = preload(kind), received = vi.fn();
    const transport = { subscriptionId: 'auth', authorization: { bootId: 'boot', permissionRevision: 3, executionAllowed: false,
      persistenceState: 'unknown', pendingOperation: { operationId: 'exec-auth:boot:2:original', expectedPermissionRevision: 2, executionAllowed: true, confirm: true } } };
    p.ipc.invoke.mockImplementation(async channel => {
      if (channel !== 'desktop:subscribeLocalExecutionAuthorization') return {};
      expect(p.count()).toBe(1);
      p.emit('desktop:localExecutionAuthorizationChanged', { ...transport, subscriptionId: 'foreign' });
      p.emit('desktop:localExecutionAuthorizationChanged', transport);
      return transport;
    });
    expect(await p.call('subscribeLocalExecutionAuthorization', { subscriptionId: 'auth' }, received)).toEqual(transport);
    expect(received.mock.calls).toEqual([[transport]]);
    await p.call('unsubscribeLocalExecutionAuthorization', { subscriptionId: 'auth' });
    expect(p.count()).toBe(0);
  });

  it('revokes late registration after unsubscribe-before-ready and reserves the ID until that attempt settles', async () => {
    const p = preload(kind); let release!: (value: unknown) => void;
    p.ipc.invoke.mockImplementation(channel => channel === 'desktop:subscribeLocalExecutionAuthorization'
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve({}));
    const ready = p.call('subscribeLocalExecutionAuthorization', { subscriptionId: 'auth' }, vi.fn());
    await p.call('unsubscribeLocalExecutionAuthorization', { subscriptionId: 'auth' });
    await expect(p.call('subscribeLocalExecutionAuthorization', { subscriptionId: 'auth' }, vi.fn())).rejects.toThrow(/duplicate/);
    release({ subscriptionId: 'auth', authorization: {} });
    await expect(ready).rejects.toThrow(/cancelled/);
    expect(p.count()).toBe(0);
    expect(p.ipc.invoke.mock.calls.filter(([name]) => name === 'desktop:unsubscribeLocalExecutionAuthorization')).toHaveLength(2);
  });

  it('removes failed listener state so the same ID can subscribe again', async () => {
    const p = preload(kind);
    p.ipc.invoke.mockRejectedValueOnce(new Error('unauthorized'));
    await expect(p.call('subscribeLocalExecutionAuthorization', { subscriptionId: 'auth' }, vi.fn())).rejects.toThrow('unauthorized');
    expect(p.count()).toBe(0);
    p.ipc.invoke.mockResolvedValue({ subscriptionId: 'auth', authorization: {} });
    await p.call('subscribeLocalExecutionAuthorization', { subscriptionId: 'auth' }, vi.fn());
    await p.call('unsubscribeLocalExecutionAuthorization', { subscriptionId: 'auth' });
    expect(p.count()).toBe(0);
  });

  it('preserves real factory SQLite unknown and same-candidate confirmation through the actual semantic registrar', async () => {
    const f = await authorizationFixture(cleanup), p = preload(kind);
    p.ipc.invoke.mockImplementation((channel, input) => f.invoke(channel.slice('desktop:'.length), input));
    const initial = await p.call('getLocalExecutionAuthorization', {});
    const request = authorizationRequest(initial, false, 'preload-real-unknown');
    const fault = failNextAuthorizationCommit(f.db, 'after'); cleanup.push(fault.restore);
    const lost = await p.call('setLocalExecutionAuthorization', request);
    expect(fault.faults()).toBe(1);
    expect(lost).toMatchObject({ state: 'unknown', executionAllowed: false, permissionRevision: initial.permissionRevision + 1 });
    const current = await p.call('getLocalExecutionAuthorization', {});
    expect(current).toMatchObject({ persistenceState: 'unknown', pendingOperation: request });
    expect(await p.call('getLocalExecutionAuthorizationOperation', { operationId: request.operationId })).toEqual({ kind: 'receipt', receipt: lost });
    const writes = fault.writePreparations();
    expect(await p.call('setLocalExecutionAuthorization', current.pendingOperation)).toMatchObject({ state: 'applied', persistenceState: 'confirmed', permissionRevision: current.permissionRevision });
    expect(fault.writePreparations()).toBe(writes);
  });
});
