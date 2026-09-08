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
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
import type { HostDeliveryRecoveryInvocation } from '../../../src/runtime/task-host/delivery-types.js';
import { bounded, deferred } from '../fixtures/desktop-post-seal-harness.js';

type AbandonInput = Parameters<InProcessTaskRuntimeHost['abandonMultiAgentPreparation']>[0];
type DeliveryInput = AbandonInput & { delivery: NonNullable<AbandonInput['delivery']> };
interface Seed { root: string; taskId: string }
const cleanup: Array<() => void | Promise<void>> = [];
let seed: Seed;

// The capability is always issued by actual startup recovery after the original
// OS owner has exited. No fake PID, quiesced flag, private WeakMap or permissive
// authorizer is used to manufacture authority.
async function crashSeed(): Promise<Seed> {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-host-authority-seed-'));
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../fixtures/desktop-post-seal-owner.ts', import.meta.url)), root, 'marker-committed'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  let output = ''; let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const reached = new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => reject(new Error(`owner exited before committed marker ${code}: ${stderr}`)));
    child.stdout.on('data', chunk => {
      output += String(chunk);
      for (;;) {
        const end = output.indexOf('\n'); if (end < 0) return;
        const line = output.slice(0, end); output = output.slice(end + 1);
        if (!line.startsWith('{')) continue;
        const event = JSON.parse(line) as { stage: string; taskId: string };
        if (event.stage === 'marker-committed') resolve(event.taskId);
      }
    });
  });
  try {
    const taskId = await bounded(reached); child.kill('SIGKILL'); await bounded(closed);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    return { root, taskId };
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(closed); rmSync(root, { recursive: true, force: true, maxRetries: 3 }); throw error;
  }
}

function cloneInput(input: DeliveryInput): DeliveryInput {
  return { ...input, expectedMarker: { ...input.expectedMarker },
    delivery: { authority: input.delivery.authority, record: structuredClone(input.delivery.record) } };
}

function open() {
  const root = mkdtempSync(join(tmpdir(), 'xiaok-post-seal-host-authority-'));
  cpSync(seed.root, root, { recursive: true });
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const store = new DesktopMultiAgentStore(join(root, 'groups.sqlite')); cleanup.push(() => store.close());
  const snapshots = new FileTaskSnapshotStore(join(root, 'tasks'));
  const sessions = vi.fn(async () => { throw new Error('replay forbidden'); });
  const service = new DesktopMultiAgentService({ store, coordinator: new DesktopExecutionCoordinator(), createSession: sessions });
  const runner = vi.fn(async () => {});
  let onAuthorized: ((input: HostDeliveryRecoveryInvocation) => void) | undefined;
  const host = new InProcessTaskRuntimeHost({ snapshotStore: snapshots,
    materialRegistry: new MaterialRegistry({ workspaceRoot: join(root, 'materials'), maxBytes: 1024 }), runner,
    assertTaskAdmission: snapshot => service.assertHostAdmission(snapshot),
    authorizeDeliveryRecovery: input => { service.assertDeliveryRecovery(input); onAuthorized?.(input); },
  });
  cleanup.push(async () => { await bounded(host.drain()); await service.dispose(); });
  const original = host.abandonMultiAgentPreparation.bind(host);
  const issued = deferred<DeliveryInput>(); const release = deferred();
  cleanup.push(() => release.resolve());
  vi.spyOn(host, 'abandonMultiAgentPreparation').mockImplementation(async input => {
    if (!input.delivery) throw new Error('fixture requires real committed checking observation');
    issued.resolve(input as DeliveryInput); await release.promise;
    await original(input);
  });
  const ready = service.initialize(host); void ready.catch(() => undefined);
  return { root, store, snapshots, service, host, runner, sessions, original, issued, release, ready,
    observeAuthorization: (observer?: (input: HostDeliveryRecoveryInvocation) => void) => { onAuthorized = observer; },
  };
}

async function assertNoMutation(f: ReturnType<typeof open>, operation: () => Promise<void>, error: RegExp) {
  const before = await f.host.inspectTask(seed.taskId);
  const binding = f.store.getRootBinding(seed.taskId);
  const save = vi.spyOn(f.snapshots, 'save'); const clear = vi.spyOn(f.snapshots, 'clearActiveTask');
  await expect(operation()).rejects.toThrow(error);
  expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  expect(await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(seed.taskId)).toEqual(before);
  expect(f.store.getRootBinding(seed.taskId)).toEqual(binding);
  expect(f.runner).not.toHaveBeenCalled(); expect(f.sessions).not.toHaveBeenCalled();
  save.mockRestore(); clear.mockRestore();
}

async function finish(f: ReturnType<typeof open>) {
  f.release.resolve(); await bounded(f.ready);
  const snapshot = await f.host.inspectTask(seed.taskId);
  expect(snapshot).toMatchObject({ status: 'failed', salvage: { reason: 'recovery_unconfirmed' },
    hostDelivery: { status: 'unknown', hostSettlement: 'committed', hostTerminalStatus: 'failed', storeCleanup: 'settled' } });
  expect(snapshot!.events.filter(event => event.type === 'task_terminal')).toHaveLength(1);
  expect(f.runner).not.toHaveBeenCalled(); expect(f.sessions).not.toHaveBeenCalled();
}

describe('R4/D18 host recovery uses actual main-issued capability at both queue boundaries', () => {
  beforeAll(async () => { seed = await crashSeed(); });
  afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.restoreAllMocks(); });
  afterAll(() => rmSync(seed.root, { recursive: true, force: true, maxRetries: 3 }));

  it.each(['copy', 'json'] as const)('rejects a %s of the real opaque recovery handle before any write', async kind => {
    const f = open(); const input = await bounded(f.issued.promise); const forged = cloneInput(input);
    forged.delivery.authority = kind === 'copy' ? { ...input.delivery.authority } : JSON.parse(JSON.stringify(input.delivery.authority));
    await assertNoMutation(f, () => f.original(forged), /invalid_delivery_recovery_owner/); await finish(f);
  });

  it('rejects a genuinely issued foreign-service capability even for identical cloned source IDs', async () => {
    const f = open(); const other = open();
    const input = await bounded(f.issued.promise); const foreign = await bounded(other.issued.promise);
    expect(input.expectedMarker).toEqual(foreign.expectedMarker);
    const forged = cloneInput(input); forged.delivery.authority = foreign.delivery.authority;
    await assertNoMutation(f, () => f.original(forged), /invalid_delivery_recovery_owner/);
    await finish(f); await finish(other);
  });

  it.each(['user', 'agent'] as const)('rejects requestSource=%s despite a real valid main recovery handle', async requestSource => {
    const f = open(); const input = await bounded(f.issued.promise);
    await assertNoMutation(f, () => f.original({ ...input, requestSource }), /source is not permitted/); await finish(f);
  });

  it.each(['revision', 'same-revision-field'] as const)('rejects replacement of the bound observation: %s', async kind => {
    const f = open(); const input = await bounded(f.issued.promise); const replaced = cloneInput(input);
    if (kind === 'revision') replaced.delivery.record.revision += 1;
    else replaced.delivery.record.deadlineAt += 1;
    await assertNoMutation(f, () => f.original(replaced), /delivery_recovery_host_mismatch/); await finish(f);
  });

  it.each(['groupId', 'rootEpoch', 'rootTurnId', 'preparationId', 'bootId'] as const)('valid authority does not bypass expected marker %s', async key => {
    const f = open(); const input = await bounded(f.issued.promise); const forged = cloneInput(input);
    if (key === 'rootEpoch') forged.expectedMarker.rootEpoch += 1;
    else forged.expectedMarker[key] += '-foreign';
    await assertNoMutation(f, () => f.original(forged), /preparation recovery marker mismatch/); await finish(f);
  });

  it('consumed recovery authority cannot replay after successful startup or append a second terminal', async () => {
    const f = open(); const input = await bounded(f.issued.promise); await finish(f);
    await assertNoMutation(f, () => f.original(input), /invalid_delivery_recovery_owner/);
  });

  it('rereads marker inside the original mutation queue after valid entry authorization', async () => {
    const f = open(); const input = await bounded(f.issued.promise);
    const before = (await f.host.inspectTask(seed.taskId))!;
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const recover = f.snapshots.recoverTask.bind(f.snapshots); let hold = true;
    vi.spyOn(f.snapshots, 'recoverTask').mockImplementation(async (...args) => {
      if (hold) { hold = false; entered.resolve(); await release.promise; }
      return recover(...args);
    });
    // Existing preparation recovery occupies the same actual mutation queue.
    // It will reject its deliberately wrong marker without writing anything.
    const blocker = f.original({ requestSource: 'scheduler', taskId: input.taskId,
      expectedMarker: { ...input.expectedMarker, preparationId: 'not-the-preparation' } }).catch(error => error);
    await bounded(entered.promise);
    const authorized = deferred(); f.observeAuthorization(() => authorized.resolve());
    const queued = f.original(input).then(() => null, error => error); await bounded(authorized.promise);
    const changed = { ...before, multiAgentPreparation: { ...before.multiAgentPreparation!, preparationId: 'changed-while-queued' } };
    await f.snapshots.save(changed, before);
    const save = vi.spyOn(f.snapshots, 'save'); const clear = vi.spyOn(f.snapshots, 'clearActiveTask');
    release.resolve(); expect(await bounded(blocker)).toBeInstanceOf(Error);
    expect(await bounded(queued)).toMatchObject({ message: 'delivery_recovery_source_mismatch' });
    expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect((await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(seed.taskId))?.multiAgentPreparation).toEqual(changed.multiAgentPreparation);
    save.mockRestore(); clear.mockRestore(); f.observeAuthorization();
    await f.snapshots.save(before, changed); await finish(f);
  });

  it('rejects an actual in-flight host admission while its physical snapshot read has not settled', async () => {
    const f = open(); const input = await bounded(f.issued.promise);
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const recover = f.snapshots.recoverTask.bind(f.snapshots); let hold = true;
    vi.spyOn(f.snapshots, 'recoverTask').mockImplementation(async (...args) => {
      if (hold) { hold = false; entered.resolve(); await release.promise; }
      return recover(...args);
    });
    // startTask's real synchronous registration precedes its real async store
    // read. The unchanged service admission will deny this old root afterward;
    // no model is started merely to fake an activeExecutions map entry.
    const start = f.host.startTask(seed.taskId).then(() => null, error => error);
    await bounded(entered.promise); expect(f.host.inFlightTaskIds()).toContain(seed.taskId);
    await assertNoMutation(f, () => f.original(input), /delivery_recovery_live_execution/);
    release.resolve(); expect(await bounded(start)).toBeInstanceOf(Error); await bounded(f.host.drain());
    expect(f.host.inFlightTaskIds()).not.toContain(seed.taskId); await finish(f);
  });

  it('rechecks disposed authority after entry authorization and before the queued mutation', async () => {
    const f = open(); const input = await bounded(f.issued.promise);
    const before = await f.host.inspectTask(seed.taskId); const binding = f.store.getRootBinding(seed.taskId);
    const entered = deferred(); const release = deferred(); cleanup.push(() => release.resolve());
    const recover = f.snapshots.recoverTask.bind(f.snapshots); let hold = true;
    vi.spyOn(f.snapshots, 'recoverTask').mockImplementation(async (...args) => {
      if (hold) { hold = false; entered.resolve(); await release.promise; }
      return recover(...args);
    });
    const blocker = f.original({ requestSource: 'scheduler', taskId: input.taskId,
      expectedMarker: { ...input.expectedMarker, preparationId: 'not-the-preparation' } }).catch(error => error);
    await bounded(entered.promise);
    const authorized = deferred(); f.observeAuthorization(() => authorized.resolve());
    const queued = f.original(input).then(() => null, error => error); await bounded(authorized.promise);
    const save = vi.spyOn(f.snapshots, 'save'); const clear = vi.spyOn(f.snapshots, 'clearActiveTask');
    await f.service.dispose(); release.resolve();
    expect(await bounded(blocker)).toBeInstanceOf(Error);
    expect(await bounded(queued)).toMatchObject({ message: 'invalid_delivery_recovery_owner' });
    f.release.resolve(); await expect(f.ready).rejects.toThrow('invalid_delivery_recovery_owner');
    expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(seed.taskId)).toEqual(before);
    expect(f.store.getRootBinding(seed.taskId)).toEqual(binding);
    expect(f.runner).not.toHaveBeenCalled(); expect(f.sessions).not.toHaveBeenCalled();
  });

  it('rechecks newly in-flight admission after entry authorization while the recovery mutation is queued', async () => {
    const f = open(); const input = await bounded(f.issued.promise);
    const queueEntered = deferred(); const queueRelease = deferred();
    const admissionEntered = deferred(); const admissionRelease = deferred();
    cleanup.push(() => { queueRelease.resolve(); admissionRelease.resolve(); });
    const recover = f.snapshots.recoverTask.bind(f.snapshots);
    let holdQueue = true; let holdAdmission = false;
    vi.spyOn(f.snapshots, 'recoverTask').mockImplementation(async (...args) => {
      if (holdQueue) { holdQueue = false; queueEntered.resolve(); await queueRelease.promise; }
      else if (holdAdmission) { holdAdmission = false; admissionEntered.resolve(); await admissionRelease.promise; }
      return recover(...args);
    });
    const blocker = f.original({ requestSource: 'scheduler', taskId: input.taskId,
      expectedMarker: { ...input.expectedMarker, preparationId: 'not-the-preparation' } }).catch(error => error);
    await bounded(queueEntered.promise);
    const authorized = deferred(); f.observeAuthorization(() => authorized.resolve());
    const queued = f.original(input).then(() => null, error => error); await bounded(authorized.promise);
    holdAdmission = true;
    const start = f.host.startTask(seed.taskId).then(() => null, error => error);
    await bounded(admissionEntered.promise); expect(f.host.inFlightTaskIds()).toContain(seed.taskId);
    const before = await f.host.inspectTask(seed.taskId); const binding = f.store.getRootBinding(seed.taskId);
    const save = vi.spyOn(f.snapshots, 'save'); const clear = vi.spyOn(f.snapshots, 'clearActiveTask');
    queueRelease.resolve(); expect(await bounded(blocker)).toBeInstanceOf(Error);
    expect(await bounded(queued)).toMatchObject({ message: 'delivery_recovery_live_execution' });
    expect(save).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(await new FileTaskSnapshotStore(join(f.root, 'tasks')).recoverTask(seed.taskId)).toEqual(before);
    expect(f.store.getRootBinding(seed.taskId)).toEqual(binding);
    save.mockRestore(); clear.mockRestore(); f.observeAuthorization();
    admissionRelease.resolve(); expect(await bounded(start)).toBeInstanceOf(Error); await bounded(f.host.drain());
    await finish(f);
  });
});
