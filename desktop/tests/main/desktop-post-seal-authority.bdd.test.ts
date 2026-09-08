// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPostSealHarness, bounded, deferred, deliveryContract, type DeliveryReportFixture, type PostSealHarness } from '../fixtures/desktop-post-seal-harness.js';

describe('R4 delivery projection authority — production service and SQLite, no fake reducer', () => {
  const fixtures: PostSealHarness[] = []; const releases: Array<() => void> = [];
  afterEach(async () => { for (const release of releases.splice(0)) release(); for (const f of fixtures.splice(0)) await f.close(); });
  async function setup() {
    const tail = deferred(); releases.push(() => tail.resolve());
    const f = await createPostSealHarness({ runnerTail: () => tail.promise }); fixtures.push(f);
    const taskId = await f.start(); await bounded(f.rootSealed.promise);
    const binding = f.store.getRootBinding(taskId)!;
    const report: DeliveryReportFixture = { source: { sourceTaskId: taskId, groupId: binding.groupId, rootTurnId: binding.rootTurnId,
      rootEpoch: binding.rootEpoch, preparationId: binding.preparationId, bootId: binding.bootId },
      delivery: { version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending', hostSettlement: 'pending',
        readerCleanup: 'none', storeCleanup: 'none', startedAt: Date.now(), deadlineAt: Date.now() + 2000 } };
    return { f, report, api: deliveryContract(f.service) };
  }
  function mustExist(api: ReturnType<typeof deliveryContract>) {
    expect(api.bindHostDeliveryOwner, 'missing real main-only owner binding').toBeTypeOf('function');
    expect(api.recordHostDelivery, 'missing real delivery projection command').toBeTypeOf('function');
  }

  it('D8/D9/D15 same host binds once and checking commits binding, root projection and one durable event', async () => {
    const { f, report, api } = await setup(); mustExist(api);
    const owner = api.bindHostDeliveryOwner(f.host);
    expect(api.bindHostDeliveryOwner(f.host)).toBe(owner); expect(Object.isFrozen(owner)).toBe(true);
    const before = f.store.readEvents(f.groupId).length;
    await api.recordHostDelivery({ requestSource: 'scheduler', authority: owner, report });
    expect(f.store.getRootBinding(report.source.sourceTaskId)).toMatchObject({ delivery: report.delivery, phase: 'settled', status: 'completed' });
    expect(f.store.getAgent(f.groupId, `root_${f.groupId}`)).toMatchObject({ status: 'completed', hostDeliveryStatus: 'checking' });
    const added = f.store.readEvents(f.groupId).slice(before);
    expect(added).toHaveLength(1); expect(added[0]).toMatchObject({ kind: 'delivery', payload: report });
    expect(Buffer.byteLength(JSON.stringify(added[0]))).toBeLessThanOrEqual(4096);
  });

  it.each(['user', 'agent', 'scheduler-with-empty', 'copied', 'json', 'foreign-host'] as const)('D15 %s cannot forge authority with correct source strings', async attack => {
    const { f, report, api } = await setup(); mustExist(api);
    const owner = api.bindHostDeliveryOwner(f.host); const before = f.store.readEvents(f.groupId);
    let authority: object = owner;
    if (attack === 'scheduler-with-empty') authority = {};
    if (attack === 'copied') authority = { ...owner };
    if (attack === 'json') authority = JSON.parse(JSON.stringify(owner));
    if (attack === 'foreign-host') {
      const other = await createPostSealHarness(); fixtures.push(other);
      expect(() => api.bindHostDeliveryOwner(other.host)).toThrow();
      authority = deliveryContract(other.service).bindHostDeliveryOwner(other.host);
    }
    await expect(api.recordHostDelivery({ requestSource: attack === 'user' || attack === 'agent' ? attack : 'scheduler', authority, report })).rejects.toThrow();
    expect(f.store.readEvents(f.groupId)).toEqual(before);
    expect(f.store.getRootBinding(report.source.sourceTaskId)).not.toHaveProperty('delivery');
  });

  it.each(['sourceTaskId', 'groupId', 'rootTurnId', 'rootEpoch', 'preparationId', 'bootId'] as const)('D8 source %s mismatch rejects before any durable write', async key => {
    const { f, report, api } = await setup(); mustExist(api);
    const before = f.store.readEvents(f.groupId);
    const bad = structuredClone(report);
    Object.assign(bad.source, { [key]: key === 'rootEpoch' ? report.source.rootEpoch + 1 : randomUUID() });
    await expect(api.recordHostDelivery({ requestSource: 'scheduler', authority: api.bindHostDeliveryOwner(f.host), report: bad })).rejects.toThrow();
    expect(f.store.readEvents(f.groupId)).toEqual(before);
    expect(f.store.getRootBinding(report.source.sourceTaskId)).not.toHaveProperty('delivery');
  });

  it('D8 identical report is a no-op, same revision conflict and lower revision cannot replace it', async () => {
    const { f, report, api } = await setup(); mustExist(api); const authority = api.bindHostDeliveryOwner(f.host);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report });
    const before = f.store.readEvents(f.groupId);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: structuredClone(report) });
    expect(f.store.readEvents(f.groupId)).toEqual(before);
    for (const patch of [{ revision: 0 }, { deadlineAt: report.delivery.deadlineAt + 1 }]) {
      await expect(api.recordHostDelivery({ requestSource: 'scheduler', authority, report: { ...report, delivery: { ...report.delivery, ...patch } } })).rejects.toThrow();
      expect(f.store.readEvents(f.groupId)).toEqual(before);
    }
  });

  it('D8 A report after B is prepared changes A history only, never spreads old delivery into B root', async () => {
    const { f, report, api } = await setup(); mustExist(api); const authority = api.bindHostDeliveryOwner(f.host);
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report });
    const b = await f.service.prepareRoot(f.host, 'post-seal-thread', { prompt: 'Explicit next root', materials: [] });
    const before = f.store.getAgent(f.groupId, `root_${f.groupId}`)!;
    expect(before.sourceTaskId).toBe(b.taskId);
    expect(before.hostDeliveryStatus).toBeUndefined();
    const late: DeliveryReportFixture = { source: report.source, delivery: { ...report.delivery, revision: 2, status: 'unknown',
      verification: 'failed', guardFailure: { code: 'delivery_timeout', stage: 'snapshot', needsExplicitFollowup: true } } };
    await api.recordHostDelivery({ requestSource: 'scheduler', authority, report: late });
    expect(f.store.getAgent(f.groupId, before.id)).toEqual(before);
    expect(f.store.getRootBinding(report.source.sourceTaskId)).toMatchObject({ delivery: late.delivery });
    expect(f.store.readEvents(f.groupId).at(-1)).toMatchObject({ kind: 'delivery', payload: late });
  });

  it.each(['extra-source', 'extra-record', 'free-detail', 'oversized-task', 'nan-time', 'fractional-revision'] as const)('D13 report %s fails closed instead of truncating or storing hidden fields', async attack => {
    const { f, report, api } = await setup(); mustExist(api);
    const bad = structuredClone(report);
    if (attack === 'extra-source') Object.assign(bad.source, { path: 'hidden' });
    if (attack === 'extra-record') Object.assign(bad.delivery, { padding: 'x'.repeat(2048) });
    if (attack === 'free-detail') bad.delivery.guardFailure = Object.assign({ code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true as const }, { detail: 'private error' });
    if (attack === 'oversized-task') bad.source.sourceTaskId = 'x'.repeat(129);
    if (attack === 'nan-time') bad.delivery.startedAt = Number.NaN;
    if (attack === 'fractional-revision') bad.delivery.revision = 1.5;
    const before = f.store.readEvents(f.groupId);
    await expect(api.recordHostDelivery({ requestSource: 'scheduler', authority: api.bindHostDeliveryOwner(f.host), report: bad })).rejects.toThrow();
    expect(f.store.readEvents(f.groupId)).toEqual(before);
  });
});
