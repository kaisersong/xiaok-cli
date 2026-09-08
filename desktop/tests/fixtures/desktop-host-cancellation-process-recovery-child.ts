// Fixed test-owned old process. The model Promise remains physically live until
// the parent observes this process's actual OS exit. Only native writeFile's
// selected failure boundary is substituted; all journal and recovery code is real.
import fs from 'node:fs/promises';
import { writeSync } from 'node:fs';
import { basename, join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import type { DesktopTaskEvent } from '../../../src/runtime/task-host/types.js';

const [root, fault] = process.argv.slice(2);
if (!root || !['checkpoint-write', 'index-write'].includes(fault)) throw new Error('invalid cancellation recovery fixture arguments');
const out = (record: object) => writeSync(1, JSON.stringify(record) + '\n');
const nativeWrite = fs.writeFile.bind(fs);
const nativeAppend = fs.appendFile.bind(fs);
const frames: Array<{ events: DesktopTaskEvent[]; patch: Record<string, unknown> }> = [];
let armed = false; let taskId = ''; let faults = 0; let aborts = 0;
const failure = Object.assign(new Error(`native ${fault} rejected after cancellation journal`), { code: 'EIO' });
fs.writeFile = async (...args) => {
  const name = basename(String(args[0]));
  const encoded = String(args[1]);
  const target = fault === 'checkpoint-write'
    ? name.startsWith(`${taskId}.json.`) && encoded.includes('"status": "cancelled"')
    : name.startsWith('active-task.json.') && encoded.includes('"activeTaskIds": []');
  // A checkpoint fails once. Keep the selected active-index writer unavailable
  // until OS exit so an allowed publication-cleanup retry cannot remove the
  // deliberately stale index before C10's restart boundary.
  if (armed && target && (fault === 'index-write' || faults === 0)) { faults++; throw failure; }
  await nativeWrite(...args);
};
fs.appendFile = async (...args) => {
  await nativeAppend(...args);
  if (armed && basename(String(args[0])) === `${taskId}.journal.jsonl`) frames.push(JSON.parse(String(args[1])));
};
syncBuiltinESMExports();

// Import after the native seam so named fs imports still call the same actual
// implementation, with only the selected write boundary failing.
const { createPostSealHarness, deferred } = await import('./desktop-post-seal-harness.js');
const { DesktopGoalCoordinator } = await import('../../electron/desktop-goal-coordinator.js');
const { SqliteGoalStore } = await import('../../electron/goal-store-sqlite.js');
const { FileTaskSnapshotStore } = await import('../../../src/runtime/task-host/snapshot-store.js');
const entered = deferred();
const never = new Promise<void>(() => {});
const f = await createPostSealHarness({ root, spawnChild: false, watchdogMs: 60_000,
  emit: async input => {
    await input.emitUsage({ inputTokens: 7, outputTokens: 11 });
    input.signal.addEventListener('abort', () => { aborts++; }, { once: true });
    entered.resolve();
    await never;
  },
});
const goalStore = new SqliteGoalStore(join(root, 'goals.sqlite'));
const goal = new DesktopGoalCoordinator({ store: goalStore, instanceId: 'cancel-old-owner', taskHost: {
  prepareTask: input => f.service.prepareRoot(f.host, 'post-seal-thread', input),
  startTask: id => f.host.startTask(id), cancelTask: (id, reason) => f.host.cancelTask(id, reason),
} });
const created = await goal.createGoal({ threadId: 'post-seal-thread', objective: 'Wait for the explicit cancellation boundary.',
  expectedEvidenceKinds: ['answer'], turnLimit: 3 });
taskId = created.preparedTask.taskId;
await goal.ackGoalTaskAttached({ threadId: 'post-seal-thread', attachmentId: created.preparedTask.attachmentId });
await entered.promise;
const before = (await f.host.inspectTask(taskId))!;
armed = true;
let rejection: unknown;
try { await f.host.cancelTask(taskId, 'user_cancelled'); } catch (error) { rejection = error; }
if (rejection !== failure || faults < 1) throw new Error(`expected exact native failure, received ${String(rejection)}`);
const cold = (await new FileTaskSnapshotStore(join(root, 'tasks')).recoverTask(taskId))!;
const document = (await goalStore.load('post-seal-thread'))!;
out({ stage: 'cancel-write-rejected', pid: process.pid, taskId, groupId: f.groupId, bootId: f.store.bootId, fault,
  faults, aborts, runnerCalls: f.runnerCalls, inFlight: f.host.inFlightTaskIds().includes(taskId),
  beforeEventCount: before.events.length, coldStatus: cold.status, goalStatus: document.state.status,
  goalTurns: document.turns.length, goalAttached: goalStore.getTaskBinding(taskId)?.attachedAt !== null,
  frameEvents: frames.map(frame => frame.events.map(event => event.type)),
  cancellationFrames: frames.filter(frame => frame.events.some(event => event.type === 'salvage')).length,
  hasDelivery: Boolean(cold.hostDelivery),
});
// No dispose/quiesced mark and no process.exit shortcut: test parent must kill
// this sole known PID and wait for close before the new owner can claim it.
setInterval(() => {}, 1000);
