// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { constants, DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext, type DesktopHostDeliveryAuthority } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { DesktopMultiAgentApprovalTransport, type DesktopApprovalServicePort, type DesktopApprovalOwner } from '../../electron/desktop-multi-agent-approval-transport.js';
import { registerDesktopMultiAgentIpc, type MultiAgentIpcEvent } from '../../electron/desktop-multi-agent-ipc.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { MultiAgentEnvelope, MultiAgentPendingApproval } from '../../shared/multi-agent-types.js';

function barrier<T = void>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
type NativeDb = DatabaseSync & { setAuthorizer(callback: ((action: number, table: string | null, column: string | null) => number) | null): void };
const nativeAuthorizer = typeof (DatabaseSync.prototype as unknown as NativeDb).setAuthorizer === 'function';

describe('BDD AP service ports: real authority, group FIFO and actor lifetime', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });

  // This is intentionally a service-only fixture, not a substitute approval
  // transport. Store/coordinator/core/host/context are production objects. The
  // managed model bodies merely wait at a real execution boundary until release.
  async function setup(history = false, multiAgentLeaseMs?: number) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-approval-service-ports-'));
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
    const coordinator = new DesktopExecutionCoordinator({ multiAgentLeaseMs });
    const released = barrier(), entered = barrier<DesktopAgentExecutionContext>();
    const contexts: DesktopAgentExecutionContext[] = [];
    const service = new DesktopMultiAgentService({ store, coordinator,
      createSession: async input => ({ run: async () => {
        contexts.push(input.getTurnContext()); await released.promise; return 'bounded child result';
      }, dispose: async () => {} }),
    });
    service.registerThread({ threadId: 'approval-thread', profileId: 'approval-profile', workspaceId: 'approval-workspace', cwd: root });
    let historyId: string | undefined;
    if (history) {
      const old = store.createGroup('approval-thread'); historyId = old.groupId;
      store.putGroup({ ...old, historicalOnly: true }, true); store.clearActiveGroup('approval-thread', old.groupId);
    }
    let deliveryOwner!: DesktopHostDeliveryAuthority;
    const host = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 * 1024 }),
      runner: input => service.runRoot(input, async context => { entered.resolve(context); await released.promise; }),
      authorizePreparation: (taskId, marker) => service.assertHostPreparation(taskId, marker),
      assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      onDeliveryReport: report => service.recordHostDelivery({ requestSource: 'scheduler', authority: deliveryOwner, report }),
    });
    let transport: DesktopMultiAgentApprovalTransport | undefined;
    cleanup.push(async () => {
      const closing = service.dispose(); released.resolve(); await closing;
      await transport?.dispose(); await host.drain(); store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    });
    await service.initialize(host); deliveryOwner = service.bindHostDeliveryOwner(host);
    const access = (threadId = 'approval-thread') => service.createUserAccess({ requestSource: 'user', actorId: 'approval-user',
      threadId, profileId: 'approval-profile', workspaceId: 'approval-workspace' });
    // Forward interface only: the initial red is a missing real service method,
    // never a test implementation of authority/capacity/expiry/unknown policy.
    const port = service as unknown as DesktopApprovalServicePort;
    const bind = () => {
      expect(port.bindApprovalTransport, 'real bind port missing; downstream owner assertions have not run').toBeTypeOf('function');
      const actual = port.bindApprovalTransport.bind(service); let owner: DesktopApprovalOwner | undefined;
      const observe = vi.spyOn(port, 'bindApprovalTransport').mockImplementation(value => { owner = actual(value); return owner; });
      try { transport = new DesktopMultiAgentApprovalTransport({ store, service: port }); }
      finally { observe.mockRestore(); }
      expect(owner).toBeDefined(); return { owner: owner!, transport: transport! };
    };
    const start = async () => {
      const prepared = await service.prepareRoot(host, 'approval-thread', { prompt: 'Bounded real root.', materials: [] });
      await host.startTask(prepared.taskId); return entered.promise;
    };
    const spawn = async (context: DesktopAgentExecutionContext, name = 'ports_child') => {
      const created = await service.spawn({ requestSource: 'agent', actor: context.actor,
        operationId: `spawn-${name}`, taskName: name, message: 'Bounded child.' });
      await vi.waitFor(() => expect(contexts.some(item => item.agentId === created.targetAgentId)).toBe(true));
      return contexts.find(item => item.agentId === created.targetAgentId)!;
    };
    return { root, store, service, coordinator, port, access, bind, start, spawn, contexts, released, historyId };
  }

  it('AP owner binds one actual transport by identity and a second actual transport cannot replace it', async () => {
    const f = await setup(), { owner, transport } = f.bind();
    expect(Object.isFrozen(owner)).toBe(true);
    expect(f.port.bindApprovalTransport(transport)).toBe(owner);
    expect(() => new DesktopMultiAgentApprovalTransport({ store: f.store, service: f.port })).toThrow(/owner|bound|transport/);
    expect(f.port.bindApprovalTransport(transport)).toBe(owner);
  });

  it.each(['command', 'expire', 'freeze', 'failure-read', 'publish'] as const)('AP copied diagnostic owner cannot use the real %s service port', async method => {
    const f = await setup(), context = await f.start(), { owner } = f.bind();
    const forged = { ...owner }, effect = vi.fn();
    const action = () => method === 'command' ? f.port.runApprovalCommand(forged, context.groupId, effect)
      : method === 'expire' ? f.port.expireApprovalActor(forged, context)
      : method === 'freeze' ? f.port.freezeApprovalPersistence(forged, context.groupId)
      : method === 'failure-read' ? f.port.getApprovalPersistenceFailure(forged, context.groupId)
      : f.port.publishApprovalChange(forged, context.groupId);
    await expect(Promise.resolve().then(action)).rejects.toThrow(/owner|authority/);
    expect(effect).not.toHaveBeenCalled(); expect(context.signal.aborted).toBe(false);
    expect(f.store.requireGroup(context.groupId).mutationBlockedReason ?? undefined).toBeUndefined();
  });

  it('AP capacity comes from the same actual root plus eight resident-child admission population', async () => {
    const f = await setup(), context = await f.start();
    for (let index = 0; index < 8; index++) await f.spawn(context, `capacity_${index}`);
    expect(f.contexts).toHaveLength(8); expect(f.service.runtimeStatus().residentSlots).toBe(8);
    await expect(f.service.spawn({ requestSource: 'agent', actor: context.actor, operationId: 'ninth', taskName: 'ninth', message: 'No capacity.' })).rejects.toThrow(/capacity/);
    expect(f.port.approvalCapacity).toBe(f.contexts.length + 1);
    expect(f.port.approvalCapacity).toBe(9);
  });

  it.each(['agent', 'scheduler', 'copied', 'foreign-thread', 'foreign-domain'] as const)('AP user access rejects %s without SQLite writes or actor cancellation', async kind => {
    const f = await setup(), context = await f.start();
    expect(f.port.assertApprovalUserAccess).toBeTypeOf('function');
    f.service.registerThread({ threadId: 'other-thread', profileId: 'approval-profile', workspaceId: 'approval-workspace', cwd: f.root });
    f.service.registerThread({ threadId: 'other-domain', profileId: 'foreign-profile', workspaceId: 'foreign-workspace', cwd: f.root });
    const access = kind === 'copied' ? { ...f.access() } : kind === 'foreign-thread' ? f.access('other-thread')
      : kind === 'foreign-domain' ? f.service.createUserAccess({ requestSource: 'user', actorId: 'foreign-user', threadId: 'other-domain', profileId: 'foreign-profile', workspaceId: 'foreign-workspace' }) : f.access();
    const before = f.store.requireGroup(context.groupId);
    expect(() => f.port.assertApprovalUserAccess(access, kind === 'agent' || kind === 'scheduler' ? kind : 'user', context.groupId)).toThrow();
    expect(f.store.requireGroup(context.groupId)).toEqual(before); expect(context.signal.aborted).toBe(false);
  });

  it('AP actual same-thread user access retains identity on current and historical read scope', async () => {
    const f = await setup(true), context = await f.start();
    expect(f.port.assertApprovalUserAccess).toBeTypeOf('function');
    for (const groupId of [context.groupId, f.historyId!]) expect(f.port.assertApprovalUserAccess(f.access(), 'user', groupId))
      .toEqual({ actorId: 'approval-user', threadId: 'approval-thread', profileId: 'approval-profile', workspaceId: 'approval-workspace' });
  });

  it('AP command joins the actual group synchronous FIFO instead of a parallel transport queue', async () => {
    const f = await setup(), context = await f.start(), { owner } = f.bind(), order: string[] = [];
    const live = (f.service as unknown as { groups: Map<string, { commands: { run<T>(action: () => T): Promise<T> } }> }).groups.get(context.groupId)!;
    const before = live.commands.run(() => { order.push('group-before'); });
    const approval = f.port.runApprovalCommand(owner, context.groupId, () => { order.push('approval'); return 'sync-result'; });
    const after = live.commands.run(() => { order.push('group-after'); });
    expect(order).toEqual([]);
    await before; expect(await approval).toBe('sync-result'); await after;
    expect(order).toEqual(['group-before', 'approval', 'group-after']);
  });

  it('AP command rejects a real thenable and does not hold up the next group command', async () => {
    const f = await setup(), context = await f.start(), { owner } = f.bind();
    const never = new Promise<void>(() => {});
    await expect(f.port.runApprovalCommand(owner, context.groupId, () => never)).rejects.toThrow(/synchronous/);
    expect(await f.port.runApprovalCommand(owner, context.groupId, () => 'next')).toBe('next');
    expect(context.signal.aborted).toBe(false);
  });

  it.each(['success', 'reject'] as const)('AP %s commands retain their shared queue only while a real command user exists', async outcome => {
    const f = await setup(), context = await f.start(), { owner } = f.bind();
    const retained = (f.service as unknown as { resourceCommands: Map<string, { users: number }> }).resourceCommands;
    const before = retained.size, observed: number[] = [];
    const first = f.port.runApprovalCommand(owner, context.groupId, () => {
      observed.push(retained.get(context.groupId)!.users);
      if (outcome === 'reject') throw new Error('known synchronous refusal');
    });
    const second = f.port.runApprovalCommand(owner, context.groupId, () => { observed.push(retained.get(context.groupId)!.users); });
    const settled = await Promise.allSettled([first, second]);
    expect(settled.map(item => item.status)).toEqual([outcome === 'reject' ? 'rejected' : 'fulfilled', 'fulfilled']);
    expect(observed).toEqual([2, 2]);
    expect(retained.size).toBe(before); expect(retained.has(context.groupId)).toBe(false);
    expect(context.signal.aborted).toBe(false);
  });

  it.skipIf(!nativeAuthorizer)('AP actual command-admission SQLite READ failure is persistence failure, not a normal permission refusal', async () => {
    const f = await setup(), context = await f.start(), { owner } = f.bind();
    const db = (f.store as unknown as { db: NativeDb }).db, action = vi.fn();
    let faults = 0;
    const oldStackLimit = Error.stackTraceLimit; Error.stackTraceLimit = 40;
    db.setAuthorizer((code, table) => {
      if (!faults && code === constants.SQLITE_READ && table === 'groups' && new Error().stack?.includes('runApprovalCommand')) {
        faults++; return constants.SQLITE_DENY;
      }
      return constants.SQLITE_OK;
    });
    try { await expect(f.port.runApprovalCommand(owner, context.groupId, action)).rejects.toThrow(); }
    finally { db.setAuthorizer(null); Error.stackTraceLimit = oldStackLimit; }
    expect(faults).toBe(1); expect(action).not.toHaveBeenCalled();
    expect.soft(context.signal.aborted).toBe(true);
    expect.soft(f.port.getApprovalPersistenceFailure(owner, context.groupId)).toEqual({
      groupId: context.groupId, bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed',
    });
  });

  it('AP unknown-group command refusal does not freeze an unrelated real actor', async () => {
    const f = await setup(), context = await f.start(), { owner } = f.bind(), action = vi.fn();
    await expect(f.port.runApprovalCommand(owner, 'never-registered-group', action)).rejects.toThrow();
    expect(action).not.toHaveBeenCalled(); expect(context.signal.aborted).toBe(false);
    expect(f.port.getApprovalPersistenceFailure(owner, context.groupId)).toBeUndefined();
  });

  it('AP actor expiry uses the real child deadline before a timer runs and never fakes member release', async () => {
    const f = await setup(false, 60_000), root = await f.start(), child = await f.spawn(root), { owner } = f.bind();
    const deadline = f.service.getApprovalDeadline(child.actor), refs = child.memberTicket.refCount;
    const now = vi.spyOn(Date, 'now').mockReturnValue(deadline - 1);
    try {
      f.port.expireApprovalActor(owner, child); expect(child.signal.aborted).toBe(false);
      now.mockReturnValue(deadline);
      f.port.expireApprovalActor(owner, child);
      // This explicit group lease bounds both actors, unlike a removed implicit child idle budget.
      expect(child.signal.aborted).toBe(true); expect(root.signal.aborted).toBe(true);
      expect(child.memberTicket.released).toBe(false); expect(child.memberTicket.refCount).toBe(refs);
      expect(f.store.getAgent(child.groupId, child.agentId)).toMatchObject({ resourcesReleased: false, executionActive: true });
    } finally { now.mockRestore(); }
  });

  it('AP copied child context cannot use a genuine owner to expire the actual actor', async () => {
    const f = await setup(), root = await f.start(), child = await f.spawn(root), { owner } = f.bind();
    expect(() => f.port.expireApprovalActor(owner, { ...child })).toThrow(/context|authority|actor/);
    expect(child.signal.aborted).toBe(false); expect(root.signal.aborted).toBe(false);
  });

  it.each(['current', 'history'] as const)('AP failure synchronously denies effects while %s snapshot preserves read-only unknown', async selected => {
    const f = await setup(true), context = await f.start(), { owner, transport } = f.bind();
    // Controlled projection DATA only: it deliberately remains stale/pending.
    // The real service must apply its own irreversible group failure fence.
    const pending: MultiAgentPendingApproval = { approvalId: 'controlled-pending', agentId: context.agentId, turn: context.turn,
      turnId: context.turnId, minDeadlineAt: Math.min(Date.now() + 600_000, context.effectiveDeadline), status: 'pending', persistenceState: 'confirmed',
      canDecide: true, inputSha256: 'a'.repeat(64), inputByteLength: 2 };
    vi.spyOn(transport, 'getGroupProjection').mockImplementation(groupId => ({ pendingApprovals: groupId === context.groupId ? [pending] : [], pendingApprovalCount: groupId === context.groupId ? 1 : 0 }));
    f.port.freezeApprovalPersistence(owner, context.groupId);
    expect(context.signal.aborted).toBe(true); expect(() => f.service.assertInvocation(context.actor, context)).toThrow();
    expect(context.memberTicket.released).toBe(false);
    const groupId = selected === 'current' ? context.groupId : f.historyId!;
    const stableGroup = f.store.requireGroup(groupId), stableThread = f.store.getThread('approval-thread');
    const snapshot = f.service.getSnapshot({ access: f.access(), groupId });
    expect(snapshot.group?.groupId).toBe(groupId);
    expect(snapshot.approvalFailure).toEqual({ groupId: context.groupId, bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed' });
    expect(snapshot.pendingApprovalCount).toBe(0);
    if (selected === 'current') expect(snapshot.pendingApprovals).toEqual([expect.objectContaining({ canDecide: false, persistenceState: 'unknown' })]);
    expect(f.port.getApprovalPersistenceFailure(owner, context.groupId)).toEqual(snapshot.approvalFailure);
    expect(f.store.requireGroup(groupId)).toEqual(stableGroup); expect(f.store.getThread('approval-thread')).toEqual(stableThread);
  });

  it('AP actual IPC retains same-thread approval failure while a historical group is selected', async () => {
    const f = await setup(true), context = await f.start(), { owner } = f.bind();
    const sent: Array<{ channel: string; data: { envelope: MultiAgentEnvelope } }> = [];
    const mainFrame = {}, sender = Object.assign(new EventEmitter(), { id: 17, mainFrame, isDestroyed: () => false,
      send: (channel: string, data: { envelope: MultiAgentEnvelope }) => { sent.push({ channel, data }); } });
    const event: MultiAgentIpcEvent = { sender, senderFrame: mainFrame };
    const handlers = new Map<string, (event: MultiAgentIpcEvent, input: unknown) => unknown>();
    cleanup.push(registerDesktopMultiAgentIpc({ handle: (name, handler) => { handlers.set(name, handler); } },
      { service: f.service, ready: Promise.resolve(), profileId: 'approval-profile', workspaceId: 'approval-workspace', cwd: f.root },
      { authorize: candidate => candidate.sender === sender && candidate.senderFrame === mainFrame ? { actorId: 'approval-user' } : null }));
    await handlers.get('desktop:subscribeMultiAgents')!(event, { threadId: 'approval-thread', groupId: f.historyId,
      subscriptionId: 'history-viewer', afterSeq: 0 });
    f.port.freezeApprovalPersistence(owner, context.groupId);
    const failure = sent.filter(item => item.data.envelope.channel === 'runtime_error');
    expect(failure).toContainEqual({ channel: 'desktop:multiAgentEvent', data: expect.objectContaining({
      subscriptionId: 'history-viewer', envelope: { channel: 'runtime_error', groupId: context.groupId,
        threadId: 'approval-thread', bootId: f.store.bootId, code: 'multi_agent_approval_persistence_failed', approvalPersistenceState: 'unknown' },
    }) });
    await tick();
  });
});
