// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { InProcessTaskRuntimeHost, type PersistedTaskEvent } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import { bounded, hostDelivery } from '../fixtures/desktop-post-seal-harness.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';

interface RecoveryReceipt extends PersistedTaskEvent { authority: object }
interface RecoveryGoalContract { handleRecoveredHostTerminal(input: RecoveryReceipt): Promise<void> }
interface RecoveryServiceContract { assertDeliveryRecovery(input: unknown): void }

interface OwnerEvent { stage: string; taskId: string; groupId: string; childId: string; elapsed?: number; status?: string; delivery?: unknown; inFlight?: boolean }
describe('R4 actual post-seal owner CPU/IO and crash boundary', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
  async function start(mode: string) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-process-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    if (mode === 'fifo') execFileSync('mkfifo', [join(root, 'pending.pdf')]);
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts', import.meta.url)), root, mode], {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    const stop = async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; };
    cleanup.push(stop);
    const events: OwnerEvent[] = []; const listeners = new Set<() => void>(); let stderr = ''; let output = '';
    child.stderr!.on('data', chunk => { stderr += String(chunk); });
    child.stdout!.on('data', chunk => {
      output += String(chunk);
      for (;;) {
        const newline = output.indexOf('\n'); if (newline < 0) break;
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        if (line.startsWith('{')) { events.push(JSON.parse(line)); for (const listener of listeners) listener(); }
      }
    });
    const wait = (stage: string) => bounded(new Promise<OwnerEvent>((resolve, reject) => {
      const check = () => {
        const found = events.find(event => event.stage === stage);
        if (found) { listeners.delete(check); resolve(found); }
        else if (stage !== 'sealed' && events.some(event => event.stage === 'host-drained')) {
          listeners.delete(check); reject(new Error(`production host drained without required ${stage} boundary`));
        }
      };
      child.once('error', reject); child.once('close', code => reject(new Error(`owner exited ${code}: ${stderr}`)));
      listeners.add(check); check();
    }));
    const sealed = await wait('sealed');
    return { root, child, events, wait, stop, sealed };
  }
  function open(root: string, withGoal = false, consumerHook?: (input: RecoveryReceipt, goal: DesktopGoalCoordinator) => Promise<void>) {
    const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
    const runner = vi.fn(async () => {}); const createSession = vi.fn(async () => { throw new Error('replay forbidden'); });
    let goal: DesktopGoalCoordinator | undefined; const receipts: RecoveryReceipt[] = [];
    const service = new DesktopMultiAgentService(Object.assign({ store, coordinator: new DesktopExecutionCoordinator(), createSession }, {
      onRecoveredHostTerminal: async (input: RecoveryReceipt) => {
        receipts.push(input);
        if (input.snapshot.executionScope?.kind !== 'goal_turn') return;
        if (!goal) throw new Error('Goal owner not constructed before recovery');
        await consumerHook?.(input, goal);
        await (goal as unknown as RecoveryGoalContract).handleRecoveredHostTerminal(input);
      },
    })); cleanup.push(() => service.dispose());
    const authorize = (input: unknown) => (service as unknown as RecoveryServiceContract).assertDeliveryRecovery(input);
    const host = new InProcessTaskRuntimeHost(Object.assign({ snapshotStore: new FileTaskSnapshotStore(join(root, 'tasks')),
      materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner }, { authorizeDeliveryRecovery: authorize }));
    const goalStore = withGoal ? new SqliteGoalStore(join(root, 'goals.sqlite')) : undefined;
    if (goalStore) {
      cleanup.push(() => goalStore.close());
      goal = new DesktopGoalCoordinator(Object.assign({ store: goalStore, instanceId: 'new-owner', taskHost: host }, { authorizeRecoveredDelivery: authorize }));
    }
    return { store, service, host, runner, createSession, goal, goalStore, receipts };
  }

  it('D7 actual native pathological classifier cannot block owner heartbeat beyond its 100ms delivery budget', async () => {
    const f = await start('cpu');
    // The fixture calls the production host's actual regex, not a busy loop,
    // source-exported diagnostic copy, eval Worker, or alternative classifier.
    const heartbeat = await f.wait('heartbeat');
    console.info('[post-seal-native-cpu]', { actualHelper: true, heartbeatElapsedMs: heartbeat.elapsed, watchdogMs: 100 });
    expect(heartbeat.elapsed).toBeLessThan(200);
    const done = await f.wait('host-drained');
    expect(f.events.filter(event => event.stage === 'native-worker-start')).toHaveLength(1);
    expect(f.events.filter(event => event.stage === 'native-worker-exit')).toHaveLength(1);
    expect(done).toMatchObject({ status: 'failed', delivery: { verification: 'failed', guardFailure: { code: 'delivery_timeout' } } });
    await f.stop();
  });

  it.skipIf(process.platform === 'win32')('D6 actual file:// PDF FIFO cannot block host heartbeat; raw IO keeps in-flight ownership after deadline', async () => {
    const f = await start('fifo');
    const heartbeat = await f.wait('heartbeat'); expect(heartbeat.elapsed).toBeLessThan(200);
    await new Promise(resolve => setTimeout(resolve, 100));
    f.child.stdin!.write('inspect\n');
    expect(await f.wait('inspection')).toMatchObject({ inFlight: true });
    expect(f.events.filter(event => event.stage === 'native-worker-start')).toHaveLength(1);
    expect(f.events.filter(event => event.stage === 'native-worker-exit')).toHaveLength(1);
    const observer = open(f.root);
    expect(observer.store.getAgent(f.sealed.groupId, `root_${f.sealed.groupId}`)).toMatchObject({ status: 'completed', hostDeliveryStatus: 'unknown',
      hostDeliveryCleanupPending: true });
    await f.stop();
  });

  it.each(['before-marker', 'marker-transaction', 'marker-committed', 'snapshot'])('D10/D18 actual OS crash at %s uses committed marker truth and never replays', async mode => {
    const f = await start(mode);
    if (mode !== 'before-marker') await f.wait(mode);
    expect(f.events.filter(event => event.stage === 'native-worker-start')).toHaveLength(0);
    // The old owner intentionally holds a synchronous write transaction in
    // one case. Inspect its committed truth read-only; a production store
    // constructor runs schema writes and cannot be used as a WAL observer.
    const readOnly = new DatabaseSync(join(f.root, 'groups.sqlite'), { readOnly: true });
    let before: { phase: string; status: string; delivery?: unknown };
    try {
      const row = readOnly.prepare('SELECT data_json FROM root_turns WHERE source_task_id=?').get(f.sealed.taskId) as { data_json: string };
      before = JSON.parse(row.data_json);
    } finally { readOnly.close(); }
    expect(before.phase).toBe('settled'); expect(before.status).toBe('completed');
    const hasMarker = mode === 'marker-committed' || mode === 'snapshot';
    expect('delivery' in before).toBe(hasMarker);
    // The three non-transaction windows also exercise the real service's
    // live-PID refusal. No competing writer is invented in the held transaction.
    if (mode !== 'marker-transaction') {
      const observer = open(f.root);
      await expect(observer.service.initialize(observer.host)).rejects.toThrow(/owner.*live/);
      expect(observer.runner).not.toHaveBeenCalled(); expect(observer.createSession).not.toHaveBeenCalled();
    }
    await f.stop();
    expect(f.child.exitCode !== null || f.child.signalCode !== null).toBe(true);
    const next = open(f.root); await next.service.initialize(next.host);
    const snapshot = await next.host.inspectTask(f.sealed.taskId);
    expect(snapshot).toMatchObject({ status: 'failed', salvage: { reason: hasMarker ? 'recovery_unconfirmed' : 'multi_agent_prepare_interrupted' } });
    if (hasMarker) expect(hostDelivery(snapshot)).toMatchObject({ status: 'unknown', verification: 'pending', hostSettlement: 'committed',
      hostTerminalStatus: 'failed', guardFailure: { code: 'recovery_unconfirmed' } });
    else expect(hostDelivery(snapshot)).toBeUndefined();
    expect(snapshot?.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(next.store.getAgent(f.sealed.groupId, `root_${f.sealed.groupId}`)?.status).toBe('completed');
    expect(next.store.getAgent(f.sealed.groupId, f.sealed.childId)?.status).toBe('interrupted');
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    const once = await next.host.inspectTask(f.sealed.taskId);
    await next.service.initialize(next.host);
    expect(await next.host.inspectTask(f.sealed.taskId)).toEqual(once);
    console.info('[post-seal-crash]', { mode, ownerPid: f.child.pid, signal: f.child.signalCode, committedMarker: hasMarker,
      terminalCount: snapshot?.events.filter(event => event.type === 'task_terminal').length });
  });

  it.each(['active', 'budget', 'paused', 'cancelled', 'consumer-failure', 'invalid-factory-order'] as const)('D10/D18 Goal %s after owner death consumes only durable recovery and remains disarmed', async scenario => {
    const mode = scenario === 'budget' ? 'goal-snapshot-last-turn' : 'goal-snapshot';
    const f = await start(mode); await f.wait(mode); await f.stop();
    const next = open(f.root, scenario !== 'invalid-factory-order', scenario === 'consumer-failure' ? async () => { throw new Error('Goal persistence unavailable'); } : undefined);
    if (scenario === 'paused') await next.goal!.pauseGoal({ threadId: 'post-seal-thread' });
    if (scenario === 'cancelled') await next.goal!.cancelGoal({ threadId: 'post-seal-thread' });
    const before = await next.goalStore?.load('post-seal-thread');
    if (scenario === 'consumer-failure' || scenario === 'invalid-factory-order') {
      await expect(next.service.initialize(next.host)).rejects.toThrow(scenario === 'consumer-failure' ? /Goal persistence/ : /Goal owner/);
    } else {
      await next.service.initialize(next.host);
      expect.soft(next.receipts).toHaveLength(1);
      if (scenario === 'active' || scenario === 'budget') {
        expect(await next.goal!.getGoal('post-seal-thread')).toMatchObject({ activation: 'disarmed', state: { status: scenario === 'budget' ? 'blocked' : 'paused', turnsUsed: 1,
          terminalReason: scenario === 'budget' ? 'turn_budget_exhausted' : 'runtime_error' } });
        const document = await next.goalStore!.load('post-seal-thread');
        expect(document?.turns).toHaveLength(1); expect(document?.turns[0].tokensUsed).toBe(18);
      } else expect(await next.goalStore!.load('post-seal-thread')).toEqual(before);
      expect(next.goal!.getPendingAttachmentForTest('post-seal-thread')).toBeNull();
    }
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    expect((await next.host.inspectTask(f.sealed.taskId))?.status).toBe('failed');
  });

  it.each(['before-host-write', 'host-committed', 'projection-committed'])('D10 OS crash at %s preserves actual host journal commit and never appends duplicate terminal', async mode => {
    const f = await start(mode); await f.wait(mode);
    expect(f.events.filter(event => event.stage === 'native-worker-start')).toHaveLength(1);
    expect(f.events.filter(event => event.stage === 'native-worker-exit')).toHaveLength(1);
    const committed = mode !== 'before-host-write'; const observer = open(f.root);
    const before = await observer.host.inspectTask(f.sealed.taskId);
    expect.soft(hostDelivery(before) ?? (observer.store.getRootBinding(f.sealed.taskId) as unknown as { delivery?: unknown })?.delivery).toBeDefined();
    expect(before?.status).toBe(committed ? 'completed' : 'running');
    await f.stop(); const next = open(f.root); await next.service.initialize(next.host);
    const recovered = await next.host.inspectTask(f.sealed.taskId);
    expect(recovered?.status).toBe(committed ? 'completed' : 'failed');
    if (committed) expect(recovered).toEqual(before);
    else expect(recovered?.salvage?.reason).toBe('recovery_unconfirmed');
    expect(recovered?.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(next.runner).not.toHaveBeenCalled(); expect(next.createSession).not.toHaveBeenCalled();
    expect(next.store.getAgent(f.sealed.groupId, `root_${f.sealed.groupId}`)?.status).toBe('completed');
  });

  it('D18 concurrent recoverTask/getActiveTask cannot race startup into ordinary stale-running recovery', async () => {
    const f = await start('before-marker'); await f.stop(); const next = open(f.root);
    const ready = next.service.initialize(next.host);
    const readers = Promise.all([next.host.recoverTask(f.sealed.taskId), next.host.getActiveTask()]);
    await ready; await readers;
    expect((await next.host.inspectTask(f.sealed.taskId))?.salvage?.reason).toBe('multi_agent_prepare_interrupted');
    expect(next.runner).not.toHaveBeenCalled();
  });

  it('D18 only service-issued recovery handle can settle a disarmed Goal; copied/JSON/wrong source are zero writes and the used handle is revoked', async () => {
    const f = await start('goal-snapshot'); await f.wait('goal-snapshot'); await f.stop();
    const next = open(f.root, true, async (input, goal) => {
      const method = (goal as unknown as RecoveryGoalContract).handleRecoveredHostTerminal.bind(goal);
      const before = await next.goalStore!.load('post-seal-thread');
      for (const attack of [ { ...input, authority: { ...input.authority } },
        { ...input, authority: JSON.parse(JSON.stringify(input.authority)) as object },
        { ...input, taskId: 'foreign-source' }, { ...input, eventIndex: input.eventIndex + 1 } ]) {
        await expect(method(attack)).rejects.toThrow();
        expect(await next.goalStore!.load('post-seal-thread')).toEqual(before);
      }
    });
    await next.service.initialize(next.host);
    expect(next.receipts).toHaveLength(1);
    const before = await next.goalStore!.load('post-seal-thread');
    await expect((next.goal as unknown as RecoveryGoalContract).handleRecoveredHostTerminal(next.receipts[0])).rejects.toThrow();
    expect(await next.goalStore!.load('post-seal-thread')).toEqual(before);
    expect(next.runner).not.toHaveBeenCalled();
  });
});
