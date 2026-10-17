import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {createVerificationAuthority,type VerificationOwner} from '../../../src/runtime/verification/proof-authority.js';
import {createReceiverReplySigner,createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {parseVerificationTuple,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64);
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'inherited-obligations-')),keys=generateKeyPairSync('ed25519'),receipt=Object.freeze({});
 const receiverVerifier=createReceiverReplyVerifier({keyId:'rk',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey});
 const authority=createVerificationAuthority({root,receiverVerifier,issuerId:'controller',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),assertQualified(){},assertVerifiedPayload(){},quiescence:{assertQuiescent(r){if(r!==receipt)throw Error('receipt');}}});
 const owner=(id:string):VerificationOwner=>({profileId:'profile',ownerKind:'task',ownerId:id});
 const context=<T extends {owner:VerificationOwner}>(method:string,payload:T,requestSource:'user'|'agent'='user')=>({requestSource,authorization:authority.host.issueAuthorization({owner:payload.owner,method,payload,requestSource,principalId:'user',expiresAt:2000})});
 function register(o:VerificationOwner,id='same'){const p={owner:o,migrationEpoch:1,obligations:[{obligationId:id,predicateId:'original',predicateVersion:'1',semantics:'specific-run' as const,definitionHash:H,requiredCheckIds:['content']}]};authority.service.registerObligations(p,context('registerObligations',p));}
 function link(parent:VerificationOwner,child:VerificationOwner){const p={owner:parent,child};authority.service.registerOwnerDependency(p,context('registerOwnerDependency',p));}
 function pass(o:VerificationOwner,id='same',passed=true){const subject=authority.host.registerSubject({owner:o,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'source.txt',sha256:H,size:1,role:'source'}]});const p={owner:o,obligationId:id,expectedAttemptEpoch:0,sourceRunId:o.ownerId,runNonce:o.ownerId,...subject,requiredScopeId:'scope',scopeRevision:1};const a=authority.service.requestVerification(p,context('requestVerification',p,'agent'));authority.host.bindExecution(a.attemptId,{sessionIdentity:o.ownerId,compoundOperationId:'op',validationInvocationId:'v',executionIdentity:'exec',scopeDigest:H});authority.host.recordControllerResult(a.attemptId,{coreId:o.ownerId,coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed}],validUntil:1500},receipt as never);}
 function tuple(o:VerificationOwner){const state=authority.service.inspectOwner(o)!;return parseVerificationTuple({schemaVersion:1,...o,migrationEpoch:1,expectedBusinessRevision:state.businessRevision,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:authority.service.getCurrentDependencies(o),operationId:o.ownerId,immutablePayloadHash:H,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1,reservationId:o.ownerId,nonce:o.ownerId,notBefore:1000,validUntil:1400,clockDomainId:'clock',clockQualificationEpoch:1});}
 function cancel(t:ReturnType<typeof tuple>){const receiver=new VerificationReceiverStore({root:join(root,'receiver'),receiverId:'receiver',receiverInstanceEpoch:1,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H})});try{const request=authority.host.issueReceiverChallenge(t),result=receiver.cancel(t,hashVerificationTuple(t)),signer=createReceiverReplySigner({keyId:'rk',receiverId:'receiver',receiverInstanceEpoch:1,privateKey:keys.privateKey});authority.host.acceptReceiverReply(t,receiverVerifier.verify(signer.sign(request,result),request));}finally{receiver.close();}}
 return{authority,owner,context,register,link,pass,tuple,cancel,receipt,close(){authority.service.close();rmSync(root,{recursive:true,force:true});}};
}
it('inherits original obligations, preserves same direct/child ID, deduplicates diamonds and refuses cycles or cross profile',()=>{
 const f=fixture();try{const [p,a,b,c]=['p','a','b','c'].map(f.owner);for(const o of[p,a,b,c]){f.register(o);f.pass(o);}f.link(p,a);f.link(p,b);f.link(a,c);f.link(b,c);
 const deps=f.authority.service.getCurrentDependencies(p);expect(deps).toHaveLength(4);expect(f.tuple(p).obligations).toHaveLength(4);expect(deps.filter(d=>d.kind==='inherited')).toHaveLength(3);
 expect(()=>f.link(c,p)).toThrow(/cycle/);expect(()=>f.link(p,{...a,profileId:'other'})).toThrow(/profile/);
 const mutation={owner:p,child:c};expect(()=>f.authority.service.registerOwnerDependency(mutation,f.context('registerOwnerDependency',mutation,'agent'))).toThrow(/source/);
 }finally{f.close();}
});
it('a successful sibling cannot wash a failed child and new child obligations change parent CAS',()=>{
 const f=fixture();try{const p=f.owner('p'),a=f.owner('a'),b=f.owner('b');for(const o of[p,a,b])f.register(o);f.pass(p);f.pass(a,'same',false);f.pass(b);f.link(p,a);f.link(p,b);
 expect(f.authority.service.inspectOwner(p)).toMatchObject({obligationCount:3,currentVerification:'needs_revalidation'});expect(()=>f.authority.service.getCurrentDependencies(p)).toThrow();const before=f.authority.service.inspectOwner(p)!;f.register(b,'new');expect(f.authority.service.inspectOwner(p)!.obligationSetHash).not.toBe(before.obligationSetHash);
 }finally{f.close();}
});
it('child invalidation fences all ancestor reservations and refuses sibling mutations while receiver outcome is unknown',()=>{
 const f=fixture();try{const p=f.owner('p'),q=f.owner('q'),c=f.owner('c');for(const o of[p,q,c]){f.register(o);f.pass(o);}f.link(p,c);f.link(q,c);for(const o of[p,q]){const tuple=f.tuple(o),payload={owner:o,tuple};f.authority.service.prepareSettlement(tuple,f.context('prepareSettlement',payload));f.authority.service.authorizePublication(tuple,f.context('authorizePublication',payload));}
 const payload={owner:c,reason:'revoked'};expect(f.authority.service.invalidate(payload,f.context('invalidate',payload))).toBe('pending');expect(f.authority.service.inspectOwner(p)?.currentVerification).toBe('needs_revalidation');expect(f.authority.service.inspectOwner(q)?.currentVerification).toBe('needs_revalidation');expect(()=>f.register(c,'another')).toThrow(/pending|fenced/);
 }finally{f.close();}
});

it('keeps the child pending until every actual receiver cancellation is durably authenticated',()=>{
 const f=fixture();try{const p=f.owner('p'),q=f.owner('q'),c=f.owner('c');for(const o of[p,q,c]){f.register(o);f.pass(o);}f.link(p,c);f.link(q,c);const tuples=[f.tuple(p),f.tuple(q)];for(const t of tuples){const o=t.ownerId==='p'?p:q,payload={owner:o,tuple:t};f.authority.service.prepareSettlement(t,f.context('prepareSettlement',payload));f.authority.service.authorizePublication(t,f.context('authorizePublication',payload));}
 const payload={owner:c,reason:'revoked'};expect(f.authority.service.invalidate(payload,f.context('invalidate',payload))).toBe('pending');expect(f.authority.host.getPendingInvalidationPublications(c)).toHaveLength(2);
 f.cancel(tuples[0]);expect(f.authority.host.getPendingInvalidationPublications(c)).toHaveLength(1);expect(()=>f.authority.service.getCurrentDependencies(c)).toThrow(/pending/);
 f.cancel(tuples[1]);expect(f.authority.host.getPendingInvalidationPublications(c)).toHaveLength(0);expect(()=>f.authority.service.getCurrentDependencies(c)).toThrow(/not_current/);expect(f.authority.service.inspectOwner(p)?.currentVerification).toBe('needs_revalidation');
 }finally{f.close();}
});
it('rejects tuple origin forgery and duplicate typed identities without merging same textual IDs',()=>{
 const f=fixture();try{const p=f.owner('p'),c=f.owner('c');for(const o of[p,c]){f.register(o);f.pass(o);}f.link(p,c);const t=f.tuple(p),inherited=t.obligations.find(d=>d.kind==='inherited')!;
 expect(()=>parseVerificationTuple({...t,obligations:[...t.obligations,inherited]})).toThrow(/duplicate/);
 expect(()=>parseVerificationTuple({...t,obligations:[{...inherited,originOwner:p}]})).toThrow(/origin/);
 expect(()=>parseVerificationTuple({...t,obligations:[{...inherited,originalObligationId:'changed'}]})).toThrow(/origin/);
 const forged=parseVerificationTuple({...t,obligations:t.obligations.map(d=>d.kind==='inherited'?{...d,originOwner:{...c,ownerId:'foreign'}}:d)});
 expect(()=>f.authority.service.prepareSettlement(forged,f.context('prepareSettlement',{owner:p,tuple:forged}))).toThrow(/conflict/);
 }finally{f.close();}
});

it('independent: a pre-invalidation running child cannot renew its proof under the new invalidation epoch',()=>{
 const f=fixture();try{const p=f.owner('parent'),c=f.owner('child');f.register(p);f.pass(p);f.register(c);f.link(p,c);
 const subject=f.authority.host.registerSubject({owner:c,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'a',sha256:H,size:1,role:'source'}]});
 const proposal={owner:c,obligationId:'same',expectedAttemptEpoch:0,sourceRunId:'old-run',runNonce:'old-nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
 const attempt=f.authority.service.requestVerification(proposal,f.context('requestVerification',proposal,'agent'));
 f.authority.host.bindExecution(attempt.attemptId,{sessionIdentity:'child',compoundOperationId:'old-op',validationInvocationId:'old-v',executionIdentity:'old-exec',scopeDigest:H});
 const revocation={owner:c,reason:'revoke-old-context'};expect(f.authority.service.invalidate(revocation,f.context('invalidate',revocation))).toBe('invalidated');
 f.authority.host.recordControllerResult(attempt.attemptId,{coreId:'old-core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt as never);
 expect(f.authority.service.inspectOwner(p)?.currentVerification).not.toBe('valid');
 }finally{f.close();}
});
it('keeps obsolete source attempts pinned by an ancestor publication until the actual signed receiver cancellation',()=>{const f=fixture();try{const parent=f.owner('parent-delete'),child=f.owner('child-delete');for(const owner of [parent,child]){f.register(owner);f.pass(owner);}f.link(parent,child);const old=f.authority.service.getCurrentDependencies(child)[0],proposal={owner:child,obligationId:old.obligationId,expectedAttemptEpoch:old.attemptEpoch,sourceRunId:old.sourceRunId,runNonce:old.runNonce,subjectId:old.subjectId,contentRoot:old.contentRoot,requiredScopeId:old.requiredScopeId,scopeRevision:old.scopeRevision},next=f.authority.service.requestVerification(proposal,f.context('requestVerification',proposal));f.authority.host.bindExecution(next.attemptId,{sessionIdentity:child.ownerId,compoundOperationId:'op',validationInvocationId:'v2',executionIdentity:'next',scopeDigest:H});f.authority.host.recordControllerResult(next.attemptId,{coreId:'new-child-core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[H]},{verifierHash:H,checks:[{id:'content',passed:true}],validUntil:1500},f.receipt as never);expect(()=>f.authority.host.assertAttemptsUnreferenced([old.activeAttemptId])).not.toThrow();const tuple=f.tuple(parent),payload={owner:parent,tuple};f.authority.service.prepareSettlement(tuple,f.context('prepareSettlement',payload));f.authority.service.authorizePublication(tuple,f.context('authorizePublication',payload));expect(()=>f.authority.host.assertAttemptsUnreferenced([old.activeAttemptId])).toThrow('publication_pending');f.cancel(tuple);expect(()=>f.authority.host.assertAttemptsUnreferenced([old.activeAttemptId])).not.toThrow();expect(()=>f.authority.host.assertAttemptsUnreferenced([next.attemptId])).toThrow('attempt_active');}finally{f.close();}});
