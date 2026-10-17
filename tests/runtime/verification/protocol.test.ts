import { describe, it, expect } from 'vitest';
import { parseVerificationTuple, hashVerificationTuple, assertVerificationTransition } from '../../../src/runtime/verification/protocol.js';

export function tupleFixture() {
  const h = 'a'.repeat(64);
  return { schemaVersion: 1, profileId: 'profile', ownerKind: 'task', ownerId: 'task1', migrationEpoch: 1,
    expectedBusinessRevision: 2, obligationSetRevision: 3, obligationSetHash: h,
    obligations: [{ obligationId: 'check1', predicateId: 'original', predicateVersion: '1', definitionHash: h,
      activeAttemptId: 'attempt1', attemptEpoch: 1, sourceRunId: 'run1', runNonce: 'nonce1', subjectId: 'subject1',
      contentRoot: h, coreId: 'core1', coreHash: h, coreFinalRevision: 1, proofId: 'proof1', proofHash: h,
      proofRevision: 1, requiredScopeId: 'scope1', scopeRevision: 1, invalidationEpoch: 1 }],
    operationId: 'operation1', immutablePayloadHash: h, receiverId: 'receiver1', receiverProtocolVersion: 1,
    receiverInstanceEpoch: 1, reservationId: 'reservation1', nonce: 'nonce2', notBefore: 1000, validUntil: 2000,
    clockDomainId: 'clock1', clockQualificationEpoch: 1 };
}
describe('P3-R canonical full tuple', () => {
  it('owns a deep immutable clone and hashes every binding', () => {
    const input = tupleFixture(); const result = parseVerificationTuple(input); const hash = hashVerificationTuple(result);
    input.obligations[0].contentRoot = 'b'.repeat(64);
    expect(result.obligations[0].contentRoot).toBe('a'.repeat(64));
    expect(Object.isFrozen(result.obligations[0])).toBe(true);
    for (const key of ['expectedBusinessRevision', 'obligationSetRevision', 'migrationEpoch', 'validUntil', 'clockQualificationEpoch'] as const) {
      expect(hashVerificationTuple(parseVerificationTuple({ ...tupleFixture(), [key]: tupleFixture()[key] + 1 }))).not.toBe(hash);
    }
  });
  it('rejects incomplete/unknown fields, duplicate obligations and non-finite time', () => {
    const { expectedBusinessRevision: _ignored, ...missing } = tupleFixture();
    for (const x of [missing, { ...tupleFixture(), passed: true }, { ...tupleFixture(), validUntil: NaN },
      { ...tupleFixture(), obligations: [tupleFixture().obligations[0], tupleFixture().obligations[0]] }]) {
      expect(() => parseVerificationTuple(x)).toThrow();
    }
  });
  it('denies unknown-to-running, expired-to-pass and terminal rollback', () => {
    expect(() => assertVerificationTransition('attempt', 'unknown', 'running')).toThrow();
    expect(() => assertVerificationTransition('proof', 'expired', 'pass')).toThrow();
    expect(() => assertVerificationTransition('receiver', 'committed', 'cancelled')).toThrow();
    expect(() => assertVerificationTransition('attempt', 'unknown', 'terminal')).not.toThrow();
  });
});
