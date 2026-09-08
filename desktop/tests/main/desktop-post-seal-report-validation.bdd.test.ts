// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { captureHostDeliveryReport, assertHostDeliveryAdvance } from '../../electron/desktop-host-delivery-projection.js';
import type { HostDeliveryRecord, HostDeliveryReport } from '../../../src/runtime/task-host/delivery-types.js';

const source: HostDeliveryReport['source'] = {
  sourceTaskId: 'task_report_fixture', groupId: '11111111-1111-4111-8111-111111111111',
  rootTurnId: '22222222-2222-4222-8222-222222222222', rootEpoch: 1,
  preparationId: '33333333-3333-4333-8333-333333333333', bootId: '44444444-4444-4444-8444-444444444444',
};
function checking(): HostDeliveryRecord {
  return { version: 1, revision: 1, status: 'checking', stage: 'flush', verification: 'pending', hostSettlement: 'pending',
    readerCleanup: 'none', storeCleanup: 'none', startedAt: 1000, deadlineAt: 3000 };
}
function decision(): HostDeliveryRecord {
  return { ...checking(), revision: 2, stage: 'settle', verification: 'passed', decisionAt: 2000,
    readerCleanup: 'settled', storeCleanup: 'pending' };
}
function pendingWrite(): HostDeliveryRecord {
  return { ...decision(), revision: 3, status: 'unknown', hostSettlement: 'unknown' };
}
function committed(): HostDeliveryRecord {
  return { ...pendingWrite(), revision: 4, status: 'passed', hostSettlement: 'committed',
    hostTerminalStatus: 'completed', finishedAt: 3500, storeCleanup: 'settled' };
}
function timedOut(): HostDeliveryRecord {
  return { ...checking(), revision: 2, status: 'unknown', stage: 'verify', verification: 'failed', decisionAt: 3000,
    hostSettlement: 'unknown', readerCleanup: 'pending', storeCleanup: 'pending',
    guardFailure: { code: 'delivery_timeout', stage: 'verify', needsExplicitFollowup: true } };
}
function report(delivery: HostDeliveryRecord): HostDeliveryReport { return { source: { ...source }, delivery }; }
function parsed(delivery: HostDeliveryRecord): HostDeliveryRecord { return captureHostDeliveryReport(report(delivery)).delivery; }

describe('R4 delivery parser: actual shape gate, not a test-owned validator', () => {
  it('captures plain immutable-by-caller facts without inferring a host terminal from checking or unknown', () => {
    const input = report(checking()); const captured = captureHostDeliveryReport(input);
    input.delivery.status = 'passed'; input.source.sourceTaskId = 'changed-after-capture';
    expect(captured).toEqual(report(checking())); expect(captured.delivery).not.toHaveProperty('hostTerminalStatus');
    expect(parsed(pendingWrite())).toMatchObject({ status: 'unknown', verification: 'passed', hostSettlement: 'unknown' });
    expect(parsed(pendingWrite())).not.toHaveProperty('hostTerminalStatus');
  });

  it.each(['outer', 'source', 'record', 'failure'] as const)('rejects free metadata on %s instead of trimming it into accepted facts', target => {
    const input = report(timedOut());
    const row = target === 'outer' ? input : target === 'source' ? input.source
      : target === 'record' ? input.delivery : input.delivery.guardFailure!;
    Object.assign(row, { detail: 'private path or model-controlled free text' });
    expect(() => captureHostDeliveryReport(input)).toThrow();
  });

  it.each(['version', 'revision', 'epoch', 'startedAt', 'deadlineAt', 'decisionAt', 'finishedAt'] as const)(
    'rejects invalid %s at the real parser', key => {
      const input = report(committed());
      if (key === 'version') Object.assign(input.delivery, { version: 2 });
      else if (key === 'revision') input.delivery.revision = 1.5;
      else if (key === 'epoch') input.source.rootEpoch = Number.MAX_SAFE_INTEGER + 1;
      else input.delivery[key] = Number.NaN;
      expect(() => captureHostDeliveryReport(input)).toThrow();
    });

  it('uses sourceTaskId UTF-8 bytes and keeps the actual 128-byte boundary', () => {
    expect(captureHostDeliveryReport({ source: { ...source, sourceTaskId: 'a'.repeat(128) }, delivery: checking() }).source.sourceTaskId).toHaveLength(128);
    expect(() => captureHostDeliveryReport({ source: { ...source, sourceTaskId: '界'.repeat(43) }, delivery: checking() })).toThrow();
  });

  it.each(['checking-committed', 'unknown-completed', 'unknown-failed-without-recovery', 'unknown-failed-wrong-reason'] as const)(
    'rejects %s: only recovery_unconfirmed may pair unknown with a committed failed host', kind => {
      const value: HostDeliveryRecord = { ...committed(), status: kind === 'checking-committed' ? 'checking' : 'unknown' };
      if (kind.startsWith('unknown-failed')) value.hostTerminalStatus = 'failed';
      if (kind === 'unknown-failed-wrong-reason') value.guardFailure = { code: 'snapshot_write_failed', stage: 'settle', needsExplicitFollowup: true };
      expect(() => parsed(value)).toThrow();
    });

  it.each(['pending', 'passed', 'failed'] as const)('accepts the frozen recovery-only committed failed host with retained verification=%s', verification => {
    const value: HostDeliveryRecord = { ...checking(), revision: 2, status: 'unknown', stage: 'settle', verification,
      hostSettlement: 'committed', hostTerminalStatus: 'failed', finishedAt: 3500,
      readerCleanup: 'settled', storeCleanup: 'settled',
      guardFailure: { code: 'recovery_unconfirmed', stage: 'settle', needsExplicitFollowup: true },
      ...(verification === 'passed' ? { decisionAt: 2000 } : {}) };
    expect(parsed(value)).toEqual(value);
    // This parser acceptance is not a live authority or Goal readiness proof.
  });

  it.each(['decision-before-start', 'finish-before-start', 'finish-before-decision'] as const)(
    'allows reported wall-clock rollback %s without using it as evidence about the live monotonic deadline', kind => {
      const value = committed();
      if (kind === 'decision-before-start') value.decisionAt = value.startedAt - 1;
      if (kind === 'finish-before-start') value.finishedAt = value.startedAt - 1;
      if (kind === 'finish-before-decision') value.finishedAt = value.decisionAt! - 1;
      expect(parsed(value)).toEqual(value);
    });

  it.each([0, 60_000])('does not overrule a trusted passed decision when its display timestamp is deadlineAt + %i after a wall-clock jump', offset => {
    const value = committed(); value.decisionAt = value.deadlineAt + offset; value.finishedAt = value.decisionAt + 1;
    // This is a report-shape test, not a fake Date proof of the live host's
    // deadline. Only the host's actual monotonic owner may decide timeout.
    expect(parsed(value)).toEqual(value);
  });

  it('does not publish finishedAt while host settlement is still unconfirmed', () => {
    const value = committed();
    Object.assign(value, { status: 'unknown', hostSettlement: 'unknown' }); delete value.hostTerminalStatus;
    expect(() => parsed(value)).toThrow();
  });

  it.each(['flush', 'snapshot', 'verify'] as const)('a passed terminal cannot report pre-settlement stage=%s', stage => {
    expect(() => parsed({ ...committed(), stage })).toThrow();
  });
});

describe('R4 delivery advance: actual monotone report sequence', () => {
  it('allows one passed decision before the deadline, unknown pending persistence, then late confirmed passed without another decision', () => {
    const records = [checking(), decision(), pendingWrite(), committed(), { ...committed(), revision: 5, stage: 'cleanup' as const }].map(parsed);
    let previous: HostDeliveryRecord | undefined;
    for (const next of records) { expect(() => assertHostDeliveryAdvance(previous, next)).not.toThrow(); previous = next; }
    expect(records[2]).not.toHaveProperty('hostTerminalStatus');
    expect(records[3]!.finishedAt).toBeGreaterThan(records[3]!.deadlineAt);
    expect(records.slice(1).map(record => record.decisionAt)).toEqual([2000, 2000, 2000, 2000]);
  });

  it('unknown with no already-won passed decision cannot later invent one, even with a backdated decisionAt', () => {
    const unknown = parsed({ ...checking(), revision: 2, status: 'unknown', stage: 'settle', hostSettlement: 'unknown', storeCleanup: 'pending' });
    expect(() => assertHostDeliveryAdvance(parsed(checking()), unknown)).not.toThrow();
    expect(() => assertHostDeliveryAdvance(unknown, parsed(committed()))).toThrow();
  });

  it('a timeout-won failed decision cannot reverse; its real failed commit and later physical cleanup remain legal', () => {
    const failed = parsed(timedOut());
    const final = parsed({ ...timedOut(), revision: 3, status: 'failed', stage: 'settle', hostSettlement: 'committed',
      hostTerminalStatus: 'failed', finishedAt: 3500 });
    expect(() => assertHostDeliveryAdvance(parsed(checking()), failed)).not.toThrow();
    expect(() => assertHostDeliveryAdvance(failed, parsed(committed()))).toThrow();
    expect(() => assertHostDeliveryAdvance(failed, final)).not.toThrow();
    expect(() => assertHostDeliveryAdvance(final, parsed({ ...final, revision: 4, stage: 'cleanup', readerCleanup: 'settled', storeCleanup: 'settled' }))).not.toThrow();
  });

  it.each(['snapshot', 'cleanup', 'reader-pending', 'store-pending', 'reader-settled', 'store-settled', 'guard-failure'] as const)(
    'first checking is a flush marker before any validation effect: reject %s', kind => {
      const value = checking();
      if (kind === 'snapshot' || kind === 'cleanup') value.stage = kind;
      if (kind === 'reader-pending') value.readerCleanup = 'pending';
      if (kind === 'store-pending') value.storeCleanup = 'pending';
      if (kind === 'reader-settled') value.readerCleanup = 'settled';
      if (kind === 'store-settled') value.storeCleanup = 'settled';
      if (kind === 'guard-failure') value.guardFailure = { code: 'delivery_timeout', stage: 'flush', needsExplicitFollowup: true };
      expect(() => assertHostDeliveryAdvance(undefined, parsed(value))).toThrow();
    });

  it.each(['readerCleanup', 'storeCleanup'] as const)('pending %s cannot disappear back to none', key => {
    const previous = parsed(timedOut()); const next = parsed({ ...previous, revision: 3, [key]: 'none' });
    expect(() => assertHostDeliveryAdvance(previous, next)).toThrow();
  });

  it.each(['readerCleanup', 'storeCleanup'] as const)('settled %s cannot restart pending', key => {
    const previous = parsed({ ...timedOut(), [key]: 'settled' }); const next = parsed({ ...previous, revision: 3, [key]: 'pending' });
    expect(() => assertHostDeliveryAdvance(previous, next)).toThrow();
  });

  it.each(['startedAt', 'deadlineAt', 'decisionAt', 'finishedAt', 'failure'] as const)('does not rewrite frozen %s on a higher revision', key => {
    const previous = parsed({ ...timedOut(), revision: 3, status: 'failed', stage: 'settle', hostSettlement: 'committed',
      hostTerminalStatus: 'failed', finishedAt: 3500 });
    const next = structuredClone(previous); next.revision++;
    if (key === 'failure') next.guardFailure!.code = 'snapshot_read_failed'; else next[key] = previous[key]! + 1;
    expect(() => assertHostDeliveryAdvance(previous, parsed(next))).toThrow();
  });

  it('does not advance a foreign stored version into v1; next-version validation is not a substitute for checking durable previous facts', () => {
    const previous = { ...checking(), version: 2 } as unknown as HostDeliveryRecord;
    expect(() => assertHostDeliveryAdvance(previous, parsed(decision()))).toThrow();
  });

  it('rejects equal/lower revision; complete identical report no-op remains the service caller contract', () => {
    const previous = parsed(pendingWrite());
    expect(() => assertHostDeliveryAdvance(previous, parsed({ ...previous }))).toThrow();
    expect(() => assertHostDeliveryAdvance(previous, parsed({ ...previous, revision: 1 }))).toThrow();
  });
});
