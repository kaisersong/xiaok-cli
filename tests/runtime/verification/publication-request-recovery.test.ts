import '../../support/installed-controller-fixture.js';
import {join} from 'node:path';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
import {publicationReviewBytes} from '../../../src/runtime/verification/publication-operation-review.js';

async function fixture(){
 const f=await verifiedOperationFixture('dispatch');let approvals=0,receiverCalls=0;
 let hook:((review:any)=>Promise<void>)|undefined;
 const options={database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,
  receiverIdentity:f.receiverIdentity,
  receiver:{async stagePayload(){receiverCalls++;throw Error('receiver offline');},async call(){receiverCalls++;throw Error('receiver offline');}},
  clock:f.clock,assertCurrent(){},resolvePrincipal:(p:typeof f.peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),
  async approve(review:any){approvals++;await hook?.(review);return{version:1 as const,purpose:'completion-publication' as const,authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:createHash('sha256').update(publicationReviewBytes(review)).digest('hex')};}};
 let operations=createApprovedPublicationOperations(options);
 return{...f,get operations(){return operations;},setHook(h:typeof hook){hook=h;},counts:()=>({approvals,receiverCalls}),async reopen(){await operations.close();operations=createApprovedPublicationOperations(options);},async cleanup(){await operations.close();await f.close();}};
}
const request={ownerKind:'task',ownerId:'task',requestSource:'user',requestId:'durable-request-1'};
it('durable request retries and restart lookup return exactly one original challenge without native work',async()=>{
 const f=await fixture();try{
  const first=f.operations.prepareRequest(request,f.peer);
  expect(f.operations.prepareRequest(request,f.peer)).toEqual(first);
  expect(()=>f.operations.prepareRequest({...request,requestSource:'agent'},f.peer)).toThrow();
  await f.reopen();expect(f.operations.lookupRequest({requestId:request.requestId},f.peer)).toEqual({state:'prepared',challenge:first});
  expect(f.operations.lookupRequest({requestId:'missing'},f.peer)).toEqual({state:'absent'});
  expect(f.database.prepare('SELECT count(*) n FROM publication_operations').get()).toEqual({n:1});expect(f.counts()).toEqual({approvals:0,receiverCalls:0});
 }finally{await f.cleanup();}
});
it('mapping write failure rolls back both prepare rows and payload',async()=>{
 const f=await fixture();try{
  f.database.exec("CREATE TRIGGER fail_request BEFORE INSERT ON publication_prepare_requests BEGIN SELECT RAISE(ABORT,'request disk failure'); END");
  await expect(Promise.resolve().then(()=>f.operations.prepareRequest(request,f.peer))).rejects.toThrow('request disk failure');
  expect(f.database.prepare('SELECT count(*) n FROM publication_operations').get()).toEqual({n:0});
  expect(f.operations.lookupRequest({requestId:request.requestId},f.peer)).toEqual({state:'absent'});
 }finally{await f.cleanup();}
});
it('prepared restart can close only its unapproved controller operation, without receiver cancellation',async()=>{
 const f=await fixture();try{
  const first=f.operations.prepareRequest(request,f.peer);await f.reopen();
  const result=f.operations.recoverUnapproved({challengeId:first.challengeId},f.peer);
  expect(result).toMatchObject({status:'not_approved',challengeId:first.challengeId,fullTupleHash:first.fullTupleHash});
  expect(f.operations.recoverUnapproved({challengeId:first.challengeId},f.peer)).toEqual(result);
  await expect(f.operations.approve({challengeId:first.challengeId},f.peer,new AbortController().signal)).rejects.toThrow();
  expect(f.operations.prepareRequest(request,f.peer)).toEqual(first);expect(f.counts()).toEqual({approvals:0,receiverCalls:0});
 }finally{await f.cleanup();}
});
it('native decline without settlement can close and explicitly prepare a different request',async()=>{
 const f=await fixture();try{
  f.setHook(async()=>{throw Error('native declined');});const first=f.operations.prepareRequest(request,f.peer);
  await expect(f.operations.approve({challengeId:first.challengeId},f.peer,new AbortController().signal)).rejects.toThrow('native declined');
  expect(f.operations.recoverUnapproved({challengeId:first.challengeId},f.peer)).toMatchObject({status:'not_approved'});
  const next=f.operations.prepareRequest({...request,requestId:'explicit-retry'},f.peer);expect(next.challengeId).not.toBe(first.challengeId);
  expect(f.counts()).toEqual({approvals:1,receiverCalls:0});f.setHook(undefined);await expect(f.operations.approve({challengeId:next.challengeId},f.peer,new AbortController().signal)).rejects.toThrow('receiver offline');expect(f.operations.recoverUnapproved({challengeId:next.challengeId},f.peer)).toMatchObject({status:'settlement_exists'});expect(f.counts().approvals).toBe(2);
 }finally{await f.cleanup();}
});
it('recovery wins against a hanging native approval and its late success cannot settle',async()=>{
 const f=await fixture();let release!:()=>void;try{
  f.setHook(()=>new Promise<void>(resolve=>{release=resolve;}));const first=f.operations.prepareRequest(request,f.peer);
  const running=f.operations.approve({challengeId:first.challengeId},f.peer,new AbortController().signal);const rejected=expect(running).rejects.toThrow();
  expect(f.operations.recoverUnapproved({challengeId:first.challengeId},f.peer)).toMatchObject({status:'not_approved'});release();await rejected;
  expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:0});
  expect(f.database.prepare('SELECT state FROM publication_operations WHERE id=?').get(first.challengeId)).toEqual({state:'not_approved'});expect(f.counts().receiverCalls).toBe(0);
 }finally{release?.();await f.cleanup();}
});
it('once settlement exists recovery preserves it and only original receiver convergence remains',async()=>{
 const f=await fixture();try{
  const first=f.operations.prepareRequest(request,f.peer);
  await expect(f.operations.approve({challengeId:first.challengeId},f.peer,new AbortController().signal)).rejects.toThrow('receiver offline');
  expect(f.operations.recoverUnapproved({challengeId:first.challengeId},f.peer)).toMatchObject({status:'settlement_exists'});
  expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:1});
 }finally{await f.cleanup();}
});
it('the original completion.settle sibling cannot bypass the durable unapproved fence',async()=>{
 const f=await fixture();try{
  const prepared=f.operations.prepareRequest(request,f.peer);
  const row=f.database.prepare('SELECT review_json FROM publication_operations WHERE id=?').get(prepared.challengeId) as {review_json:string};
  const review=JSON.parse(row.review_json),tuple=review.tuple;
  const authorization=f.composition.privateHost.completionScopes.issueMutation({owner:f.owner,peer:f.peer,expiresAt:tuple.validUntil,method:'completion.settle',tuple,requestSource:'user'});
  f.operations.recoverUnapproved({challengeId:prepared.challengeId},f.peer);
  expect(()=>f.composition.public.invoke('completion.settle',{owner:f.owner,tuple,authorization,requestSource:'user'},f.peer)).toThrow('publication_operation_not_approved');
  expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:0});
 }finally{await f.cleanup();}
});
it('recovery rejects a partial settlement journal instead of inventing no-publication facts',async()=>{
 const f=await fixture();try{
  const prepared=f.operations.prepareRequest(request,f.peer);
  await expect(f.operations.approve({challengeId:prepared.challengeId},f.peer,new AbortController().signal)).rejects.toThrow('receiver offline');
  f.database.prepare('DELETE FROM publication_journal').run();
  expect(()=>f.operations.recoverUnapproved({challengeId:prepared.challengeId},f.peer)).toThrow('publication_operation_settlement');
 }finally{await f.cleanup();}
});

it('signed client lookup and recovery route without renewed execution or recreated approval capability',async()=>{
 const f=await fixture();let renewals=0;const signal=new AbortController().signal;
 const router=createControllerOperationRouting({assertCurrent(){},async renew(){renewals++;},publication:f.operations,verification:{async prepare(){throw Error('unexpected');},async dispatch(){throw Error('unexpected');}},completion:{invoke(){throw Error('unexpected');}},execution:{async invoke(){throw Error('unexpected');}}});
 const socketPath=join(f.root,'publication-requests.sock');
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'epoch',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,invoke:router.invoke});
 const transport=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>callControllerIpc(socketPath,bytes,{signal}),roundTripSync(){throw Error('unexpected');}});
 try{
  const first=createPublicationClient({owner:f.owner,requestSource:'user',transport:transport.publicationTransport});
  const ticket=await first.prepareRequest(request.requestId,signal);expect(renewals).toBe(1);
  const restarted=createPublicationClient({owner:f.owner,requestSource:'user',transport:transport.publicationTransport});
  const found=await restarted.lookupRequest(request.requestId,signal);expect(found).toEqual({state:'prepared',challenge:ticket});
  if(found.state!=='prepared')throw Error('missing');
  await expect(restarted.approve(found.challenge,signal)).rejects.toThrow('publication_client_challenge');
  expect(await restarted.recoverUnapproved(found.challenge,signal)).toMatchObject({status:'not_approved'});
  expect(await restarted.recoverRequest('unsent',signal)).toEqual({status:'not_prepared'});expect(await restarted.lookupRequest('unsent',signal)).toEqual({state:'not_prepared'});expect(renewals).toBe(1);expect(f.counts()).toEqual({approvals:0,receiverCalls:0});
 }finally{transport.dispose();await server.close();await f.cleanup();}
});

it('recovery CAS failure preserves the original row and retry works after proof expiry',async()=>{
 const f=await fixture();try{
  const prepared=f.operations.prepareRequest(request,f.peer);
  f.database.exec("CREATE TRIGGER fail_recovery BEFORE UPDATE ON publication_operations WHEN NEW.state='not_approved' BEGIN SELECT RAISE(ABORT,'recovery disk failure'); END");
  expect(()=>f.operations.recoverUnapproved({challengeId:prepared.challengeId},f.peer)).toThrow('recovery disk failure');
  expect(f.database.prepare('SELECT state FROM publication_operations WHERE id=?').get(prepared.challengeId)).toEqual({state:'prepared'});
  f.database.exec('DROP TRIGGER fail_recovery');f.setTime(999999);
  expect(f.operations.recoverUnapproved({challengeId:prepared.challengeId},f.peer)).toMatchObject({status:'not_approved'});
  expect(f.counts()).toEqual({approvals:0,receiverCalls:0});
 }finally{await f.cleanup();}
});
it('request identity cannot cross original owner, peer or audit session',async()=>{
 const f=await fixture();try{
  const prepared=f.operations.prepareRequest(request,f.peer);
  expect(()=>f.operations.prepareRequest({...request,ownerId:'other'},f.peer)).toThrow();
  const foreign={...f.peer,auditSessionId:f.peer.auditSessionId+1};
  expect(f.operations.lookupRequest({requestId:request.requestId},foreign)).toEqual({state:'absent'});
  expect(()=>f.operations.recoverUnapproved({challengeId:prepared.challengeId},foreign)).toThrow();
  expect(f.database.prepare('SELECT count(*) n FROM publication_operations').get()).toEqual({n:1});
 }finally{await f.cleanup();}
});
it('a durable request tombstone closes crash-before-send and rejects a late prepare',async()=>{
 const f=await fixture();try{
  expect(f.operations.lookupRequest({requestId:request.requestId},f.peer)).toEqual({state:'absent'});
  expect(f.operations.recoverRequest(request,f.peer)).toEqual({status:'not_prepared'});
  await f.reopen();expect(f.operations.recoverRequest(request,f.peer)).toEqual({status:'not_prepared'});
  expect(f.operations.lookupRequest({requestId:request.requestId},f.peer)).toEqual({state:'not_prepared'});
  expect(()=>f.operations.prepareRequest(request,f.peer)).toThrow('publication_request_not_prepared');
  expect(()=>f.operations.recoverRequest({...request,requestSource:'agent'},f.peer)).toThrow('publication_request_changed');
  expect(f.database.prepare('SELECT count(*) n FROM publication_operations').get()).toEqual({n:0});
 }finally{await f.cleanup();}
});
it('recoverRequest after prepare closes exactly the original challenge',async()=>{
 const f=await fixture();try{
  const prepared=f.operations.prepareRequest(request,f.peer);
  expect(f.operations.recoverRequest(request,f.peer)).toMatchObject({status:'not_approved',challenge:prepared});
  expect(f.database.prepare('SELECT count(*) n FROM publication_operations').get()).toEqual({n:1});
 }finally{await f.cleanup();}
});

it('request tombstone write rollback grants no false retirement and combined rows share the fixed cap',async()=>{
 const f=await fixture();try{
  f.reserveControllerMetadata(32*1024**2);
  f.database.exec("CREATE TRIGGER fail_tomb BEFORE INSERT ON publication_request_tombstones BEGIN SELECT RAISE(ABORT,'tombstone disk failure'); END");
  expect(()=>f.operations.recoverRequest(request,f.peer)).toThrow('tombstone disk failure');
  expect(f.operations.lookupRequest({requestId:request.requestId},f.peer)).toEqual({state:'absent'});
  f.database.exec('DROP TRIGGER fail_tomb');f.operations.prepareRequest(request,f.peer);
  const tomb={...request,requestId:'closed'};f.operations.recoverRequest(tomb,f.peer);
  const row=f.database.prepare('SELECT principal_key,request_json FROM publication_request_tombstones').get() as {principal_key:string;request_json:string};
  // Fill only durable accounting slots; these rows are not used as authority.
  f.database.transaction(()=>{const put=f.database.prepare('INSERT INTO publication_request_tombstones VALUES(?,?,?)');for(let i=0;i<4094;i++)put.run(row.principal_key,`quota-${i}`,row.request_json);})();
  expect(()=>f.operations.recoverRequest({...request,requestId:'overflow-retire'},f.peer)).toThrow('publication_request_capacity');
  expect(()=>f.operations.prepareRequest({...request,requestId:'overflow-prepare'},f.peer)).toThrow('publication_request_capacity');
  expect(f.operations.recoverRequest(tomb,f.peer)).toEqual({status:'not_prepared'});
 }finally{await f.cleanup();}
});
