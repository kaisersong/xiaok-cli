import { types as nativeTypes } from 'node:util';
// The test account home is isolated; native UID/PID and production facts remain real.
// Real owner process. The runner is controlled, but host/core/seal, SQLite,
// checkpoint/journal and the actual native CPU Worker are not substituted.
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import workerThreads from 'node:worker_threads';
import fsPromises from 'node:fs/promises';
import { build } from 'esbuild';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { createPassiveTrace, createPassiveOpenObserver, installPassiveMethodObserver, observePassiveSettlement, passiveVerifierOptionFields } from './desktop-post-seal-passive-trace.js';

const [root, mode] = process.argv.slice(2);
if (!root || !['cpu', 'fifo', 'before-marker', 'marker-transaction', 'marker-committed', 'snapshot', 'goal-snapshot', 'goal-snapshot-last-turn',
  'before-host-write', 'host-committed', 'projection-committed'].includes(mode)) throw new Error('invalid fixture input');
const out = (event: object) => writeSync(1, JSON.stringify(event) + '\n');
const d10Trace = mode === 'before-host-write' ? createPassiveTrace() : undefined;
const markD10 = (stage: string) => { try { d10Trace?.record(stage); } catch { /* Diagnostic failure does not affect original execution. */ } };
markD10('owner-entry');
const safeD10Snapshot = () => { try { return d10Trace?.snapshot(); } catch { return undefined; } };
// Source-mode fixture only: map the one fixed production .js URL to that
// exact TS entry compiled into the fixture-owned directory. No eval Worker,
// fake classifier/result/exit, production fallback, or configurable task URL.
const workerSource = new URL('../../../src/runtime/task-host/delivery-verifier-worker.ts', import.meta.url);
const workerUrl = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
const workerOutput = join(root, 'delivery-verifier-worker.mjs');
markD10('worker-build-before');
await build({ entryPoints: [fileURLToPath(workerSource)], outfile: workerOutput, bundle: true, platform: 'node', format: 'esm' });
markD10('worker-build-after');
const trace = mode === 'fifo' ? createPassiveTrace() : undefined;
const nativeProtectionUrlGetter = Object.getOwnPropertyDescriptor(URL.prototype, 'href')?.get;
function protectionWorkerUrl(filename: unknown): string | undefined {
  try {
    if (!filename || typeof filename !== 'object' || nativeTypes.isProxy(filename) || !nativeProtectionUrlGetter) return undefined;
    return Reflect.apply(nativeProtectionUrlGetter, filename, []);
  } catch { return undefined; }
}
const protectionSourceUrl = new URL('../../../src/runtime/task-host/protection-read-worker.ts', import.meta.url).href;
let nextProtectionToken = 0;
const protectionMark = (stage: string, token: number, threadId?: number) => { try { d10Trace?.record(stage, { token, ...(typeof threadId === 'number' ? { threadId } : {}) }); } catch { /* Passive only. */ } };
const NativeWorker = workerThreads.Worker;
const ObservedWorker = workerThreads.Worker = class extends NativeWorker {
  constructor(filename: ConstructorParameters<typeof NativeWorker>[0], options?: ConstructorParameters<typeof NativeWorker>[1]) {
    const mapped = filename instanceof URL && filename.href === workerUrl;
    const protectionToken = mode === 'before-host-write' && protectionWorkerUrl(filename) === protectionSourceUrl ? ++nextProtectionToken : undefined;
    if (protectionToken !== undefined) protectionMark('child-protection-worker-constructor-before', protectionToken);
    if (mapped) trace?.record('worker-constructor-start');
    super(mapped ? workerOutput : filename, options);
    if (protectionToken !== undefined) {
      try {
        protectionMark('child-protection-worker-constructor-after', protectionToken, this.threadId);
        this.once('online', () => protectionMark('child-protection-worker-online', protectionToken));
        this.once('message', () => protectionMark('child-protection-worker-message', protectionToken));
        this.once('exit', () => protectionMark('child-protection-worker-exit', protectionToken));
      } catch { protectionMark('observer-error', protectionToken); }
    }
    if (mapped) {
      trace?.record('worker-constructor-return', { threadId: this.threadId });
      if (trace) {
        const threadId = this.threadId;
        this.once('online', () => trace.record('worker-online', { threadId }));
        this.on('message', () => trace.record('worker-message', { threadId }));
      }
      out({ stage: 'native-worker-start', threadId: this.threadId });
      this.once('exit', code => {
        trace?.record('worker-exit', { code });
        out({ stage: 'native-worker-exit', code });
      });
    }
  }
};
const originalOpen = fsPromises.open;
const passiveOpen = trace ? createPassiveOpenObserver(originalOpen, join(root, 'pending.pdf'), trace) : undefined;
if (passiveOpen) fsPromises.open = passiveOpen.open;
syncBuiltinESMExports();
let restoreVerifier = () => {};
let restoreRecovery = () => {};
if (trace) {
  // The harness already imports this same source module before task start.
  // Importing the class does not instantiate or prewarm a native Worker.
  const { DeliveryVerifier } = await import('../../../src/runtime/task-host/delivery-verifier.js');
  restoreVerifier = installPassiveMethodObserver(DeliveryVerifier.prototype, 'verify', trace, 'verifier',
    args => passiveVerifierOptionFields(args[1]));
}
// SIGKILL remains the test's existing cleanup boundary. Restore only our own
// process-local observers if an unrelated normal exit does occur.
if (passiveOpen) process.once('exit', () => {
  try {
    passiveOpen.restoreHandles();
    restoreVerifier(); restoreRecovery();
    if (fsPromises.open === passiveOpen.open) fsPromises.open = originalOpen;
    if (workerThreads.Worker === ObservedWorker) workerThreads.Worker = NativeWorker;
    syncBuiltinESMExports();
  } catch { trace?.record('observer-error'); }
});
const { createPostSealHarness, hostDelivery } = await import('./desktop-post-seal-harness.js');
const stop = () => { const cell = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(cell, 0, 0); };
let taskId = '';
markD10('harness-before');
const f = await createPostSealHarness({ root, passiveTrace: trace, readOrdinal: mode === 'snapshot' || mode.startsWith('goal-snapshot') ? 1 : undefined,
  snapshotStore: ['before-host-write', 'host-committed'].includes(mode) ? directory => new class extends FileTaskSnapshotStore {
    override async save(snapshot: TaskSnapshot, previous?: TaskSnapshot) {
      if (mode === 'before-host-write' && snapshot.status === 'completed') { markD10('before-host-write-boundary'); out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId, d10Trace: safeD10Snapshot() }); stop(); }
      await super.save(snapshot, previous);
      if (mode === 'host-committed' && snapshot.status === 'completed') { out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); stop(); }
    }
  }(directory) : undefined,
  watchdogMs: mode === 'cpu' || mode === 'fifo' ? 100 : 2000,
  prompt: mode === 'cpu' ? 'create' + ' '.repeat(65529) + 'x' : mode === 'fifo' ? '生成 PDF 文件' : 'Hello',
  emit: mode === 'fifo' ? input => input.emitRuntimeEvent({ type: 'artifact_recorded', sessionId: input.sessionId,
    turnId: 'turn', intentId: 'intent', stageId: 'stage', artifactId: 'pdf', kind: 'file', label: 'PDF', path: pathToFileURL(join(root, 'pending.pdf')).href })
    : mode.startsWith('goal-snapshot') ? input => input.emitUsage({ inputTokens: 7, outputTokens: 11 }) : undefined,
  runnerTail: async () => {
    markD10('post-seal-observed');
    trace?.record('sealed');
    out({ stage: 'sealed', taskId, groupId: f.groupId, childId: f.childId, pid: process.pid });
    if (mode === 'before-marker') stop();
    if (mode === 'cpu' || mode === 'fifo') {
      const started = performance.now();
      setTimeout(() => {
        trace?.record('heartbeat');
        out({ stage: 'heartbeat', elapsed: performance.now() - started });
      }, 50);
    }
  },
  report: async (report, persist) => {
    trace?.record('delivery-report-enter', { revision: report.delivery.revision, deliveryStage: report.delivery.stage,
      verification: report.delivery.verification, startedAt: report.delivery.startedAt,
      deadlineAt: report.delivery.deadlineAt, guardCode: report.delivery.guardFailure?.code ?? null });
    if (mode === 'projection-committed' && report.delivery.hostSettlement === 'committed') {
      await persist(); out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); stop();
    }
    if (report.delivery.revision !== 1) {
      trace?.record('report-persist-call', { revision: report.delivery.revision });
      const raw = persist();
      if (trace) observePassiveSettlement(raw, () => trace.record('report-persist-return', { revision: report.delivery.revision }),
        () => trace.record('report-persist-reject', { revision: report.delivery.revision }), trace);
      return raw;
    }
    if (mode === 'marker-transaction') {
      const put = f.store.putRootBinding.bind(f.store);
      f.store.putRootBinding = (binding, control) => {
        put(binding, control);
        if ('delivery' in binding) { out({ stage: 'marker-transaction', taskId, groupId: f.groupId, childId: f.childId }); stop(); }
      };
    }
    trace?.record('report-persist-call', { revision: report.delivery.revision });
    const receipt = await persist();
    trace?.record('report-persist-return', { revision: report.delivery.revision });
    if (mode === 'marker-committed') { out({ stage: 'marker-committed', taskId, groupId: f.groupId, childId: f.childId }); stop(); }
    return receipt;
  },
});
markD10('harness-after');
if (trace) restoreRecovery = installPassiveMethodObserver(f.snapshots, 'recoverTask', trace, 'snapshot-recover');
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => {
  if (text.includes('inspect')) {
    trace?.record('inspect-request-received');
    void f.host.inspectTask(taskId).then(snapshot => {
      trace?.record('inspection');
      out({ stage: 'inspection', status: snapshot?.status,
    delivery: hostDelivery(snapshot), inFlight: f.host.inFlightTaskIds().includes(taskId),
    rootStatus: f.store.getAgent(f.groupId, `root_${f.groupId}`)?.status,
    childStatus: f.store.getAgent(f.groupId, f.childId)?.status,
    ...(trace ? { trace: trace.snapshot(), watchdogMs: 100 } : {}) });
    });
  }
});
if (mode.startsWith('goal-snapshot')) {
  const goal = new DesktopGoalCoordinator({ store: new SqliteGoalStore(join(root, 'goals.sqlite')), instanceId: 'old-owner', taskHost: {
    prepareTask: input => f.service.prepareRoot(f.host, 'post-seal-thread', input), startTask: id => f.host.startTask(id), cancelTask: (id, reason) => f.host.cancelTask(id, reason),
  } });
  const created = await goal.createGoal({ threadId: 'post-seal-thread', objective: 'Hello', expectedEvidenceKinds: ['answer'], turnLimit: mode === 'goal-snapshot-last-turn' ? 1 : 3 });
  taskId = created.preparedTask.taskId;
  await goal.ackGoalTaskAttached({ threadId: 'post-seal-thread', attachmentId: created.preparedTask.attachmentId });
} else {
  markD10('prepareRoot-before');
  const task = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: mode === 'cpu' ? 'create' + ' '.repeat(65529) + 'x' : mode === 'fifo' ? '生成 PDF 文件' : 'Hello', materials: [] });
  markD10('prepareRoot-after');
  taskId = task.taskId;
  markD10('startTask-before');
  await f.host.startTask(taskId);
  markD10('startTask-after');
}
if (mode === 'snapshot' || mode.startsWith('goal-snapshot')) { await f.readEntered.promise; out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); }
else {
  await f.host.drain();
  trace?.record('host-drain-resolved');
  out({ stage: 'host-drained', taskId, status: (await f.host.inspectTask(taskId))?.status, delivery: hostDelivery(await f.host.inspectTask(taskId)),
    ...(trace ? { trace: trace.snapshot(), watchdogMs: 100 } : {}) });
}
// Explicit OS crash is the boundary; never disguise this as graceful cleanup.
setInterval(() => {}, 1000);
