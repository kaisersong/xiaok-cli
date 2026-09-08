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
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { GoalInput } from '../../../src/runtime/goal/types.js';
import type { TaskCreateInput } from '../../../src/runtime/task-host/types.js';
import { bounded, deferred } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';

// The real native Worker only needs its fixed source-mode URL mapped to the
// compiled production entry. No frame, termination, verifier or host is mocked.
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('fixed native Worker fixture is not compiled');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  console.info('W2 P1/P4 native Worker physical lifecycle', { starts: nativeWorker.starts, exits: nativeWorker.exits });
  if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 });
});

// Frozen R4 shape declarations let behavioral tests reach today's real
// coordinator before its new optional input/required output is implemented.
// They do not synthesize metadata, validate IDs or substitute coordinator logic.
type AttachmentSource = { kind: 'request'; requestId: string | null }
  | { kind: 'automatic'; predecessorTaskId: string };
type ObservedPrepared = PreparedGoalTask & { attachmentSource?: AttachmentSource };
type RequestInput = { threadId: string; requestId?: string } & GoalInput;
type Method = 'createGoal' | 'replaceGoal' | 'resumeGoal';
const methods: Method[] = ['createGoal', 'replaceGoal', 'resumeGoal'];
const threadId = 'attachment-thread';
const requestId = '11111111-1111-4111-8111-111111111111';
const otherRequestId = '22222222-2222-4222-8222-222222222222';
const makeInput = (id = threadId): RequestInput => ({
  threadId: id, objective: 'Provide a verifiable answer', expectedEvidenceKinds: ['answer'], turnLimit: 5,
});
const correlatedInput = (id = threadId): RequestInput => ({ ...makeInput(id), requestId });

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  expect(nativeWorker.exits, 'a native verifier start is not a physical exit').toBe(nativeWorker.starts);
  vi.restoreAllMocks();
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-goal-attachment-source-'));
  const groups = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const goals = new SqliteGoalStore(join(root, 'goals.sqlite'));
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const preparedEvents: ObservedPrepared[] = [];
  const releases: Array<() => void> = [];
  const stopping: Promise<void>[] = [];
  let goal!: DesktopGoalCoordinator;
  let authority: DesktopHostDeliveryAuthority | undefined;
  let publish: ((event: ObservedPrepared) => void) | undefined;
  let beforeThread: ((id: string) => Promise<void>) | undefined;
  let runs = 0;
  const service = new DesktopMultiAgentService({
    store: groups, coordinator: new DesktopExecutionCoordinator(),
    executionDomain: { profileId: 'profile', workspaceId: 'workspace', cwd: root, actorId: 'user' },
    createSession: async () => { throw new Error('this fixture must not spawn a child'); },
    stopForWorkspaceExecutionRevocation: () => {
      const result = goal.stopForWorkspaceExecutionRevocation({ requestSource: 'user' });
      stopping.push(result); return result;
    },
  });
  for (const id of [threadId, 'foreign-thread']) {
    service.registerThread({ threadId: id, profileId: 'profile', workspaceId: 'workspace', cwd: root });
  }
  const host = new InProcessTaskRuntimeHost({
    snapshotStore: snapshots,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    authorizePreparation: (id, marker) => service.assertHostPreparation(id, marker),
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    decideCancellation: (snapshot, reason) => service.decideHostCancellation(snapshot, reason),
    getExecutionPolicy: () => ({ deliveryRepair: 'explicit' }),
    onDeliveryReport: report => {
      if (!authority) throw new Error('real host delivery authority is missing');
      return service.recordHostDelivery({ requestSource: 'scheduler', authority, report });
    },
    runner: input => service.runRoot(input, async context => {
      runs++;
      await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId,
        turnId: context.turnId, intentId: 'verified-answer', stepId: 'answer', note: 'A real saved answer.' });
    }),
  });
  const ready = service.initialize(host); authority = service.bindHostDeliveryOwner(host); await ready;
  const taskHost = {
    prepareTask: vi.fn((input: TaskCreateInput) => service.prepareRoot(host, input.context!.threadId!, input)),
    startTask: vi.fn((id: string) => host.startTask(id)),
    cancelTask: vi.fn((id: string, reason?: string) => host.cancelTask(id, reason)),
  };
  goal = new DesktopGoalCoordinator({ store: goals, taskHost, multiAgent: service, instanceId: 'attachment-test-main',
    prepareThread: id => beforeThread?.(id) ?? Promise.resolve(),
    publishGoalTaskPrepared: event => { preparedEvents.push(event); publish?.(event); },
  });
  const access = service.createWorkspaceUserAccess({ requestSource: 'user', actorId: 'user', profileId: 'profile', workspaceId: 'workspace' });
  cleanup.push(async () => {
    for (const release of releases) release();
    goal.disarmAll(); host.abortAllActive();
    await bounded(host.drain()); await Promise.allSettled(stopping);
    await service.dispose(); goals.close(); groups.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  async function arrange(method: Method) {
    if (method !== 'createGoal') {
      await goal.createGoal(makeInput());
      if (method === 'resumeGoal') await goal.pauseGoal({ threadId });
      else await goal.cancelGoal({ threadId });
    }
    preparedEvents.length = 0;
    taskHost.prepareTask.mockClear(); taskHost.startTask.mockClear(); taskHost.cancelTask.mockClear();
  }
  async function consumeCompleted(taskId: string) {
    await bounded(host.drain());
    const snapshot = (await host.recoverTask(taskId)).snapshot;
    const eventIndex = snapshot.events.findIndex(event => event.type === 'task_terminal');
    const event = snapshot.events[eventIndex];
    expect(snapshot.status).toBe('completed');
    expect(event?.type).toBe('task_terminal');
    if (!event || event.type !== 'task_terminal') throw new Error('actual committed terminal is missing');
    // The harness has no factory Goal callback. Explicitly consume the exact
    // durable host receipt; never fabricate a terminal or claim factory E2E.
    await goal.handlePersistedTaskEvent({ taskId, snapshot, eventIndex, event });
    return snapshot;
  }
  return { root, groups, goals, snapshots, host, service, goal, taskHost, preparedEvents, arrange, consumeCompleted,
    runs: () => runs,
    onPublish: (callback: typeof publish) => { publish = callback; },
    beforeThread: (callback: typeof beforeThread) => { beforeThread = callback; },
    barrier: () => {
      const entered = deferred(), release = deferred(); releases.push(() => release.resolve());
      return { entered: entered.promise, release: () => release.resolve(),
        hold: async () => { entered.resolve(); await release.promise; } };
    },
    deny: async () => {
      const current = service.getExecutionAuthorization();
      return service.setExecutionAuthorization({ access, requestSource: 'user', confirm: true,
        executionAllowed: false, expectedPermissionRevision: current.permissionRevision,
        operationId: `exec-auth:${current.bootId}:${current.permissionRevision}:attachment-deny` });
    },
  };
}

describe('W2 R4 P1 real coordinator / SQLite attachment provenance', () => {
  it.each(methods.flatMap(method => (['uuid', 'omitted', 'undefined'] as const).map(mode => ({ method, mode }))))(
    'P1 $method / $mode echoes a request source without making metadata a start receipt', async ({ method, mode }) => {
      const f = await fixture(); await f.arrange(method);
      const input = makeInput();
      if (mode === 'uuid') input.requestId = requestId;
      if (mode === 'undefined') input.requestId = undefined;
      const result = await f.goal[method](input);
      const expected = { kind: 'request', requestId: mode === 'uuid' ? requestId : null };
      const snapshot = (await f.host.recoverTask(result.preparedTask.taskId)).snapshot;
      expect.soft((result.preparedTask as ObservedPrepared).attachmentSource).toEqual(expected);
      expect.soft(f.preparedEvents.at(-1)?.attachmentSource).toEqual(expected);
      expect.soft((f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared | null)?.attachmentSource).toEqual(expected);
      expect.soft(result.preparedTask.executionScope.origin).toBe(method === 'resumeGoal' ? 'continuation' : 'user');
      expect(snapshot.status).toBe('understanding');
      expect(f.goals.getTaskBinding(result.preparedTask.taskId)?.attachedAt).toBeNull();
      for (const durable of [snapshot, snapshot.executionScope, f.goals.getTaskBinding(result.preparedTask.taskId)]) {
        expect(durable).not.toHaveProperty('attachmentSource'); expect(durable).not.toHaveProperty('requestId');
      }
      expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
      expect(f.taskHost.prepareTask).toHaveBeenCalledTimes(1);
    },
  );

  it('P1 automatic source derives from the actually consumed committed predecessor, not continuation origin', async () => {
    const f = await fixture(); const created = await f.goal.createGoal(correlatedInput());
    await f.goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId });
    await f.consumeCompleted(created.preparedTask.taskId);
    const continuation = f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared;
    expect.soft(continuation.attachmentSource).toEqual({ kind: 'automatic', predecessorTaskId: created.preparedTask.taskId });
    expect.soft(f.preparedEvents.at(-1)?.attachmentSource).toEqual(continuation.attachmentSource);
    expect(continuation.executionScope.origin).toBe('continuation');
    expect(continuation.taskId).not.toBe(created.preparedTask.taskId);
    expect((await f.host.recoverTask(continuation.taskId)).snapshot.status).toBe('understanding');
    expect(f.goals.getTaskBinding(continuation.taskId)).not.toHaveProperty('attachmentSource');
    expect(f.taskHost.startTask).toHaveBeenCalledTimes(1); expect(f.runs()).toBe(1);
    expect((await f.goal.getGoal(threadId))?.state.turnsUsed).toBe(1);
  });
});

describe('W2 R4 P3 direct coordinator request capture before its existing prepareThread await', () => {
  it.each(methods)('P3 %s captures only the request ID before an actual admission await', async method => {
    const f = await fixture(); await f.arrange(method);
    const gate = f.barrier(); f.beforeThread(gate.hold);
    const input = { ...makeInput(), requestId };
    const pending = f.goal[method](input);
    await bounded(gate.entered); input.requestId = otherRequestId; gate.release();
    const result = await pending;
    expect.soft((result.preparedTask as ObservedPrepared).attachmentSource).toEqual({ kind: 'request', requestId });
    expect.soft(f.preparedEvents.at(-1)?.attachmentSource).toEqual({ kind: 'request', requestId });
    expect(input.requestId).toBe(otherRequestId);
    expect(f.taskHost.prepareTask).toHaveBeenCalledTimes(1); expect(f.runs()).toBe(0);
  });

  const malformed = [
    { name: 'null', value: null }, { name: 'number', value: 1 }, { name: 'empty', value: '' },
    { name: 'whitespace', value: ` ${requestId}` }, { name: 'wrong-version', value: '11111111-1111-1111-8111-111111111111' },
    { name: 'uppercase', value: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }, { name: 'oversize', value: 'x'.repeat(4096) },
  ];
  it.each(methods.flatMap(method => malformed.map(bad => ({ method, ...bad }))))(
    'P3 $method rejects $name at the direct boundary before any admission callback or durable mutation', async ({ method, value }) => {
      const f = await fixture(); await f.arrange(method);
      const callback = vi.fn(async () => {}); f.beforeThread(callback);
      const beforeGoal = await f.goals.load(threadId), beforeTasks = f.goals.listThreadTaskIds(threadId);
      // Deliberate untyped caller input at the existing public method. No
      // test-owned validator or production return-value cast hides rejection.
      const input = Object.assign(makeInput(), { requestId: value });
      const settled = await Promise.resolve().then(() => Reflect.apply(f.goal[method], f.goal, [input]))
        .then(result => ({ result }), error => ({ error: error as unknown }));
      expect.soft(settled).toEqual({ error: new Error('invalid_goal_request_id') });
      expect.soft(callback).not.toHaveBeenCalled();
      expect.soft(f.taskHost.prepareTask).not.toHaveBeenCalled(); expect.soft(f.preparedEvents).toHaveLength(0);
      expect.soft(await f.goals.load(threadId)).toEqual(beforeGoal);
      expect.soft(f.goals.listThreadTaskIds(threadId)).toEqual(beforeTasks);
      expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
    },
  );
});

describe('W2 R4 P4 source copies cannot corrupt pending / reply or authorize execution', () => {
  it.each(methods.flatMap(method => (['nested', 'replacement'] as const).map(mutation => ({ method, mutation }))))(
    'P4 $method publish listener $mutation mutation cannot change its pending record or semantic reply', async ({ method, mutation }) => {
      const f = await fixture(); await f.arrange(method);
      let touched = 0;
      f.onPublish(event => {
        if (mutation === 'replacement') { event.attachmentSource = { kind: 'automatic', predecessorTaskId: 'untrusted-listener-task' }; touched++; }
        else if (event.attachmentSource?.kind === 'request') { event.attachmentSource.requestId = otherRequestId; touched++; }
      });
      const result = await f.goal[method](correlatedInput());
      expect.soft(touched, 'missing output metadata must not count as exercising nested mutation').toBe(1);
      expect.soft((result.preparedTask as ObservedPrepared).attachmentSource).toEqual({ kind: 'request', requestId });
      expect.soft((f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared)?.attachmentSource).toEqual({ kind: 'request', requestId });
      expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
    },
  );

  it.each(methods)('P4 %s getter and reply source are independent copies of the main-owned pending source', async method => {
    const f = await fixture(); await f.arrange(method);
    const result = await f.goal[method](correlatedInput());
    const observed = f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared;
    const reply = result.preparedTask as ObservedPrepared;
    expect.soft(observed.attachmentSource).toEqual({ kind: 'request', requestId });
    let touched = 0;
    if (observed.attachmentSource?.kind === 'request') { observed.attachmentSource.requestId = otherRequestId; touched++; }
    if (reply.attachmentSource?.kind === 'request') { reply.attachmentSource.requestId = null; touched++; }
    expect.soft(touched, 'both actual source objects must exist before copy isolation is proven').toBe(2);
    expect.soft((f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared).attachmentSource).toEqual({ kind: 'request', requestId });
    expect(f.runs()).toBe(0);
  });

  it('P4 automatic publish and getter copies cannot replace the actual predecessor', async () => {
    const f = await fixture(); const created = await f.goal.createGoal(correlatedInput());
    let touched = 0;
    f.onPublish(event => {
      if (event.attachmentSource?.kind === 'automatic') { event.attachmentSource.predecessorTaskId = 'listener-replacement'; touched++; }
    });
    await f.goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId });
    await f.consumeCompleted(created.preparedTask.taskId);
    const observed = f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared;
    expect.soft(observed.attachmentSource).toEqual({ kind: 'automatic', predecessorTaskId: created.preparedTask.taskId });
    if (observed.attachmentSource?.kind === 'automatic') { observed.attachmentSource.predecessorTaskId = 'getter-replacement'; touched++; }
    expect.soft(touched, 'both real automatic source objects must be reached').toBe(2);
    expect.soft((f.goal.getPendingAttachmentForTest(threadId) as ObservedPrepared).attachmentSource)
      .toEqual({ kind: 'automatic', predecessorTaskId: created.preparedTask.taskId });
    expect(f.taskHost.startTask).toHaveBeenCalledTimes(1); expect(f.runs()).toBe(1);
  });

  it.each(methods)('P4 existing control: repeated request ID cannot bypass %s busy admission', async method => {
    const f = await fixture(); await f.arrange(method);
    const first = await f.goal[method](correlatedInput());
    const before = f.goals.listThreadTaskIds(threadId);
    await expect(f.goal[method](correlatedInput())).rejects.toThrow();
    expect(f.goals.listThreadTaskIds(threadId)).toEqual(before);
    expect(f.goal.getPendingAttachmentForTest(threadId)?.taskId).toBe(first.preparedTask.taskId);
    expect(f.taskHost.prepareTask).toHaveBeenCalledTimes(1); expect(f.runs()).toBe(0);
  });

  it('P4 existing control: repeated request ID after cancellation is not an idempotency key', async () => {
    const f = await fixture(); const first = await f.goal.createGoal(correlatedInput());
    await f.goal.cancelGoal({ threadId });
    const next = await f.goal.createGoal(correlatedInput());
    expect(next.preparedTask.taskId).not.toBe(first.preparedTask.taskId);
    expect(next.preparedTask.attachmentId).not.toBe(first.preparedTask.attachmentId);
    expect(f.taskHost.prepareTask).toHaveBeenCalledTimes(2); expect(f.runs()).toBe(0);
  });

  it('P4 existing control: same request ID in a different registered thread cannot authorize a foreign ACK', async () => {
    const f = await fixture(); const first = await f.goal.createGoal(correlatedInput());
    const foreign = await f.goal.createGoal(correlatedInput('foreign-thread'));
    expect(foreign.preparedTask.attachmentId).not.toBe(first.preparedTask.attachmentId);
    await expect(f.goal.ackGoalTaskAttached({ threadId: 'foreign-thread', attachmentId: first.preparedTask.attachmentId })).rejects.toThrow(/attachment/i);
    expect(f.goals.getTaskBinding(first.preparedTask.taskId)?.attachedAt).toBeNull();
    expect(f.goals.getTaskBinding(foreign.preparedTask.taskId)?.attachedAt).toBeNull();
    expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
  });

  it('P4 existing control: a same-ID replacement does not make an old Goal attachment current', async () => {
    const f = await fixture(); const first = await f.goal.createGoal(correlatedInput());
    await f.goal.cancelGoal({ threadId });
    const next = await f.goal.replaceGoal(correlatedInput());
    expect(next.goal.state.goalId).toBe(first.goal.state.goalId);
    expect(next.goal.state.epoch).toBe(first.goal.state.epoch + 1);
    await expect(f.goal.ackGoalTaskAttached({ threadId, attachmentId: first.preparedTask.attachmentId })).rejects.toThrow(/attachment/i);
    expect(f.goal.getPendingAttachmentForTest(threadId)?.taskId).toBe(next.preparedTask.taskId);
    expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
  });

  it('P4 existing control: real workspace denial invalidates the original correlated attachment without starting a model', async () => {
    const f = await fixture(); const created = await f.goal.createGoal(correlatedInput());
    expect((await f.deny()).executionAllowed).toBe(false);
    await expect(f.goal.ackGoalTaskAttached({ threadId, attachmentId: created.preparedTask.attachmentId })).rejects.toThrow(/permission_revoked/i);
    expect(f.service.getExecutionAuthorization()).toMatchObject({ executionAllowed: false, persistenceState: 'confirmed' });
    expect(f.taskHost.startTask).not.toHaveBeenCalled(); expect(f.runs()).toBe(0);
  });
});
