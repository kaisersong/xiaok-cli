import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { VerificationReceiverStore } from '../../../src/runtime/verification/receiver-store.js';
import { parseVerificationTuple, hashVerificationTuple } from '../../../src/runtime/verification/protocol.js';

function fixture(payload: string) {
  const h = 'a'.repeat(64);
  return parseVerificationTuple({ schemaVersion: 1, profileId: 'profile', ownerKind: 'task', ownerId: 'task1', migrationEpoch: 1,
    expectedBusinessRevision: 2, obligationSetRevision: 3, obligationSetHash: h,
    obligations: [{ obligationId: 'check1', predicateId: 'original', predicateVersion: '1', definitionHash: h,
      activeAttemptId: 'attempt1', attemptEpoch: 1, sourceRunId: 'run1', runNonce: 'nonce1', subjectId: 'subject1',
      contentRoot: h, coreId: 'core1', coreHash: h, coreFinalRevision: 1, proofId: 'proof1', proofHash: h,
      proofRevision: 1, requiredScopeId: 'scope1', scopeRevision: 1, invalidationEpoch: 1 }],
    operationId: 'operation1', immutablePayloadHash: createHash('sha256').update(payload).digest('hex'),
    receiverId: 'receiver1', receiverProtocolVersion: 1, receiverInstanceEpoch: 1,
    reservationId: 'reservation1', nonce: 'nonce2', notBefore: 1000, validUntil: 2000, clockDomainId: 'clock1', clockQualificationEpoch: 1 });
}
describe('P3-R real SQLite receiver transaction', () => {
  let root: string; let now: number; let store: VerificationReceiverStore;
  const options = () => ({ root, receiverId: 'receiver1', receiverInstanceEpoch: 1,
    clock: () => ({ domainId: 'clock1', qualificationEpoch: 1, lowerBound: now, upperBound: now, evidenceHash: 'c'.repeat(64) }) });
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'verification-receiver-')); now = 1500; store = new VerificationReceiverStore(options()); });
  afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  it('stages no visible result, commits atomically and survives reopen idempotently', () => {
    const t = fixture('artifact'); store.stage(t, 'artifact'); expect(store.readVisible(t.operationId)).toBeUndefined();
    const result = store.commit(t, hashVerificationTuple(t), 1); expect(result.status).toBe('committed');
    expect(store.readVisible(t.operationId)).toBe('artifact'); store.close(); store = new VerificationReceiverStore(options());
    expect(store.commit(t, hashVerificationTuple(t), 1)).toEqual(result);
  });
  it('first commit after expiry cancels and can never make output visible', () => {
    const t = fixture('artifact'); store.stage(t, 'artifact'); now = 2000;
    expect(store.commit(t, hashVerificationTuple(t), 1)).toMatchObject({ status: 'cancelled', reason: 'expired' });
    now = 1500; expect(store.commit(t, hashVerificationTuple(t), 1).status).toBe('cancelled');
    expect(store.readVisible(t.operationId)).toBeUndefined();
  });
  it('cancel before stage creates a durable tombstone; late stage cannot resurrect', () => {
    const t = fixture('artifact'); store.cancel(t, hashVerificationTuple(t));
    store.close(); store = new VerificationReceiverStore(options());
    expect(store.stage(t, 'artifact').status).toBe('cancelled');
    expect(store.commit(t, hashVerificationTuple(t), 1).status).toBe('cancelled');
  });
  it('rejects full-tuple drift, payload mismatch and stale prepared revision', () => {
    const t = fixture('artifact'); expect(() => store.stage(t, 'different')).toThrow(); store.stage(t, 'artifact');
    const changed = parseVerificationTuple({ ...t, expectedBusinessRevision: 3 });
    expect(() => store.commit(changed, hashVerificationTuple(changed), 1)).toThrow();
    expect(() => store.commit(t, 'b'.repeat(64), 1)).toThrow();
    expect(() => store.commit(t, hashVerificationTuple(t), 0)).toThrow();
    expect(store.readVisible(t.operationId)).toBeUndefined();
  });
  it('rolls back visible output if terminal persistence fails in the real database', () => {
    const t = fixture('artifact'); store.stage(t, 'artifact');
    const Database = createRequire(import.meta.url)('better-sqlite3'); const other = new Database(join(root, 'authority.sqlite'));
    try { other.exec("CREATE TRIGGER fail_terminal BEFORE UPDATE ON receiver_operations BEGIN SELECT RAISE(ABORT,'injected_failure'); END"); }
    finally { other.close(); }
    expect(() => store.commit(t, hashVerificationTuple(t), 1)).toThrow('injected_failure');
    expect(store.readVisible(t.operationId)).toBeUndefined();
    expect(store.query(t, hashVerificationTuple(t))?.status).toBe('prepared');
  });
  it('unknown clock and rejected Promise are cancelled, never treated as approval', () => {
    for (const clock of [() => undefined, () => Promise.reject(Error('clock_failure')), () => ({ domainId: 'clock1', qualificationEpoch: 9, lowerBound: 1500, upperBound: 1500, evidenceHash: 'c'.repeat(64) })]) {
      store.close(); store = new VerificationReceiverStore({ ...options(), clock });
      const t = parseVerificationTuple({ ...fixture('artifact'), operationId: 'clock-' + Math.random(), reservationId: 'res-' + Math.random() });
      store.stage(t, 'artifact');
      expect(store.commit(t, hashVerificationTuple(t), 1)).toMatchObject({ status: 'cancelled', reason: 'clock_unavailable' });
      expect(store.readVisible(t.operationId)).toBeUndefined();
    }
  });
  it('clock rollback remains rejected across receiver restarts', () => {
    const t = fixture('artifact'); store.stage(t, 'artifact'); store.commit(t, hashVerificationTuple(t), 1);
    store.close(); now = 1400; store = new VerificationReceiverStore(options());
    const next = parseVerificationTuple({ ...t, operationId: 'next', reservationId: 'nextres' }); store.stage(next, 'artifact');
    expect(store.commit(next, hashVerificationTuple(next), 1)).toMatchObject({ status: 'cancelled', reason: 'clock_unavailable' });
  });
  it('a second real connection cannot cancel a committed result', () => {
    const t = fixture('artifact'); store.stage(t, 'artifact');
    const other = new VerificationReceiverStore(options());
    try { const committed = store.commit(t, hashVerificationTuple(t), 1); expect(other.cancel(t, hashVerificationTuple(t))).toEqual(committed); }
    finally { other.close(); }
    expect(store.readVisible(t.operationId)).toBe('artifact');
  });

  it('does not compare watermarks from incomparable clock domains or qualification epochs', () => {
    const first = fixture('artifact'); store.stage(first, 'artifact'); store.commit(first, hashVerificationTuple(first), 1); store.close();
    store = new VerificationReceiverStore({ ...options(), clock: () => ({ domainId: 'new-clock', qualificationEpoch: 2, lowerBound: 150, upperBound: 150, evidenceHash: 'c'.repeat(64) }) });
    const next = parseVerificationTuple({ ...first, operationId: 'new-clock-op', expectedBusinessRevision:first.expectedBusinessRevision+1, reservationId: 'new-res', clockDomainId: 'new-clock', clockQualificationEpoch: 2, notBefore: 100, validUntil: 200 });
    store.stage(next, 'artifact'); expect(store.commit(next, hashVerificationTuple(next), 1).status).toBe('committed');
  });

  it('persists receiver identity and refuses opening the same database under another receiver', () => {
    store.close();
    expect(() => new VerificationReceiverStore({ ...options(), receiverId: 'other' })).toThrow('receiver_identity_mismatch');
  });

  it.each(['commit','reopen','failure','terminal-failure','cancel','owner','conflict','overflow'] as const)('commits the actual owner business completion in the same receiver transaction: %s',mode=>{
    const t=mode==='overflow'?parseVerificationTuple({...fixture('artifact'),expectedBusinessRevision:Number.MAX_SAFE_INTEGER}):fixture('artifact'),owner={profileId:t.profileId,ownerKind:t.ownerKind,ownerId:t.ownerId},h=hashVerificationTuple(t);
    store.stage(t,'artifact');expect(store.readBusinessCompletion(owner,t.operationId,h)).toBeUndefined();
    if(mode==='cancel'){store.cancel(t,h);expect(store.commit(t,h,1).status).toBe('cancelled');expect(store.readBusinessCompletion(owner,t.operationId,h)).toBeUndefined();return;}
    if(mode==='overflow'){expect(()=>store.commit(t,h,1)).toThrow('receiver_business_revision');expect(store.query(t,h)?.status).toBe('prepared');expect(store.readBusinessCompletion(owner,t.operationId,h)).toBeUndefined();return;}
    if(mode==='failure'||mode==='terminal-failure'){
      const Database=createRequire(import.meta.url)('better-sqlite3'),db=new Database(join(root,'authority.sqlite'));
      try{db.exec(mode==='failure'?"CREATE TRIGGER fail_business BEFORE INSERT ON receiver_business_completions BEGIN SELECT RAISE(ABORT,'business_failure'); END":"CREATE TRIGGER fail_terminal BEFORE UPDATE ON receiver_operations BEGIN SELECT RAISE(ABORT,'business_failure'); END");}finally{db.close();}
      expect(()=>store.commit(t,h,1)).toThrow('business_failure');expect(store.query(t,h)?.status).toBe('prepared');expect(store.readVisible(t.operationId)).toBeUndefined();expect(store.readBusinessCompletion(owner,t.operationId,h)).toBeUndefined();return;
    }
    const committed=store.commit(t,h,1);expect(committed.status).toBe('committed');
    if(mode==='reopen'){store.close();store=new VerificationReceiverStore(options());}
    const business=store.readBusinessCompletion(owner,t.operationId,h);expect(business).toMatchObject({owner,operationId:t.operationId,businessRevision:t.expectedBusinessRevision+1,migrationEpoch:t.migrationEpoch,fullTupleHash:h,payload:'artifact',result:committed});
    expect(store.commit(t,h,1)).toEqual(committed);expect(store.readBusinessCompletion(owner,t.operationId,h)).toEqual(business);
    if(mode==='owner')expect(()=>store.readBusinessCompletion({...owner,ownerId:'other'},t.operationId,h)).toThrow();
    if(mode==='conflict'){const other=parseVerificationTuple({...t,operationId:'other',reservationId:'other',nonce:'other'});store.stage(other,'artifact');expect(()=>store.commit(other,hashVerificationTuple(other),1)).toThrow();expect(store.query(other,hashVerificationTuple(other))?.status).toBe('prepared');expect(store.readVisible('other')).toBeUndefined();expect(store.readBusinessCompletion(owner,t.operationId,h)).toEqual(business);}
  });

});
