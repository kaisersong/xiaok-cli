// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import {
  bounded, createPostSealHarness, deferred, deliveryContract,
  type DeliveryRecordFixture, type DeliveryReportFixture, type PostSealHarness,
} from '../fixtures/desktop-post-seal-harness.js';

/** These tests call the real service and SQLite. Only the not-yet-implemented
 * private report API is structurally typed; no authority/transition logic lives here. */
describe('R4 host delivery owner: shutdown, physical ownership and source fencing', () => {
  const fixtures: PostSealHarness[] = []; const releases: Array<() => void> = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const release of releases.splice(0)) release();
    for (const fixture of fixtures.splice(0)) await fixture.close();
  });

  async function setup(options: { holdSecondBody?: boolean } = {}) {
    const tail = deferred(); const secondBody = deferred(); const secondEntered = deferred(); const secondSealed = deferred();
    releases.push(() => tail.resolve(), () => secondBody.resolve()); let bodyCount = 0; let tailCount = 0;
    const f = await createPostSealHarness({ spawnChild: false,
      emit: async () => { if (++bodyCount === 2) { secondEntered.resolve(); if (options.holdSecondBody) await secondBody.promise; } },
      runnerTail: async () => { if (++tailCount === 2) secondSealed.resolve(); await tail.promise; },
    }); fixtures.push(f);
    const taskId = await f.start(); await bounded(f.rootSealed.promise);
    return { f, taskId, tail, secondBody, secondEntered, secondSealed, api: deliveryContract(f.service) };
  }
  function reportFor(f: PostSealHarness, taskId: string): DeliveryReportFixture {
    const binding = f.store.getRootBinding(taskId)!; const startedAt = Date.now();
    return { source: { sourceTaskId: taskId, groupId: binding.groupId, rootTurnId: binding.rootTurnId,
      rootEpoch: binding.rootEpoch, preparationId: binding.preparationId, bootId: binding.bootId },
    delivery: { version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending', hostSettlement: 'pending',
      readerCleanup: 'none', storeCleanup: 'none', startedAt, deadlineAt: startedAt + 2000 } };
  }
  function patch(report: DeliveryReportFixture, delivery: Partial<DeliveryRecordFixture>): DeliveryReportFixture {
    return { source: { ...report.source }, delivery: { ...report.delivery, ...delivery } };
  }
  function timeout(report: DeliveryReportFixture): DeliveryReportFixture {
    return patch(report, { revision: report.delivery.revision + 1, status: 'unknown', stage: 'verify', verification: 'failed',
      hostSettlement: 'unknown', readerCleanup: 'pending', decisionAt: report.delivery.deadlineAt,
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } });
  }
  function requireApi(api: ReturnType<typeof deliveryContract>): void {
    expect(api.bindHostDeliveryOwner, 'entry red: real main-only bindHostDeliveryOwner is not implemented yet').toBeTypeOf('function');
    expect(api.recordHostDelivery, 'entry red: real main-only recordHostDelivery is not implemented yet').toBeTypeOf('function');
  }
  function durableFacts(path: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try { return {
      bindings: db.prepare('SELECT source_task_id,data_json FROM root_turns ORDER BY source_task_id').all(),
      agents: db.prepare('SELECT group_id,agent_id,data_json FROM agents ORDER BY group_id,agent_id').all(),
      events: db.prepare('SELECT group_id,seq,data_json FROM events ORDER BY group_id,seq').all(),
      owners: db.prepare('SELECT boot_id,owner_pid,state FROM boot_owners ORDER BY boot_id').all(),
    }; } finally { db.close(); }
  }

  it('D15 real sealed root plus physically pending host forbids boot quiescence and another live owner, without requiring new delivery APIs', async () => {
    const { f, taskId } = await setup();
    expect(f.store.getRootBinding(taskId)).toMatchObject({ phase: 'settled', status: 'completed' });
    expect(f.host.inFlightTaskIds()).toContain(taskId); expect(f.tokenReleases).toBe(0);
    f.host.stopAccepting('app_shutdown'); f.host.abortAllActive('app_shutdown');
    await bounded(f.service.dispose());
    const file = join(f.root, 'groups.sqlite');
    expect.soft(durableFacts(file).owners).toContainEqual(expect.objectContaining({ boot_id: f.store.bootId, state: 'active' }));
    const next = new DesktopMultiAgentStore(file); let claimed = false;
    try {
      expect(() => { next.claimBootOwnership(); claimed = true; }).toThrow(/multi_agent_owner_live/);
      expect(f.host.inFlightTaskIds()).toContain(taskId); expect(f.tokenReleases).toBe(0);
    } finally {
      // Only clean an unexpectedly admitted, otherwise empty test owner. Never
      // mark the old host owner drained or replace the production liveness test.
      if (claimed) next.settleBootOwnership(); next.close();
    }
  });

  it('D15 shutdown admits registered A settlement/cleanup but refuses first checking for an already sealed B', async () => {
    const { f, taskId, api, secondSealed } = await setup(); requireApi(api);
    const authority = api.bindHostDeliveryOwner(f.host); const a = reportFor(f, taskId);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: a });
    const bTask = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Next explicit root', materials: [] });
    await f.host.startTask(bTask.taskId); await bounded(secondSealed.promise);
    const b = reportFor(f, bTask.taskId); expect(f.store.getRootBinding(bTask.taskId)?.phase).toBe('settled');
    f.host.stopAccepting('app_shutdown'); await bounded(f.service.dispose());
    const before = f.store.readEvents(f.groupId);
    await expect(api.recordHostDelivery({ requestSource: 'scheduler', authority, report: b })).rejects.toThrow();
    expect(f.store.readEvents(f.groupId)).toEqual(before); expect(f.store.getRootBinding(bTask.taskId)).not.toHaveProperty('delivery');
    const pending = timeout(a);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: pending });
    const committed = patch(pending, { revision: 3, status: 'failed', stage: 'settle', hostSettlement: 'committed',
      hostTerminalStatus: 'failed', finishedAt: a.delivery.deadlineAt + 1 });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: committed });
    const cleaned = patch(committed, { revision: 4, stage: 'cleanup', readerCleanup: 'settled' });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: cleaned });
    expect(f.store.getRootBinding(taskId)).toMatchObject({ delivery: cleaned.delivery, status: 'completed' });
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ sourceTaskId: bTask.taskId, status: 'completed' });
  });

  it('D15 shutdown prevents both repeated owner binding and foreign replacement, without touching durable rows', async () => {
    const { f, api } = await setup(); requireApi(api); api.bindHostDeliveryOwner(f.host);
    await bounded(f.service.dispose()); const before = durableFacts(join(f.root, 'groups.sqlite'));
    expect(() => api.bindHostDeliveryOwner(f.host)).toThrow();
    const other = await createPostSealHarness({ spawnChild: false }); fixtures.push(other);
    expect(() => api.bindHostDeliveryOwner(other.host)).toThrow();
    expect(durableFacts(join(f.root, 'groups.sqlite'))).toEqual(before);
  });

  it('D15 store close fences a delayed trusted callback before transaction/binding/event writes', async () => {
    const { f, taskId, api } = await setup(); requireApi(api); const authority = api.bindHostDeliveryOwner(f.host);
    const a = reportFor(f, taskId); await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: a });
    const releaseCallback = deferred(); releases.push(() => releaseCallback.resolve());
    const delayed = releaseCallback.promise.then(() => api.recordHostDelivery({ requestSource: 'scheduler', authority, report: timeout(a) }));
    const observed = delayed.then(() => ({ accepted: true }), error => ({ accepted: false, error }));
    await bounded(f.service.dispose()); f.store.close();
    const file = join(f.root, 'groups.sqlite'); const before = durableFacts(file);
    const transaction = vi.spyOn(f.store, 'transaction'); const binding = vi.spyOn(f.store, 'putRootBinding'); const event = vi.spyOn(f.store, 'appendEvent');
    releaseCallback.resolve(); expect(await bounded(observed)).toMatchObject({ accepted: false });
    expect(transaction).not.toHaveBeenCalled(); expect(binding).not.toHaveBeenCalled(); expect(event).not.toHaveBeenCalled();
    expect(durableFacts(file)).toEqual(before);
  });

  it.each(['same-revision-conflict', 'higher-revision-pass', 'new-deadline', 'new-start', 'new-decision'] as const)(
    'D8 frozen timeout rejects %s without another event or changed binding', async mutation => {
      const { f, taskId, api } = await setup(); requireApi(api); const authority = api.bindHostDeliveryOwner(f.host); const a = reportFor(f, taskId);
      await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: a });
      const failed = timeout(a); await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: failed });
      const before = durableFacts(join(f.root, 'groups.sqlite'));
      let candidate = patch(failed, { revision: 3 });
      if (mutation === 'same-revision-conflict') candidate = patch(failed, { stage: 'settle' });
      if (mutation === 'higher-revision-pass') {
        candidate = patch(failed, { revision: 3, status: 'passed', verification: 'passed', hostSettlement: 'committed',
          stage: 'settle', hostTerminalStatus: 'completed', finishedAt: failed.delivery.deadlineAt + 1 });
        delete candidate.delivery.guardFailure;
      }
      if (mutation === 'new-deadline') candidate.delivery.deadlineAt++;
      if (mutation === 'new-start') candidate.delivery.startedAt++;
      if (mutation === 'new-decision') candidate.delivery.decisionAt = failed.delivery.decisionAt! - 1;
      await expect(api.recordHostDelivery({ requestSource: 'scheduler', authority, report: candidate })).rejects.toThrow();
      expect(durableFacts(join(f.root, 'groups.sqlite'))).toEqual(before);
    });

  it('D8 the reported pre-deadline passed decision may settle late; repeating the complete terminal report is a no-op', async () => {
    const { f, taskId, api } = await setup(); requireApi(api); const authority = api.bindHostDeliveryOwner(f.host); const a = reportFor(f, taskId);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: a });
    const decision = patch(a, { revision: 2, stage: 'settle', verification: 'passed', decisionAt: a.delivery.startedAt + 1 });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: decision });
    const pending = patch(decision, { revision: 3, status: 'unknown', hostSettlement: 'unknown', storeCleanup: 'pending' });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: pending });
    const committed = patch(pending, { revision: 4, status: 'passed', hostSettlement: 'committed', storeCleanup: 'settled',
      hostTerminalStatus: 'completed', finishedAt: a.delivery.deadlineAt + 1 });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: committed });
    const before = durableFacts(join(f.root, 'groups.sqlite'));
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: structuredClone(committed) });
    expect(durableFacts(join(f.root, 'groups.sqlite'))).toEqual(before);
    expect(f.store.getRootBinding(taskId)).toMatchObject({ delivery: committed.delivery });
  });

  it.each(['prepared', 'active'] as const)('D8 B %s clears all inherited A delivery fields, and a later A report only changes A history', async phase => {
    const { f, taskId, api, secondEntered } = await setup({ holdSecondBody: true }); requireApi(api);
    const authority = api.bindHostDeliveryOwner(f.host); const a = reportFor(f, taskId);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: a });
    const failed = timeout(a); await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: failed });
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ hostDeliveryStatus: 'unknown', hostDeliveryCleanupPending: true,
      guardFailure: { code: 'delivery_timeout' } });
    const b = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Next root with independent outcome', materials: [] });
    if (phase === 'active') { await f.host.startTask(b.taskId); await bounded(secondEntered.promise); }
    const root = f.store.getAgent(f.groupId, `root_${f.groupId}`)!;
    expect(root).toMatchObject({ sourceTaskId: b.taskId, status: phase === 'active' ? 'running' : 'pending' });
    expect(root.hostDeliveryStatus).toBeUndefined(); expect(root).not.toHaveProperty('guardFailure'); expect(root).not.toHaveProperty('hostDeliveryCleanupPending');
    const later = patch(failed, { revision: 3, readerCleanup: 'settled', stage: 'cleanup' });
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: later });
    expect(f.store.getAgent(f.groupId, root.id)).toEqual(root);
    expect(f.store.getRootBinding(taskId)).toMatchObject({ delivery: later.delivery });
    expect(f.store.getRootBinding(b.taskId)).not.toHaveProperty('delivery');
    expect(f.store.readEvents(f.groupId).at(-1)).toMatchObject({ kind: 'delivery', payload: later });
  });
});
