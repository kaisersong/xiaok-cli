// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import * as deliverableGate from '../../../src/runtime/task-host/deliverable-gate.js';
import type { DesktopTaskEvent } from '../../../src/runtime/task-host/types.js';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { createDesktopServices } from '../../electron/desktop-services.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, appendFile: vi.fn(actual.appendFile), writeFile: vi.fn(actual.writeFile), rename: vi.fn(actual.rename) };
});

type Internals = {
  activeExecutions: Map<string, { controller: AbortController }>;
  persistedEventDispatchChains: Map<string, Promise<void>>;
  flushRuntimeEvents(taskId: string): Promise<void>;
  flushMutations(taskId: string): Promise<void>;
  subscribers: Map<string, Set<unknown>>;
  closeSubscribers(taskId: string): void;
};
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const observed = (promise: Promise<unknown>) => promise.then(() => ({ ok: true as const }), error => ({ ok: false as const, error: error as unknown }));

describe('BDD: real cancellation creator boundaries, without replacing an immutable preparation marker', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(fs.appendFile).mockImplementation(actual.appendFile);
    vi.mocked(fs.writeFile).mockImplementation(actual.writeFile);
    vi.mocked(fs.rename).mockImplementation(actual.rename);
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  async function fixture() {
    const f = await authorizationFixture(cleanup);
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const internals = host as unknown as Internals;
    const task = await host.prepareTask({ prompt: 'Hello', materials: [] });
    expect(f.store.getRootBinding(task.taskId)).toBeNull();
    await flushDispatch(internals);
    const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
    return { ...f, host, internals, taskId: task.taskId, callback,
      cold: () => new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId) };
  }
  async function flushDispatch(internals: Internals) {
    while (internals.persistedEventDispatchChains.size) await Promise.all([...internals.persistedEventDispatchChains.values()]);
  }

  it.each(['completed', 'failed'] as const)(
    'C13 actual %s terminal committed during an awaited cancellation decision must not be aborted or overwritten', async terminal => {
      const f = await fixture(), actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const modelEntered = deferred(), releaseModel = deferred(), decisionEntered = deferred(), releaseDecision = deferred();
      const indexEntered = deferred(), releaseIndex = deferred();
      cleanup.push(async () => { releaseModel.resolve(); releaseDecision.resolve(); releaseIndex.resolve(); await f.host.drain(); });
      vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
        modelEntered.resolve(); await releaseModel.promise;
        if (terminal === 'failed') throw new Error('actual provider failure before cancellation resumes');
        yield { type: 'text', delta: 'Hello.' };
      });
      const decide = f.boundary.service.decideHostCancellation.bind(f.boundary.service);
      vi.spyOn(f.boundary.service, 'decideHostCancellation').mockImplementation(async (...args) => {
        const result = await decide(...args);
        if (args[0].taskId === f.taskId) { expect(result.hostAbortAllowed).toBe(true); decisionEntered.resolve(); await releaseDecision.promise; }
        return result;
      });
      let held = false;
      vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
        if (!held && basename(String(args[0])).startsWith('active-task.json.') && String(args[1]).includes('"activeTaskIds": []')) {
          held = true; indexEntered.resolve(); await releaseIndex.promise;
        }
        await actual.writeFile(...args);
      });
      await f.host.startTask(f.taskId); await modelEntered.promise;
      const signal = f.internals.activeExecutions.get(f.taskId)!.controller.signal;
      const cancellation = observed(f.services.cancelTask(f.taskId)); await decisionEntered.promise;
      releaseModel.resolve(); await indexEntered.promise;
      const committed = (await f.cold())!;
      expect(committed.status).toBe(terminal); expect(committed.multiAgentPreparation).toBeUndefined();
      expect(f.internals.activeExecutions.has(f.taskId)).toBe(true); expect(signal.aborted).toBe(false);
      releaseDecision.resolve(); await turn();
      expect.soft(signal.aborted, 'a real already-committed terminal is not a new cancellation target').toBe(false);
      releaseIndex.resolve(); const result = await cancellation; await f.host.drain(); await flushDispatch(f.internals);
      const cold = (await f.cold())!;
      console.log('CANCELLATION_TERMINAL_BEFORE_CLAIM', { terminal, aborted: signal.aborted, result, cold: cold.status,
        events: cold.events.map(event => event.type) });
      expect.soft(cold.status).toBe(terminal);
      expect.soft(cold.events.filter(event => event.type === 'salvage')).toHaveLength(0);
      expect.soft(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    });

  it('C14 a concurrent follower cannot replace the original failed buffered-flush outcome with cancelled', async () => {
    const f = await fixture(), actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const modelEntered = deferred(), releaseModel = deferred(), appendEntered = deferred(), releaseAppend = deferred();
    cleanup.push(async () => { releaseModel.resolve(); releaseAppend.resolve(); await f.host.drain(); });
    const failure = Object.assign(new Error('first native cancellation delta append rejected'), { code: 'EIO' });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'text', delta: 'A real buffered provider delta.' };
      modelEntered.resolve(); await releaseModel.promise;
    });
    let faults = 0;
    vi.mocked(fs.appendFile).mockImplementation(async (...args) => {
      if (faults === 0 && basename(String(args[0])) === `${f.taskId}.journal.jsonl` && String(args[1]).includes('assistant_delta')) {
        faults++; appendEntered.resolve(); await releaseAppend.promise; throw failure;
      }
      await actual.appendFile(...args);
    });
    await f.host.startTask(f.taskId); await modelEntered.promise;
    const flush = vi.spyOn(f.internals, 'flushRuntimeEvents');
    const first = observed(f.services.cancelTask(f.taskId)); await appendEntered.promise;
    const second = observed(f.services.cancelTask(f.taskId)); await turn();
    // The actual FileStore pending-save gate keeps the second initial read
    // waiting here. The defect is observed after that native append rejects.
    expect(flush).toHaveBeenCalledTimes(1);
    releaseAppend.resolve(); const outcomes = await Promise.all([first, second]);
    expect.soft(outcomes).toEqual([{ ok: false, error: failure }, { ok: false, error: failure }]);
    expect.soft(flush).toHaveBeenCalledTimes(1);
    releaseModel.resolve(); await f.host.drain(); await flushDispatch(f.internals);
    const cold = (await f.cold())!;
    console.log('CANCELLATION_CONCURRENT_FLUSH_OWNER', { outcomes, flushes: flush.mock.calls.length, faults,
      status: cold.status, events: cold.events.map(event => event.type) });
    expect.soft(cold.status).toBe('failed');
    expect.soft(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect.soft(cold.events.filter(event => event.type === 'salvage')).toHaveLength(0);
    expect(faults).toBe(1);
  });

  it.each(['write', 'rename'] as const)(
    'C15 original runtime event/index is published once when its full append precedes an interim checkpoint %s rejection', async stage => {
      const f = await fixture(), actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      const modelEntered = deferred(), releaseModel = deferred();
      cleanup.push(async () => { releaseModel.resolve(); await f.host.drain(); });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
        for (let i = 0; i < 253; i++) yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        yield { type: 'text', delta: 'Buffered event at the real checkpoint threshold.' };
        modelEntered.resolve(); await releaseModel.promise;
      });
      await f.host.startTask(f.taskId); await modelEntered.promise; await f.internals.flushMutations(f.taskId);
      await flushDispatch(f.internals);
      const before = (await f.cold())!;
      expect(before.events).toHaveLength(255); expect(before.usage).toEqual({ inputTokens: 253, outputTokens: 253, known: true });
      f.callback.mockClear();
      const live: DesktopTaskEvent[] = [];
      const stream = (async () => { for await (const event of f.host.subscribeTask(f.taskId, { sinceIndex: 255 })) live.push(event); })();
      cleanup.push(async () => { f.internals.closeSubscribers(f.taskId); await stream; });
      while (!f.internals.subscribers.get(f.taskId)?.size) await turn();
      const failure = Object.assign(new Error(`native interim checkpoint ${stage} rejected after full runtime frame`), { code: 'EIO' });
      let faults = 0, interimPath: string | undefined;
      vi.mocked(fs.writeFile).mockImplementation(async (...args) => {
        const target = basename(String(args[0])).startsWith(`${f.taskId}.json.`);
        if (target) {
          const payload = JSON.parse(String(args[1])) as { events?: unknown[]; status?: string };
          if (payload.events?.length === 256 && payload.status === 'running') {
            interimPath = String(args[0]);
            if (stage === 'write' && faults === 0) { faults++; throw failure; }
          }
        }
        await actual.writeFile(...args);
      });
      vi.mocked(fs.rename).mockImplementation(async (...args) => {
        if (stage === 'rename' && faults === 0 && String(args[0]) === interimPath) { faults++; throw failure; }
        await actual.rename(...args);
      });
      expect(await observed(f.services.cancelTask(f.taskId))).toEqual({ ok: false, error: failure });
      expect(faults).toBe(1);
      releaseModel.resolve(); await f.host.drain(); await flushDispatch(f.internals); await turn();
      const cold = (await f.cold())!;
      const calls = f.callback.mock.calls.map(([input]) => input).filter(input => input.taskId === f.taskId);
      console.log('CANCELLATION_INTERIM_FLUSH_PUBLICATION', { stage, faults, status: cold.status,
        cold: cold.events.slice(255).map(event => event.type), live: live.map(event => event.type),
        persisted: calls.map(input => [input.eventIndex, input.event.type]) });
      expect(cold.events[255]?.type).toBe('assistant_delta');
      expect(cold.events.filter(event => event.type === 'assistant_delta')).toHaveLength(1);
      expect.soft(live.filter(event => event.type === 'assistant_delta')).toHaveLength(1);
      expect.soft(calls.filter(input => input.event.type === 'assistant_delta').map(input => input.eventIndex)).toEqual([255]);
      expect.soft(calls.map(input => input.eventIndex)).toEqual([...calls.map(input => input.eventIndex)].sort((a, b) => a - b));
    });

  it('C16 an actual ordinary factory Goal consumes the original committed late usage once, without replacing terminal index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-cancel-ordinary-goal-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config'));
    const entered = deferred(), release = deferred();
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
      getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture',
      request: async () => new Response('{}', { status: 503 }),
    } as unknown as KSwarmService;
    let actualHost: InProcessTaskRuntimeHost | undefined;
    const start = InProcessTaskRuntimeHost.prototype.startTask;
    vi.spyOn(InProcessTaskRuntimeHost.prototype, 'startTask').mockImplementation(function(this: InProcessTaskRuntimeHost, ...args) {
      actualHost = this; return start.apply(this, args);
    });
    const callback = vi.spyOn(DesktopGoalCoordinator.prototype, 'handlePersistedTaskEvent');
    // An explicitly injected main runner is an existing ordinary factory
    // population. This does not bypass or change default MA recordUsage policy.
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'),
      workspaceRoot: root, pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService,
      runner: async input => { entered.resolve(); await release.promise; await input.emitUsage({ inputTokens: 17, outputTokens: 19 }); },
    });
    cleanup.push(() => services.disposeMultiAgent());
    cleanup.push(async () => { release.resolve(); await actualHost?.drain(); });
    expect(services.multiAgent).toBeNull();
    const created = await services.createGoal({ threadId: 'ordinary-goal', objective: 'Hello', expectedEvidenceKinds: ['answer'], turnLimit: 3 });
    const taskId = created.preparedTask.taskId;
    await services.ackGoalTaskAttached({ threadId: 'ordinary-goal', attachmentId: created.preparedTask.attachmentId });
    await entered.promise;
    const host = actualHost!, internals = host as unknown as Internals;
    await services.cancelTask(taskId);
    const coldStore = () => new FileTaskSnapshotStore(join(root, 'data', 'tasks'));
    const cancelled = (await coldStore().recoverTask(taskId))!;
    const terminalIndex = cancelled.events.findIndex(event => event.type === 'task_terminal');
    expect(cancelled.status).toBe('cancelled'); expect(terminalIndex).toBeGreaterThan(0);
    expect((await services.getGoal('ordinary-goal'))?.state.turnsUsed).toBe(0);
    let drained = false; const drain = host.drain().then(() => { drained = true; }); await turn();
    expect(drained).toBe(false);
    release.resolve(); await drain; await flushDispatch(internals);
    const cold = (await coldStore().recoverTask(taskId))!;
    const goalStore = new SqliteGoalStore(join(root, 'data', 'goals', 'goals.sqlite'));
    cleanup.push(() => goalStore.close());
    const document = (await goalStore.load('ordinary-goal'))!;
    const calls = callback.mock.calls.map(([input]) => input).filter(input => input.taskId === taskId);
    const terminals = calls.filter(input => input.event.type === 'task_terminal');
    console.log('CANCELLATION_ORDINARY_GOAL_LATE_USAGE', { usage: cold.usage, goalTokens: document.state.tokensUsed,
      turns: document.turns.map(item => item.tokensUsed), terminalIndex,
      callbacks: calls.map(input => [input.eventIndex, input.event.type, input.snapshot.usage]) });
    // These were already correct: do not make an event-order fix discard
    // provider cost that the original ordinary usage owner has persisted.
    expect(cold.usage).toEqual({ inputTokens: 17, outputTokens: 19, known: true });
    expect(cold.events.filter(event => event.type === 'usage_recorded')).toHaveLength(1);
    expect(cold.events[terminalIndex]).toEqual(cancelled.events[terminalIndex]);
    expect(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(terminals).toHaveLength(1); expect(terminals[0]!.eventIndex).toBe(terminalIndex);
    expect.soft(terminals[0]!.snapshot.usage).toEqual(cold.usage);
    expect.soft(document.state.tokensUsed).toBe(36); expect.soft(document.turns.map(item => item.tokensUsed)).toEqual([36]);
    // Usage notification ordering is not a new host contract: the existing
    // artifact consumer replays its cursor gap, and Goal only reads terminal.
    await services.cancelTask(taskId); await flushDispatch(internals);
    expect(callback.mock.calls.filter(([input]) => input.taskId === taskId && input.event.type === 'task_terminal')).toHaveLength(1);
    expect((await goalStore.load('ordinary-goal'))!.turns).toHaveLength(1);
  });

  it('C17 a runner past its outer cancelling check must yield terminal settlement when cancellation wins during its original async Store read', async () => {
    const f = await fixture();
    const entered = deferred(), release = deferred(); cleanup.push(async () => { release.resolve(); await f.host.drain(); });
    let gatePassed = false, held = false;
    const actualGate = deliverableGate.runDeliverableGate;
    vi.spyOn(deliverableGate, 'runDeliverableGate').mockImplementation((...args) => {
      const result = actualGate(...args);
      // Observe the real gate result without changing its return Promise or
      // inserting an await into the synchronous decision/dispatch segment.
      void result.then(() => { gatePassed = true; });
      return result;
    });
    const store = (f.host as unknown as { options: { snapshotStore: FileTaskSnapshotStore } }).options.snapshotStore;
    const recover = store.recoverTask.bind(store);
    vi.spyOn(store, 'recoverTask').mockImplementation(async (...args) => {
      const snapshot = await recover(...args);
      if (gatePassed && !held && args[0] === f.taskId) { held = true; entered.resolve(); await release.promise; }
      return snapshot;
    });
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () { yield { type: 'text', delta: 'Hello.' }; });
    await f.host.startTask(f.taskId); await entered.promise;
    // This is executeTask's existing guardedLatest = await requireSnapshot,
    // after runDeliverableGate and the original outer !cancelling check.
    await f.services.cancelTask(f.taskId);
    const cancelled = (await f.cold())!;
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    release.resolve(); await f.host.drain(); await flushDispatch(f.internals);
    const cold = (await f.cold())!;
    console.log('CANCELLATION_CLAIM_BEFORE_RUNNER_TERMINAL', { status: cold.status, events: cold.events.map(event => event.type) });
    expect.soft(cold.status).toBe('cancelled');
    expect.soft(cold.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect.soft(cold.events).toEqual(cancelled.events);
  });
});
