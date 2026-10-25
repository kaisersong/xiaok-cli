import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { openPrivateVerificationDatabase } from '../../../src/runtime/verification/private-database.js';
import { VerificationReceiverStore } from '../../../src/runtime/verification/receiver-store.js';
import { VerificationPublicationJournal } from '../../../src/runtime/verification/publication-journal.js';
import { createReceiverReplySigner, createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';
import { parseVerificationTuple, hashVerificationTuple } from '../../../src/runtime/verification/protocol.js';

const H = 'a'.repeat(64);
const clock = (now: number) => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: now, upperBound: now, evidenceHash: H });
function tuple() { return parseVerificationTuple({ schemaVersion: 1, profileId: 'p', ownerKind: 'task', ownerId: 'o', migrationEpoch: 1, expectedBusinessRevision: 1, obligationSetRevision: 1, obligationSetHash: H,
  obligations: [{ obligationId: 'check', predicateId: 'original', predicateVersion: '1', definitionHash: H, activeAttemptId: 'a', attemptEpoch: 1, sourceRunId: 'r', runNonce: 'n', subjectId: 's', contentRoot: H, coreId: 'c', coreHash: H, coreFinalRevision: 1, proofId: 'proof', proofHash: H, proofRevision: 1, requiredScopeId: 'scope', scopeRevision: 1, invalidationEpoch: 1 }], operationId: 'op', immutablePayloadHash: H, receiverId: 'receiver', receiverProtocolVersion: 1, receiverInstanceEpoch: 1, reservationId: 'res', nonce: 'nonce', notBefore: 1000, validUntil: 2000, clockDomainId: 'clock', clockQualificationEpoch: 1 }); }
describe('P3-R durable publication reservation', () => {
  let root: string; let journal: VerificationPublicationJournal;
  const keys = generateKeyPairSync('ed25519'), id = { keyId: 'k', receiverId: 'receiver', receiverInstanceEpoch: 1 };
  const verifier = createReceiverReplyVerifier({ ...id, publicKey: keys.publicKey });
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'verification-journal-')); journal = new VerificationPublicationJournal({ root, receiverVerifier: verifier }); });
  afterEach(() => { journal.close(); rmSync(root, { recursive: true, force: true }); });
  it('unknown authorization survives restart and fences all dependency mutation', () => {
    const t = tuple(); journal.recordCommittedSettlement(t); journal.authorizeReservation(t, clock(1500));
    expect(journal.requestInvalidation(t)).toBe('pending'); journal.close(); journal = new VerificationPublicationJournal({ root, receiverVerifier: verifier });
    expect(journal.get(t)).toMatchObject({ reservation: 'commit_authorized', revocation: 'revocation_pending', outbox: 'dispatching' });
    expect(journal.requestInvalidation(t)).toBe('pending');
    expect(() => journal.authorizeReservation(t, clock(2500))).toThrow();
    expect(journal.get(t)?.reservation).toBe('commit_authorized');
  });
  it('only actual authenticated receiver terminal can release the reservation', () => {
    const t = tuple(); journal.recordCommittedSettlement(t); journal.authorizeReservation(t, clock(1500)); journal.requestInvalidation(t);
    expect(() => journal.acceptReceiverReply(t, {} as never)).toThrow();
    const request = journal.issueReceiverChallenge(t);
    const envelope = createReceiverReplySigner({ ...id, privateKey: keys.privateKey }).sign(request, { status: 'cancelled', fullTupleHash: request.fullTupleHash, objectRevision: 2, reason: 'user_cancelled', terminalRecordHash: H });
    const reply = verifier.verify(envelope, request);
    journal.acceptReceiverReply(t, reply);
    expect(journal.get(t)).toMatchObject({ reservation: 'cancelled', outbox: 'cancelled', revocation: 'revoked' });
  });
  it('restart does not dispatch ready and any full tuple mismatch is rejected', () => {
    const t = tuple(); journal.recordCommittedSettlement(t); journal.close(); journal = new VerificationPublicationJournal({ root, receiverVerifier: verifier });
    expect(journal.get(t)).toMatchObject({ reservation: 'pending', outbox: 'ready' });
    expect(() => journal.authorizeReservation({ ...t, obligationSetRevision: 2 }, clock(1500))).toThrow();
  });
  it('receiver stage followed by controller restart cannot locally release pending before cancellation ACK', () => {
    const t = parseVerificationTuple({ ...tuple(), immutablePayloadHash: createHash('sha256').update('artifact').digest('hex') });
    journal.recordCommittedSettlement(t);
    const receiver = new VerificationReceiverStore({ root, receiverId: 'receiver', receiverInstanceEpoch: 1,
      clock: () => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: 1500, upperBound: 1500, evidenceHash: H }) });
    try {
      receiver.stage(t, 'artifact'); journal.close(); journal = new VerificationPublicationJournal({ root, receiverVerifier: verifier });
      expect(journal.requestInvalidation(t)).toBe('pending');
      expect(journal.get(t)).toMatchObject({ reservation: 'pending', revocation: 'revocation_pending' });
      expect(() => journal.authorizeReservation(t, clock(1500))).toThrow();
      const request = journal.issueReceiverChallenge(t);
      const signed = createReceiverReplySigner({ ...id, privateKey: keys.privateKey }).sign(request, receiver.cancel(t, request.fullTupleHash));
      const reply = verifier.verify(signed, request); journal.acceptReceiverReply(t, reply); journal.acceptReceiverReply(t, reply);
      expect(journal.get(t)).toMatchObject({ reservation: 'cancelled', revocation: 'revoked' });
    } finally { receiver.close(); }
  });

  it('does not authorize when only the clock upper bound has passed notBefore', () => {
    const t = tuple(); journal.recordCommittedSettlement(t);
    expect(() => journal.authorizeReservation(t, { domainId: 'clock', qualificationEpoch: 1, lowerBound: 500, upperBound: 1500, evidenceHash: H })).toThrow();
    expect(journal.get(t)?.reservation).toBe('pending');
  });

  it('rejects a signed challenge the journal did not issue for this reservation', () => {
    const t = tuple(); journal.recordCommittedSettlement(t); journal.authorizeReservation(t, clock(1500));
    journal.issueReceiverChallenge(t);
    const unrelated = { fullTupleHash: hashVerificationTuple(t), challenge: 'e'.repeat(64) };
    const signed = createReceiverReplySigner({ ...id, privateKey: keys.privateKey }).sign(unrelated, { status: 'cancelled', fullTupleHash: unrelated.fullTupleHash, objectRevision: 2, reason: 'user_cancelled', terminalRecordHash: H });
    expect(() => journal.acceptReceiverReply(t, verifier.verify(signed, unrelated))).toThrow();
    expect(journal.get(t)?.reservation).toBe('commit_authorized');
  });

});

describe('same-connection authority transaction', () => {
  it('rolls back decision and publication together and never owns borrowed connection', () => {
    const root=mkdtempSync(join(tmpdir(),'verification-shared-')),db=openPrivateVerificationDatabase(root);
    const keys=generateKeyPairSync('ed25519');
    const receiverVerifier=createReceiverReplyVerifier({keyId:'k',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey});
    let journal:VerificationPublicationJournal|undefined;
    try {
      journal=new VerificationPublicationJournal({database:db,receiverVerifier});
      db.exec('CREATE TABLE test_decision(id TEXT PRIMARY KEY)');
      expect(()=>journal!.recordCommittedSettlement(tuple())).toThrow(/outer_transaction/);
      expect(()=>db.transaction(()=>{db.prepare('INSERT INTO test_decision VALUES(?)').run('op');journal!.recordCommittedSettlement(tuple());throw Error('injected_commit_failure');}).immediate()).toThrow('injected_commit_failure');
      expect(db.prepare('SELECT * FROM test_decision').all()).toEqual([]);expect(journal.get(tuple())).toBeUndefined();
      db.transaction(()=>{db.prepare('INSERT INTO test_decision VALUES(?)').run('op');journal!.recordCommittedSettlement(tuple());}).immediate();
      expect(journal.get(tuple())?.reservation).toBe('pending');
      expect(()=>journal!.authorizeReservation(tuple(),clock(1500))).toThrow(/outer_transaction/);
      db.transaction(()=>journal!.authorizeReservation(tuple(),clock(1500))).immediate();
      expect(journal.get(tuple())?.reservation).toBe('commit_authorized');
      journal.close();expect(db.prepare('SELECT COUNT(*) n FROM test_decision').get()).toEqual({n:1});
    }finally{journal?.close();db.close();rmSync(root,{recursive:true,force:true});}
  });
});
it('does not let retired terminal history permanently exhaust active outbox slots',()=>{
 const root=mkdtempSync(join(tmpdir(),'journal-retired-')),keys=generateKeyPairSync('ed25519'),identity={keyId:'k',receiverId:'receiver',receiverInstanceEpoch:1};
 const verifier=createReceiverReplyVerifier({...identity,publicKey:keys.publicKey}),journal=new VerificationPublicationJournal({root,receiverVerifier:verifier}),db=openPrivateVerificationDatabase(root);
 try{
  const first=tuple();journal.recordCommittedSettlement(first);
  const challenge=journal.issueReceiverChallenge(first);
  journal.acceptReceiverReply(first,verifier.verify(createReceiverReplySigner({...identity,privateKey:keys.privateKey}).sign(challenge,{status:'cancelled',fullTupleHash:challenge.fullTupleHash,objectRevision:1,reason:'user_cancelled',terminalRecordHash:H}),challenge));
  // Populate historical volume using the actual terminal row format; no fake live execution.
  const row=db.prepare('SELECT * FROM publication_journal WHERE operation_id=?').get(first.operationId) as any;
  const insert=db.prepare('INSERT INTO publication_journal VALUES(?,?,?,?,?,?,?)');
  db.transaction(()=>{for(let n=1;n<4096;n++){const old={...first,operationId:'old-'+n};insert.run(old.operationId,row.owner_key,hashVerificationTuple(old),JSON.stringify(old),row.state_json,row.reply_json,row.challenge);}})();
  const next={...first,operationId:'new-after-4096'};
  expect(()=>journal.recordCommittedSettlement(next)).not.toThrow();
  expect(journal.get(first)?.reservation).toBe('cancelled');
  expect(journal.get(next)?.reservation).toBe('pending');
  expect(db.prepare('SELECT COUNT(*) n FROM publication_journal').get()).toEqual({n:4097});
  expect(()=>journal.recordCommittedSettlement({...first,nonce:'changed'})).toThrow(/tuple_conflict/);
 }finally{journal.close();db.close();rmSync(root,{recursive:true,force:true});}
});
