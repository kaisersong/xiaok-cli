import {createLoopApplicationBinding,type LoopApplicationBinding} from '../../../src/runtime/verification/loop-application-binding.js';
import {businessApplicationOwner} from '../../../src/runtime/verification/business-application-binding.js';
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createVerificationAuthority} from '../../../src/runtime/verification/proof-authority.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createIndependentVerifierRecipes} from '../../../src/runtime/verification/independent-recipes.js';
import {createVerifiedPublicationPayloads} from '../../../src/runtime/verification/verified-publication-payload.js';
import {canonicalVerificationJson} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),sha=(x:Buffer|string)=>createHash('sha256').update(x).digest('hex');
const owner={profileId:'profile',ownerKind:'task' as const,ownerId:'task'};
async function fixture(withPayloadGate=true,application?:Readonly<LoopApplicationBinding>){
 const owner=application?{profileId:'profile',...businessApplicationOwner(application)}:{profileId:'profile',ownerKind:'task' as const,ownerId:'task'};
 const root=mkdtempSync(join(tmpdir(),'verified-payload-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),receipt=Object.freeze({});
 const expected={sessionIdentity:'session',compoundOperationId:'operation',validationInvocationId:'invocation',executionIdentity:'execution',scopeDigest:H};
 let live=true;let body:Buffer=Buffer.from('verified artifact');
 const recipes=createIndependentVerifierRecipes({assertFailedRunComplete(){throw Error('protected run not configured');},verifierHash:H,assertCurrent:()=>{if(!live)throw Error('stale');},quiescence:{assertQuiescent:()=>{}},readArtifact:async()=>body,runBlackbox:async()=>{throw Error('unused');},readFailedRun:async()=>{throw Error('unused');}});
 const plan=recipes.compile({kind:'artifact-content',checks:[{id:'content',path:'result.txt',sha256:sha(body),structure:'utf8'}]});
 let store:ReturnType<typeof createVerifiedPublicationPayloads>;
 const authority=createVerificationAuthority({root,database,receiverVerifier:createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),verifierHash:H,issuerId:'issuer',keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock:()=>({domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:H}),assertQualified:()=>{},assertVerifiedPayload:withPayloadGate?(tuple)=>store.assertTuple(tuple):undefined,quiescence:{assertQuiescent:(r)=>{if(r!==receipt)throw Error('physical');}}});
 const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:authority.host.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
 const registration={owner,migrationEpoch:1,obligations:[{obligationId:'obligation',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:plan.definitionHash,requiredCheckIds:plan.requiredCheckIds}]};
 authority.service.registerObligations(registration,issue('registerObligations',registration));
 if(application){authority.host.beginApplicationTransition({owner,transitionId:'loop-binding',previousBindingHash:null,binding:application,registrationHash:H});authority.host.finishApplicationTransition(owner,'loop-binding',()=>{});}
 const subject=authority.host.registerSubject({owner,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'result.txt',sha256:sha(body),size:body.length,role:'source'}]});
 const proposal={owner,obligationId:'obligation',expectedAttemptEpoch:0,sourceRunId:'run',runNonce:'nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
 const attempt=authority.service.requestVerification(proposal,issue('requestVerification',proposal));authority.host.bindExecution(attempt.attemptId,expected);
 const binding={attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:'nonce',expected};
 const evaluation=await recipes.evaluate(plan,binding);
 authority.host.recordControllerResult(attempt.attemptId,{coreId:'core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[sha(body)]},{...evaluation,validUntil:1500},receipt as never);
 const options={database,recipes,getCurrentDependencies:authority.service.getCurrentDependencies.bind(authority.service),assertCurrent:()=>{if(!live)throw Error('stale');}};
 store=createVerifiedPublicationPayloads(options);
 return {root,database,owner,authority,issue,recipes,plan,binding,evaluation,store,options,receipt:receipt as never,setBody:(b:Buffer)=>{body=b;},revoke:()=>{live=false;},close:()=>{authority.service.close();database.close();rmSync(root,{recursive:true,force:true});}};
}
it('exports the original compared evaluations from every graph owner despite identical obligation IDs',async()=>{
 const f=await fixture();try{
  const child={...owner,ownerId:'child'};
  const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:f.authority.host.issueAuthorization({owner:child,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
  const registration={owner:child,migrationEpoch:1,obligations:[{obligationId:'obligation',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:f.plan.definitionHash,requiredCheckIds:f.plan.requiredCheckIds}]};
  f.authority.service.registerObligations(registration,issue('registerObligations',registration));
  const subject=f.authority.host.registerSubject({owner:child,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'result.txt',sha256:sha('verified artifact'),size:17,role:'source'}]});
  const proposal={owner:child,obligationId:'obligation',expectedAttemptEpoch:0,sourceRunId:'child-run',runNonce:'child-nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
  const attempt=f.authority.service.requestVerification(proposal,issue('requestVerification',proposal));
  const expected={...f.binding.expected,executionIdentity:'child-exec',sessionIdentity:'child'};f.authority.host.bindExecution(attempt.attemptId,expected);
  const evaluation=await f.recipes.evaluate(f.plan,{attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:'child-nonce',expected});
  f.authority.host.recordControllerResult(attempt.attemptId,{coreId:'child-core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[sha('verified artifact')]},{...evaluation,validUntil:1500},f.receipt);
  // A valid unrelated evaluation cannot be silently adopted by the parent.
  expect(()=>f.store.stage({owner,evaluations:[evaluation]})).toThrow(/dependency/);
  const edge={owner,child};f.authority.service.registerOwnerDependency(edge,f.issue('registerOwnerDependency',edge));
  expect(()=>f.store.stage({owner,evaluations:[f.evaluation]})).toThrow(/dependency/);
  expect(()=>f.store.stage({owner,evaluations:[f.evaluation,f.evaluation]})).toThrow(/dependency/);
  const payload=f.store.stage({owner,evaluations:[evaluation,f.evaluation]}),envelope=JSON.parse(f.store.read(payload.payloadId,owner).toString());
  expect(envelope.evaluations).toHaveLength(2);expect(envelope.evaluations.find((e:any)=>e.kind==='inherited').originOwner).toEqual(child);
  const state=f.authority.service.inspectOwner(owner)!;
  const tuple={schemaVersion:1 as const,...owner,migrationEpoch:1,expectedBusinessRevision:0,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:f.authority.service.getCurrentDependencies(owner),operationId:'graph-operation',immutablePayloadHash:payload.immutablePayloadHash,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'graph-reservation',nonce:'graph-nonce',notBefore:1000,validUntil:1400,clockDomainId:'clock',clockQualificationEpoch:1};
  f.authority.service.prepareSettlement(tuple,f.issue('prepareSettlement',{owner,tuple}));
 }finally{f.close();}
});
it('stages only exact successful recipe identities and immutable compared bytes with all current dependencies',async()=>{
 const f=await fixture();try{
  const evidence=f.recipes.exportVerifiedArtifacts(f.evaluation);evidence.artifacts[0].bytes.fill(0);
  const payload=f.store.stage({owner,evaluations:[f.evaluation]});
  const bytes=f.store.read(payload.payloadId,owner);expect(sha(bytes)).toBe(payload.immutablePayloadHash);
  const envelope=JSON.parse(bytes.toString());expect(Buffer.from(envelope.evaluations[0].artifacts[0].bytesBase64,'base64').toString()).toBe('verified artifact');
  bytes.fill(0);expect(sha(f.store.read(payload.payloadId,owner))).toBe(payload.immutablePayloadHash);
  expect(()=>f.store.stage({owner,evaluations:[JSON.parse(JSON.stringify(f.evaluation))]})).toThrow(/identity/);
  expect(()=>f.store.stage({owner,evaluations:[]})).toThrow(/dependency/);
  expect(()=>f.store.stage({owner,evaluations:[f.evaluation,f.evaluation]})).toThrow(/dependency/);
  expect(()=>f.store.read(payload.payloadId,{...owner,ownerId:'foreign'})).toThrow(/owner/);
  f.setBody(Buffer.from('bad'));const failed=await f.recipes.evaluate(f.plan,f.binding);
  expect(()=>f.store.stage({owner,evaluations:[failed]})).toThrow(/failed/);
  f.revoke();expect(()=>f.store.read(payload.payloadId,owner)).toThrow(/stale/);
 }finally{f.close();}
});
it('requires exact stored payload/dependencies and preserves database rollback and restart bytes',async()=>{
 const f=await fixture();try{
  const payload=f.store.stage({owner,evaluations:[f.evaluation]}),state=f.authority.service.inspectOwner(owner)!;
  const tuple={schemaVersion:1 as const,...owner,migrationEpoch:1,expectedBusinessRevision:0,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:f.authority.service.getCurrentDependencies(owner),operationId:'operation',immutablePayloadHash:payload.immutablePayloadHash,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'reservation',nonce:'nonce',notBefore:1000,validUntil:1500,clockDomainId:'clock',clockQualificationEpoch:1};
  expect(()=>f.store.assertTuple(tuple)).toThrow(/transaction/);
  f.database.transaction(()=>f.store.assertTuple(tuple))();
  const bad={...tuple,immutablePayloadHash:H};
  expect(()=>f.authority.service.prepareSettlement(bad,f.issue('prepareSettlement',{owner,tuple:bad}))).toThrow(/publication_payload/);
  expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:0});
  expect(()=>f.database.transaction(()=>f.store.assertTuple({...tuple,immutablePayloadHash:H}))()).toThrow(/payload/);
  expect(()=>f.database.transaction(()=>f.store.assertTuple({...tuple,obligations:[{...tuple.obligations[0],proofId:'forged'}]}))()).toThrow(/dependency/);
  const before=f.database.prepare('SELECT count(*) n FROM verified_publication_payloads').get();
  expect(()=>f.database.transaction(()=>{f.store.stage({owner,evaluations:[f.evaluation]});throw Error('rollback');})()).toThrow('rollback');
  expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads').get()).toEqual(before);
  const restarted=createVerifiedPublicationPayloads(f.options);expect(sha(restarted.read(payload.payloadId,owner))).toBe(payload.immutablePayloadHash);
  f.database.prepare('UPDATE verifier_proofs SET proof_json=?').run(canonicalVerificationJson({bad:true}));
  // Active proof still points to its original exact immutable proof; changing the historical row must be detected.
  expect(()=>f.store.stage({owner,evaluations:[f.evaluation]})).toThrow(/proof/);
 }finally{f.close();}
});

it('the actual authority denies missing composition and commits only the staged verified envelope',async()=>{
 for(const withGate of [false,true]){
  const f=await fixture(withGate);try{
   const payload=f.store.stage({owner,evaluations:[f.evaluation]}),state=f.authority.service.inspectOwner(owner)!;
   const tuple={schemaVersion:1 as const,...owner,migrationEpoch:1,expectedBusinessRevision:0,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:f.authority.service.getCurrentDependencies(owner),operationId:'operation',immutablePayloadHash:payload.immutablePayloadHash,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:'reservation',nonce:'nonce',notBefore:1000,validUntil:1500,clockDomainId:'clock',clockQualificationEpoch:1};
   const settle=()=>f.authority.service.prepareSettlement(tuple,f.issue('prepareSettlement',{owner,tuple}));
   if(!withGate){expect(settle).toThrow(/payload_unavailable/);expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:0});}
   else{settle();f.authority.service.authorizePublication(tuple,f.issue('authorizePublication',{owner,tuple}));expect(f.database.prepare('SELECT count(*) n FROM settlement_decisions').get()).toEqual({n:1});expect(f.authority.service.inspectOwner(owner)?.businessRevision).toBe(1);}
  }finally{f.close();}
 }
});
it('counts stored envelope bytes against the shared 32 MiB payload ceiling before admission',async()=>{
 const f=await fixture();try{
  f.database.prepare('INSERT INTO verified_publication_payloads VALUES(?,?,?,?,zeroblob(?))').run('existing','other-owner',H,'[]',32*1024**2);
  expect(()=>f.store.stage({owner,evaluations:[f.evaluation]})).toThrow(/payload_capacity/);
  expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads').get()).toEqual({n:1});
 }finally{f.close();}
});

it('captures one verified body independently while revalidating current metadata and authority',async()=>{
 const f=await fixture();try{
  const payload=f.store.stage({owner,evaluations:[f.evaluation]});
  const captured=f.store.capture(payload.payloadId,owner),original=captured.readBytes();
  const changed=captured.readBytes();changed.fill(0);expect(captured.readBytes()).toEqual(original);
  f.database.prepare('UPDATE verified_publication_payloads SET payload=? WHERE payload_id=?').run(Buffer.alloc(original.length,120),payload.payloadId);
  captured.assertCurrent();expect(captured.readBytes()).toEqual(original);
  expect(()=>f.store.read(payload.payloadId,owner)).toThrow('publication_payload_corrupt');
  expect(()=>f.store.capture(payload.payloadId,owner)).toThrow('publication_payload_corrupt');
  f.database.prepare('UPDATE verified_publication_payloads SET payload_hash=? WHERE payload_id=?').run(H,payload.payloadId);
  expect(()=>captured.assertCurrent()).toThrow('publication_payload_changed');
  f.revoke();expect(()=>captured.assertCurrent()).toThrow('stale');
 }finally{f.close();}
});
function loopPublicationBinding(digest=sha('verified artifact')){
 return createLoopApplicationBinding({version:1,kind:'loop',subject:{kind:'loop-run',loopId:'artifact-evidence-regression',runId:'loop-run',stage:null},candidateId:'candidate',candidateRevision:1,originalTriggerJson:'{"kind":"manual"}',logicalRunKey:null,contract:{version:1,kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',objective:'Publish report',completionCriterion:'Verify original content'},body:{kind:'builtin-diagnostic',scanner:'artifact-evidence-regression',observedAt:1000,summary:'Original report',nextActionKind:'none',nextActionSummary:null,diagnostic:{kind:'artifact-evidence-regression',scannedOwnerCount:0,openAnomalyCount:0,resolvedAnomalyCount:0,anomalies:[]},artifacts:[{selection:{kind:'local',obligationId:'obligation',path:'result.txt'},sha256:digest,size:17}]}});
}
it('publishes the exact Loop candidate, contract and actual verified artifact bytes under the attempt application',async()=>{
 const application=loopPublicationBinding(),f=await fixture(true,application);try{
  const staged=f.store.stage({owner:f.owner,evaluations:[f.evaluation]}),bytes=f.store.read(staged.payloadId,f.owner),body=JSON.parse(bytes.toString());
  expect(body.application).toMatchObject({binding:application});expect(body.evaluations[0].application).toEqual(body.application);
  const {readPublishedArtifact}=await import('../../../src/runtime/verification/published-artifact-reader.js');
  const decoded=readPublishedArtifact({owner:f.owner,businessRevision:1,operationId:'publication',fullTupleHash:H,payloadHash:staged.immutablePayloadHash,bytes},application.body.artifacts[0].selection);
  expect(decoded.bytes.toString()).toBe('verified artifact');
 }finally{f.close();}
});
it('rejects a Loop descriptor whose claimed bytes differ from the actual successful evaluation',async()=>{
 const f=await fixture(true,loopPublicationBinding('b'.repeat(64)));try{
  expect(()=>f.store.stage({owner:f.owner,evaluations:[f.evaluation]})).toThrow(/loop_application_artifact/);
 }finally{f.close();}
});
it('cannot reuse a valid Loop evaluation for a newer candidate application',async()=>{
 const f=await fixture(true,loopPublicationBinding());try{
  const current=f.authority.host.inspectApplication(f.owner),base=loopPublicationBinding();const {triggerHash,contractHash,candidatePayloadHash,...candidate}=base;
  const next=createLoopApplicationBinding({...candidate,candidateId:'later',candidateRevision:2,body:{...candidate.body,summary:'Other candidate'}});
  f.authority.host.beginApplicationTransition({owner:f.owner,transitionId:'later',previousBindingHash:current.current!.bindingHash,binding:next,registrationHash:H});f.authority.host.finishApplicationTransition(f.owner,'later',()=>{});
  expect(()=>f.store.stage({owner:f.owner,evaluations:[f.evaluation]})).toThrow();
 }finally{f.close();}
});

it('independent: actual parent publication preserves inherited Loop declarations and rejects lost/duplicate/corrupt sections',async()=>{
 const f=await fixture(true,loopPublicationBinding());try{
  const child={...owner,ownerId:'parent'};
  const issue=(method:string,payload:unknown)=>({requestSource:'user' as const,authorization:f.authority.host.issueAuthorization({owner:child,method,payload,requestSource:'user',principalId:'user',expiresAt:2000})});
  const registration={owner:child,migrationEpoch:1,obligations:[{obligationId:'obligation',predicateId:'artifact',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:f.plan.definitionHash,requiredCheckIds:f.plan.requiredCheckIds}]};
  f.authority.service.registerObligations(registration,issue('registerObligations',registration));
  const subject=f.authority.host.registerSubject({owner:child,requiredScopeId:'scope',scopeRevision:1,scopeExpiresAt:2000,manifest:[{path:'result.txt',sha256:sha('verified artifact'),size:17,role:'source'}]});
  const proposal={owner:child,obligationId:'obligation',expectedAttemptEpoch:0,sourceRunId:'child-run',runNonce:'child-nonce',...subject,requiredScopeId:'scope',scopeRevision:1};
  const attempt=f.authority.service.requestVerification(proposal,issue('requestVerification',proposal));
  const expected={...f.binding.expected,executionIdentity:'child-exec',sessionIdentity:'child'};f.authority.host.bindExecution(attempt.attemptId,expected);
  const evaluation=await f.recipes.evaluate(f.plan,{attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:'child-nonce',expected});
  f.authority.host.recordControllerResult(attempt.attemptId,{coreId:'child-core',coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[sha('verified artifact')]},{...evaluation,validUntil:1500},f.receipt);

 const edge={owner:child,child:f.owner};f.authority.service.registerOwnerDependency(edge,issue('registerOwnerDependency',edge));
 const staged=f.store.stage({owner:child,evaluations:[evaluation,f.evaluation]}),bytes=f.store.read(staged.payloadId,child);
 const body=JSON.parse(bytes.toString()),inherited=body.evaluations.find((e:any)=>e.kind==='inherited');
 expect(inherited.originOwner).toEqual(f.owner);expect(inherited.application.binding).toEqual(loopPublicationBinding());
 const {readPublishedArtifact}=await import('../../../src/runtime/verification/published-artifact-reader.js');
 const payload={owner:child,businessRevision:1,operationId:'parent-publication',fullTupleHash:H,payloadHash:staged.immutablePayloadHash,bytes};
 const selection={kind:'inherited' as const,obligationId:'obligation',originalObligationId:'obligation',originOwner:f.owner,path:'result.txt'};
 expect(readPublishedArtifact(payload,selection).bytes.toString()).toBe('verified artifact');
 for(const mode of ['missing','duplicate','bytes','foreign-origin']){
 const changed=JSON.parse(bytes.toString()),item=changed.evaluations.find((e:any)=>e.kind==='inherited');
 if(mode==='missing')item.artifacts=[];
 if(mode==='duplicate')changed.evaluations.push(structuredClone(item));
 if(mode==='bytes')item.artifacts[0].bytesBase64=Buffer.from('different bytes!!').toString('base64');
 if(mode==='foreign-origin')item.originOwner={...f.owner,ownerId:'foreign'};
 const encoded=Buffer.from(canonicalVerificationJson(changed));
 expect(()=>readPublishedArtifact({...payload,bytes:encoded,payloadHash:sha(encoded)},selection)).toThrow();
 }
 }finally{f.close();}
});
