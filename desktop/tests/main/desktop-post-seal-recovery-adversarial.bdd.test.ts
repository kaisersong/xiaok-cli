// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { captureHostDeliveryReport, reconcileHostDeliveryRecords } from '../../electron/desktop-host-delivery-projection.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { HostDeliveryRecord, HostDeliverySource } from '../../../src/runtime/task-host/delivery-types.js';
import type { TaskSnapshot } from '../../../src/runtime/task-host/types.js';
import { bounded } from '../fixtures/desktop-post-seal-harness.js';

// All cases start from a real sealed root and a real former process. Only its
// persisted report inputs are varied; production owns parsing and recovery.
interface Seed { root: string; taskId: string }
let seed: Seed;
const fixtures: Array<{ close(): Promise<void> }> = [];

async function crashSeed(): Promise<Seed> {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-recovery-adversarial-seed-'));
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts', import.meta.url)), root, 'snapshot'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let output = ''; let stderr = '';
  const reached = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => reject(new Error(`owner closed before actual snapshot barrier ${code}: ${stderr}`)));
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    child.stdout.on('data', chunk => {
      output += String(chunk);
      for (;;) {
        const end = output.indexOf('\n'); if (end < 0) return;
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (!line.startsWith('{')) continue;
        const event = JSON.parse(line) as { stage: string; taskId: string };
        if (event.stage === 'snapshot') resolve(event.taskId);
      }
    });
  });
  try {
    const taskId = await bounded(reached);
    child.kill('SIGKILL'); await bounded(closed);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    return { root, taskId };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(closed); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); throw error;
  }
}

function open() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-recovery-adversarial-'));
  cpSync(seed.root, root, { recursive: true });
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite'));
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const runner = vi.fn(async () => {});
  const createSession = vi.fn(async () => { throw new Error('recovery cannot replay an agent'); });
  const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession });
  const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots, runner,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }),
    authorizeDeliveryRecovery: input => service.assertDeliveryRecovery(input),
  });
  const binding = store.getRootBinding(seed.taskId)!;
  const source: HostDeliverySource = { sourceTaskId: binding.sourceTaskId, groupId: binding.groupId,
    rootTurnId: binding.rootTurnId, rootEpoch: binding.rootEpoch, preparationId: binding.preparationId, bootId: binding.bootId };
  const fixture = { root, store, snapshots, host, service, runner, createSession, source, taskId: seed.taskId,
    checking: binding.delivery!,
    async close() {
      await bounded(host.drain()); await service.dispose(); store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    },
  };
  fixtures.push(fixture);
  return fixture;
}
type Fixture = ReturnType<typeof open>;

function passed(base: HostDeliveryRecord, revision: number): HostDeliveryRecord {
  return { ...base, revision, status: 'passed', stage: 'settle', verification: 'passed',
    decisionAt: base.startedAt + 1, finishedAt: base.startedAt + 2, hostSettlement: 'committed', hostTerminalStatus: 'completed',
    readerCleanup: 'settled', storeCleanup: 'settled' };
}
function unknown(base: HostDeliveryRecord, revision: number): HostDeliveryRecord {
  return { ...base, revision, status: 'unknown', stage: 'settle', hostSettlement: 'unknown', storeCleanup: 'pending' };
}
async function persistPair(f: Fixture, hostDelivery: HostDeliveryRecord | undefined, sqliteDelivery: HostDeliveryRecord) {
  // A malformed shape is a different guard. These examples deliberately pass
  // the real bounded parser on both legs before exercising pair compatibility.
  if (hostDelivery) expect(captureHostDeliveryReport({ source: f.source, delivery: hostDelivery }).delivery).toEqual(hostDelivery);
  expect(captureHostDeliveryReport({ source: f.source, delivery: sqliteDelivery }).delivery).toEqual(sqliteDelivery);
  const before = (await f.snapshots.recoverTask(f.taskId))!;
  if (!hostDelivery) expect(before.hostDelivery).toBeUndefined();
  const terminal = hostDelivery?.hostSettlement === 'committed' ? hostDelivery.hostTerminalStatus : undefined;
  const snapshot: TaskSnapshot = { ...before, ...(hostDelivery ? { hostDelivery } : {}),
    ...(terminal ? { status: terminal, events: [...before.events, { type: 'task_terminal' as const, status: terminal }] } : {}),
  };
  await f.snapshots.save(snapshot, before);
  f.store.putRootBinding({ ...f.store.getRootBinding(f.taskId)!, delivery: sqliteDelivery }, true);
  return snapshot;
}
async function rejectBeforeMutation(f: Fixture, hostDelivery: HostDeliveryRecord | undefined, sqliteDelivery: HostDeliveryRecord) {
  const snapshot = await persistPair(f, hostDelivery, sqliteDelivery);
  const binding = f.store.getRootBinding(f.taskId);
  const events = f.store.readEvents(f.source.groupId);
  const result = await f.service.initialize(f.host).then(() => ({ ready: true, error: '' }), error => ({ ready: false, error: String(error) }));
  // Soft assertions retain the actual post-rejection state: rejecting only
  // after a compensating host terminal is already written is still too late.
  expect.soft(result.ready, JSON.stringify(result)).toBe(false);
  expect.soft(await f.host.inspectTask(f.taskId)).toEqual(snapshot);
  expect.soft(f.store.getRootBinding(f.taskId)).toEqual(binding);
  expect.soft(f.store.readEvents(f.source.groupId)).toEqual(events);
  expect(f.runner).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
}

beforeAll(async () => { seed = await crashSeed(); });
afterEach(async () => { for (const f of fixtures.splice(0).reverse()) await f.close(); });
afterAll(() => { if (seed) rmSync(seed.root, { recursive: true, force: true, maxRetries: 3 }); });

describe('R4 two-source recovery rejects illegal cross-revision history before either delivery source changes', () => {
  it('does not turn a persisted unknown pending decision into a later successful host terminal', async () => {
    const f = open();
    await rejectBeforeMutation(f, passed(f.checking, 3), unknown(f.checking, 2));
  });

  it('does not return from persisted unknown to a later checking observation', async () => {
    const f = open();
    await rejectBeforeMutation(f, { ...f.checking, revision: 3, stage: 'settle', storeCleanup: 'pending' }, unknown(f.checking, 2));
  });

  it('does not delete a previously frozen decisionAt while preserving a failed verification', async () => {
    const f = open();
    const earlier: HostDeliveryRecord = { ...unknown(f.checking, 2), verification: 'failed', decisionAt: f.checking.startedAt + 1,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    const { decisionAt: _removed, ...later } = { ...earlier, revision: 3 };
    await rejectBeforeMutation(f, later, earlier);
  });

  it('does not apply the host-candidate/SQLite-writer exception backwards and then mutate before rejecting', async () => {
    const f = open(); const committed = passed(f.checking, 2);
    const waiter: HostDeliveryRecord = { ...unknown(f.checking, 3), verification: 'passed', decisionAt: committed.decisionAt,
      readerCleanup: 'settled' };
    await rejectBeforeMutation(f, waiter, committed);
  });

  it('does not waive the frozen failure reason for an uncommitted recovery-shaped observation', async () => {
    const f = open();
    const earlier: HostDeliveryRecord = { ...unknown(f.checking, 2), verification: 'failed', decisionAt: f.checking.startedAt + 1,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    const notCommitted: HostDeliveryRecord = { ...earlier, revision: 3,
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true } };
    await rejectBeforeMutation(f, notCommitted, earlier);
  });

  it('does not treat a SQLite recovery terminal as an actually committed host when the host is still nonterminal', async () => {
    const f = open();
    const earlier: HostDeliveryRecord = { ...unknown(f.checking, 2), verification: 'failed', decisionAt: f.checking.startedAt + 1,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    const sqliteOnlyTerminal: HostDeliveryRecord = { ...earlier, revision: 3, hostSettlement: 'committed', hostTerminalStatus: 'failed',
      finishedAt: f.checking.startedAt + 2, storeCleanup: 'settled',
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true } };
    await rejectBeforeMutation(f, earlier, sqliteOnlyTerminal);
  });

  it('rejects the sibling ordinary SQLite committed report while the host remains unknown without changing its reason', async () => {
    const f = open();
    const earlier: HostDeliveryRecord = { ...unknown(f.checking, 2), verification: 'failed', decisionAt: f.checking.startedAt + 1,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    const ordinaryTerminal: HostDeliveryRecord = { ...earlier, revision: 3, status: 'failed',
      hostSettlement: 'committed', hostTerminalStatus: 'failed', finishedAt: f.checking.startedAt + 2, storeCleanup: 'settled' };
    await rejectBeforeMutation(f, earlier, ordinaryTerminal);
  });

  it('rejects a SQLite-only committed report when the real host has no delivery record', async () => {
    const f = open();
    const sqliteOnlyTerminal: HostDeliveryRecord = { ...passed(f.checking, 2), status: 'failed', verification: 'failed', hostTerminalStatus: 'failed',
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    await rejectBeforeMutation(f, undefined, sqliteOnlyTerminal);
  });

  it('keeps the actual earlier host terminal when a higher SQLite revision describes its pending writer', async () => {
    const f = open(); const committed = passed(f.checking, 2);
    const waiter: HostDeliveryRecord = { ...unknown(f.checking, 3), verification: 'passed', decisionAt: committed.decisionAt,
      readerCleanup: 'settled' };
    const saved = await persistPair(f, committed, waiter);
    expect(reconcileHostDeliveryRecords(f.source, committed, waiter)).toEqual(waiter);
    await f.service.initialize(f.host);
    expect(await f.host.inspectTask(f.taskId)).toEqual(saved);
    expect(f.store.getRootBinding(f.taskId)?.delivery).toEqual({ ...committed, revision: 4 });
    const deliveryEvents = f.store.readEvents(f.source.groupId).filter(event => event.kind === 'delivery');
    expect(deliveryEvents).toHaveLength(2);
    expect(deliveryEvents.at(-1)?.payload).toEqual({ source: f.source, delivery: { ...committed, revision: 4 } });
    expect(f.runner).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
  });

  it('accepts the explicit recovery failure exception without changing the previously failed decision', async () => {
    const f = open();
    const earlier: HostDeliveryRecord = { ...unknown(f.checking, 2), verification: 'failed', decisionAt: f.checking.startedAt + 1,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    const recovered: HostDeliveryRecord = { ...earlier, revision: 3, hostSettlement: 'committed', hostTerminalStatus: 'failed',
      finishedAt: f.checking.startedAt + 2, readerCleanup: 'settled', storeCleanup: 'settled',
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true } };
    const saved = await persistPair(f, recovered, earlier);
    await f.service.initialize(f.host);
    expect(await f.host.inspectTask(f.taskId)).toEqual(saved);
    expect(f.store.getRootBinding(f.taskId)?.delivery).toEqual({ ...recovered, revision: 4 });
    expect(f.runner).not.toHaveBeenCalled(); expect(f.createSession).not.toHaveBeenCalled();
  });
});
