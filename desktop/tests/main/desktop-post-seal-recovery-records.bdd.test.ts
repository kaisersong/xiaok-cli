// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as projection from '../../electron/desktop-host-delivery-projection.js';
import type { HostDeliveryRecord, HostDeliverySource } from '../../../src/runtime/task-host/delivery-types.js';

const source: HostDeliverySource = { sourceTaskId: 'task-fixture', groupId: randomUUID(), rootTurnId: randomUUID(),
  rootEpoch: 1, bootId: randomUUID(), preparationId: randomUUID() };
const checking = (): HostDeliveryRecord => ({ version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending',
  hostSettlement: 'pending', readerCleanup: 'none', storeCleanup: 'none', startedAt: 10, deadlineAt: 200 });
const passed = (): HostDeliveryRecord => ({ ...checking(), revision: 2, status: 'passed', stage: 'settle', verification: 'passed', decisionAt: 100,
  hostSettlement: 'committed', hostTerminalStatus: 'completed', readerCleanup: 'pending', storeCleanup: 'pending', finishedAt: 150 });
function reconcile(host?: HostDeliveryRecord, journal?: HostDeliveryRecord) {
  const method = (projection as typeof projection & { reconcileHostDeliveryRecords?: (source: HostDeliverySource, host?: HostDeliveryRecord, journal?: HostDeliveryRecord) => HostDeliveryRecord | undefined }).reconcileHostDeliveryRecords;
  expect(method, 'production reconciliation entry is not implemented; downstream record assertions have not run').toBeTypeOf('function');
  return method!(source, host, journal);
}
describe('R4 recovery reconciles actual committed observations, not a second verification', () => {
  beforeEach(() => expect((projection as Record<string, unknown>).reconcileHostDeliveryRecords,
    'missing production entry cannot satisfy a negative toThrow assertion').toBeTypeOf('function'));
  it('no saved delivery remains unrecorded', () => { expect(reconcile()).toBeUndefined(); });
  it('SQLite-only acknowledged checking is valid before a host delivery snapshot exists', () => { expect(reconcile(undefined, checking())).toEqual(checking()); });
  it('host journal commit with an older SQLite checking preserves the latest confirmed decision', () => { expect(reconcile(passed(), checking())).toEqual(passed()); });
  it('a later pending-writer unknown can coexist with the earlier actually committed host candidate', () => {
    const observation: HostDeliveryRecord = { ...checking(), revision: 3, status: 'unknown', stage: 'settle', verification: 'passed', decisionAt: 100,
      hostSettlement: 'unknown', readerCleanup: 'pending', storeCleanup: 'pending' };
    expect(reconcile(passed(), observation)).toEqual(observation);
  });
  it.each(['host', 'journal'] as const)('%s unknown schema is rejected even when the other leg is valid', leg => {
    const bad = { ...checking(), version: 2 } as unknown as HostDeliveryRecord;
    expect(() => reconcile(leg === 'host' ? bad : passed(), leg === 'journal' ? bad : checking())).toThrow();
  });
  it('same revision requires an exact whole-record match', () => {
    expect(reconcile(passed(), passed())).toEqual(passed());
    expect(() => reconcile(passed(), { ...passed(), storeCleanup: 'settled' })).toThrow();
  });
  it.each(['startedAt', 'deadlineAt', 'decisionAt', 'finishedAt'] as const)('%s cannot change across stored observations', key => {
    expect(() => reconcile(passed(), { ...passed(), revision: 3, [key]: passed()[key]! + 1 })).toThrow();
  });
  it('a failed verifier decision cannot be upgraded by another higher-revision record', () => {
    const failed: HostDeliveryRecord = { ...checking(), revision: 2, status: 'unknown', verification: 'failed', decisionAt: 100, hostSettlement: 'unknown',
      guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
    expect(() => reconcile({ ...passed(), revision: 3 }, failed)).toThrow();
  });
  it('a committed host terminal never reverses outcome', () => {
    const failed: HostDeliveryRecord = { ...passed(), revision: 3, status: 'failed', verification: 'failed', hostTerminalStatus: 'failed' };
    expect(() => reconcile(passed(), failed)).toThrow();
  });
  it('the explicit recovery-unknown record can replace an uncommitted failure reason, not its verification', () => {
    const unknown: HostDeliveryRecord = { ...checking(), revision: 2, status: 'unknown', hostSettlement: 'unknown', verification: 'failed', decisionAt: 100,
      guardFailure: { code: 'delivery_timeout', stage: 'snapshot', needsExplicitFollowup: true } };
    const recovered: HostDeliveryRecord = { ...unknown, revision: 3, stage: 'settle', hostSettlement: 'committed', hostTerminalStatus: 'failed', finishedAt: 250,
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true } };
    expect(reconcile(recovered, unknown)).toEqual(recovered);
  });
});
