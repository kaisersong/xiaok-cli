import {it,expect} from 'vitest';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),peer={uid:501,gid:20,auditSessionId:7},hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'completion-composition-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),markers=join(root,'markers');mkdirSync(markers,{mode:0o755});
 const clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H});
 const composition=createVerificationCompletionComposition({root,database,authorityId:'authority',authority:{receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},quiescence:{assertQuiescent(){}}},enrollment:{resolvePrincipal:(p:typeof peer)=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),approve:async(review:any)=>({uid:peer.uid,auditSessionId:peer.auditSessionId,reviewHash:hash(json(review).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')))}),profilePublication:createProfileIndexPublisher({root:markers,database,authorityId:'authority',assertCurrent(){}})},recipePorts:{assertFailedRunComplete(){throw Error('protected run not configured');},assertCurrent(){},async readArtifact(){return Buffer.from('result');},async runBlackbox(){throw Error('unused');},async readFailedRun(){throw Error('unused');}}});
 return{composition,database,close(){composition.close();database.close();rmSync(root,{recursive:true,force:true});}};
}
it.each(['blackbox','cumulative'] as const)('binds only the original committed native recipe to the exact current bound attempt (%s)',async kind=>{
 const f=fixture();try{
  const host=f.composition.privateHost;
  const recipe=kind==='blackbox'?{kind:'blackbox' as const,cases:[{id:'case-1',inputBase64:Buffer.from('private input').toString('base64'),expectedOutputBase64:Buffer.from('expected output').toString('base64'),sideEffects:[]}]}:{kind:'diagnostic-coverage' as const,sources:['A','B'].map(name=>({checkId:name,sourceRunId:name,runNonce:`nonce-${name}`,archiveHash:H,diagnosisPath:`${name}.json`}))};
  const obligation={obligationId:'original',predicateId:'blackbox',predicateVersion:'1',semantics:kind==='blackbox'?'specific-run' as const:'cumulative' as const,definitionHash:hash(json(recipe)),requiredCheckIds:kind==='blackbox'?['case-1']:['A','B']};
  const proposal={enrollment:{ownerKind:'task',ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}};
  const review=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any;
  const {owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:review.challengeId},peer) as any;
  const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:host.authorityHost.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
  const subject=host.authorityHost.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'program',sha256:H,size:1,role:'source'}]});
  const request={owner,obligationId:'original',expectedAttemptEpoch:0,sourceRunId:'run',runNonce:'nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
  const attempt=host.authorityService.requestVerification(request,issue('requestVerification',request));
  const expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'physical',scopeDigest:H};
  const binding={attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:'nonce',expected};
  expect(()=>host.readApprovedRecipeBinding(binding)).toThrow();
  host.authorityHost.bindExecution(attempt.attemptId,expected);
  const approved=host.readApprovedRecipeBinding(binding);
  expect(approved.recipe).toEqual(recipe);expect(approved.attempt.owner).toEqual(owner);expect(approved.attempt.obligation).toEqual(obligation);
  expect(Object.isFrozen(approved.recipe)).toBe(true);
  expect(()=>host.readApprovedRecipeBinding({...binding,expected:{...expected,executionIdentity:'forged'}})).toThrow();
  expect(()=>host.readApprovedRecipeBinding({...binding,runNonce:'other'})).toThrow();
  expect(host.authorityService.inspectOwner(owner)!.currentVerification).toBe('needs_revalidation');
  // A retained partial/failed enrollment intent cannot authorize case execution.
  f.database.prepare('UPDATE owner_enrollment_intents SET committed=0').run();
  expect(()=>host.readApprovedRecipeBinding(binding)).toThrow(/enrollment/);
  f.database.prepare('UPDATE owner_enrollment_intents SET committed=1').run();
  const invalidation={owner,reason:'explicit user revocation'};
  host.authorityService.invalidate(invalidation,issue('invalidate',invalidation));
  expect(()=>host.readApprovedRecipeBinding(binding)).toThrow(/admission/);
  f.composition.close();expect(()=>host.readApprovedRecipeBinding(binding)).toThrow(/closed/);
 }finally{f.close();}
});
it('routes actual enrollment and read scopes without exposing issuers or treating registration as success',async()=>{
 const f=fixture();try{
  const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:hash('result'),structure:'utf8' as const}]};
  const proposal={enrollment:{ownerKind:'task',ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'specific-run',definitionHash:hash(json(recipe)),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner'}}};
  const prepared=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any;
  const enrolled=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},peer) as any;
  const opened=await f.composition.public.invoke('completion.open-owner',{ownerKind:'task',ownerId:'task'},peer) as any;
  expect(opened.owner).toEqual(enrolled.owner);
  expect(await f.composition.public.invoke('completion.inspect',opened,peer)).toMatchObject({currentVerification:'needs_revalidation',obligationCount:1});
  expect(Object.keys(f.composition.public)).toEqual(['invoke']);
  expect(()=>f.composition.public.invoke('completion.issue-proof' as never,{},peer)).toThrow(/method/);
  expect(()=>f.composition.public.invoke('completion.authorize-owner',{challengeId:'x',passed:true},peer)).toThrow(/shape/);
  const host=f.composition.privateHost,owner=enrolled.owner;
  const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:host.authorityHost.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
  const subject=host.authorityHost.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'result.txt',sha256:hash('result'),size:6,role:'source'}]});
  const proposalAttempt={owner,obligationId:'original',expectedAttemptEpoch:0,sourceRunId:'run',runNonce:'run-nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
  const attempt=host.authorityService.requestVerification(proposalAttempt,issue('requestVerification',proposalAttempt)),expected={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v',executionIdentity:'execution',scopeDigest:H};
  host.authorityHost.bindExecution(attempt.attemptId,expected);
  const evaluation=await host.recipes.evaluate(host.recipes.compile(recipe),{attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:'run-nonce',expected});
  host.authorityHost.recordControllerResult(attempt.attemptId,{coreId:'core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[hash('result')]},{...evaluation,validUntil:1500},{} as never);
  const state=host.authorityService.inspectOwner(owner)!;
  const tuple={schemaVersion:1 as const,...owner,migrationEpoch:1,expectedBusinessRevision:0,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:host.authorityService.getCurrentDependencies(owner),operationId:'operation',immutablePayloadHash:H,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'reservation',nonce:'nonce',notBefore:1000,validUntil:1400,clockDomainId:'clock',clockQualificationEpoch:1};
  const authorization=host.completionScopes.issueMutation({owner,peer,expiresAt:1400,method:'completion.settle',tuple,requestSource:'user'});
  expect(()=>f.composition.public.invoke('completion.settle',{owner,tuple,requestSource:'user',authorization},peer)).toThrow(/payload/);
  expect(host.authorityService.inspectOwner(owner)?.businessRevision).toBe(0);
  const payload=host.payloads.stage({owner,evaluations:[evaluation]}),good={...tuple,immutablePayloadHash:payload.immutablePayloadHash};
  const fresh=host.completionScopes.issueMutation({owner,peer,expiresAt:1400,method:'completion.settle',tuple:good,requestSource:'user'});
  expect(f.composition.public.invoke('completion.settle',{owner,tuple:good,requestSource:'user',authorization:fresh},peer)).toMatchObject({state:'committed',committedBusinessRevision:1});
  f.composition.close();expect(f.database.open).toBe(true);
  expect(()=>f.composition.public.invoke('completion.open-owner',{ownerKind:'task',ownerId:'task'},peer)).toThrow(/closed/);
  expect(()=>f.composition.privateHost.recipes.compile(recipe)).toThrow(/closed/);
 }finally{f.close();}
});

import {createApprovedSourceCapabilities} from '../../../src/runtime/verification/approved-source-capabilities.js';
it.each(['read','copied','owner','source','expired','revoked','append','guard','start','start-wrong','start-copied'] as const)('uses native committed exact source authority without recursive proof inspection: %s',async mode=>{
 const f=fixture();let time=1000;
 try{
  const host=f.composition.privateHost,source={checkId:'diagnosis',sourceRunId:'run',runNonce:'nonce',archiveHash:H,diagnosisPath:'diagnosis.json',sourceScope:'protected-execution-run' as const},recipe={kind:'diagnostic-coverage' as const,...source};
  const obligation={obligationId:'original',predicateId:'coverage',predicateVersion:'1',semantics:'specific-run',definitionHash:hash(json(recipe)),requiredCheckIds:['diagnosis']};
  const proposal={enrollment:{ownerKind:'task',ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation,recipe}],source:{kind:'new-owner'}}};
  const review=await f.composition.public.invoke('completion.prepare-owner',proposal,peer) as any,{owner}=await f.composition.public.invoke('completion.authorize-owner',{challengeId:review.challengeId},peer) as any;
  const caps=createApprovedSourceCapabilities({database:f.database,completion:host,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:time,upperBound:time+1,evidenceHash:H}),wallNow:()=>time});
  const deadline={wallExpiresAt:2000,continuousExpiresAt:2000,clockDomainId:'clock',clockQualificationEpoch:1,preparedLowerBound:1000};
  const cap=caps.issueRead({owner,obligationId:'original',source,deadline}),facts={ownerKey:json(owner),sourceRunId:'run',runNonce:'nonce',archiveHash:H,scope:'protected-execution-run' as const};
  if(mode.startsWith('start')){const invocation={sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'},start=caps.issueStart({owner,obligationId:'original',peer,invocation,deadline}),proposal={ownerKey:json(owner),rootInvocation:invocation};if(mode==='start')expect(()=>caps.assertStart(proposal,start)).not.toThrow();else if(mode==='start-wrong')expect(()=>caps.assertStart({...proposal,rootInvocation:{...invocation,validationInvocationId:'other'}},start)).toThrow();else expect(()=>caps.assertStart(proposal,{...start})).toThrow();}
  else if(mode==='copied')expect(()=>caps.assertRead(facts,{...cap})).toThrow();
  else if(mode==='owner')expect(()=>caps.assertRead({...facts,ownerKey:json({...owner,ownerId:'other'})},cap)).toThrow();
  else if(mode==='source')expect(()=>caps.assertRead({...facts,archiveHash:'b'.repeat(64)},cap)).toThrow();
  else if(mode==='expired'){time=2000;expect(()=>caps.assertRead(facts,cap)).toThrow();}
  else if(mode==='revoked'){const payload={owner,reason:'user revoke'},authorization=host.authorityHost.issueAuthorization({owner,method:'invalidate',payload,requestSource:'user',principalId:'user',expiresAt:2000});host.authorityService.invalidate(payload,{requestSource:'user',authorization});expect(()=>caps.assertRead(facts,cap)).toThrow();}
  else if(mode==='append'){const added=structuredClone(proposal),entry=structuredClone(added.registration.obligations[0]);entry.obligation.obligationId='extra';added.registration.obligations.push(entry);const review=await f.composition.public.invoke('completion.prepare-owner',added,peer) as any;await f.composition.public.invoke('completion.authorize-owner',{challengeId:review.challengeId},peer);expect(()=>caps.assertRead(facts,cap)).not.toThrow();}
  else if(mode==='guard'){host.authorityHost.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'source.ndjson',sha256:H,size:1,role:'original-source'}]});let called=false;expect(()=>host.authorityHost.registerScopeGuard({owner,scopeId:'scope',revision:1},()=>{called=true;caps.assertRead(facts,cap);})).toThrow('scope_guard_brand');expect(called).toBe(false);expect(()=>caps.assertRead(facts,cap)).not.toThrow();expect(()=>host.authorityService.inspectOwner(owner)).not.toThrow();}
  else expect(()=>caps.assertRead(facts,cap)).not.toThrow();
  caps.close();expect(()=>caps.assertRead(facts,cap)).toThrow();
 }finally{f.close();}
});
it('signed controller client routes durable enrollment recovery through the actual composition and legacy authorization fence',async()=>{
 const {createAuthenticatedControllerClient}=await import('../../../src/runtime/verification/controller-client.js');
 const {encodeControllerResponse}=await import('../../../src/runtime/verification/controller-response.js');
 const {createOwnerEnrollmentClient}=await import('../../../src/runtime/verification/completion-client.js');
 const f=fixture(),keys=generateKeyPairSync('ed25519');
 const client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTripSync(){throw Error('no sync mutation');},async roundTrip(bytes){
  const r=JSON.parse(bytes.toString());const result=r.method==='controller.identity'?{serviceEpoch:'epoch',requestTicket:'a'.repeat(64)}:await f.composition.public.invoke(r.method,r.payload,peer);
  return encodeControllerResponse({domain:'xiaok.controller.response.v1',authorityId:'authority',serviceEpoch:'epoch',nonce:r.nonce,method:r.method,requestHash:r.requestHash,result},keys.privateKey);
 }});
 try{
  const recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result.txt',sha256:H,structure:'utf8' as const}]};
  const request={requestId:'signed-request',enrollment:{ownerKind:'task' as const,ownerId:'task',invocations:[{sessionIdentity:'s',compoundOperationId:'o',validationInvocationId:'v'}]},registration:{migrationEpoch:1,obligations:[{obligation:{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:hash(json(recipe)),requiredCheckIds:['content']},recipe}],source:{kind:'new-owner' as const}}};
  const enrollment=createOwnerEnrollmentClient(client.completionTransport),first=await enrollment.prepareRequest(request);
  expect((await enrollment.lookupRequest(request)).state).toBe('mapped');
  expect((await enrollment.recoverRequest(request)).state).toBe('not_approved');
  await expect(enrollment.authorize(first.challenge)).rejects.toThrow(/consumed/);
  const next=await enrollment.prepareRequest({...request,requestId:'signed-retry'}),result=await enrollment.authorize(next.challenge);
  expect((await enrollment.recoverRequest({...request,requestId:'signed-retry'}))).toMatchObject({state:'committed',owner:result.owner});
 }finally{client.dispose();f.close();}
});
