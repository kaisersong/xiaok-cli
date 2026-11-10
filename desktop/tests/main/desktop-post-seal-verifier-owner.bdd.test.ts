// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { registerRawAccessDeadlineCase, registerHeldFileCapacityCases } from '../support/post-seal-callback-io-fixture.js';
import { join } from 'node:path';
import type { EventEmitter } from 'node:events';
import type { PassThrough } from 'node:stream';
import { taskHostDirectory, snapshotFixture, type VerifierContract } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { bounded, nextTurn } from '../fixtures/desktop-post-seal-harness.js';

interface WorkerDouble extends EventEmitter {
  stdout: PassThrough; stderr: PassThrough; request?: unknown;
  terminate: ReturnType<typeof vi.fn>; exit(code: number): void;
}
const sdk = vi.hoisted(() => ({ workers: [] as WorkerDouble[], constructorError: false, terminateError: false }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, open: vi.fn(actual.open), access: vi.fn(actual.access), read: vi.fn(actual.read), close: vi.fn(actual.close) };
});
vi.mock('node:worker_threads', async importNative => {
  const {preserveNativeWorkerGetters}=await import('../support/native-worker-fixture.js');
  const originalNative=await importNative<typeof import('node:worker_threads')>();

  const { EventEmitter } = await import('node:events'); const { PassThrough } = await import('node:stream');
  return { Worker: preserveNativeWorkerGetters(originalNative.Worker,class extends EventEmitter {
    stdout = new PassThrough(); stderr = new PassThrough(); request?: unknown;
    private finish!: (code: number) => void;
    private stopped = new Promise<number>(resolve => { this.finish = resolve; });
    constructor(_url: URL, options?: { workerData?: unknown }) {
      super(); if (sdk.constructorError) throw new Error('SDK constructor failed');
      this.request = options?.workerData; sdk.workers.push(this); queueMicrotask(() => this.emit('online'));
    }
    postMessage(value: unknown) { this.request = value; }
    terminate = vi.fn(() => sdk.terminateError ? Promise.reject(new Error('SDK terminate failed')) : this.stopped);
    exit(code: number) { this.emit('exit', code); this.finish(code); }
  }) };
});

describe('R4 verifier owner protocol and physical exit accounting (controlled SDK, not CPU evidence)', () => {
  afterEach(async () => {
    for (const worker of sdk.workers.splice(0)) { worker.exit(1); worker.stdout.destroy(); worker.stderr.destroy(); }
    sdk.constructorError = false; sdk.terminateError = false; vi.useRealTimers();
    await nextTurn();
  });
  async function owner() {
    const source = join(taskHostDirectory, 'delivery-verifier.ts');
    expect(existsSync(source), 'owner missing: SDK protocol assertions below are not yet reached').toBe(true);
    const module = await vi.importActual<VerifierContract>(source);
    expect(module.DeliveryVerifier).toBeTypeOf('function'); return new module.DeliveryVerifier();
  }
  function run(verifier: InstanceType<VerifierContract['DeliveryVerifier']>, signal = new AbortController().signal, deadline = performance.now() + 2000, snapshot = snapshotFixture()) {
    const raw: Promise<unknown>[] = [];
    const promise = verifier.verify(snapshot, { signal, deadline, trackPending: promise => raw.push(promise) });
    const outcome = promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    return { promise, outcome, raw };
  }
  async function workerAt(index: number) {
    for (let i = 0; i < 20 && !sdk.workers[index]?.request; i++) await nextTurn();
    const worker = sdk.workers[index]; expect(worker).toBeDefined(); expect(worker.request).toBeDefined(); return worker;
  }
  function frame(worker: WorkerDouble) {
    const request = typeof worker.request === 'string' ? JSON.parse(worker.request) : worker.request as { requestId: string };
    return { version: 1, requestId: request.requestId, result: { kind: 'facts', planComplete: true, emptyDelivery: true, guard: { kind: 'skip' } } };
  }
  const emit = (worker: WorkerDouble) => worker.emit('message', JSON.stringify(frame(worker)) + '\n');

  it.each(['zero-frame', 'two-frames', 'non-string', 'invalid-json', 'wrong-request', 'unknown-key', 'oversized-frame', 'stdout', 'stderr', 'error'] as const)('D7 rejects %s and only actual exit releases ownership', async attack => {
    const verifier = await owner(); const task = run(verifier); const worker = await workerAt(0);
    if (attack === 'two-frames') { emit(worker); emit(worker); }
    if (attack === 'non-string') worker.emit('message', frame(worker));
    if (attack === 'invalid-json') worker.emit('message', '{\n');
    if (attack === 'wrong-request') worker.emit('message', JSON.stringify({ ...frame(worker), requestId: 'foreign' }));
    if (attack === 'unknown-key') worker.emit('message', JSON.stringify({ ...frame(worker), module: 'node:fs' }));
    if (attack === 'oversized-frame') worker.emit('message', ' '.repeat(65537));
    if (attack === 'stdout' || attack === 'stderr') worker[attack].write('x');
    if (attack === 'error') worker.emit('error', new Error('SDK failed'));
    worker.exit(attack === 'error' ? 1 : 0);
    const result = await bounded(task.outcome);
    expect(result).toMatchObject({ ok: false, error: { code: attack === 'error' ? 'verifier_crashed' : attack === 'oversized-frame' ? 'validation_limit' : 'verifier_protocol_error' } });
  });

  it('D7 even an adversarial SDK exit before a queued valid message fails closed without late revival', async () => {
    // Deliberately stronger than the native SDK ordering. This is a protocol
    // defensive control, not evidence that Node emits message after final exit.
    const verifier = await owner(); const task = run(verifier); const worker = await workerAt(0);
    const response = JSON.stringify(frame(worker)) + '\n';
    const access = vi.mocked(fs.access).mock.calls.length, opens = vi.mocked(fs.open).mock.calls.length;
    worker.exit(0); queueMicrotask(() => worker.emit('message', response));
    const result = await bounded(task.outcome);
    expect(result).toMatchObject({ ok: false, error: { code: 'verifier_protocol_error' } });
    await nextTurn(); await Promise.all(task.raw);
    expect(await task.outcome).toBe(result);
    expect(vi.mocked(fs.access).mock.calls).toHaveLength(access);
    expect(vi.mocked(fs.open).mock.calls).toHaveLength(opens);
  });

  it.each(['stdout', 'stderr'] as const)('D7 caps the real %s stream at exactly 2048 bytes without declaring physical exit', async name => {
    const verifier = await owner(); const task = run(verifier); const worker = await workerAt(0);
    const stream = worker[name]; const destroy = vi.spyOn(stream, 'destroy');
    stream.write(Buffer.alloc(1024)); expect(stream.destroyed).toBe(false);
    stream.write(Buffer.alloc(1024));
    expect.soft(stream.destroyed).toBe(true); expect.soft(destroy).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    let drained = false; void task.raw[0].then(() => { drained = true; });
    await nextTurn(); expect(drained).toBe(false);
    worker.exit(1); expect(await task.outcome).toMatchObject({ ok: false, error: { code: 'verifier_protocol_error' } });
    await Promise.allSettled(task.raw); expect(drained).toBe(true);
  });

  it('D7 constructor rejection is visible and creates no phantom occupied attempt', async () => {
    const verifier = await owner(); sdk.constructorError = true;
    expect(await bounded(run(verifier).outcome)).toMatchObject({ ok: false, error: { code: 'verifier_start_failed' } });
    expect(sdk.workers).toHaveLength(0); sdk.constructorError = false;
    const retry = run(verifier); const worker = await workerAt(0); emit(worker); worker.exit(0);
    expect(await bounded(retry.outcome)).toMatchObject({ ok: true });
  });

  it('D7/D17 one valid frame before deadline but exit after deadline remains failed; late success never revives', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const verifier = await owner(); const task = run(verifier, undefined, performance.now() + 100); const worker = await workerAt(0);
    emit(worker); let settled = false; void task.outcome.then(() => { settled = true; }); await nextTurn(); expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100); worker.exit(0);
    expect(await bounded(task.outcome)).toMatchObject({ ok: false, error: { code: 'delivery_timeout' } });
  });

  it.each([499, 500])('D16 shared 500ms exit grace, actual SDK exit at %ims is not manufactured by a timer', async exitAt => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const verifier = await owner(); const a = new AbortController(); const first = run(verifier, a.signal); const worker = await workerAt(0);
    a.abort(new Error('app_shutdown')); await vi.advanceTimersByTimeAsync(exitAt);
    const second = run(verifier); await workerAt(1);
    const third = run(verifier);
    expect(await bounded(third.outcome)).toMatchObject({ ok: false, error: { code: 'verifier_capacity' } });
    expect(sdk.workers).toHaveLength(2); // even 500ms did not synthesize an exit
    worker.exit(1); await bounded(first.outcome);
    const fourth = run(verifier); const admitted = await workerAt(2); emit(admitted); admitted.exit(0);
    expect(await bounded(fourth.outcome)).toMatchObject({ ok: true });
    sdk.workers[1].exit(1); await bounded(second.outcome);
  });

  it('D16 terminate rejects but two physically live Workers still refuse a third attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const verifier = await owner(); sdk.terminateError = true;
    const controllers = [new AbortController(), new AbortController()]; const tasks = controllers.map(controller => run(verifier, controller.signal));
    await workerAt(1); controllers.forEach(controller => controller.abort(new Error('app_shutdown')));
    await vi.advanceTimersByTimeAsync(500);
    expect(await bounded(run(verifier).outcome)).toMatchObject({ ok: false, error: { code: 'verifier_capacity' } });
    expect(sdk.workers).toHaveLength(2);
    sdk.workers.forEach(worker => worker.exit(1)); await Promise.all(tasks.map(task => task.outcome));
  });

  it('D16 host receives a physical receipt still pending after 500ms outward failure, until real SDK exit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const verifier = await owner(); const controller = new AbortController(); const task = run(verifier, controller.signal); const worker = await workerAt(0);
    expect.soft(task.raw).toHaveLength(1);
    let drained = false; if (task.raw.length > 0) void task.raw[0].then(() => { drained = true; });
    controller.abort(new Error('app_shutdown')); await vi.advanceTimersByTimeAsync(500);
    expect(await bounded(task.outcome)).toMatchObject({ ok: false }); expect(drained).toBe(false);
    worker.exit(1); await Promise.all(task.raw); expect(drained).toBe(true);
  });

  it('D17 wall clock rollback does not extend the monotonic deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
    const verifier = await owner(); const task = run(verifier, undefined, performance.now() + 100); const worker = await workerAt(0);
    vi.setSystemTime(Date.now() - 60_000); await vi.advanceTimersByTimeAsync(100); emit(worker); worker.exit(0);
    expect(await bounded(task.outcome)).toMatchObject({ ok: false, error: { code: 'delivery_timeout' } });
  });

  it('D17 budget spent during bounded DTO capture starts no Worker', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const verifier = await owner(); const snapshot = snapshotFixture();
    Object.defineProperty(snapshot, 'prompt', { get: () => { vi.advanceTimersByTime(101); return 'Hello'; } });
    const task = run(verifier, undefined, performance.now() + 100, snapshot);
    expect.soft(sdk.workers).toHaveLength(0);
    await nextTurn(); await vi.advanceTimersByTimeAsync(500);
    expect(await bounded(task.outcome)).toMatchObject({ ok: false, error: { code: 'delivery_timeout' } });
  });

  registerRawAccessDeadlineCase({ owner, run, workerAt, frame, sdk });

  it.each([65535, 65536, 65537])('D13 exact Worker output frame %i bytes includes the newline and is checked before parse/IO', async size => {
    const verifier = await owner(); const snapshot = snapshotFixture({ prompt: '解释结果', events: [{ type: 'result', result: { summary: 'fixture answer', artifacts: [] } }] });
    const task = run(verifier, undefined, performance.now() + 2000, snapshot); const worker = await workerAt(0);
    const value = frame(worker); const evidence = { ownerKind: 'task', ownerId: snapshot.taskId, kind: 'answer', summary: '', metadata: { responseId: `${snapshot.taskId}:result:0` } };
    Object.assign(value.result, { emptyDelivery: false, guard: { kind: 'evaluate', expectation: { ownerKind: 'task', ownerId: snapshot.taskId,
      expectedKinds: ['answer'], source: 'legacy_classifier', confidence: 'inferred' }, evidence: [evidence] } });
    evidence.summary = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(value) + '\n'));
    const frameText = JSON.stringify(value) + '\n'; expect(Buffer.byteLength(frameText)).toBe(size);
    worker.emit('message', frameText); worker.exit(0);
    expect(await bounded(task.outcome)).toMatchObject(size > 65536 ? { ok: false, error: { code: 'validation_limit' } } : { ok: true });
  });

  it.each(['stdout', 'stderr'] as const)('D13 any %s bytes reject; above 2048B destroys that stream instead of forwarding contents', async stream => {
    const verifier = await owner(); const task = run(verifier); const worker = await workerAt(0);
    worker[stream].write('PRIVATE_TEST_BYTES'.repeat(200));
    await nextTurn(); expect(worker[stream].destroyed).toBe(true); expect(worker.terminate).toHaveBeenCalledOnce();
    worker.exit(1);
    expect(await bounded(task.outcome)).toMatchObject({ ok: false, error: { code: 'verifier_protocol_error' } });
  });

  registerHeldFileCapacityCases({ owner, run, workerAt, frame, sdk });

});
