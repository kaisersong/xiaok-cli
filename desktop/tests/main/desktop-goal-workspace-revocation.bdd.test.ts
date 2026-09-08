// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DesktopGoalCoordinator, type PreparedGoalTask } from '../../electron/desktop-goal-coordinator.js';
import { DesktopMultiAgentService, type DesktopHostDeliveryAuthority } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { TaskCreateInput } from '../../../src/runtime/task-host/types.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

const compiled = vi.hoisted(() => ({ output: '', root: '' }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      if (String(filename) === source && !compiled.output) throw new Error('compiled fixed Worker is not ready');
      super(String(filename) === source ? compiled.output : filename, options);
    }
  } };
});
beforeAll(async () => { Object.assign(compiled, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => { if (compiled.root) rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }); });

type WorkspaceGoal = DesktopGoalCoordinator & {
  stopForWorkspaceExecutionRevocation(input: { requestSource: 'user' | 'agent' | 'scheduler' }): Promise<void>;
};
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function observe<T>(promise: Promise<T>) {
  return promise.then(value => ({ value }), error => ({ error: error as unknown }));
}

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-workspace-revoke-'));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const goals = new SqliteGoalStore(join(root, 'goals.sqlite'));
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const stops: Promise<void>[] = [], releases: Array<() => void> = [];
  const consumers = new Set<Promise<void>>(), terminals = new Map<string, ReturnType<typeof deferred<void>>>();
  const terminal = (id: string) => {
    let receipt = terminals.get(id);
    if (!receipt) { receipt = deferred(); terminals.set(id, receipt); }
    return receipt;
  };
  const preparedEvents: PreparedGoalTask[] = [];
  let goal!: DesktopGoalCoordinator, authority: DesktopHostDeliveryAuthority | undefined;
  let afterPrepare: ((input: TaskCreateInput, result: { taskId: string }) => Promise<void>) | undefined;
  let beforeThread: ((threadId: string) => Promise<void>) | undefined;
  let runCount = 0;
  const service = new DesktopMultiAgentService({
    store, coordinator: new DesktopExecutionCoordinator(),
    executionDomain: { profileId: 'profile', workspaceId: 'workspace', cwd: root, actorId: 'user' },
    createSession: async () => { throw new Error('this Goal fixture must not spawn children'); },
    stopForWorkspaceExecutionRevocation: () => {
      // Fixed main user closure, never a JSON authority or a test reimplementation.
      const stopping = (goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation({ requestSource: 'user' });
      stops.push(stopping); return stopping;
    },
  });
  for (const threadId of ['thread', 'other']) service.registerThread({ threadId, profileId: 'profile', workspaceId: 'workspace', cwd: root });
  const host = new InProcessTaskRuntimeHost({
    snapshotStore: snapshots,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker),
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
    getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
    onDeliveryReport: report => {
      if (!authority) throw new Error('real delivery owner has not been bound');
      return service.recordHostDelivery({ requestSource: 'scheduler', authority, report });
    },
    onPersistedEvent: input => {
      const consumed = goal.handlePersistedTaskEvent(input).finally(() => {
        if (input.event.type === 'task_terminal') terminal(input.taskId).resolve();
      });
      consumers.add(consumed);
      void consumed.then(() => consumers.delete(consumed), () => consumers.delete(consumed));
      return consumed;
    },
    runner: input => service.runRoot(input, async context => {
      runCount++;
      await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId,
        turnId: context.turnId, intentId: 'answer', stepId: 'answer', delta: 'VERIFIABLE_GOAL_ANSWER' });
    }),
  });
  const ready = service.initialize(host); authority = service.bindHostDeliveryOwner(host); await ready;
  const taskHost = {
    prepareTask: vi.fn(async (input: TaskCreateInput) => {
      const result = await service.prepareRoot(host, input.context?.threadId ?? 'thread', input);
      await afterPrepare?.(input, result);
      return result;
    }),
    startTask: vi.fn((id: string) => host.startTask(id)),
    cancelTask: vi.fn((id: string, reason?: string) => host.cancelTask(id, reason)),
  };
  goal = new DesktopGoalCoordinator({ store: goals, taskHost, instanceId: 'goal-revoke-test', multiAgent: service,
    prepareThread: thread => beforeThread?.(thread) ?? Promise.resolve(),
    publishGoalTaskPrepared: value => preparedEvents.push(value),
  });
  const access = service.createWorkspaceUserAccess({ requestSource: 'user', actorId: 'user', profileId: 'profile', workspaceId: 'workspace' });
  let nonce = 0;
  async function setAllowed(executionAllowed: boolean) {
    const current = service.getExecutionAuthorization();
    return service.setExecutionAuthorization({ access, requestSource: 'user', confirm: true, executionAllowed,
      expectedPermissionRevision: current.permissionRevision,
      operationId: `exec-auth:${current.bootId}:${current.permissionRevision}:goal${++nonce}` });
  }
  function barrier() {
    const entered = deferred(), release = deferred(); releases.push(() => release.resolve());
    return { entered: entered.promise, release: () => release.resolve(), hold: async () => { entered.resolve(); await release.promise; } };
  }
  async function seed(status: 'paused' | 'blocked' | 'complete' | 'cancelled') {
    const real = new GoalService({ store: goals, ownership: { assertOwned: () => undefined } });
    const context = { sessionId: 'thread', instanceId: 'seed', requestSource: 'user' as const, expectedRevision: null };
    const state = await real.create(context, { objective: 'existing durable Goal', expectedEvidenceKinds: ['answer'], turnLimit: 4 });
    const current = { ...context, expectedRevision: state.revision };
    if (status === 'paused') return real.pause(current, 'user_paused');
    if (status === 'complete') return real.complete(current, 'already_done');
    if (status === 'cancelled') return real.cancel(current, 'user_cancelled');
    return real.settleTurn({ ...current, requestSource: 'runtime' }, { turnId: 'seed-turn', tokensUsed: 0,
      activeWallClockMs: 0, terminalDecision: { kind: 'blocked', reason: 'existing_blocker' } });
  }
  cleanup.push(async () => {
    for (const release of releases) release();
    goal.disarmAll(); host.abortAllActive();
    await host.drain(); await Promise.allSettled(stops); await service.dispose();
    await new Promise<void>(resolve => setImmediate(resolve));
    await Promise.allSettled([...consumers]);
    goals.close(); store.close(); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return { root, store, goals, snapshots, goal, service, host, taskHost, preparedEvents, stops, barrier, seed,
    setAllowed, terminal: (id: string) => terminal(id).promise, runs: () => runCount,
    onPrepared: (fn: typeof afterPrepare) => { afterPrepare = fn; },
    onThread: (fn: typeof beforeThread) => { beforeThread = fn; },
    create: (threadId = 'thread') => goal.createGoal({ threadId, objective: 'verified answer', expectedEvidenceKinds: ['answer'], turnLimit: 4 }),
  };
}

describe('W8: real Goal execution revision survives asynchronous boundaries', () => {
  it.each([false, true])('actual prepared root returning after revoke (regrant=%s) cannot publish or bind an old attachment', async regrant => {
    const f = await fixture(), held = f.barrier(); let taskId = '';
    f.onPrepared(async (_input, result) => { taskId = result.taskId; await held.hold(); });
    const creating = observe(f.create()); await held.entered;
    expect(f.store.getRootBinding(taskId)?.phase).toBe('queued');
    expect((await f.host.inspectTask(taskId))?.multiAgentPreparation).toBeDefined();
    await f.setAllowed(false); if (regrant) await f.setAllowed(true);
    held.release(); const result = await creating; await Promise.allSettled(f.stops);
    expect(f.preparedEvents, 'old actual prepare result must not become startable').toEqual([]);
    expect(result).toHaveProperty('error');
    expect(f.goals.getTaskBinding(taskId)).toBeNull();
    expect(f.taskHost.startTask).not.toHaveBeenCalled();
    expect(f.taskHost.cancelTask).toHaveBeenCalledWith(taskId, 'permission_revoked');
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'paused', terminalReason: 'permission_revoked' } });
  });

  it('a real revoke queued immediately after the prepared-result check must not cross a new success-only await before binding', async () => {
    const f = await fixture(); let taskId = '', revoke: ReturnType<typeof f.setAllowed> | undefined;
    f.onPrepared(async (_input, prepared) => { taskId = prepared.taskId; });
    const check = f.service.assertExecutionAdmission.bind(f.service);
    vi.spyOn(f.service, 'assertExecutionAdmission').mockImplementation((thread, revision) => {
      const allowed = check(thread, revision);
      if (taskId && !revoke && f.store.getRootBinding(taskId)?.phase === 'queued') revoke = f.setAllowed(false);
      return allowed;
    });
    const created = await observe(f.create());
    expect(revoke).toBeDefined(); await revoke; await Promise.allSettled(f.stops);
    if ('error' in created) {
      // If denial won, no attachment may be newly inserted after the synchronous
      // stop captured its list. A successful pre-fence publish is instead legal.
      expect(f.goal.getPendingAttachmentForTest('thread')).toBeNull();
    }
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed' });
    expect(f.taskHost.startTask).not.toHaveBeenCalled();
  });

  it.each(['create', 'resume', 'replace'] as const)('%s commit returned after revoke→grant cannot re-arm or call prepare', async operation => {
    const f = await fixture(); if (operation !== 'create') await f.seed('paused');
    const held = f.barrier(), commit = f.goals.commit.bind(f.goals); let heldOnce = false;
    vi.spyOn(f.goals, 'commit').mockImplementation(async input => {
      await commit(input);
      if (!heldOnce && input.next.status === 'active') { heldOnce = true; await held.hold(); }
    });
    const result = observe(operation === 'create' ? f.create() : operation === 'resume'
      ? f.goal.resumeGoal({ threadId: 'thread' })
      : f.goal.replaceGoal({ threadId: 'thread', objective: 'replacement', expectedEvidenceKinds: ['answer'], turnLimit: 4 }));
    await held.entered; await f.setAllowed(false); await f.setAllowed(true); held.release();
    const settled = await result; await Promise.allSettled(f.stops);
    expect(f.taskHost.prepareTask, 'a committed Goal mutation is not execution authority').not.toHaveBeenCalled();
    expect(settled).toHaveProperty('error');
    expect(f.preparedEvents).toEqual([]);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'paused' } });
  });

  it.each(['no-goal', 'paused-goal', 'armed-goal'] as const)('%s Chat sibling must not attach/start an actual late prepare after revoke→grant', async mode => {
    const f = await fixture();
    if (mode === 'paused-goal') await f.seed('paused');
    if (mode === 'armed-goal') {
      await f.create();
      await f.goal.setUserQueuePending({ threadId: 'thread', pending: true });
      await f.host.drain();
    }
    const held = f.barrier(); let taskId = '';
    f.onPrepared(async (_input, result) => { taskId = result.taskId; await held.hold(); });
    const result = observe(f.goal.admitUserTask({ prompt: 'new user input', materials: [], context: { threadId: 'thread' } }));
    await held.entered; await f.setAllowed(false); await f.setAllowed(true); held.release();
    await result; await Promise.allSettled(f.stops);
    expect(f.taskHost.startTask, 'host refusal must not substitute the Goal start-boundary check').not.toHaveBeenCalled();
    expect(f.goals.getTaskBinding(taskId)).toBeNull();
    expect(f.goals.listThreadTaskIds('thread')).not.toContain(taskId);
    expect(f.taskHost.cancelTask).toHaveBeenCalledWith(taskId, 'permission_revoked');
    expect(f.runs()).toBe(0);
  });

  it('attachment ACK waiting on real Goal load cannot mark attached or start after revoke→grant', async () => {
    const f = await fixture(), initial = await f.create(), held = f.barrier();
    const load = f.goals.load.bind(f.goals); let once = false;
    vi.spyOn(f.goals, 'load').mockImplementation(async thread => {
      const value = await load(thread); if (!once) { once = true; await held.hold(); } return value;
    });
    const ack = observe(f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId }));
    await held.entered; await f.setAllowed(false); await f.setAllowed(true); held.release();
    expect(await ack).toHaveProperty('error'); await Promise.allSettled(f.stops);
    expect(f.taskHost.startTask).not.toHaveBeenCalled();
    expect(f.goals.getTaskBinding(initial.preparedTask.taskId)?.attachedAt).toBeNull();
    expect(f.goal.getPendingAttachmentForTest('thread')).toBeNull();
  });

  it('calls already queued before revoke keep the pre-queue revision across regrant and prepareThread', async () => {
    const f = await fixture(), held = f.barrier(); let calls = 0;
    f.onThread(async () => { if (++calls === 1) await held.hold(); });
    const first = observe(f.goal.admitUserTask({ prompt: 'first', materials: [], context: { threadId: 'thread' } }));
    await held.entered;
    const queued = observe(f.goal.admitUserTask({ prompt: 'queued-before-revoke', materials: [], context: { threadId: 'thread' } }));
    await f.setAllowed(false); await f.setAllowed(true); held.release();
    await Promise.all([first, queued]); await Promise.allSettled(f.stops); await f.host.drain();
    expect(f.taskHost.prepareTask).not.toHaveBeenCalled();
    expect(await first).toHaveProperty('error'); expect(await queued).toHaveProperty('error');
    expect(f.runs()).toBe(0);
  });

  it('real terminal settlement returning after revoke→grant cannot enqueue automatic continuation', async () => {
    const f = await fixture(), initial = await f.create(), held = f.barrier();
    const commit = f.goals.commit.bind(f.goals); let once = false;
    vi.spyOn(f.goals, 'commit').mockImplementation(async input => {
      await commit(input);
      if (!once && input.turns.length) { once = true; await held.hold(); }
    });
    await f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId });
    await held.entered;
    const terminal = await f.host.inspectTask(initial.preparedTask.taskId);
    expect(terminal?.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    await f.setAllowed(false); await f.setAllowed(true); held.release();
    await f.host.drain(); await f.terminal(initial.preparedTask.taskId); await Promise.allSettled(f.stops);
    expect(f.taskHost.prepareTask, 'settlement may persist but must not mint new execution').toHaveBeenCalledTimes(1);
    expect(f.taskHost.startTask).toHaveBeenCalledTimes(1);
    expect(f.preparedEvents).toHaveLength(1); expect(f.runs()).toBe(1);
    expect((await f.goals.load('thread'))?.turns).toHaveLength(1);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'paused', turnsUsed: 1, terminalReason: 'permission_revoked' } });
  });

  it('an actual automatic continuation already prepared before revoke cannot publish its late attachment after regrant', async () => {
    const f = await fixture(), initial = await f.create(), held = f.barrier(); let continuationTaskId = '';
    f.onPrepared(async (input, result) => {
      expect(input.executionScope?.kind).toBe('goal_turn');
      continuationTaskId = result.taskId; await held.hold();
    });
    await f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId });
    await held.entered;
    expect(f.store.getRootBinding(continuationTaskId)?.phase).toBe('queued');
    expect((await f.goals.load('thread'))?.turns).toHaveLength(1);
    await f.setAllowed(false); await f.setAllowed(true); held.release();
    await f.terminal(initial.preparedTask.taskId); await Promise.allSettled(f.stops);
    expect(f.preparedEvents).toHaveLength(1);
    expect(f.goals.getTaskBinding(continuationTaskId)).toBeNull();
    expect(f.taskHost.cancelTask).toHaveBeenCalledWith(continuationTaskId, 'permission_revoked');
    expect(f.taskHost.startTask).toHaveBeenCalledTimes(1); expect(f.runs()).toBe(1);
    expect(f.taskHost.cancelTask.mock.calls.some(([id]) => id === initial.preparedTask.taskId)).toBe(false);
  });

  it('a real withGoalDecision continuation result already returned retains the revoked activation across its outer await', async () => {
    const f = await fixture(), initial = await f.create(), held = f.barrier();
    const decide = f.service.withGoalDecision.bind(f.service);
    vi.spyOn(f.service, 'withGoalDecision').mockImplementation(async (id, action) => {
      const result = await decide(id, action); await held.hold(); return result;
    });
    await f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId });
    await held.entered;
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'armed', state: { turnsUsed: 1 } });
    await f.setAllowed(false); await f.setAllowed(true); held.release();
    await f.terminal(initial.preparedTask.taskId); await Promise.allSettled(f.stops);
    expect(f.taskHost.prepareTask).toHaveBeenCalledTimes(1); expect(f.preparedEvents).toHaveLength(1);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'paused', turnsUsed: 1 } });
  });

  it('main user stop synchronously disarms and removes the attachment before queued pause persistence settles', async () => {
    const f = await fixture(), initial = await f.create(), held = f.barrier();
    expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation).toBeTypeOf('function');
    const commit = f.goals.commit.bind(f.goals);
    vi.spyOn(f.goals, 'commit').mockImplementation(async input => {
      if (input.next.terminalReason === 'permission_revoked') await held.hold();
      await commit(input);
    });
    const stopping = observe((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation({ requestSource: 'user' }));
    expect(f.goal.getPendingAttachmentForTest('thread')).toBeNull();
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed' });
    await held.entered;
    expect(f.goals.loadGoalById(initial.goal.state.goalId)?.state.status).toBe('active');
    held.release(); expect(await stopping).toHaveProperty('value');
    expect(await f.goal.getGoal('thread')).toMatchObject({ state: { status: 'paused', terminalReason: 'permission_revoked' } });
    expect(f.goals.listGoalIdsForSession('thread')).toEqual([initial.goal.state.goalId]);
  });

  it.each(['agent', 'scheduler'] as const)('%s cannot invoke the main-only Goal stop', async requestSource => {
    const f = await fixture(), initial = await f.create();
    expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation).toBeTypeOf('function');
    await expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation({ requestSource })).rejects.toThrow(/source|permitted/);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'armed', state: { status: 'active' } });
    expect(f.goal.getPendingAttachmentForTest('thread')?.attachmentId).toBe(initial.preparedTask.attachmentId);
    expect(f.taskHost.cancelTask).not.toHaveBeenCalled();
  });

  it.each(['paused', 'blocked', 'complete', 'cancelled'] as const)('already %s durable Goal is preserved without another reducer transition', async status => {
    const f = await fixture(), state = await f.seed(status);
    expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation).toBeTypeOf('function');
    await f.goal.getGoal('thread');
    await (f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation({ requestSource: 'user' });
    expect((await f.goals.load('thread'))?.state).toEqual(state);
    expect(f.taskHost.prepareTask).not.toHaveBeenCalled(); expect(f.taskHost.startTask).not.toHaveBeenCalled();
  });

  it('one actual pause write failure leaves both Goals disarmed and does not stop the other thread queue', async () => {
    const f = await fixture(); await f.create(); await f.create('other');
    expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation).toBeTypeOf('function');
    const commit = f.goals.commit.bind(f.goals);
    vi.spyOn(f.goals, 'commit').mockImplementation(async input => {
      if (input.sessionId === 'thread' && input.next.terminalReason === 'permission_revoked') throw new Error('EIO: actual Goal pause write');
      await commit(input);
    });
    await expect((f.goal as WorkspaceGoal).stopForWorkspaceExecutionRevocation({ requestSource: 'user' })).rejects.toThrow(/EIO/);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'active' } });
    expect(await f.goal.getGoal('other')).toMatchObject({ activation: 'disarmed', state: { status: 'paused', terminalReason: 'permission_revoked' } });
    expect(f.goal.getPendingAttachmentForTest('thread')).toBeNull(); expect(f.goal.getPendingAttachmentForTest('other')).toBeNull();
  });

  it('normal real Goal attachment still runs once and publishes exactly one next attachment', async () => {
    const f = await fixture(), initial = await f.create();
    await f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId });
    await f.host.drain(); await f.terminal(initial.preparedTask.taskId);
    expect(f.runs()).toBe(1); expect(f.taskHost.startTask).toHaveBeenCalledTimes(1);
    expect(f.preparedEvents).toHaveLength(2);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'armed', state: { status: 'active', turnsUsed: 1 } });
    expect(Object.keys(f.preparedEvents[1]!)).toEqual(expect.arrayContaining(['attachmentId', 'threadId', 'taskId', 'executionScope', 'goalRef', 'expiresAt']));
    expect(f.preparedEvents[1]).not.toHaveProperty('permissionRevision');
  });

  it('an independent ordinary host without multiAgent remains outside workspace scope', async () => {
    const f = await fixture(); let runs = 0;
    const ordinaryHost = new InProcessTaskRuntimeHost({ snapshotStore: new FileTaskSnapshotStore(join(f.root, 'ordinary')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(f.root, 'ordinary-materials'), maxBytes: 1024 }),
      runner: async () => { runs++; },
    });
    const ordinary = new DesktopGoalCoordinator({ store: f.goals, taskHost: ordinaryHost, instanceId: 'ordinary' });
    await f.setAllowed(false);
    const task = await ordinary.admitUserTask({ prompt: 'independent business task', materials: [] });
    await ordinaryHost.drain(); ordinary.disarmAll();
    expect(runs).toBe(1); expect((await ordinaryHost.inspectTask(task.taskId))?.status).toBe('completed');
    expect(f.taskHost.prepareTask).not.toHaveBeenCalled();
  });

  it('regrant alone does not resume, but a new explicit user reset then Goal resume can prepare and run', async () => {
    const f = await fixture(), initial = await f.create();
    const oldGroup = f.store.activeGroup('thread')!.groupId;
    await f.setAllowed(false); await Promise.allSettled(f.stops); await f.setAllowed(true);
    expect(f.preparedEvents).toHaveLength(1); expect(f.runs()).toBe(0);
    expect(await f.goal.getGoal('thread')).toMatchObject({ activation: 'disarmed', state: { status: 'paused' } });
    await expect(f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: initial.preparedTask.attachmentId })).rejects.toThrow();
    const access = f.service.createUserAccess({ requestSource: 'user', actorId: 'user', threadId: 'thread', profileId: 'profile', workspaceId: 'workspace' });
    await f.service.resetGroup({ access, requestSource: 'user', expectedGroupId: oldGroup, operationId: 'explicit-reset-after-grant', confirmTerminate: true });
    await vi.waitFor(() => {
      expect(f.store.activeGroup('thread')?.groupId).toBeTruthy();
      expect(f.store.activeGroup('thread')?.groupId).not.toBe(oldGroup);
    });
    const resumed = await f.goal.resumeGoal({ threadId: 'thread' });
    expect(resumed.preparedTask.taskId).not.toBe(initial.preparedTask.taskId);
    expect(f.store.activeGroup('thread')?.permissionRevision).toBe(f.service.getExecutionAuthorization().permissionRevision);
    await f.goal.ackGoalTaskAttached({ threadId: 'thread', attachmentId: resumed.preparedTask.attachmentId });
    await f.host.drain(); await f.terminal(resumed.preparedTask.taskId);
    expect(f.runs()).toBe(1); expect((await f.goals.load('thread'))?.state.goalId).toBe(initial.goal.state.goalId);
  });
});
