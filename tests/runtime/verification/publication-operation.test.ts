import '../../support/installed-controller-fixture.js';
import {readPublishedArtifact} from '../../../src/runtime/verification/published-artifact-reader.js';
import {createPublicationClient} from '../../../src/runtime/verification/publication-client.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {it,expect,vi,type TestContext} from 'vitest';
import {join} from 'node:path';
import {Session as InspectorSession} from 'node:inspector';
import {createHash} from 'node:crypto';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {VerificationReceiverStore} from '../../../src/runtime/verification/receiver-store.js';
import {startReceiverService} from '../../../src/runtime/verification/receiver-service.js';
import {createReceiverTransport} from '../../../src/runtime/verification/receiver-transport.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createReceiverUploadVerifier} from '../../../src/runtime/verification/receiver-upload-authentication.js';
import {publicationReviewBytes} from '../../../src/runtime/verification/publication-operation-review.js';
import {createApprovedPublicationOperations} from '../../../src/runtime/verification/approved-publication-operation.js';
const publicationScenarios=['publish','expired-approval','wrong-peer','repeat','lost-commit','reopen-query','wrong-receipt','principal-changed','expired-after-stage','aborted-native','competing-challenges','public-client','public-client-goal','public-client-large','public-client-near-limit','failed-upload-recovery','principal-during-registration','observe-principal-change','observe-revision-change','observe-expired-proof','observe-offline','read-payload','read-payload-stale','read-payload-corrupt','read-payload-principal','read-payload-near-limit','read-payload-replaced','read-payload-single-capture'] as const;
// User-approved near-limit budget; only this case receives timeout cancellation and join.
for(const scenario of publicationScenarios){
 if(scenario==='public-client-near-limit'){
  it.for([scenario])('actual verification to receiver publication: %s',{timeout:300000},(mode,ctx:TestContext)=>{
   const scenarioPromise=actualPublicationScenario(mode,ctx.signal);
   const settledOutcome=scenarioPromise.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
   ctx.onTestFinished(async()=>{
    const outcome=await settledOutcome;
    if(ctx.signal.aborted&&outcome.failed&&outcome.error!==ctx.signal.reason)throw outcome.error;
   });
   return scenarioPromise;
  });
 }else it.each([scenario])('actual verification to receiver publication: %s',mode=>actualPublicationScenario(mode),120000);
}
async function actualPublicationScenario(mode:typeof publicationScenarios[number],testSignal?:AbortSignal){
 testSignal?.throwIfAborted();
 const nearCleanup:Array<()=>void|Promise<void>>=[],nearServerFailures:unknown[]=[];let bodyFailure:{error:unknown}|undefined;
 try{
 const f=await verifiedOperationFixture(mode==='public-client-goal'?'goal-application':(mode==='read-payload-near-limit'||mode==='public-client-near-limit')?'maximum-artifact':(mode.startsWith('read-payload')||mode==='public-client-large')?'large-artifact':'dispatch', (mode==='read-payload-near-limit'||mode==='public-client-near-limit')?{controllerMetadataMinimumBytes:96*1024**2}:{}),identity=f.receiverIdentity,socketPath=join(f.root,'receiver.sock');
 if(testSignal)nearCleanup.unshift(()=>f.close());
 const store=new VerificationReceiverStore({root:join(f.root,'receiver-state'),...identity,clock:f.clock});
 if(testSignal)nearCleanup.unshift(()=>store.close());
 // Explicit peer fixture: full protocol/SQLite/signatures, not installed UID qualification.
 let changeDuringRecovery=false,recoveryConnections=0;
 const service=await startReceiverService({socketPath,controllerServiceUid:501,identity,privateKey:f.keys.privateKey,store,assertCurrent(){},readPeer:()=>{if(changeDuringRecovery&&++recoveryConnections===2)changedPrincipal=true;return {...f.peer,pid:123};}});
 if(testSignal)nearCleanup.unshift(()=>service.close());
 const transport=createReceiverTransport({socketPath,receiverServiceUid:700,identity,verifier:createReceiverReplyVerifier({...identity,publicKey:f.keys.publicKey}),uploadVerifier:createReceiverUploadVerifier({...identity,publicKey:f.keys.publicKey}),assertCurrent(){},readPeer:()=>({uid:700,gid:700,auditSessionId:1,pid:234})});
 if(testSignal)nearCleanup.unshift(()=>transport.close());
 let afterQuery:(()=>Promise<void>)|undefined;let approvals=0,commits=0,cancels=0,changedPrincipal=false,clockOverride:Partial<ReturnType<typeof f.clock>>={};const cancellation=new AbortController();
 const options={database:f.database,authorityId:'authority',completion:f.composition,verification:f.operations,receiverIdentity:identity,receiver:{async stagePayload(...args:Parameters<typeof transport.stagePayload>){if(mode==='failed-upload-recovery'||mode==='principal-during-registration')throw Error('upload unavailable before registration');const staged=await transport.stagePayload(...args);if(mode==='expired-after-stage')f.setTime(999999);return staged;},async call(...args:Parameters<typeof transport.call>){const result=await transport.call(...args);if(args[0]==='query'&&afterQuery){const hook=afterQuery;afterQuery=undefined;await hook();}if(args[0]==='cancel')cancels++;if(args[0]==='commit'){commits++;if(mode==='lost-commit')throw Error('response lost after real commit');}return result;}},clock:()=>({...f.clock(),...clockOverride}),assertCurrent(){},resolvePrincipal:(p:typeof f.peer)=>({...p,accountGeneration:changedPrincipal?'22222222-AAAA-BBBB-CCCC-555555555555':'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review:any){approvals++;if(mode==='principal-changed')changedPrincipal=true;if(mode==='aborted-native')cancellation.abort();if(mode==='expired-approval')f.setTime(999999);return{version:1 as const,purpose:'completion-publication' as const,authorityId:review.authorityId,challengeId:review.challengeId,uid:review.principal.uid,accountGeneration:review.principal.accountGeneration,auditSessionId:review.principal.auditSessionId,requestSource:review.requestSource,fullReviewHash:mode==='wrong-receipt'?'f'.repeat(64):createHash('sha256').update(publicationReviewBytes(review)).digest('hex')};}};
 let operations=createApprovedPublicationOperations(options);let publicServer:Awaited<ReturnType<typeof startPublicController>>|undefined,publicClient:ReturnType<typeof createAuthenticatedControllerClient>|undefined;
 if(testSignal)nearCleanup.unshift(()=>publicClient?.dispose(),()=>publicServer?.close(),()=>operations.close());
 try{
  if(mode.startsWith('public-client')){
   const path=join(f.root,'public.sock');const serverOptions:Parameters<typeof startPublicController>[0]={socketPath:path,authorityId:'authority',serviceEpoch:'epoch',privateKey:f.keys.privateKey,allowedUserIds:[501],acceptPeer:()=>f.peer,async invoke(method,payload,p,signal){if(method==='publication.prepare')return operations.prepare(payload,p);if(method==='publication.approve')return operations.approve(payload,p,signal);if(method==='publication.reconcile')return operations.reconcile(payload,p,signal);if(method==='publication.observeOwner')return operations.observeOwner(payload,p,signal);if(method==='publication.readOwnerPayload')return operations.readOwnerPayload(payload,p,signal);if(method==='publication.recoverExpired')return operations.recoverExpired(payload,p,signal);throw Error('method');}};
   if(testSignal){
    const caseSignal=testSignal,invoke=serverOptions.invoke;
    serverOptions.invoke=async(method,payload,peer,serverSignal)=>{
     const signal=AbortSignal.any([serverSignal,caseSignal]);
     try{signal.throwIfAborted();return await invoke(method,payload,peer,signal);}catch(error){if(!caseSignal.aborted||error!==caseSignal.reason)nearServerFailures.push(error);throw error;}
    };
   }
   publicServer=await startPublicController(serverOptions);
   publicClient=createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,signal)=>{if(testSignal){signal=signal===undefined?testSignal:AbortSignal.any([signal,testSignal]);signal.throwIfAborted();}return callControllerIpc(path,bytes,{signal,...(mode==='public-client-near-limit'?{timeoutMs:300000}:{})});},roundTripSync(){throw Error('no sync');}});
   const client=createPublicationClient({owner:f.owner,requestSource:'agent',transport:publicClient.publicationTransport}),ticket=await client.prepare();
   expect(Object.keys(ticket).sort()).toEqual(['challengeId','deadline','fullTupleHash','owner']);
   await expect(client.approve({...ticket})).rejects.toThrow('publication_client_challenge');
   const published=await client.approve(ticket);expect(published.status).toBe('committed');expect(store.readVisible(published.operationId)).toBeTruthy();
   await expect(client.approve(ticket)).rejects.toThrow('publication_client_challenge');
   const reopened=createPublicationClient({owner:f.owner,requestSource:'agent',transport:publicClient.publicationTransport});expect((await reopened.reconcile(JSON.parse(JSON.stringify(ticket)))).status).toBe('committed');expect(commits).toBe(1);expect((await reopened.recoverExpired(JSON.parse(JSON.stringify(ticket)))).status).toBe('committed');expect(cancels).toBe(0);const current=await reopened.observe();expect(current.publication).toMatchObject({status:'committed',current:true});const payload=await reopened.readPayload(current);expect(JSON.parse(payload.bytes.toString()).owner).toEqual(f.owner);if(mode==='public-client-goal')expect(JSON.parse(payload.bytes.toString()).application).toEqual(f.composition.privateHost.authorityHost.inspectApplication(f.owner).current);expect(readPublishedArtifact(payload,{kind:'local',obligationId:'original',path:'result'}).bytes).toEqual(mode==='public-client-near-limit'?Buffer.alloc(12*1024**2-32768,97):mode==='public-client-large'?Buffer.alloc(300*1024,97):Buffer.from('result'));expect(commits).toBe(1);return;
  }
  expect((await operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal)).publication.status).toBe('absent');
  const prepared=operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},f.peer);
  const competing=mode==='competing-challenges'?operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},f.peer):undefined;
  const review=JSON.parse((f.database.prepare('SELECT review_json FROM publication_operations WHERE id=?').get(prepared.challengeId) as {review_json:string}).review_json);
  expect(review.tuple.immutablePayloadHash).toMatch(/^[a-f0-9]{64}$/);expect(store.readVisible(review.tuple.operationId)).toBeUndefined();
  if(mode==='wrong-peer'){await expect(operations.approve({challengeId:prepared.challengeId},{...f.peer,uid:502},new AbortController().signal)).rejects.toThrow();expect(approvals).toBe(0);return;}
  if(['expired-approval','wrong-receipt','principal-changed','expired-after-stage','aborted-native'].includes(mode)){await expect(operations.approve({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow();expect(commits).toBe(0);expect(store.readVisible(review.tuple.operationId)).toBeUndefined();return;}
  if(mode==='failed-upload-recovery'||mode==='principal-during-registration'){
   await expect(operations.approve({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('upload unavailable');
   if(mode==='principal-during-registration'){f.setTime(review.tuple.validUntil+1);changeDuringRecovery=true;await expect(operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_principal');expect(cancels).toBe(0);expect(store.query(review.tuple,prepared.fullTupleHash)).toBeUndefined();return;}
   expect((await operations.reconcile({challengeId:prepared.challengeId},f.peer,cancellation.signal)).status).toBe('unknown');
   await expect(operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_not_expired');
   expect(store.query(review.tuple,prepared.fullTupleHash)).toBeUndefined();
   clockOverride={lowerBound:review.tuple.validUntil-1,upperBound:review.tuple.validUntil+1};
   await expect(operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_not_expired');
   clockOverride={domainId:'different-domain'};f.setTime(review.tuple.validUntil+1);
   await expect(operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_not_expired');
   clockOverride={};changedPrincipal=true;
   await expect(operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_principal');
   changedPrincipal=false;expect(cancels).toBe(0);

   await operations.close();operations=createApprovedPublicationOperations(options);
   expect((await operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).status).toBe('cancelled');
   expect((await operations.reconcile({challengeId:prepared.challengeId},f.peer,cancellation.signal)).status).toBe('cancelled');
   expect(commits).toBe(0);expect(store.readVisible(review.tuple.operationId)).toBeUndefined();
   const journal=f.database.prepare('SELECT state_json FROM publication_journal WHERE operation_id=?').get(review.tuple.operationId) as {state_json:string};
   expect(JSON.parse(journal.state_json).reservation).toBe('cancelled');expect(cancels).toBe(1);return;
  }
  if(mode==='lost-commit')await expect(operations.approve({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow('response lost');
  else expect((await operations.approve({challengeId:prepared.challengeId},f.peer,cancellation.signal)).status).toBe('committed');
  if(mode.startsWith('read-payload')){
   const request={ownerKind:'task',ownerId:'task',operationId:review.tuple.operationId,fullTupleHash:prepared.fullTupleHash,offset:0,maxBytes:262144};
   if(mode==='read-payload-principal'){afterQuery=async()=>{changedPrincipal=true;};await expect(operations.readOwnerPayload(request,f.peer,cancellation.signal)).rejects.toThrow('publication_operation_principal');return;}
   const page=await operations.readOwnerPayload(request,f.peer,cancellation.signal);
   expect(page.offset).toBe(0);expect(page.eof).toBe(false);expect(page.payloadHash).toBe(review.tuple.immutablePayloadHash);
   expect(Buffer.from(page.bytes,'base64')).toHaveLength(262144);
   if(mode==='read-payload-stale'){f.setTime(review.tuple.validUntil+1);await expect(operations.readOwnerPayload({...request,offset:262144},f.peer,cancellation.signal)).rejects.toThrow();expect(commits).toBe(1);return;}
   if(mode==='read-payload-corrupt'){f.database.prepare('UPDATE verified_publication_payloads SET payload=?').run(Buffer.from('changed original bytes'));await expect(operations.readOwnerPayload({...request,offset:262144},f.peer,cancellation.signal)).rejects.toThrow(/payload/);expect(commits).toBe(1);return;}
   if(mode==='read-payload-replaced'){const newer=operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},f.peer);await operations.approve({challengeId:newer.challengeId},f.peer,cancellation.signal);await expect(operations.readOwnerPayload({...request,offset:262144},f.peer,cancellation.signal)).rejects.toThrow('publication_payload_not_current');expect(commits).toBe(2);return;}
   if(mode==='read-payload-single-capture'){
    // Count the actual full-row decoder without replacing guarded database methods.
    const inspector=new InspectorSession();inspector.connect();
    const post=(method:string,params={})=>new Promise<any>((resolve,reject)=>inspector.post(method as any,params,(error,result)=>error?reject(error):resolve(result)));
    try{
     await post('Profiler.enable');await post('Profiler.startPreciseCoverage',{callCount:true,detailed:true});
     await operations.readOwnerPayload({...request,offset:262144},f.peer,cancellation.signal);
     const coverage=await post('Profiler.takePreciseCoverage');
     const scripts=coverage.result.filter((script:any)=>/\/src\/runtime\/verification\/verified-publication-payload\.(?:ts|js)$/.test(script.url.replace(/\\/g,'/')));
     expect(scripts).toHaveLength(1);
     const functions=scripts[0].functions.filter((fn:any)=>fn.functionName==='readRow');
     expect(functions).toHaveLength(1);expect(functions[0].ranges.length).toBeGreaterThan(0);
     const reads=functions[0].ranges[0].count;
     expect(reads).toBe(1);
    }finally{await post('Profiler.stopPreciseCoverage');inspector.disconnect();}
    return;
   }
   if(mode==='read-payload-near-limit'){expect(page.totalBytes).toBeGreaterThan(31*1024**2);expect(page.totalBytes).toBeLessThanOrEqual(32*1024**2);const tail=await operations.readOwnerPayload({...request,offset:page.totalBytes-262144},f.peer,cancellation.signal);expect(tail.eof).toBe(true);expect(tail.payloadHash).toBe(page.payloadHash);expect(Buffer.from(tail.bytes,'base64')).toHaveLength(262144);expect(commits).toBe(1);return;}
   const last=await operations.readOwnerPayload({...request,offset:262144},f.peer,cancellation.signal);
   expect(last.eof).toBe(true);expect(last.totalBytes).toBe(page.totalBytes);
   const body=Buffer.concat([Buffer.from(page.bytes,'base64'),Buffer.from(last.bytes,'base64')]);
   expect(createHash('sha256').update(body).digest('hex')).toBe(review.tuple.immutablePayloadHash);
   expect(Buffer.from(JSON.parse(body.toString()).evaluations[0].artifacts[0].bytesBase64,'base64')).toEqual(Buffer.alloc(300*1024,97));
   expect(await operations.readOwnerPayload(request,f.peer,cancellation.signal)).toEqual(page);expect(commits).toBe(1);expect(approvals).toBe(1);return;
  }
  if(mode==='observe-principal-change'){afterQuery=async()=>{changedPrincipal=true;};await expect(operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_principal');expect(commits).toBe(1);return;}
  if(mode==='observe-revision-change'){
   afterQuery=async()=>{const next=operations.prepare({ownerKind:'task',ownerId:'task',requestSource:'agent'},f.peer);await operations.approve({challengeId:next.challengeId},f.peer,cancellation.signal);};
   await expect(operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal)).rejects.toThrow('publication_observation_changed');
   const latest=await operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal);expect(latest.businessRevision).toBe(review.tuple.expectedBusinessRevision+2);expect(latest.publication).toMatchObject({status:'committed',current:true});expect(commits).toBe(2);return;
  }
  if(mode==='observe-expired-proof'){f.setTime(review.tuple.validUntil+1);const expired=await operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal);expect(expired.publication).toMatchObject({status:'committed',current:false});expect(expired.currentVerification).toBe('needs_revalidation');expect(commits).toBe(1);return;}
  if(mode==='observe-offline'){await transport.close();await expect(operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal)).rejects.toThrow('receiver_transport_closed');expect(commits).toBe(1);return;}
  if(competing){await expect(operations.approve({challengeId:competing.challengeId},f.peer,cancellation.signal)).rejects.toThrow('publication_operation_not_current');}
  expect(commits).toBe(1);expect(approvals).toBe(1);expect(store.readVisible(review.tuple.operationId)).toBeTruthy();
  if(mode==='reopen-query'){await operations.close();operations=createApprovedPublicationOperations(options);}
  const recovered=await operations.reconcile({challengeId:prepared.challengeId},f.peer,new AbortController().signal);expect(recovered.status).toBe('committed');expect(recovered.fullTupleHash).toBeTruthy();const observed=await operations.observeOwner({ownerKind:'task',ownerId:'task'},f.peer,cancellation.signal);expect(observed.publication).toMatchObject({status:'committed',current:true,fullTupleHash:prepared.fullTupleHash});const newLogin=await operations.observeOwner({ownerKind:'task',ownerId:'task'},{...f.peer,auditSessionId:f.peer.auditSessionId+1},cancellation.signal);expect(newLogin.publication).toMatchObject({status:'committed',current:true});expect(commits).toBe(1);expect((await operations.recoverExpired({challengeId:prepared.challengeId},f.peer,cancellation.signal)).status).toBe('committed');expect(cancels).toBe(0);
  await expect(operations.approve({challengeId:prepared.challengeId},f.peer,cancellation.signal)).rejects.toThrow();expect(approvals).toBe(1);
 }finally{
  if(!testSignal){publicClient?.dispose();await publicServer?.close();await operations.close();await transport.close();await service.close();store.close();await f.close();}
 }
 }catch(error){if(testSignal)bodyFailure={error};throw error;}
 finally{
  if(testSignal){
   const cleanupErrors:unknown[]=[];
   for(const close of nearCleanup){
    try{await close();}catch(error){cleanupErrors.push(error);}
   }
   const failures=[...nearServerFailures,...cleanupErrors];
   if(failures.length)throw new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...failures],'publication_near_limit_cleanup_or_transport_failed');
  }
 }
}
it('rejects copied or foreign actual verification assembly before creating publication state',async()=>{
 const a=await verifiedOperationFixture(),b=await verifiedOperationFixture();
 try{for(const verification of [{...a.operations},b.operations]){
  expect(()=>createApprovedPublicationOperations({database:a.database,authorityId:'authority',completion:a.composition,verification,receiverIdentity:{receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'},receiver:{async stagePayload(){throw Error('unused');},async call(){throw Error('unused');}},clock:a.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('unused');}})).toThrow('publication_verification_binding');
  expect(a.database.prepare('SELECT COUNT(*) n FROM publication_operations').get()).toEqual({n:0});
 }}finally{await a.close();await b.close();}
});
it('rejects a copied completion wrapper with a substituted public dispatcher',async()=>{
 const f=await verifiedOperationFixture();let calls=0;
 try{expect(()=>createApprovedPublicationOperations({database:f.database,authorityId:'authority',completion:{...f.composition,public:{invoke(){calls++;throw Error('foreign public dispatcher');}}},verification:f.operations,receiverIdentity:{receiverId:'receiver',receiverInstanceEpoch:1,keyId:'receiver'},receiver:{async stagePayload(){throw Error('unused');},async call(){throw Error('unused');}},clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid'}),async approve(){throw Error('unused');}})).toThrow('publication_completion_binding');expect(calls).toBe(0);expect(f.database.prepare('SELECT COUNT(*) n FROM publication_operations').get()).toEqual({n:0});}
 finally{await f.close();}
});
