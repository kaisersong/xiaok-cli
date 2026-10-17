import '../../support/installed-controller-fixture.js';
import {canonicalVerificationJson as canonical} from '../../../src/runtime/verification/protocol.js';
import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { createReceiverReplyVerifier } from '../../../src/runtime/verification/receiver-authentication.js';
import { createVerificationAuthority } from '../../../src/runtime/verification/proof-authority.js';
const H = 'a'.repeat(64), owner = { profileId: 'p', ownerKind: 'task' as const, ownerId: 'o' };
for(const timing of ['prepared','terminal','restart','scope','subject'] as const)it(`does not reauthorize an old attempt after ${timing} invalidation or incarnation change`,()=>{
 const f=fixture(),isPrepared=['prepared','scope','subject'].includes(timing);let restarted:ReturnType<typeof createVerificationAuthority>|undefined;
 try{
  const registration={owner,migrationEpoch:1,obligations:[{obligationId:'o1',predicateId:'original',predicateVersion:'1',semantics:timing==='subject'?'current-subject' as const:'specific-run' as const,definitionHash:H,requiredCheckIds:['content']}]};
  f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});
  const subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});
  const proposal={owner,obligationId:'o1',expectedAttemptEpoch:0,sourceRunId:'r',runNonce:'n',...subject,requiredScopeId:'scope',scopeRevision:1};
  const attempt=f.authority.service.requestVerification(proposal,{requestSource:'user',authorization:f.issue('requestVerification',proposal)});
  const expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H};
  const core={coreId:'c',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},verdict={verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500};
  if(!isPrepared)f.authority.host.bindExecution(attempt.attemptId,expected);
  if(timing==='terminal')f.authority.host.recordControllerResult(attempt.attemptId,core,verdict,f.receipt);
  let authority=f.authority;
  if(timing==='restart'){f.authority.service.close();restarted=createVerificationAuthority({...f.options,serviceEpoch:'boot2'});authority=restarted;}
  else if(timing==='scope')f.advance(2500);
  else if(timing==='subject')authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'b',sha256:H,size:1,role:'source'}]});
  else{const revoke={owner,reason:'revoke'};f.authority.service.invalidate(revoke,{requestSource:'user',authorization:f.issue('invalidate',revoke)});}
  if(isPrepared){
   expect(()=>authority.host.bindExecution(attempt.attemptId,expected)).toThrow(/admission/);
   authority.host.cancelPreparedAttempt(attempt.attemptId);
   expect(()=>authority.host.bindExecution(attempt.attemptId,expected)).toThrow(/binding/);
   if(timing!=='prepared')return;
   const fresh={...proposal,expectedAttemptEpoch:1},next=authority.service.requestVerification(fresh,{requestSource:'user',authorization:f.issue('requestVerification',fresh)});
   authority.host.bindExecution(next.attemptId,expected);
   expect(()=>authority.host.cancelPreparedAttempt(next.attemptId)).toThrow(/prepared/);
  }
  else{authority.host.recordControllerResult(attempt.attemptId,{...core,coreFinalRevision:timing==='terminal'?2:1},verdict,f.receipt);expect(authority.service.inspectOwner(owner)?.currentVerification).not.toBe('valid');}
 }finally{restarted?.service.close();f.close();}
});
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'proof-authority-')), keys = generateKeyPairSync('ed25519');
    const receiverVerifier = createReceiverReplyVerifier({ keyId: 'receiver-key', receiverId: 'receiver', receiverInstanceEpoch: 1, publicKey: keys.publicKey });
    const receipt = Object.freeze({});let now=1000;
    const options = { root, receiverVerifier, verifierHash: H, issuerId: 'controller', keyId: 'key', serviceEpoch: 'boot1', privateKey: keys.privateKey,
        clock: () => ({ domainId: 'clock', qualificationEpoch: 1, lowerBound: now, upperBound: now+1, evidenceHash: H }), assertVerifiedPayload: () => { /* Private payload port isolated here; real store covered by verified-publication-payload.test.ts. */ }, assertQualified: () => { }, quiescence: { assertQuiescent: (r: unknown, expected: unknown) => { if (r !== receipt || (expected as any).executionIdentity !== 'exec')
                throw Error('verification_receipt'); } } };
    const authority = createVerificationAuthority(options);
    const issue = (method: string, payload: unknown, requestSource: 'user' | 'agent' | 'scheduler' = 'user') => authority.host.issueAuthorization({ owner, method, payload, requestSource, principalId: 'user', expiresAt: 2000 });
    return { root, authority, options, issue, advance:(time:number)=>{now=time;},receipt: receipt as never, close: () => { authority.service.close(); rmSync(root, { recursive: true, force: true }); } };
}
it('rejects forged caller, source mismatch, payload replacement and replay after a failed transaction', () => {
    const f = fixture();
    try {
        const payload = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content'] }] };
        expect(() => f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: {} })).toThrow(/authorization/);
        const auth = f.issue('registerObligations', payload);
        expect(() => f.authority.service.registerObligations({ ...payload, migrationEpoch: 2 }, { requestSource: 'user', authorization: auth })).toThrow(/authorization/);
        expect(() => f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: auth })).toThrow(/authorization/);
        f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: f.issue('registerObligations', payload) });
        const redefine = { ...payload, obligations: [{ ...payload.obligations[0], definitionHash: 'b'.repeat(64) }] };
        const denied = f.issue('registerObligations', redefine);
        expect(() => f.authority.service.registerObligations(redefine, { requestSource: 'user', authorization: denied })).toThrow(/immutable/);
        expect(() => f.authority.service.registerObligations(redefine, { requestSource: 'user', authorization: denied })).toThrow(/authorization/);
        expect(f.authority.service.inspectOwner(owner)).toMatchObject({ obligationSetRevision: 1, obligationCount: 1, currentVerification: 'needs_revalidation' });
        const agent = f.issue('registerObligations', payload, 'agent');
        expect(() => f.authority.service.registerObligations(payload, { requestSource: 'agent', authorization: agent })).toThrow(/source/);
    }
    finally {
        f.close();
    }
});
it('preserves mandatory obligations across restart and never treats ordinary completion as proof', () => {
    const f = fixture();
    try {
        const payload = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'specific-run' as const, definitionHash: H, requiredCheckIds: ['diagnostic'] }] };
        f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: f.issue('registerObligations', payload) });
        f.authority.service.close();
        const restarted = createVerificationAuthority({ ...f.options, serviceEpoch: 'boot2' });
        try {
            expect(restarted.service.inspectOwner(owner)).toMatchObject({ currentVerification: 'needs_revalidation', obligationCount: 1 });
            expect(restarted.service.inspectOwner({ ...owner, ownerId: 'legacy' })).toBeUndefined();
        }
        finally {
            restarted.service.close();
        }
    }
    finally {
        f.close();
    }
});
it('rejects getter-swapped authorization without consuming a different permit', () => {
    const f = fixture();
    try {
        const payload = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content'] }] };
        const a = f.issue('registerObligations', payload), b = f.issue('registerObligations', payload);
        let reads = 0;
        const malicious = { requestSource: 'user' as const, get authorization() { return ++reads === 1 ? a : b; } };
        expect(() => f.authority.service.registerObligations(payload, malicious)).toThrow(/context/);
        expect(reads).toBe(0);
        f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: a });
        expect(() => f.authority.service.registerObligations(payload, { requestSource: 'user', authorization: a })).toThrow(/authorization/);
    }
    finally {
        f.close();
    }
});
it('requires controller-issued subject, exact physical receipt and all mandatory checks; rejects stale proofs after reboot', () => {
    const f = fixture();
    try {
        const registration = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content', 'structure'] }] };
        f.authority.service.registerObligations(registration, { requestSource: 'user', authorization: f.issue('registerObligations', registration) });
        const base = { owner, obligationId: 'o1', expectedAttemptEpoch: 0, sourceRunId: 'r', runNonce: 'nonce', subjectId: 'forged', contentRoot: H, requiredScopeId: 'scope', scopeRevision: 1 };
        expect(() => f.authority.service.requestVerification(base, { requestSource: 'agent', authorization: f.issue('requestVerification', base, 'agent') })).toThrow(/subject/);
        const subject = f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 1, scopeExpiresAt:2000,manifest: [{ path: 'source.txt', sha256: H, size: 6, role: 'source' }] });
        const proposal = { ...base, ...subject };
        const a = f.authority.service.requestVerification(proposal, { requestSource: 'agent', authorization: f.issue('requestVerification', proposal, 'agent') });
        const expected = { sessionIdentity: 's', compoundOperationId: 'op', validationInvocationId: 'v', executionIdentity: 'exec', scopeDigest: H };
        f.authority.host.bindExecution(a.attemptId, expected);
        const core = { coreId: 'core', coreFinalRevision: 1, exitCode: 0, quiescent: true, outputHashes: [H] };
        const checks = [{ id: 'content', passed: true }, { id: 'structure', passed: true }], verdict = { verifierHash: H, checks, validUntil: 1500 };
        expect(() => f.authority.host.recordControllerResult(a.attemptId, core, verdict, {} as never)).toThrow(/receipt/);
        expect(() => f.authority.host.recordControllerResult(a.attemptId, core, { ...verdict, checks: checks.slice(0, 1) }, f.receipt)).toThrow(/check_set/);
        f.authority.host.recordControllerResult(a.attemptId, core, verdict, f.receipt);
        expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('valid');
        expect(f.authority.service.getCurrentDependencies(owner)).toHaveLength(1);
        f.authority.service.close();
        const restarted = createVerificationAuthority({ ...f.options, serviceEpoch: 'boot2' });
        try {
            expect(restarted.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
        }
        finally {
            restarted.service.close();
        }
    }
    finally {
        f.close();
    }
});
it.each(['current-subject','cumulative'] as const)('unknown physical execution cannot be superseded and terminal reconciliation requires the same bound receipt (%s)', semantics => {
    const f = fixture();
    try {
        const registration = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics, definitionHash: H, requiredCheckIds: ['content'] }] };
        f.authority.service.registerObligations(registration, { requestSource: 'user', authorization: f.issue('registerObligations', registration) });
        const subject = f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 1, scopeExpiresAt:2000,manifest: [{ path: 'a', sha256: H, size: 1, role: 'source' }] });
        const proposal = { owner, obligationId: 'o1', expectedAttemptEpoch: 0, sourceRunId: 'r', runNonce: 'n', ...subject, requiredScopeId: 'scope', scopeRevision: 1 };
        const a = f.authority.service.requestVerification(proposal, { requestSource: 'agent', authorization: f.issue('requestVerification', proposal, 'agent') });
        const expected = { sessionIdentity: 's', compoundOperationId: 'op', validationInvocationId: 'v', executionIdentity: 'exec', scopeDigest: H };
        f.authority.host.bindExecution(a.attemptId, expected);
        const core = { coreId: 'c', coreFinalRevision: 1, exitCode: null, quiescent: false, outputHashes: [] }, verdict = { verifierHash: H, checks: [{ id: 'content', passed: false }], validUntil: 1500 };
        f.authority.host.recordControllerResult(a.attemptId, core, verdict);
        let retry = { ...proposal, expectedAttemptEpoch: 1 };
        if(semantics==='cumulative'){
            f.authority.host.refreshOriginalSubject({owner,subjectId:subject.subjectId,manifest:[{path:'a',sha256:H,size:1,role:'source'}],requiredScopeId:'scope',scopeRevision:2,scopeExpiresAt:2000});
            retry={...retry,scopeRevision:2};
        }
        expect(() => f.authority.service.requestVerification(retry, { requestSource: 'agent', authorization: f.issue('requestVerification', retry, 'agent') })).toThrow(/not_quiescent/);
        expect(() => f.authority.host.recordControllerResult(a.attemptId, { ...core, quiescent: true, coreFinalRevision: 2 }, verdict, {} as never)).toThrow(/receipt/);
        f.authority.host.recordControllerResult(a.attemptId, { ...core, quiescent: true, exitCode: 1, coreFinalRevision: 2 }, verdict, f.receipt);
        expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
        expect(f.authority.service.requestVerification(retry, { requestSource: 'agent', authorization: f.issue('requestVerification', retry, 'agent') })).toMatchObject({ attemptEpoch: 2 });
    }
    finally {
        f.close();
    }
});
it('subject replacement invalidates old proof, and settlement failure leaves neither decision nor outbox', async () => {
    const { openPrivateVerificationDatabase } = await import('../../../src/runtime/verification/private-database.js');
    const f = fixture();
    try {
        const registration = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content'] }] };
        f.authority.service.registerObligations(registration, { requestSource: 'user', authorization: f.issue('registerObligations', registration) });
        const subject = f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 1, scopeExpiresAt:2000,manifest: [{ path: 'a', sha256: H, size: 1, role: 'source' }] });
        const proposal = { owner, obligationId: 'o1', expectedAttemptEpoch: 0, sourceRunId: 'r', runNonce: 'n', ...subject, requiredScopeId: 'scope', scopeRevision: 1 };
        const a = f.authority.service.requestVerification(proposal, { requestSource: 'agent', authorization: f.issue('requestVerification', proposal, 'agent') });
        f.authority.host.bindExecution(a.attemptId, { sessionIdentity: 's', compoundOperationId: 'op', validationInvocationId: 'v', executionIdentity: 'exec', scopeDigest: H });
        f.authority.host.recordControllerResult(a.attemptId, { coreId: 'c', coreFinalRevision: 1, exitCode: 0, quiescent: true, outputHashes: [H] }, { verifierHash: H, checks: [{ id: 'content', passed: true }], validUntil: 1500 }, f.receipt);
        const state = f.authority.service.inspectOwner(owner)!;
        const tuple = { schemaVersion: 1 as const, ...owner, migrationEpoch: state.migrationEpoch, expectedBusinessRevision: state.businessRevision, obligationSetRevision: state.obligationSetRevision, obligationSetHash: state.obligationSetHash, obligations: f.authority.service.getCurrentDependencies(owner), operationId: 'settle', immutablePayloadHash: H, receiverId: 'receiver', receiverProtocolVersion: 1 as const, receiverInstanceEpoch: 1, reservationId: 'reservation', nonce: 'nonce', notBefore: 1000, validUntil: 1400, clockDomainId: 'clock', clockQualificationEpoch: 1 };
        const inspector = openPrivateVerificationDatabase(f.root);
        try {
            inspector.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON publication_journal BEGIN SELECT RAISE(ABORT,'injected_outbox_failure'); END");
            const auth = f.issue('prepareSettlement', { owner, tuple });
            expect(() => f.authority.service.prepareSettlement(tuple, { requestSource: 'agent', authorization: auth })).toThrow(/authorization/);
            const valid = f.issue('prepareSettlement', { owner, tuple }, 'agent');
            expect(() => f.authority.service.prepareSettlement(tuple, { requestSource: 'agent', authorization: valid })).toThrow('injected_outbox_failure');
            expect(inspector.prepare('SELECT COUNT(*) n FROM settlement_decisions').get()).toEqual({ n: 0 });
            expect(inspector.prepare('SELECT COUNT(*) n FROM publication_journal').get()).toEqual({ n: 0 });
            inspector.exec('DROP TRIGGER reject_outbox');
            expect(() => f.authority.service.prepareSettlement(tuple, { requestSource: 'agent', authorization: valid })).toThrow(/authorization/);
            f.authority.service.prepareSettlement(tuple, { requestSource: 'agent', authorization: f.issue('prepareSettlement', { owner, tuple }, 'agent') });
            expect(inspector.prepare('SELECT COUNT(*) n FROM settlement_decisions').get()).toEqual({ n: 1 });
            expect(() => f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 2, scopeExpiresAt:2000,manifest: [{ path: 'a', sha256: 'b'.repeat(64), size: 1, role: 'source' }] })).toThrow(/fenced/);
        }
        finally {
            inspector.close();
        }
    }
    finally {
        f.close();
    }
});
it('new immutable subject makes the previous proof non-current without replacing the original obligation', () => {
    const f = fixture();
    try {
        const registration = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'o1', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content'] }] };
        f.authority.service.registerObligations(registration, { requestSource: 'user', authorization: f.issue('registerObligations', registration) });
        const subject = f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 1, scopeExpiresAt:2000,manifest: [{ path: 'a', sha256: H, size: 1, role: 'source' }] });
        const proposal = { owner, obligationId: 'o1', expectedAttemptEpoch: 0, sourceRunId: 'r', runNonce: 'n', ...subject, requiredScopeId: 'scope', scopeRevision: 1 };
        const a = f.authority.service.requestVerification(proposal, { requestSource: 'agent', authorization: f.issue('requestVerification', proposal, 'agent') });
        f.authority.host.bindExecution(a.attemptId, { sessionIdentity: 's', compoundOperationId: 'op', validationInvocationId: 'v', executionIdentity: 'exec', scopeDigest: H });
        f.authority.host.recordControllerResult(a.attemptId, { coreId: 'c', coreFinalRevision: 1, exitCode: 0, quiescent: true, outputHashes: [] }, { verifierHash: H, checks: [{ id: 'content', passed: true }], validUntil: 1500 }, f.receipt);
        expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('valid');
        f.authority.host.registerSubject({ owner, requiredScopeId: 'scope', scopeRevision: 2, scopeExpiresAt:2000,manifest: [{ path: 'a', sha256: 'b'.repeat(64), size: 1, role: 'source' }] });
        expect(f.authority.service.inspectOwner(owner)).toMatchObject({ currentVerification: 'needs_revalidation', obligationCount: 1 });
        const old = { ...proposal, expectedAttemptEpoch: 1 };
        expect(() => f.authority.service.requestVerification(old, { requestSource: 'agent', authorization: f.issue('requestVerification', old, 'agent') })).toThrow(/subject/);
    }
    finally {
        f.close();
    }
});
function verified(f:ReturnType<typeof fixture>){
 const registration={owner,migrationEpoch:1,obligations:[{obligationId:'o1',predicateId:'original',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['content']}]};
 f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});
 const subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});
 const proposal={owner,obligationId:'o1',expectedAttemptEpoch:0,sourceRunId:'r',runNonce:'n',...subject,requiredScopeId:'scope',scopeRevision:1};const a=f.authority.service.requestVerification(proposal,{requestSource:'agent',authorization:f.issue('requestVerification',proposal,'agent')});
 f.authority.host.bindExecution(a.attemptId,{sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H});
 f.authority.host.recordControllerResult(a.attemptId,{coreId:'c',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt);
 const state=f.authority.service.inspectOwner(owner)!;
 return {schemaVersion:1 as const,...owner,migrationEpoch:state.migrationEpoch,expectedBusinessRevision:state.businessRevision,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:f.authority.service.getCurrentDependencies(owner),operationId:'settle',immutablePayloadHash:H,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'reservation',nonce:'nonce',notBefore:1000,validUntil:1400,clockDomainId:'clock',clockQualificationEpoch:1};
}
it('consumes exactly one business revision, then fences invalidation until authenticated receiver cancellation',async()=>{
 const {createReceiverReplySigner,createReceiverReplyVerifier}=await import('../../../src/runtime/verification/receiver-authentication.js');
 const f=fixture();try{
 const tuple=verified(f),payload={owner,tuple};
 f.authority.service.prepareSettlement(tuple,{requestSource:'agent',authorization:f.issue('prepareSettlement',payload,'agent')});
 f.authority.service.prepareSettlement(tuple,{requestSource:'agent',authorization:f.issue('prepareSettlement',payload,'agent')});
 expect(f.authority.service.inspectOwner(owner)?.businessRevision).toBe(1);
 expect(()=>f.authority.host.refreshOriginalSubject({owner,subjectId:tuple.obligations[0].subjectId,manifest:[{path:'a',sha256:H,size:1,role:'source'}],requiredScopeId:'scope',scopeRevision:2,scopeExpiresAt:2000})).toThrow(/fenced/);
 f.authority.service.authorizePublication(tuple,{requestSource:'agent',authorization:f.issue('authorizePublication',payload,'agent')});
 const invalidation={owner,reason:'user_revoked_scope'};
 expect(f.authority.service.invalidate(invalidation,{requestSource:'user',authorization:f.issue('invalidate',invalidation)})).toBe('pending');
 expect(()=>f.authority.host.refreshOriginalSubject({owner,subjectId:tuple.obligations[0].subjectId,manifest:[{path:'a',sha256:H,size:1,role:'source'}],requiredScopeId:'scope',scopeRevision:2,scopeExpiresAt:2000})).toThrow(/pending/);
 expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
 expect(()=>f.authority.host.acceptReceiverReply(tuple,{} as never)).toThrow();
 const challenge=f.authority.host.issueReceiverChallenge(tuple);
 const envelope=createReceiverReplySigner({keyId:'receiver-key',receiverId:'receiver',receiverInstanceEpoch:1,privateKey:f.options.privateKey}).sign(challenge,{status:'cancelled',fullTupleHash:challenge.fullTupleHash,objectRevision:1,reason:'user_cancelled',terminalRecordHash:H});
 const authenticated=f.options.receiverVerifier.verify(envelope,challenge);
 f.authority.host.acceptReceiverReply(tuple,authenticated);
 expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
 const subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:2,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});expect(subject.subjectId).toBeTruthy();
 expect(()=>f.authority.service.authorizePublication(tuple,{requestSource:'agent',authorization:f.issue('authorizePublication',payload,'agent')})).toThrow();
 }finally{f.close();}
});
it('core correction appends immutable facts and proof revisions instead of overwriting audit history',async()=>{
 const {openPrivateVerificationDatabase}=await import('../../../src/runtime/verification/private-database.js');
 const f=fixture();try{
 const tuple=verified(f),before=tuple.obligations[0];
 f.authority.host.recordControllerResult(before.activeAttemptId,{coreId:'c',coreFinalRevision:2,exitCode:1,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:false}],validUntil:1500},f.receipt);
 expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
 const db=openPrivateVerificationDatabase(f.root);try{
 expect(db.prepare('SELECT COUNT(*) n FROM execution_facts_revisions').get()).toEqual({n:2});expect(db.prepare('SELECT COUNT(*) n FROM verifier_proofs').get()).toEqual({n:2});
 }finally{db.close();}
 }finally{f.close();}
});
it('does not allow successor proof fields to be smuggled back into an execution core',()=>{
 const f=fixture();try{
 const tuple=verified(f);
 expect(()=>f.authority.host.recordControllerResult(tuple.obligations[0].activeAttemptId,{coreId:'c',coreFinalRevision:2,exitCode:0,quiescent:true,outputHashes:[],proofHash:H} as never,{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt)).toThrow(/fields/);
 }finally{f.close();}
});
it('keeps a specific failed-run obligation bound to its old subject when a new current subject is registered',()=>{
 const f=fixture();try{
 const registration={owner,migrationEpoch:1,obligations:[{obligationId:'o1',predicateId:'diagnostic',predicateVersion:'1',semantics:'specific-run' as const,definitionHash:H,requiredCheckIds:['coverage']}]};
 f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});
 const subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'failed.ndjson',sha256:H,size:1,role:'source'}]});
 const proposal={owner,obligationId:'o1',expectedAttemptEpoch:0,sourceRunId:'failure-A',runNonce:'A',...subject,requiredScopeId:'scope',scopeRevision:1};
 const a=f.authority.service.requestVerification(proposal,{requestSource:'agent',authorization:f.issue('requestVerification',proposal,'agent')});
 f.authority.host.bindExecution(a.attemptId,{sessionIdentity:'s',compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H});
 f.authority.host.recordControllerResult(a.attemptId,{coreId:'c',coreFinalRevision:1,exitCode:1,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'coverage',passed:true}],validUntil:1500},f.receipt);
 f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'fixed.txt',sha256:'b'.repeat(64),size:1,role:'source'}]});
 expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('valid');
 const wash={...proposal,expectedAttemptEpoch:1,sourceRunId:'success-B'};
 expect(()=>f.authority.service.requestVerification(wash,{requestSource:'agent',authorization:f.issue('requestVerification',wash,'agent')})).toThrow(/original_run/);
 const same={...proposal,expectedAttemptEpoch:1};expect(f.authority.service.requestVerification(same,{requestSource:'agent',authorization:f.issue('requestVerification',same,'agent')})).toMatchObject({attemptEpoch:2});
 }finally{f.close();}
});

it('requires the current installed verifier version, even when the old proof signature is valid',()=>{
 const f=fixture();try{
 verified(f);f.authority.service.close();const restarted=createVerificationAuthority({...f.options,verifierHash:'b'.repeat(64)});
 try{expect(restarted.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');}finally{restarted.service.close();}
 }finally{f.close();}
});
it('borrows the actual shared connection without closing it and respects the outer rollback', async () => {
    const { openPrivateVerificationDatabase } = await import('../../../src/runtime/verification/private-database.js');
    const f = fixture();
    f.authority.service.close();
    const db = openPrivateVerificationDatabase(f.root);
    const authority = createVerificationAuthority({ ...f.options, database: db });
    try {
        const payload = { owner, migrationEpoch: 1, obligations: [{ obligationId: 'shared', predicateId: 'original', predicateVersion: '1', semantics: 'current-subject' as const, definitionHash: H, requiredCheckIds: ['content'] }] };
        const authorization = authority.host.issueAuthorization({ owner, method: 'registerObligations', payload, requestSource: 'user', principalId: 'user', expiresAt: 2000 });
        expect(() => db.transaction(() => {
            authority.service.registerObligations(payload, { requestSource: 'user', authorization });
            throw Error('outer_rollback');
        })()).toThrow('outer_rollback');
        expect(authority.service.inspectOwner(owner)).toBeUndefined();
        expect(() => authority.service.registerObligations(payload, { requestSource: 'user', authorization })).toThrow(/authorization/);
        authority.service.close();
        expect(db.prepare('SELECT COUNT(*) n FROM verification_owners').get()).toEqual({ n: 0 });
    } finally { authority.service.close(); db.close(); f.close(); }
});
it.each(['specific-run','cumulative'] as const)('refreshes only the exact original subject for a new service without reviving old proof (%s)',semantics=>{
 const f=fixture();let restarted:ReturnType<typeof createVerificationAuthority>|undefined;
 try{
  const registration={owner,migrationEpoch:1,obligations:[{obligationId:'o1',predicateId:'original',predicateVersion:'1',semantics,definitionHash:H,requiredCheckIds:['content']}]};f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});
  const manifest=[{path:'a',sha256:H,size:1,role:'source'},{path:'b',sha256:H,size:1,role:'source'}],subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest});
  const proposal={owner,obligationId:'o1',expectedAttemptEpoch:0,sourceRunId:'original-runs',runNonce:'original-nonce',...subject,requiredScopeId:'scope',scopeRevision:1},first=f.authority.service.requestVerification(proposal,{requestSource:'user',authorization:f.issue('requestVerification',proposal)});
  const expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H};f.authority.host.bindExecution(first.attemptId,expected);f.authority.host.recordControllerResult(first.attemptId,{coreId:'old',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt);expect(f.authority.service.inspectOwner(owner)?.currentVerification).toBe('valid');
  f.authority.service.close();restarted=createVerificationAuthority({...f.options,serviceEpoch:'boot2'});const live=restarted;
  const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:live.host.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
  const retry={...proposal,expectedAttemptEpoch:1};expect(()=>live.service.requestVerification(retry,issue('requestVerification',retry))).toThrow(/subject/);
  const refreshed={owner,subjectId:subject.subjectId,manifest,requiredScopeId:'scope',scopeRevision:2,scopeExpiresAt:2000};
  expect(()=>live.host.refreshOriginalSubject({...refreshed,manifest:manifest.slice(1)})).toThrow();
  expect(()=>live.host.refreshOriginalSubject({...refreshed,manifest:manifest.map(m=>({...m,role:'weaker'}))})).toThrow();
  expect(()=>live.host.refreshOriginalSubject({...refreshed,owner:{...owner,ownerId:'other'}})).toThrow();
  const currentRegistration={owner,migrationEpoch:1,obligations:[{obligationId:'current',predicateId:'current',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['content']}]};
  live.service.registerObligations(currentRegistration,issue('registerObligations',currentRegistration));
  const newerSubject=live.host.registerSubject({owner,requiredScopeId:'new-scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'new',sha256:H,size:1,role:'source'}]});
  expect(live.host.refreshOriginalSubject(refreshed)).toEqual(subject);
  const currentProposal={owner,obligationId:'current',expectedAttemptEpoch:0,sourceRunId:'new',runNonce:'new',...newerSubject,requiredScopeId:'new-scope',scopeRevision:1};
  expect(live.service.requestVerification(currentProposal,issue('requestVerification',currentProposal))).toMatchObject({attemptEpoch:1});

  expect(live.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');
  expect(()=>live.host.readAdmittedAttempt({attemptId:first.attemptId,subjectId:subject.subjectId,runNonce:proposal.runNonce,expected})).toThrow(/admission/);
  expect(()=>live.host.refreshOriginalSubject({...refreshed,scopeRevision:1})).toThrow(/revision/);
  expect(()=>live.host.refreshOriginalSubject({...refreshed,scopeRevision:3,scopeExpiresAt:1000})).toThrow(/expired/);
  const next={...retry,scopeRevision:2};expect(live.service.requestVerification(next,issue('requestVerification',next))).toMatchObject({attemptEpoch:2});expect(live.service.inspectOwner(owner)?.currentVerification).toBe('needs_revalidation');

 }finally{restarted?.service.close();f.close();}
});

it.each(['revoked','rebind','restart','async','reentrant'] as const)('keeps the actual operation material guard mandatory: %s',async mode=>{
 const {verifiedOperationFixture}=await import('../../support/verified-operation-fixture.js'),{reopenedVerificationFixture}=await import('../../support/reopened-verification-fixture.js'),f=await verifiedOperationFixture();let reopened:Awaited<ReturnType<typeof reopenedVerificationFixture>>|undefined,closed=false;
 try{const host=f.composition.privateHost,owner=f.owner,raw=f.database.prepare('SELECT facts_json FROM obligation_attempts WHERE owner_key=?').get(canonical(owner)) as {facts_json:string};const facts=JSON.parse(raw.facts_json),scope={owner,scopeId:facts.requiredScopeId,revision:facts.scopeRevision};expect(host.authorityService.inspectOwner(owner)?.currentVerification).toBe('valid');
  if(mode==='revoked'){f.material.revoke((f.database.prepare('SELECT id FROM material_authority_challenges').get() as {id:string}).id,f.peer);expect(host.authorityService.inspectOwner(owner)?.currentVerification).not.toBe('valid');expect(()=>host.authorityService.getCurrentDependencies(owner)).toThrow();}
  else if(mode==='restart'){await f.close(true);closed=true;reopened=await reopenedVerificationFixture(f.root,f.keys);expect(reopened.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).not.toBe('valid');expect(()=>reopened!.composition.privateHost.authorityHost.registerScopeGuard(scope,()=>{})).toThrow('scope_guard_brand');}
  else{let called=0;const before=f.database.prepare('SELECT * FROM verification_scope_guards').all(),bad=()=>{called++;if(mode==='async')return Promise.resolve();if(mode==='reentrant')host.authorityHost.registerScopeGuard(scope,{});};expect(()=>host.authorityHost.registerScopeGuard(scope,bad)).toThrow('scope_guard_brand');expect(called).toBe(0);expect(f.database.prepare('SELECT * FROM verification_scope_guards').all()).toEqual(before);expect(host.authorityService.inspectOwner(owner)?.currentVerification).toBe('valid');}
 }finally{if(reopened)await reopened.close();if(!closed)await f.close();}
});
it('permits only superseded terminal attempt evidence deletion, never active, expired-active or unknown history',()=>{const f=fixture();try{const registration={owner,migrationEpoch:1,obligations:[{obligationId:'delete-history',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['content']}]};f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});const subject=f.authority.host.registerSubject({owner,requiredScopeId:'scope-a',scopeRevision:1,scopeExpiresAt:3000,manifest:[{path:'a',sha256:H,size:1,role:'input'}]}),proposal={owner,obligationId:'delete-history',expectedAttemptEpoch:0,sourceRunId:'run-a',runNonce:'nonce-a',...subject,requiredScopeId:'scope-a',scopeRevision:1},first=f.authority.service.requestVerification(proposal,{requestSource:'user',authorization:f.issue('requestVerification',proposal)});expect(()=>f.authority.host.assertAttemptsUnreferenced([first.attemptId])).toThrow();const expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H};f.authority.host.bindExecution(first.attemptId,expected);expect(()=>f.authority.host.assertAttemptsUnreferenced([first.attemptId])).toThrow();f.authority.host.recordControllerResult(first.attemptId,{coreId:'first-core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt);expect(()=>f.authority.host.assertAttemptsUnreferenced([first.attemptId])).toThrow();f.advance(1501);expect(()=>f.authority.host.assertAttemptsUnreferenced([first.attemptId])).toThrow();const nextSubject=f.authority.host.registerSubject({owner,requiredScopeId:'scope-b',scopeRevision:1,scopeExpiresAt:3000,manifest:[{path:'b',sha256:H,size:1,role:'input'}]}),nextProposal={...proposal,...nextSubject,requiredScopeId:'scope-b',expectedAttemptEpoch:1,sourceRunId:'run-b',runNonce:'nonce-b'},next=f.authority.service.requestVerification(nextProposal,{requestSource:'user',authorization:f.issue('requestVerification',nextProposal)});expect(()=>f.authority.host.assertAttemptsUnreferenced([first.attemptId])).not.toThrow();f.authority.host.bindExecution(next.attemptId,{...expected,executionIdentity:'exec-2'});f.authority.host.recordControllerResult(next.attemptId,{coreId:'unknown-core',coreFinalRevision:1,exitCode:null,quiescent:false,outputHashes:[]},{verifierHash:H,checks:[{id:'content',passed:false}],validUntil:1800});expect(()=>f.authority.host.assertAttemptsUnreferenced([next.attemptId])).toThrow();expect(()=>f.authority.host.assertAttemptsUnreferenced(['missing'])).toThrow();}finally{f.close();}});
it('keeps application replacement fenced until exact pointer commit and never relabels old attempts',()=>{
 const f=fixture(),goal={profileId:'p',ownerKind:'goal' as const,ownerId:'g'},issue=(method:string,payload:unknown)=>f.authority.host.issueAuthorization({owner:goal,method,payload,requestSource:'user',principalId:'user',expiresAt:2000});
 try{const registration={owner:goal,migrationEpoch:1,obligations:[{obligationId:'o',predicateId:'original',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['content']}]};f.authority.service.registerObligations(registration,{requestSource:'user',authorization:issue('registerObligations',registration)});
 const binding={version:1 as const,kind:'goal' as const,sessionId:'s',goalId:'g',epoch:1,objective:'原目标',completionCriterion:null,expectedEvidenceKinds:['answer' as const]};
 f.authority.host.beginApplicationTransition({owner:goal,transitionId:'t',previousBindingHash:null,binding,registrationHash:H});
 expect(f.authority.host.inspectApplication(goal).state).toBe('pending');
 expect(()=>f.authority.host.registerSubject({owner:goal,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]})).toThrow();
 f.authority.host.finishApplicationTransition(goal,'t',()=>{});const original=f.authority.host.inspectApplication(goal);expect(original.state).toBe('active');
 const subject=f.authority.host.registerSubject({owner:goal,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});const proposal={owner:goal,obligationId:'o',expectedAttemptEpoch:0,sourceRunId:'r',runNonce:'n',...subject,requiredScopeId:'scope',scopeRevision:1};const attempt=f.authority.service.requestVerification(proposal,{requestSource:'user',authorization:issue('requestVerification',proposal)});
 f.authority.host.beginApplicationTransition({owner:goal,transitionId:'t2',previousBindingHash:original.current!.bindingHash,binding:{...binding,epoch:2,objective:'新目标'},registrationHash:H});f.authority.host.finishApplicationTransition(goal,'t2',()=>{});
 expect(()=>f.authority.host.bindExecution(attempt.attemptId,{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H})).toThrow(/admission/);
 expect(f.authority.host.inspectApplication(goal).current!.binding).toMatchObject({kind:'goal',epoch:2});
 }finally{f.close();}
});
it('refuses a caller scope-guard function before invoking it inside the authority transaction',()=>{
 const f=fixture();let called=0;try{const registration={owner,migrationEpoch:1,obligations:[{obligationId:'guard-deny',predicateId:'p',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:H,requiredCheckIds:['c']}]};f.authority.service.registerObligations(registration,{requestSource:'user',authorization:f.issue('registerObligations',registration)});f.authority.host.registerSubject({owner,requiredScopeId:'guard-deny',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'input'}]});expect(()=>f.authority.host.registerScopeGuard({owner,scopeId:'guard-deny',revision:1},()=>{called++;})).toThrow('scope_guard_brand');expect(called).toBe(0);}finally{f.close();}
});
