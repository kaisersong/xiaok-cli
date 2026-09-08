// Real owner process. The runner is controlled, but host/core/seal, SQLite,
// checkpoint/journal and the actual native CPU Worker are not substituted.
import { writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import workerThreads from 'node:worker_threads';
import { build } from 'esbuild';
import { DesktopGoalCoordinator } from '../../electron/desktop-goal-coordinator.js';
import { SqliteGoalStore } from '../../electron/goal-store-sqlite.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';

const [root, mode] = process.argv.slice(2);
if (!root || !['cpu', 'fifo', 'before-marker', 'marker-transaction', 'marker-committed', 'snapshot', 'goal-snapshot', 'goal-snapshot-last-turn',
  'before-host-write', 'host-committed', 'projection-committed'].includes(mode)) throw new Error('invalid fixture input');
const out = (event: object) => writeSync(1, JSON.stringify(event) + '\n');
// Source-mode fixture only: map the one fixed production .js URL to that
// exact TS entry compiled into the fixture-owned directory. No eval Worker,
// fake classifier/result/exit, production fallback, or configurable task URL.
const workerSource = new URL('../../../src/runtime/task-host/delivery-verifier-worker.ts', import.meta.url);
const workerUrl = new URL('../../../src/runtime/task-host/delivery-verifier-worker.js', import.meta.url).href;
const workerOutput = join(root, 'delivery-verifier-worker.mjs');
await build({ entryPoints: [fileURLToPath(workerSource)], outfile: workerOutput, bundle: true, platform: 'node', format: 'esm' });
const NativeWorker = workerThreads.Worker;
workerThreads.Worker = class extends NativeWorker {
  constructor(filename: ConstructorParameters<typeof NativeWorker>[0], options?: ConstructorParameters<typeof NativeWorker>[1]) {
    const mapped = filename instanceof URL && filename.href === workerUrl;
    super(mapped ? workerOutput : filename, options);
    if (mapped) {
      out({ stage: 'native-worker-start', threadId: this.threadId });
      this.once('exit', code => out({ stage: 'native-worker-exit', code }));
    }
  }
};
syncBuiltinESMExports();
const { createPostSealHarness, hostDelivery } = await import('./desktop-post-seal-harness.js');
const stop = () => { const cell = new Int32Array(new SharedArrayBuffer(4)); for (;;) Atomics.wait(cell, 0, 0); };
let taskId = '';
const f = await createPostSealHarness({ root, readOrdinal: mode === 'snapshot' || mode.startsWith('goal-snapshot') ? 1 : undefined,
  snapshotStore: ['before-host-write', 'host-committed'].includes(mode) ? directory => new class extends FileTaskSnapshotStore {
    override async save(snapshot: TaskSnapshot, previous?: TaskSnapshot) {
      if (mode === 'before-host-write' && snapshot.status === 'completed') { out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); stop(); }
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
    out({ stage: 'sealed', taskId, groupId: f.groupId, childId: f.childId, pid: process.pid });
    if (mode === 'before-marker') stop();
    if (mode === 'cpu' || mode === 'fifo') {
      const started = performance.now();
      setTimeout(() => out({ stage: 'heartbeat', elapsed: performance.now() - started }), 50);
    }
  },
  report: async (report, persist) => {
    if (mode === 'projection-committed' && report.delivery.hostSettlement === 'committed') {
      await persist(); out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); stop();
    }
    if (report.delivery.revision !== 1) return persist();
    if (mode === 'marker-transaction') {
      const put = f.store.putRootBinding.bind(f.store);
      f.store.putRootBinding = (binding, control) => {
        put(binding, control);
        if ('delivery' in binding) { out({ stage: 'marker-transaction', taskId, groupId: f.groupId, childId: f.childId }); stop(); }
      };
    }
    const receipt = await persist();
    if (mode === 'marker-committed') { out({ stage: 'marker-committed', taskId, groupId: f.groupId, childId: f.childId }); stop(); }
    return receipt;
  },
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => {
  if (text.includes('inspect')) void f.host.inspectTask(taskId).then(snapshot => out({ stage: 'inspection', status: snapshot?.status,
    delivery: hostDelivery(snapshot), inFlight: f.host.inFlightTaskIds().includes(taskId),
    rootStatus: f.store.getAgent(f.groupId, `root_${f.groupId}`)?.status,
    childStatus: f.store.getAgent(f.groupId, f.childId)?.status }));
});
if (mode.startsWith('goal-snapshot')) {
  const goal = new DesktopGoalCoordinator({ store: new SqliteGoalStore(join(root, 'goals.sqlite')), instanceId: 'old-owner', taskHost: {
    prepareTask: input => f.service.prepareRoot(f.host, 'post-seal-thread', input), startTask: id => f.host.startTask(id), cancelTask: (id, reason) => f.host.cancelTask(id, reason),
  } });
  const created = await goal.createGoal({ threadId: 'post-seal-thread', objective: 'Hello', expectedEvidenceKinds: ['answer'], turnLimit: mode === 'goal-snapshot-last-turn' ? 1 : 3 });
  taskId = created.preparedTask.taskId;
  await goal.ackGoalTaskAttached({ threadId: 'post-seal-thread', attachmentId: created.preparedTask.attachmentId });
} else {
  const task = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: mode === 'cpu' ? 'create' + ' '.repeat(65529) + 'x' : mode === 'fifo' ? '生成 PDF 文件' : 'Hello', materials: [] });
  taskId = task.taskId; await f.host.startTask(taskId);
}
if (mode === 'snapshot' || mode.startsWith('goal-snapshot')) { await f.readEntered.promise; out({ stage: mode, taskId, groupId: f.groupId, childId: f.childId }); }
else {
  await f.host.drain();
  out({ stage: 'host-drained', taskId, status: (await f.host.inspectTask(taskId))?.status, delivery: hostDelivery(await f.host.inspectTask(taskId)) });
}
// Explicit OS crash is the boundary; never disguise this as graceful cleanup.
setInterval(() => {}, 1000);
