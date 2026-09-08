// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopServices } from '../../electron/desktop-services.js';
import { DesktopMultiAgentService, type DesktopMultiAgentServiceOptions } from '../../electron/desktop-multi-agent-service.js';
import type { DesktopGoalCoordinator, DesktopGoalCoordinatorOptions } from '../../electron/desktop-goal-coordinator.js';
import type { InProcessTaskRuntimeHost, InProcessTaskRuntimeHostOptions } from '../../../src/runtime/task-host/task-runtime-host.js';
import { OpenAIAdapter } from '../../../src/ai/adapters/openai.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
import type { HostDeliveryReport, HostDeliveryRecoveryReceipt } from '../../../src/runtime/task-host/delivery-types.js';
import * as kbStoreModule from '../../electron/kb-store-sqlite.js';
import { compileVerifierEntry, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';

const observed = vi.hoisted(() => ({ order: [] as string[], goals: [] as unknown[], goalOptions: [] as unknown[] }));
vi.mock('../../electron/desktop-goal-coordinator.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../electron/desktop-goal-coordinator.js')>();
  return { ...actual, DesktopGoalCoordinator: class extends actual.DesktopGoalCoordinator {
    constructor(...args: ConstructorParameters<typeof actual.DesktopGoalCoordinator>) {
      super(...args); observed.goals.push(this); observed.goalOptions.push(args[0]); observed.order.push('goal_constructed');
    }
  } };
});
const nativeWorker = vi.hoisted(() => ({ output: '', root: '', starts: 0, exits: 0 }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  const source = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      const mapped = String(filename) === source;
      if (mapped && !nativeWorker.output) throw new Error('test compiled Worker entry is not ready');
      super(mapped ? nativeWorker.output : filename, options);
      if (mapped) { nativeWorker.starts++; this.once('exit', () => { nativeWorker.exits++; }); }
    }
  } };
});
beforeAll(async () => { Object.assign(nativeWorker, await compileVerifierEntry('delivery-verifier-worker.ts')); });
afterAll(() => {
  try { expect(nativeWorker.exits).toBe(nativeWorker.starts); }
  finally { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); }
});

describe('R4 actual Desktop factory owns live delivery and recovery callback wiring', () => {
  const cleanup: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    vi.restoreAllMocks(); for (const action of cleanup.splice(0).reverse()) await action(); vi.unstubAllEnvs();
    observed.order.length = 0; observed.goals.length = 0; observed.goalOptions.length = 0;
  });
  async function setup(runner?: Parameters<typeof createDesktopServices>[0]['runner']) {
    const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-factory-'));
    cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
    vi.stubEnv('XIAOK_CONFIG_DIR', join(root, 'config')); vi.stubEnv('XIAOK_DISABLE_GLOBAL_PLUGINS', '1');
    const createKb = kbStoreModule.createKbStoreSqlite;
    vi.spyOn(kbStoreModule, 'createKbStoreSqlite').mockImplementation(() => createKb(join(root, 'knowledge.sqlite')));
    const originalInitialize = DesktopMultiAgentService.prototype.initialize;
    let host: InProcessTaskRuntimeHost | undefined;
    const initialize = vi.spyOn(DesktopMultiAgentService.prototype, 'initialize').mockImplementation(function(this: DesktopMultiAgentService, owner) {
      host = owner; observed.order.push('service_initialize'); return originalInitialize.call(this, owner);
    });
    const originalBind = DesktopMultiAgentService.prototype.bindHostDeliveryOwner;
    const bind = vi.spyOn(DesktopMultiAgentService.prototype, 'bindHostDeliveryOwner').mockImplementation(function(this: DesktopMultiAgentService, owner) {
      observed.order.push('delivery_bind'); return originalBind.call(this, owner);
    });
    const kswarmService = { start: async () => {}, stop: async () => {}, restart: async () => {},
      getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }),
      onStatusChange: () => () => {}, getDesktopMutationToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }),
    } as unknown as KSwarmService;
    const services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), workspaceRoot: root,
      pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService, runner });
    cleanup.push(() => services.disposeMultiAgent()); cleanup.push(async () => { await host?.drain(); });
    if (services.multiAgent) await services.multiAgent.ready;
    return { root, services, initialize, bind, host: host!,
      hostOptions: host ? (host as unknown as { options: InProcessTaskRuntimeHostOptions }).options : undefined,
      goal: observed.goals.at(-1) as DesktopGoalCoordinator, goalOptions: observed.goalOptions.at(-1) as DesktopGoalCoordinatorOptions };
  }

  it.each(['passed', 'failed'] as const)('PF1 actual default provider loop finishes root execution but publishes host delivery %s through the real service', async outcome => {
    const f = await setup(); await f.services.saveModelConfig({ providerId: 'kimi', apiKey: 'fixture' });
    const reports: HostDeliveryReport[] = [], service = f.services.multiAgent!.service, original = service.recordHostDelivery.bind(service);
    vi.spyOn(service, 'recordHostDelivery').mockImplementation(async input => { const ack = await original(input); reports.push(ack); return ack; });
    let calls = 0;
    vi.spyOn(OpenAIAdapter.prototype, 'stream').mockImplementation(async function* () {
      yield { type: 'thinking', delta: '', reasoningProvenance: { captureVersion: 1, source: 'reasoning_content', fieldPresence: 'present' } };
      if (++calls === 1 && outcome === 'failed') yield { type: 'tool_use', id: 'plan', name: 'report_progress', input: {
        steps: [{ id: 'report', label: 'report', status: 'completed' }, { id: 'slides', label: 'slides', status: 'running' }],
      } };
      else yield { type: 'text', delta: 'This is the complete bounded explanation of the result and its supporting reasoning.' };
    });
    const starts = nativeWorker.starts, exits = nativeWorker.exits;
    const created = await f.services.createTask({ prompt: outcome === 'failed' ? '生成一份报告和一份演示文稿' : 'Explain the result.', materials: [], context: { threadId: 'factory-thread' } });
    await f.host.drain();
    const snapshot = (await f.services.recoverTask(created.taskId)).snapshot;
    expect.soft(snapshot.status).toBe(outcome === 'passed' ? 'completed' : 'failed');
    expect.soft(snapshot.hostDelivery).toMatchObject({ status: outcome, verification: outcome, hostSettlement: 'committed', readerCleanup: 'settled', storeCleanup: 'settled' });
    if (outcome === 'failed') expect.soft(snapshot.hostDelivery?.guardFailure?.code).toBe('deliverables_incomplete');
    expect.soft(reports[0]?.delivery).toMatchObject({ status: 'checking', revision: 1 });
    expect.soft(reports.at(-1)?.delivery).toEqual(snapshot.hostDelivery);
    const boundary = f.services.multiAgent!, access = service.createUserAccess({ requestSource: 'user', actorId: 'fixture', threadId: 'factory-thread', profileId: boundary.profileId, workspaceId: boundary.workspaceId });
    expect.soft(service.getSnapshot({ access }).root).toMatchObject({ sourceTaskId: created.taskId, status: 'completed', hostDeliveryStatus: outcome });
    expect.soft(calls).toBe(outcome === 'passed' ? 1 : 2);
    expect.soft(nativeWorker.starts - starts).toBe(1); expect(nativeWorker.exits - exits).toBe(1);
  });

  it('PF2 constructs the actual Goal before service initialization, then binds exactly one opaque live delivery owner', async () => {
    const f = await setup();
    expect(observed.order).toEqual(['goal_constructed', 'service_initialize', 'delivery_bind']);
    expect(f.initialize).toHaveBeenCalledOnce(); expect(f.bind).toHaveBeenCalledExactlyOnceWith(f.host);
    expect(typeof f.hostOptions?.onDeliveryReport).toBe('function');
    const real = f.services.multiAgent!.service.bindHostDeliveryOwner(f.host);
    expect(real).toBe(f.bind.mock.results[0]!.value); expect(Object.isFrozen(real)).toBe(true);
  });

  it('PF3 ordinary injected runner still creates no multi-agent owner or delivery record', async () => {
    const runner = vi.fn<NonNullable<Parameters<typeof createDesktopServices>[0]['runner']>>(async input => { await input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId,
      turnId: 'turn', intentId: 'intent', stepId: 'step', note: 'Ordinary bounded response.' }); });
    const f = await setup(runner), starts = nativeWorker.starts;
    const created = await f.services.createTask({ prompt: 'ordinary', materials: [], context: { threadId: 'ordinary-thread' } });
    await vi.waitFor(async () => expect((await f.services.recoverTask(created.taskId)).snapshot.status).toBe('completed'));
    expect(f.services.multiAgent).toBeNull(); expect(f.initialize).not.toHaveBeenCalled(); expect(f.bind).not.toHaveBeenCalled();
    expect((await f.services.recoverTask(created.taskId)).snapshot.hostDelivery).toBeUndefined();
    expect(runner).toHaveBeenCalledOnce(); expect(nativeWorker.starts).toBe(starts);
  });

  it.each(['host', 'goal'] as const)('PF4 the fixed %s recovery authorization callback synchronously delegates to the real service and rejects a forged handle', async consumer => {
    const f = await setup(), service = f.services.multiAgent!.service;
    const authorize = consumer === 'host' ? f.hostOptions!.authorizeDeliveryRecovery : f.goalOptions.authorizeRecoveredDelivery;
    expect(typeof authorize, 'actual factory must install the recovery authority callback').toBe('function');
    const checked = vi.spyOn(service, 'assertDeliveryRecovery');
    const input: HostDeliveryRecoveryReceipt = { authority: Object.freeze({ ownerId: 'forged' }), taskId: 'test-only-untrusted',
      snapshot: snapshotFixture({ taskId: 'test-only-untrusted', status: 'failed' }), eventIndex: 0, event: { type: 'task_terminal', status: 'failed' } };
    let failure: unknown, returned: unknown;
    try { returned = authorize!(input); } catch (error) { failure = error; }
    if (returned instanceof Promise) await returned.catch(() => {});
    expect(failure).toBeInstanceOf(Error); expect(returned).toBeUndefined();
    expect(checked).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each(['ordinary', 'goal_turn'] as const)('PF5 fixed recovered-terminal routing for %s awaits Goal receipt directly and does not swallow its failure', async kind => {
    const f = await setup();
    const options = (f.services.multiAgent!.service as unknown as { options: DesktopMultiAgentServiceOptions }).options;
    expect(typeof options.onRecoveredHostTerminal, 'actual factory must install a non-swallowing consumer receipt').toBe('function');
    const input: HostDeliveryRecoveryReceipt = { authority: Object.freeze({ ownerId: 'controlled-callback-test' }), taskId: 'callback-test',
      snapshot: snapshotFixture({ taskId: 'callback-test', status: 'failed', ...(kind === 'goal_turn' ? { executionScope: {
        kind: 'goal_turn', origin: 'user', goalId: 'goal', epoch: 1, goalTurnId: 'turn', threadId: 'thread',
      } } : {}) }), eventIndex: 0, event: { type: 'task_terminal', status: 'failed' } };
    // Controlled receipt only tests factory routing/await semantics. It is not
    // claimed to be an authenticated startup recovery or a durable Goal event.
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); cleanup.push(release);
    const sentinel = new Error('controlled Goal consumer receipt failed');
    const consumer = vi.spyOn(f.goal, 'handleRecoveredHostTerminal').mockImplementation(async () => { await wait; throw sentinel; });
    let settled = false;
    const pending = options.onRecoveredHostTerminal!(input); void pending.then(() => { settled = true; }, () => { settled = true; });
    if (kind === 'ordinary') { await pending; expect(consumer).not.toHaveBeenCalled(); return; }
    await vi.waitFor(() => expect(consumer).toHaveBeenCalledExactlyOnceWith(input));
    await Promise.resolve(); expect(settled).toBe(false);
    release(); await expect(pending).rejects.toBe(sentinel);
  });
});
