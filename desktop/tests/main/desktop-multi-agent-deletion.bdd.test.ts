// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService, type DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import type { ManagedAgentSession } from '../../../src/ai/agents/multi-agent-coordinator.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('BDD: thread deletion retains ownership until real work is settled', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); });
  async function setup(options: {
    childRun?: ManagedAgentSession['run']; childDispose?: () => Promise<void>;
    body?: (context: DesktopAgentExecutionContext, service: DesktopMultiAgentService) => Promise<void>;
    beforeDelete?: (threadId: string) => Promise<void>;
    ordinaryRun?: () => Promise<void>;
  } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-ma-delete-')); cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    const path = join(root, 'groups.sqlite'); const store = new DesktopMultiAgentStore(path); cleanup.push(() => store.close());
    const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
    const coordinator = new DesktopExecutionCoordinator();
    const goalStore = new SqliteGoalStore(join(root, 'goals.sqlite')); cleanup.push(() => goalStore.close());
    let goal: DesktopGoalCoordinator;
    const beforeDelete = vi.fn(options.beforeDelete ?? (async threadId => { await goal.stopForThreadDeletion({ threadId, requestSource: 'user' }); }));
    const service = new DesktopMultiAgentService({ store, coordinator, closeGraceMs: 30,
      beforeThreadDeletion: beforeDelete,
      hasUnboundHistory: async threadId => Boolean(await goalStore.load(threadId)) || await snapshots.hasThreadHistory(threadId),
      createSession: async () => ({ run: options.childRun ?? (async () => 'CHILD_RESULT'), suspend: async () => {}, dispose: options.childDispose ?? (async () => {}) }) });
    cleanup.push(() => service.dispose());
    for (const threadId of ['thread', 'other']) service.registerThread({ threadId, profileId: 'profile', workspaceId: 'workspace', cwd: root });
    const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots,
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
      authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker), assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
      decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
      getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
      runner: input => input.executionScope?.kind === 'goal_turn' || store.getRootBinding(input.taskId)
        ? service.runRoot(input, context => options.body?.(context, service) ?? Promise.resolve())
        : coordinator.run(input.signal, options.ordinaryRun ?? (async () => {})),
    });
    await service.initialize(host);
    goal = new DesktopGoalCoordinator({ store: goalStore, instanceId: 'test', multiAgent: service,
      taskHost: { prepareTask: input => service.prepareRoot(host, input.context!.threadId!, input),
        startTask: id => host.startTask(id), cancelTask: (id, reason) => host.cancelTask(id, reason) } });
    cleanup.push(() => goal.disarmAll());
    const access = service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    const deletion = (nonce: string) => { const expectedThreadRevision = store.getThread('thread')!.threadRevision!;
      return { access, requestSource: 'user' as const, operationId: `delete:${expectedThreadRevision}:${nonce}`, expectedThreadRevision, confirmTerminate: true as const }; };
    const start = async (threadId = 'thread') => { const prepared = await service.prepareRoot(host, threadId, { prompt: 'work', materials: [], context: { threadId } }); await host.startTask(prepared.taskId); return prepared.taskId; };
    return { store, service, host, coordinator, access, start, deletion, beforeDelete, path, goal, goalStore, root };
  }

  it('A25 Given an unbound legacy thread without live resources, Then main registers it and exposes the actual initial revision for deletion', async () => {
    const f = await setup();
    const binding = { threadId: 'legacy-empty', profileId: 'profile', workspaceId: 'workspace', cwd: f.root };
    await f.service.registerThreadWithOwnership(binding, 'user');
    expect(f.store.getThread(binding.threadId)).toMatchObject({ threadRevision: 0, deleteState: 'none' });
    await expect(f.service.registerThreadWithOwnership({ ...binding, workspaceId: 'foreign' }, 'user')).rejects.toThrow(/ownership/);
    await expect(f.service.registerThreadWithOwnership({ ...binding, threadId: 'forged' }, 'agent')).rejects.toThrow(/source|permitted/);
    expect(f.store.getThread('forged')).toBeNull();
  });

  it('U7 Given actual core activity before its durable checkpoint, Then snapshot and page expose the current phase without writing an extra checkpoint', async () => {
    const entered = deferred<void>(), release = deferred<void>(); let childId = '', groupId = '';
    const f = await setup({ childRun: async (_message, _signal, activity) => {
      activity!.onActivity({ phase: 'tool', toolName: 'read' }); entered.resolve(); await release.promise; return 'done';
    }, body: async (context, service) => {
      groupId = context.groupId; childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'activity', taskName: 'child', message: 'work' })).targetAgentId!;
      await entered.promise;
    } });
    cleanup.push(() => release.resolve()); await f.start(); await f.host.drain();
    await vi.waitFor(() => expect(f.service.getSnapshot({ access: f.access }).agents.find(agent => agent.id === childId)).toMatchObject({ phase: 'tool', currentTool: 'read' }));
    expect(f.service.readAgents({ access: f.access, groupId }).items.find(agent => agent.id === childId)).toMatchObject({ phase: 'tool', currentTool: 'read' });
    expect(f.store.getAgent(groupId, childId)?.phase).not.toBe('tool');
    release.resolve();
  });

  it('A25 Given a live unbound legacy task with no workspace proof, Then main refuses to adopt or cancel it under the current workspace', async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const f = await setup({ ordinaryRun: async () => { entered.resolve(); await release.promise; } });
    const task = await f.host.createTask({ prompt: 'old workspace task', materials: [], context: { threadId: 'legacy-live' } });
    await entered.promise;
    await expect(f.service.registerThreadWithOwnership({ threadId: 'legacy-live', profileId: 'profile', workspaceId: 'workspace', cwd: f.root }, 'user')).rejects.toThrow(/owner.*unknown/);
    expect(f.store.getThread('legacy-live')).toBeNull(); expect((await f.host.inspectTask(task.taskId))?.status).not.toBe('cancelled');
    release.resolve(); await f.host.drain();
  });

  it('A25 Given an unbound paused or armed legacy Goal, Then lazy registration is denied without changing Goal state', async () => {
    const f = await setup();
    const legacy = new DesktopGoalCoordinator({ store: f.goalStore, instanceId: 'old', taskHost: f.host }); cleanup.push(() => legacy.disarmAll());
    await legacy.createGoal({ threadId: 'legacy-goal', objective: 'work', expectedEvidenceKinds: ['answer'] });
    const before = await f.goalStore.load('legacy-goal');
    await expect(f.service.registerThreadWithOwnership({ threadId: 'legacy-goal', profileId: 'profile', workspaceId: 'workspace', cwd: f.root }, 'user')).rejects.toThrow(/owner.*unknown/);
    expect(f.store.getThread('legacy-goal')).toBeNull(); expect(await f.goalStore.load('legacy-goal')).toEqual(before);
    await legacy.cancelGoal({ threadId: 'legacy-goal' });
    await expect(f.service.registerThreadWithOwnership({ threadId: 'legacy-goal', profileId: 'profile', workspaceId: 'workspace', cwd: f.root }, 'user')).rejects.toThrow(/owner.*unknown/);
    expect(f.store.getThread('legacy-goal')).toBeNull();
  });

  it('A25 Given an unbound terminal host snapshot, Then another workspace cannot claim it merely because active refs are empty', async () => {
    const f = await setup();
    const task = await f.host.createTask({ prompt: 'legacy history', materials: [], context: { threadId: 'legacy-settled' } }); await f.host.drain();
    expect((await f.host.inspectTask(task.taskId))?.status).toBe('completed'); expect(await f.host.getActiveTasks()).toEqual([]);
    await expect(f.service.registerThreadWithOwnership({ threadId: 'legacy-settled', profileId: 'profile', workspaceId: 'foreign', cwd: f.root }, 'user')).rejects.toThrow(/owner.*unknown/);
    expect(f.store.getThread('legacy-settled')).toBeNull();
  });

  it('A25 Given a real Goal awaiting attachment, Then deletion cancels it durably and all Goal start siblings reject without a new mutation', async () => {
    const f = await setup();
    const created = await f.goal.createGoal({ threadId: 'thread', objective: 'work', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
    expect(f.goal.getPendingAttachmentForTest('thread')).not.toBeNull();
    await expect(f.goal.stopForThreadDeletion({ threadId: 'thread', requestSource: 'agent' })).rejects.toThrow(/source|permitted/);
    expect((await f.goal.getGoal('thread'))?.state.status).toBe('active');
    const first = await f.service.deleteThread(f.deletion('goal-delete'));
    if (first.state !== 'completed') {
      await f.host.drain();
      expect(await f.service.deleteThread(f.deletion('goal-after-drain'))).toMatchObject({ state: 'completed' });
    }
    expect(await f.goal.getGoal('thread')).toMatchObject({ state: { status: 'cancelled' }, activation: 'disarmed' });
    expect(f.goal.getPendingAttachmentForTest('thread')).toBeNull();
    const before = await f.goalStore.load('thread');
    await expect(f.goal.createGoal({ threadId: 'thread', objective: 'new', expectedEvidenceKinds: ['answer'] })).rejects.toThrow(/delet/);
    await expect(f.goal.replaceGoal({ threadId: 'thread', objective: 'new', expectedEvidenceKinds: ['answer'] })).rejects.toThrow(/delet/);
    await expect(f.goal.resumeGoal({ threadId: 'thread' })).rejects.toThrow(/delet/);
    await expect(f.goal.admitUserTask({ prompt: 'new', materials: [], context: { threadId: 'thread' } })).rejects.toThrow(/delet/);
    await expect(f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: created.preparedTask.attachmentId })).rejects.toThrow(/delet/);
    expect(await f.goalStore.load('thread')).toEqual(before);
  });

  it('A25 Given a group read throws after deletion is admitted, Then the attempt becomes unknown and a fresh explicit retry is not held by a leaked owner', async () => {
    const f = await setup({ beforeDelete: async () => {}, body: async (context, service) => {
      await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' });
    } });
    await f.start(); await f.host.drain();
    const groupId = f.store.activeGroup('thread')!.groupId;
    await vi.waitFor(() => expect(f.store.allAgents(groupId).find(agent => agent.depth === 1)?.executionActive).toBe(false));
    const requireGroup = f.store.requireGroup.bind(f.store);
    let failed = false;
    const fault = vi.spyOn(f.store, 'requireGroup').mockImplementation(id => {
      if (!failed && f.store.getThread('thread')?.deleteState === 'delete_pending') {
        failed = true; throw new Error('delete_group_read_fault');
      }
      return requireGroup(id);
    });
    await expect(f.service.deleteThread(f.deletion('audit-failure'))).resolves.toMatchObject({ state: 'unknown' });
    fault.mockImplementation(requireGroup);
    const retry = await f.service.deleteThread(f.deletion('audit-retry'));
    if (retry.state !== 'completed') {
      await vi.waitFor(() => expect(f.service.runtimeStatus().residentSlots).toBe(0));
      expect(await f.service.deleteThread(f.deletion('after-drain'))).toMatchObject({ state: 'completed' });
    }
  });

  it('A25 Given a settled group, Then deleting it removes its history atomically but keeps an owner tombstone and exact-operation receipt', async () => {
    const fixture = await setup(); await fixture.start(); await fixture.host.drain();
    const groupId = fixture.store.activeGroup('thread')!.groupId;
    const request = fixture.deletion('delete-once');
    expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'completed', operationId: request.operationId });
    expect(fixture.store.getGroup(groupId)).toBeNull();
    expect(fixture.store.getThread('thread')).toMatchObject({ deleteState: 'deleted', activeGroupId: null, profileId: 'profile', workspaceId: 'workspace' });
    expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'completed' });
    expect(fixture.beforeDelete).toHaveBeenCalledTimes(1);
    expect(fixture.service.readThreadDeletion({ access: fixture.access })).toMatchObject({ deleteState: 'deleted', operation: { operationId: request.operationId, state: 'completed' } });
    fixture.service.registerThread({ threadId: 'thread', profileId: 'profile', workspaceId: 'workspace', cwd: fixture.store.getThread('thread')!.cwd });
    await expect(fixture.start()).rejects.toThrow(/delet/);
    expect(() => fixture.store.createGroup('thread')).toThrow(/delet/);
    expect(fixture.store.getThread('other')?.deleteState).not.toBe('deleted');
  });

  it('A25 Given an empty thread, Then unauthorized, unconfirmed and stale deletion cannot mutate its binding', async () => {
    const fixture = await setup(); const request = fixture.deletion('delete');
    await expect(fixture.service.deleteThread({ ...request, requestSource: 'agent' })).rejects.toThrow(/source|permitted/);
    await expect(fixture.service.deleteThread({ ...request, requestSource: 'scheduler' })).rejects.toThrow(/source|permitted/);
    await expect(fixture.service.deleteThread({ ...request, access: Object.freeze({ accessId: fixture.access.accessId }) })).rejects.toThrow(/authority/);
    await expect(fixture.service.deleteThread({ ...request, confirmTerminate: false as never })).rejects.toThrow(/confirm/);
    await expect(fixture.service.deleteThread({ ...request, expectedThreadRevision: 99 })).rejects.toThrow(/revision|stale/);
    expect(fixture.store.getThread('thread')?.deleteState).not.toBe('deleted'); expect(fixture.beforeDelete).not.toHaveBeenCalled();
    expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'completed' });
  });

  it('A25 Given a host preparation still pending after its cancellation ACK, Then deletion waits for the real preparation to settle', async () => {
    const entered = deferred<void>(), release = deferred<void>(), f = await setup();
    const prepare = f.host.prepareTask.bind(f.host);
    vi.spyOn(f.host, 'prepareTask').mockImplementation(async (...args) => { const result = await prepare(...args); entered.resolve(); await release.promise; return result; });
    const preparing = f.service.prepareRoot(f.host, 'thread', { prompt: 'work', materials: [], context: { threadId: 'thread' } });
    const settled = preparing.then(() => 'unexpected-success', error => String(error));
    await entered.promise;
    expect(await f.service.deleteThread(f.deletion('during-prepare'))).toMatchObject({ state: 'cleanup_pending' });
    expect(f.store.activeGroup('thread')).not.toBeNull();
    release.resolve(); expect(await settled).toMatch(/delet|cancel/);
    expect(await f.service.deleteThread(f.deletion('after-prepare'))).toMatchObject({ state: 'completed' });
  });

  it('A25 Given an in-flight task with unknown thread attribution, Then deletion cannot treat it as proven unrelated', async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const f = await setup({ ordinaryRun: async () => { entered.resolve(); await release.promise; } });
    await f.host.createTask({ prompt: 'unattributed work', materials: [] }); await entered.promise;
    expect(await f.service.deleteThread(f.deletion('unknown-host'))).toMatchObject({ state: 'cleanup_pending' });
    expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
    release.resolve(); await f.host.drain(); expect(await f.service.deleteThread(f.deletion('known-drained'))).toMatchObject({ state: 'completed' });
  });

  it('A25 Given an in-flight Goal stop obligation after bounded ACK, Then dispose cannot report the boot owner as quiesced', async () => {
    const release = deferred<void>(), f = await setup({ beforeDelete: () => release.promise });
    expect(await f.service.deleteThread(f.deletion('stop-pending'))).toMatchObject({ state: 'cleanup_pending' });
    const quiesce = vi.spyOn(f.store, 'settleBootOwnership');
    await f.service.dispose(); expect(quiesce).not.toHaveBeenCalled(); expect(f.service.runtimeStatus().blocked).toBe(true);
    release.resolve();
  });

  it('A25 Given cancellation of a prepared host task fails, Then the deletion is unknown and a new explicit operation can retry the failed cancellation', async () => {
    const f = await setup();
    const task = await f.host.prepareTask({ prompt: 'prepared', materials: [], context: { threadId: 'thread' } });
    const cancel = vi.spyOn(f.host, 'cancelTask').mockRejectedValueOnce(new Error('cancel_write_failed'));
    expect(await f.service.deleteThread(f.deletion('cancel-fails'))).toMatchObject({ state: 'unknown' });
    expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending'); expect(await f.host.getActiveTasks()).toContainEqual({ taskId: task.taskId });
    expect(await f.service.deleteThread(f.deletion('cancel-retry'))).toMatchObject({ state: 'completed' });
    expect(cancel).toHaveBeenCalledTimes(2); expect((await f.host.inspectTask(task.taskId))?.status).toBe('cancelled');
  });

  it.each(['getActiveTasks', 'inspectTask'] as const)('A25 Given a persistently slow %s scan, Then bounded attempts retain one scan and a later explicit attempt can finish without rereading it', async method => {
    const f = await setup(), entered = deferred<void>(), release = deferred<void>();
    const cancelEntered = deferred<void>(), cancelRelease = deferred<void>();
    const task = await f.host.prepareTask({ prompt: 'prepared', materials: [], context: { threadId: 'thread' } });
    const original = f.host[method].bind(f.host);
    const scan = vi.spyOn(f.host, method).mockImplementation((async (...args: unknown[]) => { entered.resolve(); await release.promise; return (original as (...input: unknown[]) => Promise<unknown>)(...args); }) as never);
    const active = method === 'getActiveTasks' ? scan : vi.spyOn(f.host, 'getActiveTasks');
    const inspect = method === 'inspectTask' ? scan : vi.spyOn(f.host, 'inspectTask');
    const originalCancel = f.host.cancelTask.bind(f.host);
    const cancel = vi.spyOn(f.host, 'cancelTask').mockImplementation(async (...args) => {
      cancelEntered.resolve(); await cancelRelease.promise; return originalCancel(...args);
    });
    const owners = f.service as unknown as {
      deletionScans: Map<string, { promise: Promise<unknown>; facts?: unknown }>;
      deletionStops: Map<string, { tasks: Map<string, { promise: Promise<void>; state: string }> }>;
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let receipt: { state: string } | undefined;
    const pending = f.service.deleteThread(f.deletion('slow-scan')).then(result => { receipt = result; });
    try {
      await entered.promise;
      const owner = owners.deletionScans.get('thread')!; expect(owner).toBeDefined();
      await vi.advanceTimersByTimeAsync(31); await pending;
      expect(receipt?.state).toBe('cleanup_pending');
      expect(await f.service.deleteThread(f.deletion('same-scan'))).toMatchObject({ state: 'cleanup_pending' });
      expect(scan).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
      expect(f.beforeDelete).toHaveBeenCalledTimes(1);
      expect(owners.deletionScans.get('thread')).toBe(owner);
      // getActiveTasks itself inspects each active task; collect then performs
      // its own attribution read. Await the whole owner, not the first spy result.
      release.resolve(); await owner.promise; expect(owner.facts).toBeDefined();
      expect(cancel).not.toHaveBeenCalled(); expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
      expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2);
      const cancellation = f.service.deleteThread(f.deletion('start-physical-cancellation'));
      await cancelEntered.promise; await vi.advanceTimersByTimeAsync(31);
      expect(await cancellation).toMatchObject({ state: 'cleanup_pending' });
      const stop = owners.deletionStops.get('thread')!.tasks.get(task.taskId)!;
      cancelRelease.resolve(); await stop.promise; expect(stop.state).toBe('confirmed');
      expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
      expect(owners.deletionScans.get('thread')).toBe(owner);
      expect(await f.service.deleteThread(f.deletion('consume-scan'))).toMatchObject({ state: 'completed' });
      expect(active).toHaveBeenCalledTimes(1); expect(inspect).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledTimes(1);
      expect(f.beforeDelete).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve(); cancelRelease.resolve(); await vi.advanceTimersByTimeAsync(31); await pending;
      await owners.deletionScans.get('thread')?.promise.catch(() => {});
      await owners.deletionStops.get('thread')?.tasks.get(task.taskId)?.promise;
      vi.useRealTimers();
    }
  });

  it('A25 Given a scan still owns host IO after its bounded response, Then dispose cannot quiesce and its late completion cannot purge history', async () => {
    const f = await setup(), release = deferred<void>(), original = f.host.getActiveTasks.bind(f.host);
    const scan = vi.spyOn(f.host, 'getActiveTasks').mockImplementation(async () => { await release.promise; return original(); });
    const quiesce = vi.spyOn(f.store, 'settleBootOwnership'); let receipt: { state: string } | undefined;
    const pending = f.service.deleteThread(f.deletion('owned-scan')).then(result => { receipt = result; });
    try {
      await vi.waitFor(() => expect(receipt?.state).toBe('cleanup_pending'));
      await f.service.dispose(); expect(quiesce).not.toHaveBeenCalled(); expect(f.service.runtimeStatus().blocked).toBe(true);
      release.resolve(); await scan.mock.results[0].value; await Promise.resolve();
      expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending'); expect(quiesce).not.toHaveBeenCalled();
    } finally { release.resolve(); await pending; }
  });

  it('A25 Given prepared cancellation is still pending, Then no execution-map entry is not proof of cancellation and retries do not duplicate it', async () => {
    const f = await setup(), release = deferred<void>(); cleanup.push(() => release.resolve());
    const task = await f.host.prepareTask({ prompt: 'prepared', materials: [], context: { threadId: 'thread' } });
    const original = f.host.cancelTask.bind(f.host);
    const cancel = vi.spyOn(f.host, 'cancelTask').mockImplementation(async (...args) => { await release.promise; return original(...args); });
    const request = f.deletion('prepared-pending');
    expect(await f.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
    expect(await f.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
    expect(await f.service.deleteThread(f.deletion('prepared-still-pending'))).toMatchObject({ state: 'cleanup_pending' });
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
    release.resolve(); await vi.waitFor(async () => expect((await f.host.inspectTask(task.taskId))?.status).toBe('cancelled'));
    expect(await f.service.deleteThread(f.deletion('prepared-confirmed'))).toMatchObject({ state: 'completed' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('A25 Given a serial scan owns a pending inspect, Then dispose cannot start the next inspect or forget the pending owner', async () => {
    const f = await setup(), release = deferred<void>();
    const tasks: Array<Awaited<ReturnType<typeof f.host.prepareTask>>> = [];
    for (const name of ['A', 'B', 'C']) tasks.push(await f.host.prepareTask({ prompt: name, materials: [], context: { threadId: 'thread' } }));
    const active = vi.spyOn(f.host, 'getActiveTasks').mockResolvedValue(tasks.map(task => ({ taskId: task.taskId })));
    const inspect = f.host.inspectTask.bind(f.host);
    const scan = vi.spyOn(f.host, 'inspectTask').mockImplementation(async id => { if (id === tasks[1].taskId) await release.promise; return inspect(id); });
    const cancel = vi.spyOn(f.host, 'cancelTask'), quiesce = vi.spyOn(f.store, 'settleBootOwnership');
    let receipt: { state: string } | undefined;
    const pending = f.service.deleteThread(f.deletion('serial-scan')).then(result => { receipt = result; });
    try {
      await vi.waitFor(() => expect(receipt?.state).toBe('cleanup_pending'));
      expect(await f.service.deleteThread(f.deletion('serial-still-pending'))).toMatchObject({ state: 'cleanup_pending' });
      expect(active).toHaveBeenCalledTimes(1); expect(scan.mock.calls.map(([id]) => id)).toEqual(tasks.slice(0, 2).map(task => task.taskId));
      expect(cancel).not.toHaveBeenCalled();
      await f.service.dispose(); expect(quiesce).not.toHaveBeenCalled();
      release.resolve(); await scan.mock.results[1].value; await Promise.resolve();
      expect(scan).toHaveBeenCalledTimes(2); expect(cancel).not.toHaveBeenCalled();
      expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
    } finally { release.resolve(); await pending; }
  });

  it('A25 Given a real inspect rejects, Then no sibling scan or cancellation starts and a new explicit attempt rescans instead of caching empty success', async () => {
    const f = await setup();
    const a = await f.host.prepareTask({ prompt: 'A', materials: [], context: { threadId: 'thread' } });
    const b = await f.host.prepareTask({ prompt: 'B', materials: [], context: { threadId: 'thread' } });
    const active = vi.spyOn(f.host, 'getActiveTasks').mockResolvedValue([{ taskId: a.taskId }, { taskId: b.taskId }]);
    const scan = vi.spyOn(f.host, 'inspectTask').mockRejectedValueOnce(new Error('snapshot_read_failed'));
    const cancel = vi.spyOn(f.host, 'cancelTask');
    expect(await f.service.deleteThread(f.deletion('scan-rejected'))).toMatchObject({ state: 'unknown' });
    expect(scan).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled();
    expect(f.store.getThread('thread')?.deleteState).toBe('delete_pending');
    expect(await f.service.deleteThread(f.deletion('scan-retry'))).toMatchObject({ state: 'completed' });
    expect(active).toHaveBeenCalledTimes(2); expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('A25 Given a task really ran and physically exited, Then its late host audit acknowledgement does not block thread reclamation', async () => {
    const entered = deferred<void>(), exit = deferred<void>(), acknowledged = deferred<void>(), cancelled = deferred<void>();
    const f = await setup({ ordinaryRun: async () => { entered.resolve(); await exit.promise; } });
    cleanup.push(() => { acknowledged.resolve(); exit.resolve(); });
    const task = await f.host.createTask({ prompt: 'running', materials: [], context: { threadId: 'thread' } }); await entered.promise;
    const original = f.host.cancelTask.bind(f.host);
    vi.spyOn(f.host, 'cancelTask').mockImplementation(async (...args) => { await original(...args); cancelled.resolve(); await acknowledged.promise; });
    const deleting = f.service.deleteThread(f.deletion('late-audit'));
    await cancelled.promise; exit.resolve(); await f.host.drain();
    expect(f.host.inFlightTaskIds()).not.toContain(task.taskId);
    expect(await deleting).toMatchObject({ state: 'completed' });
    expect(await f.host.inspectTask(task.taskId)).not.toBeNull();
    acknowledged.resolve();
  });

  it('A25 Given a child that never settles, Then deleting retains its thread, execution, slot and audit instead of fabricating reclamation', async () => {
    const entered = deferred<void>(); let childId = '', groupId = '';
    const fixture = await setup({ childRun: async () => { entered.resolve(); return new Promise<string>(() => {}); }, body: async (context, service) => {
      groupId = context.groupId;
      childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' })).targetAgentId!;
      await entered.promise;
    } });
    await fixture.start(); await fixture.host.drain(); const request = fixture.deletion('delete-never');
    expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
    expect(fixture.store.getThread('thread')).toMatchObject({ deleteState: 'delete_pending', activeGroupId: groupId });
    expect(fixture.store.getAgent(groupId, childId)).toMatchObject({ executionActive: true, resourcesReleased: false, cleanupPending: true });
    expect(fixture.service.getSnapshot({ access: fixture.access })).toMatchObject({ threadDeleteState: 'delete_pending' });
    expect(fixture.service.getSnapshot({ access: fixture.access }).agents.every(agent => !agent.resumable)).toBe(true);
    expect(fixture.service.readAgents({ access: fixture.access, groupId }).items.every(agent => !agent.resumable)).toBe(true);
    expect(fixture.service.runtimeStatus().residentSlots).toBe(1);
    expect(fixture.store.getOperation(groupId, 'spawn')).not.toBeNull();
    expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
    expect(fixture.beforeDelete).toHaveBeenCalledTimes(1);
    await expect(fixture.start()).rejects.toThrow(/delet|blocked/);
  });

  it('A25 Given dispose is pending, Then a later physical release requires an explicit fresh retry before history is removed', async () => {
    const entered = deferred<void>(), release = deferred<void>(); let groupId = '', childId = '';
    const fixture = await setup({ childRun: async () => { entered.resolve(); return 'done'; }, childDispose: () => release.promise,
      body: async (context, service) => { groupId = context.groupId; childId = (await service.spawn({ actor: context.actor, requestSource: 'agent', operationId: 'spawn', taskName: 'child', message: 'work' })).targetAgentId!; await entered.promise; } });
    try {
      await fixture.start(); await fixture.host.drain();
      await vi.waitFor(() => expect(fixture.store.getAgent(groupId, childId)?.executionActive).toBe(false));
      const original = fixture.deletion('delete-pending');
      expect(await fixture.service.deleteThread(original)).toMatchObject({ state: 'cleanup_pending' });
      expect(fixture.store.getThread('thread')?.deleteState).toBe('delete_pending');
      release.resolve(); await vi.waitFor(() => expect(fixture.store.getAgent(groupId, childId)?.resourcesReleased).toBe(true));
      expect(fixture.store.getGroup(groupId)).not.toBeNull();
      expect(await fixture.service.deleteThread(original)).toMatchObject({ state: 'cleanup_pending' });
      expect(await fixture.service.deleteThread(fixture.deletion('delete-retry'))).toMatchObject({ state: 'completed' });
      expect(fixture.store.getGroup(groupId)).toBeNull();
      await expect(fixture.service.deleteThread(original)).rejects.toThrow(/revision|stale/);
    } finally { release.resolve(); }
  });

  it('A25 Given main cancellation coordination has not acknowledged, Then even an empty thread stays pending and duplicate requests do not restart that coordination', async () => {
    const release = deferred<void>(), entered = deferred<void>();
    const fixture = await setup({ beforeDelete: async () => { entered.resolve(); await release.promise; } });
    try {
      const request = fixture.deletion('delete-waiting'); const attempt = fixture.service.deleteThread(request); await entered.promise;
      expect(fixture.store.getThread('thread')?.deleteState).toBe('delete_pending');
      expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
      expect(fixture.beforeDelete).toHaveBeenCalledTimes(1);
      release.resolve(); expect(await attempt).toMatchObject({ state: 'completed' });
    } finally { release.resolve(); }
  });

  it('A25 Given A has been replaced by B, Then the forgotten A cannot be replayed with the latest revision', async () => {
    const release = deferred<void>(); const fixture = await setup({ beforeDelete: () => release.promise });
    try {
      const first = fixture.deletion('first'); expect(await fixture.service.deleteThread(first)).toMatchObject({ state: 'cleanup_pending' });
      expect(await fixture.service.deleteThread(fixture.deletion('second'))).toMatchObject({ state: 'cleanup_pending' });
      const state = fixture.service.readThreadDeletion({ access: fixture.access });
      await expect(fixture.service.deleteThread({ ...first, expectedThreadRevision: state.threadRevision })).rejects.toThrow(/revision|identifier/);
      expect(fixture.service.readThreadDeletion({ access: fixture.access })).toEqual(state);
      expect(fixture.beforeDelete).toHaveBeenCalledTimes(1);
    } finally { release.resolve(); }
  });

  it('A25 Given SQLite rejects a history delete, Then rollback preserves all tables, unknown is never replayed, and a new explicit retry may finish', async () => {
    const fixture = await setup(); await fixture.start(); await fixture.host.drain();
    const groupId = fixture.store.activeGroup('thread')!.groupId, rootId = `root_${groupId}`;
    fixture.store.sendMessage(groupId, { sender: { kind: 'user', actorId: 'user' }, receiverId: rootId, text: 'must survive rollback' });
    const beforeEvents = fixture.store.readEvents(groupId, 0, 100); const request = fixture.deletion('delete-fails');
    const fault = new DatabaseSync(fixture.path);
    try {
      fault.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'injected delete failure'); END");
      expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'unknown' });
      expect(fixture.store.getGroup(groupId)).not.toBeNull(); expect(fixture.store.getAgent(groupId, rootId)).not.toBeNull();
      expect(fixture.store.listMessages(groupId, rootId)).toHaveLength(1);
      expect(fixture.store.readEvents(groupId, 0, 100)).toEqual(beforeEvents);
      fault.exec('DROP TRIGGER reject_delete');
      expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'unknown' });
      expect(fixture.store.getGroup(groupId)).not.toBeNull();
      expect(await fixture.service.deleteThread(fixture.deletion('retry-delete'))).toMatchObject({ state: 'completed' });
      expect(fixture.store.getGroup(groupId)).toBeNull();
    } finally { fault.close(); }
  });

  it('A25 Given an ordinary host task is logically cancelled but physically running, Then it also prevents thread deletion', async () => {
    const entered = deferred<void>(), release = deferred<void>();
    const fixture = await setup({ ordinaryRun: async () => { entered.resolve(); await release.promise; } });
    try {
      const task = await fixture.host.createTask({ prompt: 'ordinary', materials: [], context: { threadId: 'thread' } }); await entered.promise;
      const request = fixture.deletion('delete-ordinary');
      expect(await fixture.service.deleteThread(request)).toMatchObject({ state: 'cleanup_pending' });
      expect((await fixture.host.inspectTask(task.taskId))?.status).toBe('cancelled');
      expect(fixture.host.activeExecutionCount()).toBe(1); expect(fixture.store.getThread('thread')?.deleteState).toBe('delete_pending');
      release.resolve(); await fixture.host.drain();
      expect(await fixture.service.deleteThread(fixture.deletion('delete-ordinary-retry'))).toMatchObject({ state: 'completed' });
    } finally { release.resolve(); await fixture.host.drain(); }
  });
});
