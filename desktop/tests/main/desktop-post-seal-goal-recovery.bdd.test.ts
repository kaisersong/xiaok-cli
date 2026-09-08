// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { GoalService } from '../../../src/runtime/goal/service.js';
import { GoalCompletionEvaluator } from '../../../src/runtime/goal/completion-evaluator.js';
import { InProcessTaskRuntimeHost, type PersistedTaskEvent } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { bounded, deferred } from '../fixtures/desktop-post-seal-harness.js';

// Test-only declarations allow old production to load. No fabricated authority
// or permissive authorization callback stands in for the service WeakMap.
interface RecoveryReceipt extends PersistedTaskEvent { authority: object }
interface RecoveryGoalContract { handleRecoveredHostTerminal(input: RecoveryReceipt): Promise<void> }
interface RecoveryServiceContract { assertDeliveryRecovery(input: unknown): void }
interface Seed { root: string; taskId: string }
interface ConsumerFixture { goal: DesktopGoalCoordinator; goalStore: SqliteGoalStore; receipts: RecoveryReceipt[] }
type Fixture = ReturnType<typeof open>;
const threadId = 'post-seal-thread';
const seeds = new Map<number, Seed>();
const fixtures: Array<{ close(): Promise<void> }> = [];
const roots: string[] = [];

async function crashSeed(turnLimit: number): Promise<Seed> {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-goal-seed-'));
  const mode = turnLimit === 1 ? 'goal-snapshot-last-turn' : 'goal-snapshot';
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts', import.meta.url)), root, mode], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let output = ''; let stderr = '';
  const reached = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => reject(new Error(`Goal owner closed before snapshot barrier ${code}: ${stderr}`)));
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.stdout.on('data', chunk => {
      output += String(chunk);
      for (;;) {
        const end = output.indexOf('\n'); if (end < 0) return;
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (!line.startsWith('{')) continue;
        const event = JSON.parse(line) as { stage: string; taskId: string };
        if (event.stage === mode) resolve(event.taskId);
      }
    });
  });
  try {
    const taskId = await bounded(reached);
    child.kill('SIGKILL'); await bounded(closed);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    return { root, taskId };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(closed); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); throw error;
  }
}

async function failRecoveryInRealOwner(root: string, taskId: string): Promise<unknown> {
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-goal-recovery-owner.ts', import.meta.url)), root, taskId], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; let stderr = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  try {
    const actualExit = await bounded(closed);
    expect(actualExit, stderr).toEqual({ code: 0, signal: null });
    const records = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as { stage: string });
    expect(records).toHaveLength(1);
    expect(records[0].stage).toBe('goal-commit-rejected');
    return records[0];
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await bounded(closed); }
  }
}

function consume(goal: DesktopGoalCoordinator, input: RecoveryReceipt): Promise<void> {
  const actual = goal as unknown as RecoveryGoalContract;
  expect(actual.handleRecoveredHostTerminal, 'real Goal recovery consumer must exist').toBeTypeOf('function');
  return actual.handleRecoveredHostTerminal(input);
}
function copyReceipt(input: RecoveryReceipt): RecoveryReceipt {
  const { authority, ...event } = input;
  return { ...structuredClone(event), authority };
}
function open(seed: Seed, options: {
  root?: string; authorize?: boolean;
  onReceipt?: (input: RecoveryReceipt, fixture: ConsumerFixture) => Promise<void>;
} = {}) {
  const root = options.root ?? mkdtempSync(join(tmpdir(), 'xiaok-post-seal-goal-bdd-'));
  if (!options.root) { roots.push(root); cpSync(seed.root, root, { recursive: true }); }
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const goalStore = new SqliteGoalStore(join(root, 'goals.sqlite'));
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const runner = vi.fn(async () => {});
  const createSession = vi.fn(async () => { throw new Error('recovery may not replay an agent'); });
  const receipts: RecoveryReceipt[] = [];
  const service = new DesktopMultiAgentService(Object.assign({ store, coordinator: new DesktopExecutionCoordinator(), createSession }, {
    onRecoveredHostTerminal: async (input: RecoveryReceipt) => {
      receipts.push(input);
      if (options.onReceipt) await options.onReceipt(input, fixture);
      else await consume(goal, input);
    },
  }));
  const authorize = (input: unknown) => (service as unknown as RecoveryServiceContract).assertDeliveryRecovery(input);
  const host = new InProcessTaskRuntimeHost(Object.assign({ snapshotStore: snapshots, runner,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
  }, { authorizeDeliveryRecovery: authorize }));
  const prepare = vi.spyOn(host, 'prepareTask'); const start = vi.spyOn(host, 'startTask'); const cancel = vi.spyOn(host, 'cancelTask');
  const changed = vi.fn(); const prepared = vi.fn();
  const goal = new DesktopGoalCoordinator(Object.assign({ store: goalStore, taskHost: host, instanceId: 'recovered-goal-owner',
    publishGoalChanged: changed, publishGoalTaskPrepared: prepared,
  }, options.authorize === false ? {} : { authorizeRecoveredDelivery: authorize }));
  // Only the existing GoalService user/runtime state API seeds newer user facts.
  // It is not a substitute for delivery recovery authorization.
  const goalService = new GoalService({ store: goalStore, ownership: { assertOwned: () => undefined } });
  let closed = false;
  const fixture = { root, taskId: seed.taskId, store, goalStore, snapshots, host, service, goal, goalService,
    receipts, runner, createSession, prepare, start, cancel, changed, prepared,
    ready: () => service.initialize(host),
    async close() {
      if (closed) return; closed = true;
      await bounded(host.drain()); await service.dispose(); goal.disarmAll(); goalStore.close(); store.close();
    },
  };
  fixtures.push(fixture);
  return fixture;
}
function assertNoReplay(f: Fixture) {
  expect(f.runner).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
  expect(f.prepare).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
  expect(f.prepared).not.toHaveBeenCalled(); expect(f.goal.getPendingAttachmentForTest(threadId)).toBeNull();
}
async function userContext(f: Fixture) {
  const document = (await f.goalStore.load(threadId))!;
  return { sessionId: threadId, instanceId: 'user-before-recovery', requestSource: 'user' as const, expectedRevision: document.state.revision };
}
async function seedCommittedHost(f: Fixture, knownUsage = true) {
  const before = (await f.snapshots.recoverTask(f.taskId))!;
  const binding = f.store.getRootBinding(f.taskId)!;
  const marker = binding.delivery!;
  const now = Date.now();
  const terminal = { type: 'task_terminal' as const, status: 'completed' as const };
  const saved: TaskSnapshot = { ...before, status: 'completed', updatedAt: now,
    events: [...before.events, terminal],
    usage: knownUsage ? before.usage : undefined,
    hostDelivery: { ...marker, revision: marker.revision + 1, status: 'passed', verification: 'passed',
      stage: 'settle', hostSettlement: 'committed', hostTerminalStatus: 'completed', decisionAt: now, finishedAt: now,
      readerCleanup: 'settled', storeCleanup: 'settled' },
  };
  // A real store commit seeds an already-completed host; no recovery algorithm
  // or verification is reproduced in the fixture.
  await f.snapshots.save(saved, before);
  return saved;
}

beforeAll(async () => { for (const limit of [1, 3]) seeds.set(limit, await crashSeed(limit)); });
afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.close();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});
afterAll(() => { for (const seed of seeds.values()) rmSync(seed.root, { recursive: true, force: true, maxRetries: 3 }); });

describe('R4 Goal recovery consumes actual service-owned durable terminals while disarmed', () => {
  it.each([3, 1])('failed recovered host records one real usage turn at budget %i without continuation', async limit => {
    const f = open(seeds.get(limit)!); const evaluator = vi.spyOn(GoalCompletionEvaluator.prototype, 'evaluate');
    await f.ready();
    expect.soft(await f.goal.getGoal(threadId)).toMatchObject({ activation: 'disarmed', state: {
      status: limit === 1 ? 'blocked' : 'paused', terminalReason: limit === 1 ? 'turn_budget_exhausted' : 'runtime_error', turnsUsed: 1, tokensUsed: 18,
    } });
    const document = (await f.goalStore.load(threadId))!; const snapshot = (await f.host.inspectTask(f.taskId))!;
    expect.soft(document.turns).toHaveLength(1);
    expect(document.turns[0]).toMatchObject({ tokensUsed: 18, activeWallClockMs: Math.max(0, snapshot.updatedAt - snapshot.createdAt) });
    expect(document.events.filter(event => event.type === 'turn_settled')).toHaveLength(1);
    expect(f.receipts).toHaveLength(1); expect(evaluator).not.toHaveBeenCalled(); assertNoReplay(f);
  });

  it.each([true, false])('already committed completed host keeps its terminal and only charges known usage=%s', async known => {
    const f = open(seeds.get(3)!); const saved = await seedCommittedHost(f, known);
    const evaluator = vi.spyOn(GoalCompletionEvaluator.prototype, 'evaluate');
    await f.ready();
    expect.soft(await f.goal.getGoal(threadId)).toMatchObject({ activation: 'disarmed', state: { status: 'active', turnsUsed: 1, tokensUsed: known ? 18 : 0 } });
    expect(await f.host.inspectTask(f.taskId)).toEqual(saved);
    expect((await f.goalStore.load(threadId))?.turns).toHaveLength(1);
    expect(evaluator).not.toHaveBeenCalled(); assertNoReplay(f);
  });

  it('ordinary live persisted-event delivery remains disarmed and is not the recovery permission', async () => {
    const f = open(seeds.get(3)!, { onReceipt: async () => {} });
    const saved = await seedCommittedHost(f);
    const eventIndex = saved.events.length - 1;
    const before = await f.goalStore.load(threadId);
    await f.goal.handlePersistedTaskEvent({ taskId: f.taskId, eventIndex, event: saved.events[eventIndex], snapshot: saved });
    expect(await f.goalStore.load(threadId)).toEqual(before); assertNoReplay(f);
  });

  it.each(['paused', 'cancelled', 'complete', 'blocked', 'replaced', 'different-goal', 'already-recorded'] as const)(
    'preserves newer %s Goal facts instead of activating or retroactively charging them', async scenario => {
      const f = open(seeds.get(3)!); const context = await userContext(f);
      if (scenario === 'paused') await f.goalService.pause(context, 'user_paused');
      else if (scenario === 'cancelled' || scenario === 'different-goal') {
        await f.goalService.cancel(context, 'user_cancelled');
        if (scenario === 'different-goal') await f.goalService.create({ ...context, expectedRevision: null }, {
          objective: 'New user goal', expectedEvidenceKinds: ['answer'], turnLimit: 3,
        });
      } else if (scenario === 'complete') await f.goalService.complete(context, 'user_complete');
      else if (scenario === 'replaced') await f.goalService.replace(context, { objective: 'Replacement goal', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
      else await f.goalService.settleTurn({ ...context, requestSource: 'runtime' }, {
        turnId: scenario === 'already-recorded' ? f.goalStore.getTaskBinding(f.taskId)!.goalTurnId : 'previous-real-turn',
        tokensUsed: 5, activeWallClockMs: 10, terminalDecision: scenario === 'blocked' ? { kind: 'blocked', reason: 'user_state_kept' } : { kind: 'none' },
      });
      const before = await f.goalStore.load(threadId); await f.ready();
      expect(await f.goalStore.load(threadId)).toEqual(before);
      expect(f.receipts).toHaveLength(1); expect((await f.goal.getGoal(threadId))?.activation).toBe('disarmed'); assertNoReplay(f);
    });

  it('only a real consumers handle permits use; copy/JSON/foreign payload and revoked handle write zero Goal rows', async () => {
    const f = open(seeds.get(3)!, { onReceipt: async (input, current) => {
      const before = await current.goalStore.load(threadId);
      const attacks = [ { ...copyReceipt(input), authority: {} }, { ...copyReceipt(input), authority: { ...input.authority } },
        { ...copyReceipt(input), authority: JSON.parse(JSON.stringify(input.authority)) as object },
        { ...copyReceipt(input), taskId: 'wrong-source' }, { ...copyReceipt(input), eventIndex: input.eventIndex + 1 },
        { ...copyReceipt(input), event: { type: 'task_terminal' as const, status: 'completed' as const } },
      ];
      const wrongScope = copyReceipt(input); wrongScope.snapshot.executionScope = { ...wrongScope.snapshot.executionScope!, goalTurnId: 'wrong-turn' } as TaskSnapshot['executionScope'];
      const wrongMarker = copyReceipt(input); wrongMarker.snapshot.multiAgentPreparation!.rootEpoch++;
      const wrongRevision = copyReceipt(input); wrongRevision.snapshot.hostDelivery!.revision++;
      for (const attack of [...attacks, wrongScope, wrongMarker, wrongRevision]) {
        await expect(consume(current.goal, attack)).rejects.toThrow();
        expect(await current.goalStore.load(threadId)).toEqual(before);
      }
      await consume(current.goal, input);
    } });
    await f.ready(); expect(f.receipts).toHaveLength(1);
    const before = await f.goalStore.load(threadId);
    await expect(consume(f.goal, f.receipts[0])).rejects.toThrow();
    expect(await f.goalStore.load(threadId)).toEqual(before); assertNoReplay(f);
  });

  it('missing fixed main authorization callback rejects even a genuine service handle', async () => {
    const f = open(seeds.get(3)!, { authorize: false }); const before = await f.goalStore.load(threadId);
    await expect(f.ready()).rejects.toThrow();
    expect(await f.goalStore.load(threadId)).toEqual(before); assertNoReplay(f);
  });

  it('same-thread concurrent duplicate receipts settle one turn, event and usage entry', async () => {
    const f = open(seeds.get(3)!, { onReceipt: async (input, current) => {
      await Promise.all([consume(current.goal, input), consume(current.goal, copyReceipt(input))]);
      await consume(current.goal, input);
    } });
    await f.ready(); expect(f.receipts).toHaveLength(1);
    const document = (await f.goalStore.load(threadId))!;
    expect(document.turns).toHaveLength(1); expect(document.state.tokensUsed).toBe(18);
    expect(document.events.filter(event => event.type === 'turn_settled')).toHaveLength(1); assertNoReplay(f);
  });

  it('a real user pause already in the thread queue wins over recovery consumption', async () => {
    const f = open(seeds.get(3)!, { onReceipt: async (input, current) => {
      const paused = current.goal.pauseGoal({ threadId });
      const consumed = consume(current.goal, input);
      await Promise.all([paused, consumed]);
    } });
    await f.ready(); expect(f.receipts).toHaveLength(1);
    expect(await f.goal.getGoal(threadId)).toMatchObject({ activation: 'disarmed', state: { status: 'paused', terminalReason: 'user_paused', turnsUsed: 0 } });
    expect((await f.goalStore.load(threadId))?.turns).toEqual([]); assertNoReplay(f);
  });

  it('queued consumer freezes the receipt payload but retains opaque handle identity', async () => {
    const f = open(seeds.get(3)!, { onReceipt: async (input, current) => {
      const entered = deferred(); const release = deferred();
      // Hold the actual existing sequencer, not a test copy of its queue rules.
      const owner = current.goal as unknown as { withThread<T>(id: string, action: () => Promise<T>): Promise<T> };
      const held = owner.withThread(threadId, async () => { entered.resolve(); await release.promise; });
      await bounded(entered.promise);
      const caller = copyReceipt(input); const original = copyReceipt(input);
      let pending: Promise<void> | undefined;
      try {
        pending = consume(current.goal, caller);
        caller.taskId = 'late-wrong-source'; caller.eventIndex++;
        caller.snapshot.usage!.inputTokens = 999_999;
        caller.snapshot.multiAgentPreparation!.rootEpoch++;
        caller.snapshot.executionScope = undefined;
      } finally { release.resolve(); }
      await held; await pending;
      expect(current.receipts[0]).toEqual(original);
    } });
    await f.ready(); expect(f.receipts).toHaveLength(1);
    expect((await f.goalStore.load(threadId))?.state.tokensUsed).toBe(18); assertNoReplay(f);
  });

  it('authority revoked after admission but before its thread turn causes zero settlement writes', async () => {
    const release = deferred(); let held: Promise<void> | undefined; let queued: Promise<void> | undefined;
    const f = open(seeds.get(3)!, { onReceipt: async (input, current) => {
      const entered = deferred();
      const owner = current.goal as unknown as { withThread<T>(id: string, action: () => Promise<T>): Promise<T> };
      held = owner.withThread(threadId, async () => { entered.resolve(); await release.promise; });
      await bounded(entered.promise);
      queued = consume(current.goal, input); void queued.catch(() => undefined);
      // Deliberately return this faulty consumer's receipt early. The service
      // revokes the real handle; the queued Goal action must recheck it.
    } });
    const before = await f.goalStore.load(threadId);
    try { await f.ready(); expect(f.receipts).toHaveLength(1); }
    finally { release.resolve(); }
    await held;
    expect(queued).toBeDefined(); await expect(queued!).rejects.toThrow();
    expect(await f.goalStore.load(threadId)).toEqual(before); assertNoReplay(f);
  });

  it('Goal commit failure blocks real startup; only after OS owner exit may the next owner retry its consumer', async () => {
    const next = open(seeds.get(3)!);
    // This parent has not initialized/claimed a boot. The fixed subprocess is
    // the genuine failed recovery owner; await its actual close, not dispose.
    expect(await failRecoveryInRealOwner(next.root, next.taskId)).toMatchObject({
      stage: 'goal-commit-rejected', commits: 1, receipts: 1, runs: 0, sessions: 0, prepares: 0, starts: 0, cancels: 0,
      hostStatus: 'failed', terminalCount: 1, goalTurns: 0, goalStatus: 'active', activation: 'disarmed',
      delivery: { status: 'unknown', guardFailure: { code: 'recovery_unconfirmed' } },
    });
    const hostCommitted = await next.host.inspectTask(next.taskId);
    expect(hostCommitted?.status).toBe('failed'); expect((await next.goalStore.load(threadId))?.turns).toEqual([]);
    await next.ready();
    expect(await next.host.inspectTask(next.taskId)).toEqual(hostCommitted);
    expect((await next.goalStore.load(threadId))?.turns).toHaveLength(1); assertNoReplay(next);
  });
});
