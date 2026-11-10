import { expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EventEmitter } from 'node:events';
import type { PassThrough } from 'node:stream';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { snapshotFixture, type VerifierContract } from '../fixtures/desktop-post-seal-verifier-contract.js';
import { bounded, deferred, nextTurn } from '../fixtures/desktop-post-seal-harness.js';

export interface CallbackWorkerDouble extends EventEmitter {
  stdout: PassThrough; stderr: PassThrough; request?: unknown;
  terminate: ReturnType<typeof vi.fn>; exit(code: number): void;
}
interface TrackedTask {
  promise: Promise<unknown>;
  outcome: Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
  raw: Promise<unknown>[];
}
type Verifier = InstanceType<VerifierContract['DeliveryVerifier']>;
export interface CallbackOwnerFixture {
  owner(): Promise<Verifier>;
  run(verifier: Verifier, signal?: AbortSignal, deadline?: number, snapshot?: TaskSnapshot): TrackedTask;
  workerAt(index: number): Promise<CallbackWorkerDouble>;
  frame(worker: CallbackWorkerDouble): { version: number; requestId: string; result: object };
  sdk: { workers: CallbackWorkerDouble[] };
}
const settle = (raw: readonly Promise<unknown>[]) => Promise.allSettled(raw);
const call = (callback: unknown, values: unknown[]) => {
  if (typeof callback !== 'function') throw new Error('fixture_native_callback_required');
  Reflect.apply(callback, undefined, values);
};

export function registerRawAccessDeadlineCase(f: CallbackOwnerFixture): void {
  it('D17 a raw access settling after the monotonic deadline starts no open even before the timer callback runs', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const verifier = await f.owner(); const root = fs.mkdtempSync(join(tmpdir(), 'xiaok-post-seal-effect-deadline-'));
    const path = join(root, 'artifact.pdf'); fs.writeFileSync(path, '%PDF-1.7'); const uri = pathToFileURL(path).href;
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const baselineOpens = vi.mocked(fs.open).mock.calls.length;
    let accessCallbacks = 0;
    vi.mocked(fs.access).mockImplementation((...args: unknown[]) => {
      expect(args[0]).toBe(new URL(uri).pathname);
      const returned = Reflect.apply(actual.access, actual, [path, ...args.slice(1, -1), (...values: unknown[]) => {
        accessCallbacks++; vi.advanceTimersByTime(101); call(args.at(-1), values);
      }]);
      expect(returned).toBeUndefined();
    });
    const snapshot = snapshotFixture({ prompt: '生成 PDF 文件' });
    const deadline = performance.now() + 100;
    const task = f.run(verifier, undefined, deadline, snapshot); const worker = await f.workerAt(0);
    const value = f.frame(worker);
    Object.assign(value.result, { guard: { kind: 'evaluate', expectation: { ownerKind: 'task', ownerId: snapshot.taskId,
      expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' }, evidence: [{ ownerKind: 'task', ownerId: snapshot.taskId,
      kind: 'file_artifact', summary: 'PDF', uri, metadata: { kind: 'pdf' } }] } });
    try {
      worker.emit('message', JSON.stringify(value) + '\n'); worker.exit(0);
      expect(await bounded(task.outcome)).toMatchObject({ ok: false, error: { code: 'delivery_timeout' } });
      expect(performance.now()).toBeGreaterThanOrEqual(deadline);
      expect(accessCallbacks).toBe(1);
      expect(vi.mocked(fs.open).mock.calls.length - baselineOpens).toBe(0);
      // fs.access returns void. Only the original producer's trackPending Promises are awaited.
      expect(vi.mocked(fs.access).mock.results.at(-1)!.value).toBeUndefined();
      expect(task.raw.length).toBeGreaterThan(1); expect(task.raw.every(raw => raw instanceof Promise)).toBe(true);
    } finally {
      await settle(task.raw); vi.mocked(fs.access).mockImplementation(actual.access);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

export function registerHeldFileCapacityCases(f: CallbackOwnerFixture): void {
  it.each((['abort', 'deadline'] as const).flatMap(cause => (['open', 'read'] as const).map(phase => ({ cause, phase }))))(
    'D6/D16/D17 CPU exited but raw $phase/close pending at $cause keeps both slots (controlled SDK contract, not Windows native IO)', async ({ cause, phase }) => {
      const verifier = await f.owner();
      const root = fs.mkdtempSync(join(tmpdir(), 'xiaok-post-seal-sdk-')); const path = join(root, 'artifact.pdf'); fs.writeFileSync(path, '%PDF-1.7');
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      // Map only this controlled legacy URI to a real owned file, without claiming Windows URI correctness.
      const legacyPath = new URL(pathToFileURL(path).href).pathname;
      const opened = deferred(), openRelease = deferred(), closing = deferred(), closeRelease = deferred();
      interface Row { fd: number; reads: number; closes: number; nativeCloseDone: boolean; closeError: unknown; openDelivered: number; readDelivered: number; closeDelivered: number }
      const rows: Row[] = [];
      const callbackErrors: unknown[] = [];
      vi.mocked(fs.access).mockImplementation((...args: unknown[]) => {
        expect(args[0]).toBe(legacyPath);
        return Reflect.apply(actual.access, actual, [path, ...args.slice(1)]);
      });
      vi.mocked(fs.open).mockImplementation((...args: unknown[]) => {
        expect(args[0]).toBe(legacyPath);
        return Reflect.apply(actual.open, actual, [path, ...args.slice(1, -1), (...values: unknown[]) => {
          if (values[0] !== null) callbackErrors.push(values[0]);
          const row: Row = { fd: values[1] as number, reads: 0, closes: 0, nativeCloseDone: false, closeError: undefined,
            openDelivered: 0, readDelivered: 0, closeDelivered: 0 };
          rows.push(row);
          if (phase === 'open' && rows.length === 2) opened.resolve();
          const deliver = () => { row.openDelivered++; call(args.at(-1), values); };
          if (phase === 'open') void openRelease.promise.then(deliver); else deliver();
        }]);
      });
      vi.mocked(fs.read).mockImplementation((...args: unknown[]) => {
        const row = rows.find(item => item.fd === args[0]); if (!row) throw new Error('fixture_foreign_read_fd');
        row.reads++;
        return Reflect.apply(actual.read, actual, [...args.slice(0, -1), (...values: unknown[]) => {
          if (values[0] !== null) callbackErrors.push(values[0]);
          const deliver = () => { row.readDelivered++; call(args.at(-1), values); };
          if (phase === 'read') {
            if (rows.length === 2 && rows.every(item => item.reads === 1)) opened.resolve();
            void openRelease.promise.then(deliver);
          } else deliver();
        }]);
      });
      vi.mocked(fs.close).mockImplementation((...args: unknown[]) => {
        const row = rows.find(item => item.fd === args[0]); if (!row) throw new Error('fixture_foreign_close_fd');
        row.closes++;
        return Reflect.apply(actual.close, actual, [...args.slice(0, -1), (...values: unknown[]) => {
          row.nativeCloseDone = true; row.closeError = values[0];
          if (values[0] !== null) callbackErrors.push(values[0]);
          if (rows.length === 2 && rows.every(item => item.nativeCloseDone)) closing.resolve();
          void closeRelease.promise.then(() => { row.closeDelivered++; call(args.at(-1), values); });
        }]);
      });
      const snapshot = snapshotFixture({ prompt: '生成 PDF 文件', events: [
        { type: 'artifact_recorded', artifactId: 'a', kind: 'pdf', label: 'PDF', filePath: pathToFileURL(path).href, previewAvailable: false, turnId: 'turn' },
      ] });
      const controllers = [new AbortController(), new AbortController()];
      const tasks = controllers.map(controller => f.run(verifier, controller.signal, performance.now() + (cause === 'deadline' ? 100 : 3000), snapshot));
      let rawSettled = false;
      try {
        for (let index = 0; index < 2; index++) {
          const worker = await f.workerAt(index); const value = f.frame(worker);
          Object.assign(value.result, { guard: { kind: 'evaluate', expectation: { ownerKind: 'task', ownerId: snapshot.taskId,
            expectedKinds: ['file_artifact'], source: 'task_spec', confidence: 'explicit' }, evidence: [{ ownerKind: 'task', ownerId: snapshot.taskId,
            kind: 'file_artifact', summary: 'PDF', uri: pathToFileURL(path).href, metadata: { artifactId: 'a', kind: 'pdf' } }] } });
          worker.emit('message', JSON.stringify(value) + '\n'); worker.exit(0);
        }
        await bounded(opened.promise);
        expect(rows).toHaveLength(2); expect(callbackErrors).toEqual([]);
        expect(rows.every(row => phase === 'open' ? row.openDelivered === 0 : row.readDelivered === 0)).toBe(true);
        expect(tasks.every(task => task.raw.length > 1 && task.raw.every(raw => raw instanceof Promise))).toBe(true);
        void settle(tasks.flatMap(task => task.raw)).then(() => { rawSettled = true; });
        if (cause === 'deadline') await new Promise(resolve => setTimeout(resolve, 110));
        else controllers.forEach(controller => controller.abort(new Error('app_shutdown')));
        expect(await bounded(f.run(verifier).outcome)).toMatchObject({ ok: false, error: { code: 'verifier_capacity' } });
        expect(f.sdk.workers).toHaveLength(2); expect(rawSettled).toBe(false);
        openRelease.resolve(); await bounded(closing.promise);
        for (const row of rows) { expect(row.reads).toBe(phase === 'open' ? 0 : 1); expect(row.closes).toBe(1); expect(row.nativeCloseDone).toBe(true); expect(row.closeDelivered).toBe(0); }
        expect(callbackErrors).toEqual([]); expect(rawSettled).toBe(false);
        expect(await bounded(f.run(verifier).outcome)).toMatchObject({ ok: false, error: { code: 'verifier_capacity' } });
        expect(f.sdk.workers).toHaveLength(2); closeRelease.resolve();
        await Promise.all(tasks.map(task => task.outcome)); await settle(tasks.flatMap(task => task.raw)); await nextTurn();
        expect(rawSettled).toBe(true);
        for (const row of rows) { expect(row.openDelivered).toBe(1); expect(row.readDelivered).toBe(phase === 'open' ? 0 : 1); expect(row.closeDelivered).toBe(1); }
        const next = f.run(verifier); const worker = await f.workerAt(2); worker.emit('message', JSON.stringify(f.frame(worker)) + '\n'); worker.exit(0);
        expect(await bounded(next.outcome)).toMatchObject({ ok: true });
      } finally {
        openRelease.resolve(); closeRelease.resolve(); controllers.forEach(controller => controller.abort());
        await settle(tasks.flatMap(task => task.raw));
        vi.mocked(fs.open).mockImplementation(actual.open); vi.mocked(fs.read).mockImplementation(actual.read);
        vi.mocked(fs.close).mockImplementation(actual.close); vi.mocked(fs.access).mockImplementation(actual.access);
        // Only clean a real test-owned fd if production never completed its negative close.
        await Promise.allSettled(rows.filter(row => !row.nativeCloseDone).map(row => new Promise<void>((resolve, reject) => {
          actual.close(row.fd, error => error ? reject(error) : resolve());
        })));
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
      }
    });
}
