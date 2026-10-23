import {afterEach,expect,it} from 'vitest';import {createHash,generateKeyPairSync} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createVerificationAuthority,type VerificationOwner} from '../../../src/runtime/verification/proof-authority.js';
import {createReceiverReplySigner,createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {createIndependentVerifierRecipes} from '../../../src/runtime/verification/independent-recipes.js';
import {createVerifiedPublicationPayloads} from '../../../src/runtime/verification/verified-publication-payload.js';
import {canonicalVerificationJson as json,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
const H='a'.repeat(64),hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex'),cleanup:(()=>void)[]=[];afterEach(()=>{for(const close of cleanup.splice(0).reverse())close();});
async function fixture(parentChange?:(raw:any)=>void,stageSummary='原结果'){
 const root=mkdtempSync(join(tmpdir(),'intent-parent-')),database=openPrivateVerificationDatabase(root),keys=generateKeyPairSync('ed25519'),receipt=Object.freeze({}),body=Buffer.from('原文');let now=1000,onCurrent:(()=>void)|undefined,onInspect:((owner:VerificationOwner)=>void)|undefined;
 const verifier=createReceiverReplyVerifier({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,publicKey:keys.publicKey}),signer=createReceiverReplySigner({keyId:'receiver',receiverId:'receiver',receiverInstanceEpoch:1,privateKey:keys.privateKey}),clock=()=>({domainId:'clock',qualificationEpoch:1,lowerBound:now,upperBound:now+1,evidenceHash:H});
 let payloads:ReturnType<typeof createVerifiedPublicationPayloads>;
 const authority=createVerificationAuthority({root,database,receiverVerifier:verifier,issuerId:'authority',verifierHash:H,keyId:'key',serviceEpoch:'boot',privateKey:keys.privateKey,clock,assertQualified(){},assertVerifiedPayload:t=>payloads.assertTuple(t),quiescence:{assertQuiescent:r=>{if(r!==receipt)throw Error('physical');}}});
 const recipes=createIndependentVerifierRecipes({verifierHash:H,assertCurrent(){},quiescence:{assertQuiescent(){}},assertFailedRunComplete(){throw Error('unused');},async readArtifact(){return body;},async readFailedRun(){throw Error('unused');},async runBlackbox(){throw Error('unused');}});
 const raw=intentApplicationCandidate(true),contract=raw.contract,subjects=[...contract.stages.map((s:any)=>({...raw.subject,stageId:s.stageId})),raw.subject],owners=subjects.map(subject=>({profileId:'profile',...intentHostSubjectOwner(subject)}));
 const issue=(owner:VerificationOwner,method:string,payload:unknown)=>({requestSource:'user' as const,authorization:authority.host.issueAuthorization({owner,method,payload,requestSource:'user',principalId:'actual-user',expiresAt:4000})});
 const plan=recipes.compile(contract.verification.obligations[0].recipe);
 for(const owner of owners){const registration={owner,migrationEpoch:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,definitionHash:plan.definitionHash,requiredCheckIds:plan.requiredCheckIds}]};authority.service.registerObligations(registration,issue(owner,'registerObligations',registration));}
 for(let i=0;i<owners.length;i++){const ids=i===owners.length-1?contract.stages.map((s:any)=>s.stageId):contract.stages[i].dependsOnStageIds;for(const id of ids){const edge={owner:owners[i],child:owners[contract.stages.findIndex((s:any)=>s.stageId===id)]};authority.service.registerOwnerDependency(edge,issue(owners[i],'registerOwnerDependency',edge));}}
 payloads=createVerifiedPublicationPayloads({database,recipes,getCurrentDependencies:authority.service.getCurrentDependencies.bind(authority.service),assertCurrent(){onCurrent?.();},inspectOwner(owner:VerificationOwner){const value=authority.service.inspectOwner(owner);onInspect?.(owner);return value;},assertPublicationTuplesCurrent:authority.host.assertPublicationTuplesCurrent.bind(authority.host)} as any);
 cleanup.push(()=>{authority.service.close();database.close();rmSync(root,{recursive:true,force:true});});
 const evaluations:any[]=[],tuples:any[]=[],refs:any[]=[],originalParentArtifacts:any[]=[];
 async function evaluate(i:number,binding:ReturnType<typeof createIntentApplicationBinding>){const owner=owners[i];authority.host.beginApplicationTransition({owner,transitionId:`application-${i}`,previousBindingHash:null,binding,registrationHash:H});authority.host.finishApplicationTransition(owner,`application-${i}`,()=>{});
 const subject=authority.host.registerSubject({owner,requiredScopeId:`scope-${i}`,scopeRevision:1,scopeExpiresAt:4000,manifest:[{path:'result.md',sha256:hash(body),size:body.length,role:'source'}]}),request={owner,obligationId:'original',expectedAttemptEpoch:0,sourceRunId:`run-${i}`,runNonce:`nonce-${i}`,...subject,requiredScopeId:`scope-${i}`,scopeRevision:1};const attempt=authority.service.requestVerification(request,issue(owner,'requestVerification',request)),expected={sessionIdentity:'actual-session',compoundOperationId:`operation-${i}`,validationInvocationId:`invocation-${i}`,executionIdentity:`execution-${i}`,scopeDigest:H};authority.host.bindExecution(attempt.attemptId,expected);
 const evaluation=await recipes.evaluate(plan,{attemptId:attempt.attemptId,subjectId:subject.subjectId,runNonce:`nonce-${i}`,expected});authority.host.recordControllerResult(attempt.attemptId,{coreId:`core-${i}`,coreFinalRevision:1,exitCode:0,quiescent:true,outputHashes:[hash(body)]},{...evaluation,validUntil:3000},receipt as never);evaluations.push(evaluation);return evaluation;}
 for(let i=0;i<contract.stages.length;i++){const stageRaw=intentApplicationCandidate();stageRaw.subject=subjects[i];stageRaw.candidateId=`candidate-${i}`;stageRaw.body.stageId=subjects[i].stageId;stageRaw.body.executionReports=[];stageRaw.body.summary=stageSummary;stageRaw.body.artifacts=stageRaw.body.artifacts.map((a:any)=>({...a,stageId:subjects[i].stageId}));const binding=createIntentApplicationBinding(stageRaw);originalParentArtifacts.push(...binding.body.artifacts.map(a=>({...a,selection:a.selection.kind==='local'?{...a.selection,kind:'inherited',originOwner:owners[i],originalObligationId:a.selection.obligationId}:a.selection})));await evaluate(i,binding);
 const deps=authority.service.getCurrentDependencies(owners[i]);
 // Actual evaluation exposes the same attempt identifier in its private export.
 const actual=evaluations.filter(e=>deps.some(d=>d.activeAttemptId===recipes.exportVerifiedArtifacts(e).binding.attemptId));
 const payload=payloads.stage({owner:owners[i],evaluations:actual}),state=authority.service.inspectOwner(owners[i])!;
 const tuple={schemaVersion:1 as const,...owners[i],migrationEpoch:1,expectedBusinessRevision:state.businessRevision,obligationSetRevision:state.obligationSetRevision,obligationSetHash:state.obligationSetHash,obligations:deps,operationId:`publication-${i}`,immutablePayloadHash:payload.immutablePayloadHash,receiverId:'receiver',receiverProtocolVersion:1 as const,receiverInstanceEpoch:1,reservationId:`reservation-${i}`,nonce:`publication-nonce-${i}`,notBefore:1000,validUntil:2800,clockDomainId:'clock',clockQualificationEpoch:1};authority.service.prepareSettlement(tuple,issue(owners[i],'prepareSettlement',{owner:owners[i],tuple}));authority.service.authorizePublication(tuple,issue(owners[i],'authorizePublication',{owner:owners[i],tuple}));
 const request=authority.host.issueReceiverChallenge(tuple),reply=signer.sign(request,{status:'committed',fullTupleHash:request.fullTupleHash,objectRevision:1,terminalRecordHash:H,clock:clock()});authority.host.acceptReceiverReply(tuple,verifier.verify(reply,request));tuples.push(tuple);
 refs.push({subject:subjects[i],candidateId:binding.candidateId,candidateRevision:1,bindingHash:intentApplicationBindingHash(binding),immutablePayloadHash:payload.immutablePayloadHash,operationId:tuple.operationId,fullTupleHash:hashVerificationTuple(tuple),committedBusinessRevision:state.businessRevision+1,receiverId:'receiver',receiverProtocolVersion:1,receiverInstanceEpoch:1});}
 raw.body.stages=refs;raw.body.artifacts=originalParentArtifacts;parentChange?.(raw);await evaluate(owners.length-1,createIntentApplicationBinding(raw));
 return {database,authority,payloads,owner:owners.at(-1)!,evaluations,tuples,refs,expire(){now=3500;},tupleExpires(){now=2800;},setCurrent(h:typeof onCurrent){onCurrent=h;},setInspect(h:typeof onInspect){onInspect=h;}};
}
it('stages the parent only with exact committed current stage publications and complete inherited bytes',async()=>{const f=await fixture();const staged=f.payloads.stage({owner:f.owner,evaluations:f.evaluations});expect(JSON.parse(f.payloads.read(staged.payloadId,f.owner).toString()).evaluations).toHaveLength(3);});
it('rejects a validly shaped but false parent stage publication reference',async()=>{const f=await fixture(raw=>raw.body.stages[0].immutablePayloadHash='f'.repeat(64));expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();});
it('does not mistake a new receiver query challenge for a changed historical commit',async()=>{const f=await fixture();f.authority.host.issueReceiverChallenge(f.tuples[0]);expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).not.toThrow();});
it('refuses a parent after a durable child receiver fact is absent',async()=>{const f=await fixture();f.database.prepare('DELETE FROM publication_journal WHERE operation_id=?').run(f.tuples[0].operationId);expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();});
it('rolls back parent payload when an INSERT trigger alters a referenced stage commit',async()=>{
 const f=await fixture();f.database.exec(`CREATE TRIGGER corrupt_child_after_parent AFTER INSERT ON verified_publication_payloads WHEN NEW.owner_key='${json(f.owner)}' BEGIN DELETE FROM publication_journal WHERE operation_id='${f.tuples[0].operationId}'; END`);
 expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();
 expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads WHERE owner_key=?').get(json(f.owner))).toEqual({n:0});
 expect(f.database.prepare('SELECT operation_id FROM publication_journal WHERE operation_id=?').get(f.tuples[0].operationId)).toBeDefined();
});
it('stored parent reads and detached capture current checks reject a removed child receipt',async()=>{
 const f=await fixture(),staged=f.payloads.stage({owner:f.owner,evaluations:f.evaluations}),captured=f.payloads.capture(staged.payloadId,f.owner);
 f.database.prepare('DELETE FROM publication_journal WHERE operation_id=?').run(f.tuples[0].operationId);
 expect(()=>f.payloads.read(staged.payloadId,f.owner)).toThrow();expect(()=>captured.readBytes()).toThrow();expect(()=>captured.assertCurrent()).toThrow();
});
it('checks the actual child current revision and proof lifetime rather than durable committed alone',async()=>{
 const f=await fixture();f.expire();expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();
});
it.each(['clock','terminalRecordHash'])('rejects a malformed durable authenticated reply field: %s',async field=>{
 const f=await fixture(),row=f.database.prepare('SELECT reply_json FROM publication_journal WHERE operation_id=?').get(f.tuples[0].operationId) as {reply_json:string},reply=JSON.parse(row.reply_json);
 if(field==='clock')reply.result.clock.domainId='foreign-clock';else reply.result.terminalRecordHash='not-a-hash';
 f.database.prepare('UPDATE publication_journal SET reply_json=? WHERE operation_id=?').run(json(reply),f.tuples[0].operationId);
 expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();
});

it('rejects an expired publication tuple while its original proof and scope remain valid',async()=>{const f=await fixture();f.tupleExpires();expect(f.authority.service.inspectOwner(f.owner)?.currentVerification).toBe('valid');expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();});
it('the first payload current callback cannot replace the parent own baseline',async()=>{const f=await fixture();let fired=false;f.setCurrent(()=>{if(!fired){fired=true;f.database.prepare('UPDATE verification_owners SET business_revision=business_revision+100 WHERE owner_key=?').run(json(f.owner));}});expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();});

it('rejects tuple expiry during the final child owner callback while proof remains valid',async()=>{const f=await fixture();f.setInspect(owner=>{if(owner.ownerId===f.tuples.at(-1).ownerId)f.tupleExpires();});expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow();});

it.each(['label','summary','createdAt','artifactId','file-location','omit','extra','reorder'])('rejects changed original child artifact descriptors before parent publication: %s',async change=>{
 const f=await fixture(raw=>{const artifact=raw.body.artifacts[0];
  if(change==='label')artifact.label='changed original label';
  else if(change==='summary')artifact.summary='changed original summary';
  else if(change==='createdAt')artifact.createdAt++;
  else if(change==='artifactId')artifact.artifactId='changed-original-id';
  else if(change==='file-location')artifact.content={kind:'file',originalPath:'other-file.txt'};
  else if(change==='omit')raw.body.artifacts.shift();
  else if(change==='extra')raw.body.artifacts.push({...artifact,artifactId:'extra-original-id'});
  else raw.body.artifacts.reverse();
 });
 expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow('intent_parent_artifacts');
 expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads WHERE owner_key=?').get(json(f.owner))).toEqual({n:0});
});

it('retains original same-named real child artifacts with their distinct stage owners in staged/read/captured parent',async()=>{
 const f=await fixture(),staged=f.payloads.stage({owner:f.owner,evaluations:f.evaluations}),bytes=f.payloads.read(staged.payloadId,f.owner),captured=f.payloads.capture(staged.payloadId,f.owner),body=JSON.parse(bytes.toString());
 expect(captured.readBytes()).toEqual(bytes);captured.assertCurrent();
 expect(body.application.binding.body.artifacts.map((a:any)=>a.artifactId)).toEqual(['original-artifact','original-artifact']);
 expect(body.application.binding.body.artifacts.map((a:any)=>a.stageId)).toEqual(f.refs.map(ref=>ref.subject.stageId));
 expect(body.application.binding.body.artifacts.map((a:any)=>a.selection.originOwner)).toEqual(f.refs.map(ref=>({profileId:'profile',...intentHostSubjectOwner(ref.subject)})));
 expect(body.evaluations).toHaveLength(3);
});


it.each(['originOwner','originalObligationId','sha256','size'])('R8 refuses parser-valid original source/content tampering: %s',async change=>{
 const f=await fixture(raw=>{const artifact=raw.body.artifacts[0];
  if(change==='originOwner')artifact.selection.originOwner=raw.body.artifacts[1].selection.originOwner;
  else if(change==='originalObligationId')artifact.selection.originalObligationId='foreign-original';
  else {artifact.content={kind:'file',originalPath:'result.md'};if(change==='sha256')artifact.sha256='f'.repeat(64);else artifact.size++;}
 });
 const error=change==='originOwner'?'intent_parent_artifacts':change==='originalObligationId'?'intent_application_artifact_not_unique':'intent_application_artifact_content';
 expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow(error);
 expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads WHERE owner_key=?').get(json(f.owner))).toEqual({n:0});
});
it('R8 refuses an artifact-only legal group that cannot fit a legal original child candidate',async()=>{
 const f=await fixture(raw=>{const artifact=raw.body.artifacts[0];artifact.label='';const local={...artifact,selection:{kind:'local',obligationId:artifact.selection.originalObligationId,path:artifact.selection.path}};artifact.label='x'.repeat(50000-Buffer.byteLength(json([local])));
 const stage=intentApplicationCandidate();stage.body.summary='s'.repeat(20000);stage.body.artifacts=[{...artifact,selection:local.selection}];expect(()=>createIntentApplicationBinding(stage)).toThrow('intent_application_limit');
 },'s'.repeat(20000));
 expect(()=>f.payloads.stage({owner:f.owner,evaluations:f.evaluations})).toThrow('intent_parent_artifacts');
 expect(f.database.prepare('SELECT count(*) n FROM verified_publication_payloads WHERE owner_key=?').get(json(f.owner))).toEqual({n:0});
});
