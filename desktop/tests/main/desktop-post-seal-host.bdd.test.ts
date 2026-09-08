// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { createPostSealHarness, deferred, bounded, hostDelivery, nextTurn, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';
import { compileVerifierEntry } from '../fixtures/desktop-post-seal-verifier-contract.js';
import type { TaskRunnerInput } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';

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
afterAll(() => { if (nativeWorker.root) rmSync(nativeWorker.root, { recursive: true, force: true, maxRetries: 3 }); });

const unfinishedPlan = (input: TaskRunnerInput) => input.emitRuntimeEvent({ type: 'progress_plan_reported', sessionId: input.sessionId,
  steps: [{ id: 'report', label: 'report', status: 'completed' }, { id: 'slides', label: 'slides', status: 'pending' }] });
const answer = (input: TaskRunnerInput) => input.emitRuntimeEvent({ type: 'receipt_emitted', sessionId: input.sessionId,
  turnId: 'turn', intentId: 'intent', stepId: 'step', note: 'A saved answer.' });

describe('R4 post-seal delivery — actual host/service/core and SQLite', () => {
  const fixtures: PostSealHarness[] = []; const releases: Array<() => void> = [];
  afterEach(async () => {
    for (const release of releases.splice(0)) release();
    vi.useRealTimers();
    for (const fixture of fixtures.splice(0)) await fixture.close();
  });
  async function setup(options: Parameters<typeof createPostSealHarness>[0] = {}) {
    const fixture = await createPostSealHarness(options); fixtures.push(fixture); return fixture;
  }
  async function deadline() {
    await vi.advanceTimersByTimeAsync(2100);
    for (let i = 0; i < 8; i++) await nextTurn();
  }

  it.each([1, 2])('D1/D3/D4/D17 read #%i crosses deadline: execution stays sealed, delivery fails, raw read retains host owner', async readOrdinal => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const f = await setup({ readOrdinal, emit: answer }); const taskId = await f.start();
    await bounded(f.readEntered.promise);
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)?.status).toBe('completed');
    expect(f.store.getAgent(f.groupId, f.childId)?.status).toBe('running');
    await deadline();
    await f.host.cancelTask(taskId);
    expect(f.rootSignal?.aborted).toBe(false);
    expect(f.host.inFlightTaskIds()).toContain(taskId);
    expect(f.tokenReleases).toBe(0);
    expect.soft(f.readSignal).toBeInstanceOf(AbortSignal);
    expect.soft(f.readSignal?.aborted).toBe(true);
    expect.soft(f.reports.at(-1)?.delivery).toMatchObject({ status: 'unknown', verification: 'failed',
      guardFailure: { code: 'delivery_timeout', needsExplicitFollowup: true } });
    f.readRelease.resolve(); await bounded(f.host.drain());
    const snapshot = await f.host.inspectTask(taskId);
    expect(snapshot).toMatchObject({ status: 'failed', salvage: { reason: 'needs_explicit_followup' } });
    expect(hostDelivery(snapshot)).toMatchObject({ status: 'failed', verification: 'failed', hostSettlement: 'committed' });
    expect(f.runnerCalls).toBe(1); expect(f.tokenReleases).toBe(1);
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ status: 'completed', hostDeliveryStatus: 'failed' });
    expect(f.store.getAgent(f.groupId, f.childId)?.status).toBe('running');
  });

  it('D2 releasing the real snapshot read before the original deadline commits delivery once', async () => {
    const starts = nativeWorker.starts; const exits = nativeWorker.exits;
    const f = await setup({ readOrdinal: 1, emit: answer }); const id = await f.start();
    await bounded(f.readEntered.promise); f.readRelease.resolve(); await bounded(f.host.drain());
    expect((await f.host.inspectTask(id))?.status).toBe('completed');
    expect(hostDelivery(await f.host.inspectTask(id))).toMatchObject({ status: 'passed', verification: 'passed', hostSettlement: 'committed' });
    expect(f.runnerCalls).toBe(1);
    expect(f.reports.filter(report => report.delivery.status === 'passed')).toHaveLength(1);
    expect(nativeWorker.starts - starts).toBe(1); expect(nativeWorker.exits - exits).toBe(1);
  });

  it('D2/D11 deadline spent after seal but before runner return is not renewed on entry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const tail = deferred(); releases.push(() => tail.resolve());
    const f = await setup({ emit: answer, runnerTail: () => tail.promise }); const id = await f.start();
    await bounded(f.rootSealed.promise); await deadline();
    expect(f.rootSignal?.aborted).toBe(false);
    tail.resolve(); await bounded(f.host.drain());
    expect((await f.host.inspectTask(id))?.status).toBe('failed');
    expect(hostDelivery(await f.host.inspectTask(id))?.guardFailure?.code).toBe('delivery_timeout');
    expect(f.runnerCalls).toBe(1);
  });

  it('D3/D9 built-in plan failure becomes delivery failure without changing root/child execution', async () => {
    const gate = vi.fn(async () => ({ complete: true }));
    const f = await setup({ prompt: '生成一份报告和一份演示文稿', emit: unfinishedPlan, completionGate: gate }); const id = await f.start(); await bounded(f.host.drain());
    expect((await f.host.inspectTask(id))).toMatchObject({ status: 'failed', salvage: { reason: 'needs_explicit_followup' } });
    expect(f.runnerCalls).toBe(1); expect(gate).not.toHaveBeenCalled();
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ status: 'completed', hostDeliveryStatus: 'failed',
      guardFailure: { code: 'deliverables_incomplete', needsExplicitFollowup: true } });
    expect(f.store.getAgent(f.groupId, f.childId)?.status).toBe('running');
    expect(hostDelivery(await f.host.inspectTask(id))).toMatchObject({ status: 'failed', verification: 'failed' });
  });

  it('D3 degraded remains the real saved result and is a passed verification, not a new failure', async () => {
    const f = await setup({ prompt: 'Hello' }); const id = await f.start(); await bounded(f.host.drain());
    const snapshot = await f.host.inspectTask(id);
    expect(snapshot).toMatchObject({ status: 'completed', result: { degraded: true } });
    expect(snapshot?.events.some(event => event.type === 'progress' && event.stage === 'warning')).toBe(true);
    expect(hostDelivery(snapshot)).toMatchObject({ status: 'passed', verification: 'passed', hostSettlement: 'committed' });
  });

  it.each(['throw', 'SQLITE_FULL', 'wrong-ack', 'pending'] as const)('D10 initial checking %s starts zero validation effects and never reruns root', async mode => {
    const ack = deferred<unknown>(); releases.push(() => ack.resolve(undefined));
    const f = await setup({ emit: answer, report: async () => {
      if (mode === 'pending') return ack.promise;
      if (mode === 'wrong-ack') return { source: {}, revision: 99 };
      throw Object.assign(new Error(mode), { code: mode });
    } });
    await f.start(); await bounded(f.rootSealed.promise);
    await bounded(Promise.race([f.reportEntered.promise, f.host.drain()]));
    if (mode !== 'pending') await bounded(f.host.drain());
    expect(f.reports[0]?.delivery).toMatchObject({ revision: 1, status: 'checking', verification: 'pending', stage: 'flush' });
    expect(f.postRunReads).toBe(0);
    expect(f.runnerCalls).toBe(1);
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)?.hostDeliveryStatus).toBeUndefined();
  });

  it('D10 commit-ACK delay past deadline never authorizes late read/worker continuation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const ack = deferred(); releases.push(() => ack.resolve());
    const committed = deferred();
    const f = await setup({ emit: answer, report: async (report, persist) => {
      const receipt = await persist(); if (report.delivery.revision === 1) { committed.resolve(); await ack.promise; } return receipt;
    } });
    const id = await f.start(); await bounded(f.rootSealed.promise);
    await bounded(Promise.race([committed.promise, f.host.drain()]));
    expect(f.reports).toHaveLength(1);
    await deadline(); ack.resolve(); await bounded(f.host.drain());
    expect(f.postRunReads).toBe(0);
    expect(f.runnerCalls).toBe(1);
    expect((await f.host.inspectTask(id))?.status).not.toBe('completed');
  });

  it('D10 a buffered runner delta cannot flush on its old timer before the first checking ACK', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const ack = deferred(); releases.push(() => ack.resolve());
    const committed = deferred(); const starts = nativeWorker.starts; const exits = nativeWorker.exits;
    const delta = 'Buffered runner answer waiting for its durable checking ACK';
    // A delta-only conversational fixture has no structured answer obligation.
    // The default "Explain" prompt deliberately requires a saved result receipt.
    const f = await setup({ spawnChild: false, prompt: 'Hello', emit: async input => {
      await input.emitRuntimeEvent({ type: 'assistant_delta', sessionId: input.sessionId,
        turnId: 'turn', intentId: 'intent', stepId: 'step', delta });
    }, report: async (report, persist) => {
      const receipt = await persist();
      if (report.delivery.revision === 1) { committed.resolve(); await ack.promise; }
      return receipt;
    } });
    // Observe the real host methods; no replacement buffer/flush algorithm.
    const flush = vi.spyOn(f.host as unknown as { flushRuntimeEvents(id: string): Promise<void> }, 'flushRuntimeEvents');
    const pending = vi.spyOn(f.host as unknown as { flushPendingAssistantDelta(id: string): Promise<void> }, 'flushPendingAssistantDelta');
    const id = await f.start(); await bounded(committed.promise);
    expect(f.store.getRootBinding(id)).toMatchObject({ phase: 'settled', status: 'completed' });
    // Cross the existing 50ms delta timer, but stay inside the original 2s deadline.
    await vi.advanceTimersByTimeAsync(100);
    expect(flush).not.toHaveBeenCalled(); expect(pending).not.toHaveBeenCalled();
    expect(f.postRunReads).toBe(0); expect(nativeWorker.starts - starts).toBe(0);
    const cold = new FileTaskSnapshotStore(join(f.root, 'tasks'));
    expect((await cold.recoverTask(id))?.events.filter(event => event.type === 'assistant_delta')).toEqual([]);

    ack.resolve(); await bounded(f.host.drain());
    expect(flush).toHaveBeenCalledOnce(); expect(pending).toHaveBeenCalledOnce();
    // A second cold store avoids reusing the pre-ACK reader's valid local cache.
    const saved = await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(id);
    expect(saved?.events.filter(event => event.type === 'assistant_delta')).toEqual([
      expect.objectContaining({ type: 'assistant_delta', delta }),
    ]);
    expect.soft(saved?.status).toBe('completed');
    expect.soft(hostDelivery(saved)?.guardFailure).toBeUndefined();
    expect.soft(hostDelivery(saved)).toMatchObject({ status: 'passed', hostSettlement: 'committed' });
    expect(nativeWorker.starts - starts).toBe(1); expect(nativeWorker.exits - exits).toBe(1);
  });

  it('D11 app shutdown aborts delivery but does not undo the sealed root', async () => {
    const f = await setup({ readOrdinal: 1, emit: answer }); const id = await f.start(); await bounded(f.readEntered.promise);
    f.host.abortAllActive('app_shutdown');
    for (let i = 0; i < 8; i++) await nextTurn();
    expect(f.rootSignal?.aborted).toBe(false);
    expect(f.reports.at(-1)?.delivery.guardFailure?.code).toBe('app_shutdown');
    expect(f.host.inFlightTaskIds()).toContain(id);
    f.readRelease.resolve(); await bounded(f.host.drain());
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)?.status).toBe('completed');
  });

  it('D12 ordinary keeps one automatic repair and does not gain delivery reports or snapshot fields', async () => {
    const f = await setup({ explicit: false, prompt: '生成一份报告和一份演示文稿', emit: async input => { await unfinishedPlan(input); await answer(input); } }); const id = await f.start(); await bounded(f.host.drain());
    expect(f.runnerCalls).toBe(2);
    expect((await f.host.inspectTask(id))?.status).toBe('completed');
    expect(f.reports).toEqual([]); expect(hostDelivery(await f.host.inspectTask(id))).toBeUndefined();
  });

  it('D12 ordinary still calls its custom gate rather than silently selecting explicit policy', async () => {
    const gate = vi.fn(async () => ({ complete: true }));
    const f = await setup({ explicit: false, completionGate: gate, prompt: '生成一份报告和一份演示文稿', emit: answer });
    const id = await f.start(); await bounded(f.host.drain());
    expect(gate).toHaveBeenCalledOnce(); expect(f.runnerCalls).toBe(1);
    expect(f.reports).toEqual([]); expect(hostDelivery(await f.host.inspectTask(id))).toBeUndefined();
  });

  it('D11/D12 ordinary without a group binding permits real user cancellation', async () => {
    const tail = deferred(); releases.push(() => tail.resolve());
    const f = await setup({ explicit: false, runnerTail: () => tail.promise }); const id = await f.start(); await bounded(f.rootSealed.promise);
    await f.host.cancelTask(id);
    expect(f.rootSignal?.aborted).toBe(true); expect(f.cancellations).toBe(1);
    tail.resolve(); await bounded(f.host.drain());
    expect((await f.host.inspectTask(id))?.status).toBe('cancelled'); expect(f.reports).toEqual([]);
  });

  it.each([65535, 65536, 65537])('D13 UTF-8 prompt byte boundary %i is not silently truncated or admitted above 64KiB', async bytes => {
    const f = await setup({ prompt: 'x'.repeat(bytes), emit: answer }); const id = await f.start(); await bounded(f.host.drain());
    const snapshot = await f.host.inspectTask(id);
    expect(Buffer.byteLength(snapshot!.prompt)).toBe(bytes);
    expect(snapshot?.status).toBe(bytes > 65536 ? 'failed' : 'completed');
    if (bytes > 65536) expect(hostDelivery(snapshot)?.guardFailure?.code).toBe('validation_limit');
    else expect(hostDelivery(snapshot)?.verification).toBe('passed');
    expect(f.runnerCalls).toBe(1);
  });
});
