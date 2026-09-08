// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Worker } from 'node:worker_threads';
import { rmSync } from 'node:fs';
import { DeliveryVerifier } from '../../../src/runtime/task-host/delivery-verifier.js';
import { HostDeliveryAttempt } from '../../../src/runtime/task-host/delivery-attempt.js';
import { randomUUID } from 'node:crypto';
import { compileVerifierEntry, snapshotFixture } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { bounded, createPostSealHarness, deferred } from '../fixtures/desktop-post-seal-harness.js';

interface NativeOwner {
  worker: Worker; online: Promise<void>; exit: Promise<number>; isExited(): boolean;
  releaseRequest(): void; terminateCalls(): number;
}
const sdk = vi.hoisted(() => ({ output: '', workers: [] as NativeOwner[], onCreated: undefined as ((owner: NativeOwner) => void) | undefined }));
vi.mock('node:worker_threads', async importOriginal => {
  const actual = await importOriginal<typeof import('node:worker_threads')>();
  return { ...actual, Worker: class extends actual.Worker {
    constructor(filename: ConstructorParameters<typeof actual.Worker>[0], options?: ConstructorParameters<typeof actual.Worker>[1]) {
      // The sole substitution is resolution of the fixed production .js URL
      // to its real compiled source. Worker execution/events/exit are native.
      expect(filename).toEqual(new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url));
      super(sdk.output, options);
      const requests: unknown[] = []; const post = this.postMessage.bind(this);
      // Hold the SDK request boundary so that timer assertions cannot race a
      // fast genuine response. Releasing invokes the original postMessage.
      this.postMessage = (value: unknown) => { requests.push(value); };
      const terminate = vi.spyOn(this as Worker, 'terminate'); let exited = false;
      const online = new Promise<void>((resolve, reject) => { this.once('online', resolve); this.once('error', reject); });
      const exit = new Promise<number>(resolve => this.once('exit', code => { exited = true; resolve(code); }));
      const owner: NativeOwner = { worker: this, online, exit, isExited: () => exited,
        releaseRequest: () => { for (const request of requests.splice(0)) post(request); },
        terminateCalls: () => terminate.mock.calls.length };
      sdk.workers.push(owner); sdk.onCreated?.(owner);
    }
  } };
});

interface CapturedTimer { delay: number; fire(): void; isPending(): boolean }
const cleanup: Array<() => Promise<void> | void> = [];
let compiled: Awaited<ReturnType<typeof compileVerifierEntry>>;
beforeAll(async () => { compiled = await compileVerifierEntry('delivery-verifier-worker.ts'); sdk.output = compiled.output; });
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
  for (const owner of sdk.workers.splice(0)) {
    if (!owner.isExited()) await owner.worker.terminate();
    await owner.exit;
  }
  sdk.onCreated = undefined;
  vi.restoreAllMocks();
});
afterAll(() => { if (compiled) rmSync(compiled.root, { recursive: true, force: true, maxRetries: 3 }); });

function controlClock(start: number) {
  let now = start;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const timers: CapturedTimer[] = [];
  const nativeSetTimeout = globalThis.setTimeout; const nativeClearTimeout = globalThis.clearTimeout;
  const handles: ReturnType<typeof setTimeout>[] = [];
  const pending = new Set<ReturnType<typeof setTimeout>>();
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(handle => {
    pending.delete(handle as ReturnType<typeof setTimeout>); nativeClearTimeout(handle);
  });
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
    // Only scheduling is controlled: fire() calls the actual production
    // callback with no reimplementation of its deadline/abort decision.
    const handle = nativeSetTimeout(() => {}, 2 ** 31 - 1); handles.push(handle); pending.add(handle);
    timers.push({ delay: delay ?? 0, fire: () => { pending.delete(handle); nativeClearTimeout(handle); callback(...args); },
      isPending: () => pending.has(handle) });
    return handle;
  }) as typeof globalThis.setTimeout);
  cleanup.push(() => { for (const handle of handles) nativeClearTimeout(handle); });
  return { timers, set: (value: number) => { now = value; }, pendingTimers: () => pending.size };
}

describe('R4 absolute deadline callbacks never manufacture a premature timeout', () => {
  it('keeps the real Worker alive at deadline minus 0.25ms, then fails only at the deadline and drains native exit', async () => {
    const clock = controlClock(1000.125); const deadline = 3000.375;
    const raw: Promise<unknown>[] = [];
    const result = new DeliveryVerifier().verify(snapshotFixture(), { deadline, signal: new AbortController().signal, trackPending: promise => raw.push(promise) })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    const owner = sdk.workers.at(-1)!; await bounded(owner.online);
    expect(clock.timers).toHaveLength(1); const timer = clock.timers[0];
    expect(timer.delay).toBeGreaterThan(0);
    let settled = false; void result.then(() => { settled = true; });
    clock.set(deadline - 0.25); timer.fire();
    expect.soft(owner.terminateCalls()).toBe(0); expect.soft(settled).toBe(false);
    const rearmed = clock.timers.slice(1).find(value => value.delay > 0 && value.delay <= 1);
    expect.soft(rearmed, 'the remaining fraction needs one later check against the same absolute deadline').toBeDefined();
    clock.set(deadline); (rearmed ?? timer).fire();
    expect(owner.terminateCalls()).toBe(1);
    expect(await bounded(result)).toMatchObject({ ok: false, error: { code: 'delivery_timeout' } });
    await bounded(owner.exit); await bounded(Promise.all(raw));
    expect(owner.isExited()).toBe(true); expect(clock.pendingTimers()).toBe(0);
  });

  it('can still accept a genuine response and native exit before the deadline after an early timer callback', async () => {
    const clock = controlClock(1000.125); const deadline = 3000.375;
    const raw: Promise<unknown>[] = [];
    const result = new DeliveryVerifier().verify(snapshotFixture(), { deadline, signal: new AbortController().signal, trackPending: promise => raw.push(promise) })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    const owner = sdk.workers.at(-1)!; await bounded(owner.online);
    clock.set(deadline - 0.25); clock.timers[0].fire();
    expect.soft(owner.terminateCalls()).toBe(0);
    owner.releaseRequest();
    expect(await bounded(result)).toMatchObject({ ok: true });
    expect(await bounded(owner.exit)).toBe(0); await bounded(Promise.all(raw));
    expect(owner.terminateCalls()).toBe(0); expect(clock.pendingTimers()).toBe(0);
  });

  it('caps a distant deadline to one native timer span and removes the timer on abort without leaking its native Worker', async () => {
    const clock = controlClock(1000.125); const deadline = 1000.125 + 2 ** 31 + 1000;
    const controller = new AbortController(); const raw: Promise<unknown>[] = [];
    const result = new DeliveryVerifier().verify(snapshotFixture(), { deadline, signal: controller.signal, trackPending: promise => raw.push(promise) })
      .then(value => ({ ok: true, value }), error => ({ ok: false, error }));
    const owner = sdk.workers.at(-1)!; await bounded(owner.online);
    expect.soft(clock.timers[0].delay).toBeLessThanOrEqual(2 ** 31 - 1);
    const reason = new Error('user_aborted'); controller.abort(reason);
    expect(await bounded(result)).toMatchObject({ ok: false, error: reason });
    await bounded(owner.exit); await bounded(Promise.all(raw));
    expect(owner.terminateCalls()).toBe(1); expect(clock.pendingTimers()).toBe(0);
  });

  it('HostDeliveryAttempt already checks the same monotonic boundary and does not fail early without a timer', () => {
    const clock = controlClock(1000.125); const deadline = 3000.375;
    const attempt = new HostDeliveryAttempt({ sourceTaskId: 'task-deadline', groupId: randomUUID(), rootTurnId: randomUUID(),
      rootEpoch: 1, preparationId: randomUUID(), bootId: randomUUID() }, deadline, 10, 2010, () => 10);
    clock.set(deadline - 0.25); expect(() => attempt.assertActive()).not.toThrow();
    expect(attempt.record.verification).toBe('pending'); expect(attempt.controller.signal.aborted).toBe(false);
    clock.set(deadline); expect(() => attempt.assertActive()).toThrow('delivery_timeout');
    expect(attempt.record.verification).toBe('failed'); expect(attempt.controller.signal.aborted).toBe(true);
    expect(clock.timers).toEqual([]);
  });

  it('the explicit host watchdog sibling must not abort the delivery phase before that same deadline', async () => {
    const start = 1000.125; const watchdogMs = 2000; const deadline = start + watchdogMs;
    const clock = controlClock(start);
    const f = await createPostSealHarness({ prompt: 'Hello', spawnChild: false, readOrdinal: 1, watchdogMs });
    cleanup.push(() => f.close());
    await f.start(); await bounded(f.readEntered.promise);
    const timer = clock.timers.find(value => value.delay === watchdogMs)!;
    expect(timer).toBeDefined(); expect(f.reports).toHaveLength(1);
    expect(f.reports[0].delivery).toMatchObject({ status: 'checking', verification: 'pending' });
    clock.set(deadline - 0.25); timer.fire();
    expect.soft(f.reports.filter(report => report.delivery.verification === 'failed'), 'the host timer bypasses the verifier timer and owns the same deadline').toHaveLength(0);
    const rearmed = clock.timers.find(value => value !== timer && value.delay > 0 && value.delay <= 1);
    expect.soft(rearmed).toBeDefined();
    clock.set(deadline); (rearmed ?? timer).fire();
    expect(f.reports.at(-1)?.delivery).toMatchObject({ verification: 'failed', guardFailure: { code: 'delivery_timeout' } });
    expect(sdk.workers).toHaveLength(0); // the genuine snapshot IO barrier precedes CPU start
    f.readRelease.resolve(); await bounded(f.host.drain());
    expect(f.tokenReleases).toBe(1);
  });

  it('successful explicit delivery clears a rearmed host watchdog after real verification and native exit', async () => {
    const start = 1000.125; const watchdogMs = 2000; const deadline = start + watchdogMs;
    const clock = controlClock(start);
    const f = await createPostSealHarness({ prompt: 'Hello', spawnChild: false, readOrdinal: 1, watchdogMs });
    cleanup.push(() => f.close());
    const taskId = await f.start(); await bounded(f.readEntered.promise);
    const timer = clock.timers.find(value => value.delay === watchdogMs)!;
    clock.set(deadline - 0.25); timer.fire();
    const rearmed = clock.timers.find(value => value !== timer && value.delay > 0 && value.delay <= 1);
    expect(rearmed?.isPending()).toBe(true);
    const created = deferred<NativeOwner>(); sdk.onCreated = created.resolve;
    f.readRelease.resolve();
    const owner = await bounded(created.promise); await bounded(owner.online); owner.releaseRequest();
    await bounded(f.host.drain());
    expect(await f.host.inspectTask(taskId)).toMatchObject({ status: 'completed', hostDelivery: { status: 'passed' } });
    expect(owner.isExited()).toBe(true); expect(owner.terminateCalls()).toBe(0);
    expect(rearmed?.isPending()).toBe(false); expect(clock.pendingTimers()).toBe(0);
    expect(f.tokenReleases).toBe(1);
  });
});
