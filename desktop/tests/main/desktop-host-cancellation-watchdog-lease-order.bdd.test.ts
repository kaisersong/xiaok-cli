// @vitest-environment node
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest';
import { join } from 'node:path';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { DesktopAgentExecutionContext } from '../../electron/desktop-multi-agent-service.js';
import { authorizationFixture, deferred } from '../fixtures/multi-agent-authorization.js';

// Keep the real coordinator and factory, but explicitly request the bounded
// lease whose race this suite exercises. Production no longer supplies one.
vi.mock('../../electron/desktop-execution-coordinator.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-execution-coordinator.js')>();
  return { ...actual, DesktopExecutionCoordinator: class extends actual.DesktopExecutionCoordinator {
    constructor(options: ConstructorParameters<typeof actual.DesktopExecutionCoordinator>[0] = {}) {
      super({ ...options, multiAgentLeaseMs: 28 * 60_000 });
    }
  } };
});

const turn = () => new Promise<void>(resolve => setImmediate(resolve));

describe('BDD: real main watchdog and lease expiry keep whichever legal terminal wins first', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const action of cleanup.splice(0).reverse()) await action();
    vi.restoreAllMocks(); vi.unstubAllEnvs();
  });
  it.each(['watchdog-terminal', 'watchdog-signal', 'lease'] as const)('C20 wall-clock stalled: %s wins without inventing a cancellation writer for signal-only abort', async first => {
    let stage = 'factory initialization';
    onTestFailed(() => console.error('CANCELLATION_WATCHDOG_FAILED_STAGE', { first, stage }));
    const f = await authorizationFixture(cleanup);
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const entered = deferred(), release = deferred(); cleanup.push(async () => { release.resolve(); await host.drain(); });
    // Explicit clock-skew case: hold the wall clock while native timer and
    // monotonic time advance. Otherwise the independent 30s runner deadline
    // wins before the 60s host watchdog; the nominal case below covers that.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    const wall = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    let models = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      models++; entered.resolve(); await release.promise; yield { type: 'text', delta: 'Late model output must not revive execution.' };
    });
    stage = 'task creation';
    const task = await f.services.createTask({ prompt: 'Wait for explicit cancellation.', materials: [], watchdogMs: 60_000,
      context: { threadId: `watchdog-lease-${first}` }, permissionMode: 'auto' });
    stage = 'provider entry';
    await entered.promise;
    const binding = f.store.getRootBinding(task.taskId)!;
    const groups = (f.boundary.service as unknown as { groups: Map<string, { root?: { context?: DesktopAgentExecutionContext } }> }).groups;
    const context = groups.get(binding.groupId)?.root?.context!;
    expect(context).toBeDefined();
    let aborts = 0; context.signal.addEventListener('abort', () => { aborts++; });
    const ticket = context.memberTicket;
    const decide = vi.spyOn(f.boundary.service, 'decideHostCancellation');
    const cold = () => new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    const expire = async () => {
      const previousWall = Date.now();
      wall.mockReturnValue(ticket.deadlineAt! + 1);
      try { await f.boundary.service.expireLease({ requestSource: 'scheduler', groupId: context.groupId, leaseEpoch: ticket.epoch }); }
      finally { wall.mockReturnValue(previousWall); }
    };
    if (first !== 'lease') {
      stage = 'watchdog timer advancement';
      const beforeClock = { monotonic: performance.now(), wall: Date.now(), timers: vi.getTimerCount() };
      await vi.advanceTimersByTimeAsync(60_000);
      console.info('CANCELLATION_WATCHDOG_WALL_STALL_CLOCKS', { first, beforeClock, afterClock: { monotonic: performance.now(), wall: Date.now(), timers: vi.getTimerCount() }, decisions: decide.mock.calls.map(([, reason]) => reason), hostWatchdogs: [...(host as unknown as { taskWatchdogs: Map<string, number> }).taskWatchdogs], binding: f.store.getRootBinding(task.taskId) });
      stage = 'watchdog abort authorization';
      while (!context.signal.aborted) await turn();
      if (first === 'watchdog-terminal') { stage = 'watchdog terminal physical drain'; release.resolve(); await host.drain(); expect((await cold())?.status).toBe('failed'); }
      stage = 'late lease expiry';
      await expire();
    } else {
      stage = 'initial lease expiry';
      await expire();
      expect((await cold())?.status).toBe('cancelled');
      stage = 'late watchdog timer advancement';
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(decide.mock.calls.some(([, reason]) => reason === 'task_watchdog_timeout')).toBe(true);
    expect(aborts).toBe(1);
    if (first !== 'watchdog-terminal') { expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false); }
    stage = 'final physical drain';
    release.resolve(); await host.drain();
    stage = 'cold terminal verification';
    const snapshot = (await cold())!;
    console.log('CANCELLATION_REAL_WATCHDOG_LEASE_ORDER', { first, status: snapshot.status, events: snapshot.events.map(event => event.type),
      decisions: await Promise.all(decide.mock.results.map(result => result.value)), aborts, models, released: ticket.released });
    expect(snapshot.status).toBe(first === 'watchdog-terminal' ? 'failed' : 'cancelled');
    expect(snapshot.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(snapshot.events.filter(event => event.type === 'salvage')).toHaveLength(first === 'watchdog-terminal' ? 0 : 1);
    expect(models).toBe(1); expect(ticket.released).toBe(true);
  });
  it('C20 nominal clocks: the 30s runner deadline seals before the late 60s host watchdog while original IO still owns the ticket', async () => {
    let stage = 'factory';
    onTestFailed(() => console.error('B_NOMINAL_CLOCK_FAILED_STAGE', { stage }));
    const f = await authorizationFixture(cleanup);
    const host = (f.boundary.service as unknown as { host: InProcessTaskRuntimeHost }).host;
    const entered = deferred(), release = deferred();
    cleanup.push(async () => { release.resolve(); await host.drain(); });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    let models = 0, providerSignal: AbortSignal | undefined;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* (_messages, _tools, _system, options) {
      models++; providerSignal = options?.signal; entered.resolve(); await release.promise;
      yield { type: 'text', delta: 'Late text after the original model deadline must not revive the sealed root.' };
    });
    const task = await f.services.createTask({ prompt: 'Wait for the original model deadline.', materials: [], watchdogMs: 60_000,
      context: { threadId: 'watchdog-nominal-runner-first' }, permissionMode: 'auto' });
    await entered.promise;
    const binding = f.store.getRootBinding(task.taskId)!;
    const groups = (f.boundary.service as unknown as { groups: Map<string, { root?: { context?: DesktopAgentExecutionContext } }> }).groups;
    const context = groups.get(binding.groupId)?.root?.context!;
    expect(context).toBeDefined();
    const ticket = context.memberTicket, decide = vi.spyOn(f.boundary.service, 'decideHostCancellation');
    let aborts = 0; context.signal.addEventListener('abort', () => { aborts++; });
    stage = 'before 30s';
    await vi.advanceTimersByTimeAsync(29_999);
    expect(providerSignal?.aborted).toBe(false);
    expect(f.store.getRootBinding(task.taskId)?.phase).toBe('active');
    stage = 'at 30s';
    await vi.advanceTimersByTimeAsync(1);
    expect(providerSignal?.aborted).toBe(true);
    expect(providerSignal?.reason).toMatchObject({ message: 'desktop_tool_loop_deadline_exceeded' });
    // The recovery owner's zero-delay outward detach is a later timer turn.
    // Fake timers schedule a timer created inside a timer on the next millisecond.
    await vi.advanceTimersByTimeAsync(1);
    stage = 'runner seal after 30s';
    console.info('B_NOMINAL_CLOCK_AT_DEADLINE', { binding: f.store.getRootBinding(task.taskId), providerAborted: providerSignal?.aborted, timers: vi.getTimerCount() });
    while (f.store.getRootBinding(task.taskId)?.phase !== 'settled') await turn();
    expect(f.store.getRootBinding(task.taskId)?.status).toBe('failed');
    expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false);
    const cold = () => new FileTaskSnapshotStore(join(f.root, 'data', 'tasks')).recoverTask(task.taskId);
    expect((await cold())?.status).toBe('running');
    stage = 'advance to 60s';
    await vi.advanceTimersByTimeAsync(29_999);
    stage = 'late host decision';
    while (!decide.mock.calls.some(([, reason]) => reason === 'task_watchdog_timeout')) await turn();
    const watchdog = decide.mock.results[decide.mock.calls.findIndex(([, reason]) => reason === 'task_watchdog_timeout')];
    expect(await watchdog.value).toMatchObject({ hostAbortAllowed: false });
    expect(context.signal.aborted).toBe(false); expect(aborts).toBe(0);
    expect(host.inFlightTaskIds()).toContain(task.taskId); expect(ticket.released).toBe(false);
    stage = 'physical drain';
    release.resolve(); await host.drain();
    const snapshot = (await cold())!;
    console.info('CANCELLATION_WATCHDOG_NOMINAL_CLOCKS', { status: snapshot.status, reason: snapshot.salvage?.reason,
      events: snapshot.events.map(event => event.type), models, released: ticket.released, aborts });
    expect(snapshot.status).toBe('failed'); expect(snapshot.salvage?.reason).toBe('desktop_tool_loop_deadline_exceeded');
    expect(snapshot.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
    expect(snapshot.events.filter(event => event.type === 'assistant_delta')).toHaveLength(0);
    expect(models).toBe(1); expect(ticket.released).toBe(true);
  });

});
