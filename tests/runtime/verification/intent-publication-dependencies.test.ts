import '../../support/installed-controller-fixture.js';
import {it,expect,vi} from 'vitest';
const installed=vi.hoisted(()=>({factory:undefined as any,route:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',async original=>({...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(),createInstalledVerificationClient:()=>installed.factory()}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>installed.route(owner)}));
import {createHash,generateKeyPairSync} from 'node:crypto';
import {join} from 'node:path';
import {Session as InspectorSession} from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {goalVerificationRegistration} from '../../../src/runtime/goal/verification-definition.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {canonicalVerificationJson as json,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex'),signal=()=>new AbortController().signal;
async function fixture(afterQuery?:()=>void,options:Parameters<typeof verifiedOperationFixture>[1]={},large=false){
 const f=await verifiedOperationFixture('dispatch',large?{...options,controllerMetadataMinimumBytes:96*1024**2}:options),raw=structuredClone(intentApplicationCandidate()),recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes' as const}]},definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe}]};
 raw.contract.verification=definition;for(const stage of raw.contract.stages)stage.verification=definition;
 if(large){const sample=structuredClone(raw.contract.stages[0]);raw.contract.stages=[];for(let i=0;;i++){const stage={...structuredClone(sample),stageId:`s${i}`,order:i,label:'stage',deliverable:'result',templateId:'template',dependsOnStageIds:[],steps:[{...sample.steps[0],stepId:`p${i}`,key:'main',order:0,skillName:null,dependsOn:[]}]};raw.contract.stages.push(stage);if(Buffer.byteLength(json(raw.contract))>61000){raw.contract.stages.pop();break;}}}
 const contract=raw.contract,subjects=[...contract.stages.map((s:any)=>({...raw.subject,stageId:s.stageId})),{...raw.subject,stageId:null}],owners:any[]=[];
 for(const subject of subjects){const prepared:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract},invocations:[]},registration:goalVerificationRegistration(definition)},f.peer);const actual:any=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.peer);owners.push(actual.owner);if(large)await new Promise<void>(resolve=>setImmediate(resolve));}
 const receiver=await loopPublicationReceiver(f,{afterQuery}),bindings:any[]=[];
 const profile=large&&process.env.SOLPI_INTENT_PROFILE==='1'?new InspectorSession():undefined;
 const post=(method:string)=>new Promise<any>((resolve,reject)=>profile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));
 if(profile){profile.connect();await post('Profiler.enable');await new Promise<void>((resolve,reject)=>profile.post('Profiler.setSamplingInterval',{interval:10000},error=>error?reject(error):resolve()));console.info('population-profile-sampling-interval-us 10000');await post('Profiler.start');console.info('population-profile-start native-subjects='+subjects.length);}
 const started=Date.now();
 try{
  for(let i=0;i<contract.stages.length;i++){
   const stage=contract.stages[i],subject=subjects[i],binding=createIntentApplicationBinding({...raw,subject,candidateId:`candidate-${i}`,body:{kind:'intent-stage',stageId:stage.stageId,summary:'actual result',executionReports:[],artifacts:[]}});bindings.push(binding);
   const phase=(name:string)=>{if(large)console.info('population-stage-phase '+i+' '+name+' elapsedMs='+(Date.now()-started));};phase('application');
   const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
   try{const prepared=application.prepare({requestSource:'user',binding},f.peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},f.peer,signal());}finally{application.close();}
   phase('invocation');const invocation={sessionIdentity:contract.sessionId,compoundOperationId:`stage-${i}`,validationInvocationId:`verification-${i}`};
   const add:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:goalVerificationRegistration(definition)},f.peer);await f.composition.public.invoke('completion.authorize-owner',{challengeId:add.challengeId},f.peer);
   phase('materials-prepare');const selected=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal());phase('materials-authorize');const grant=await f.material.authorize(selected.challengeId,f.peer,signal());phase('materials-stage');const staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal());
   phase('verification-prepare');const operation=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal());phase('verification-dispatch');await f.operations.dispatch({operationHandle:operation.operationHandle},f.peer,signal());
   phase('publication');const pub=receiver.publication.prepare({...intentHostSubjectOwner(subject),requestSource:'user'},f.peer);await receiver.publication.approve({challengeId:pub.challengeId},f.peer,signal());
   if(large&&!profile){console.info('population-actual-publication '+(i+1)+'/'+contract.stages.length+' elapsedMs='+(Date.now()-started));await new Promise<void>(resolve=>setImmediate(resolve));}
   if(profile){console.info('population-publication-ms '+i+' '+(Date.now()-started));if(i===2){const result=await post('Profiler.stop');writeFileSync('/tmp/solpi-intent-population.cpuprofile',JSON.stringify(result.profile));profile.disconnect();throw Error('explicit_profile_stopped_after_three_actual_publications');}}
  }
 }catch(error){if(profile){try{const result=await post('Profiler.stop');writeFileSync('/tmp/solpi-intent-population-failure.cpuprofile',JSON.stringify(result.profile));profile.disconnect();}catch{/* Preserve the original entry failure if the profiler was already stopped. */}}await receiver.close();await f.close();throw error;}
 return {f,receiver,subjects,owners,bindings,contract,async close(){await receiver.close();await f.close();}};
}
it('actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts',async()=>{
 const f=await fixture();try{
  const observe=(subject:any)=>(f.receiver.publication as any).observeIntentDependencies({subject},f.f.peer,signal());
  const first=await observe(f.subjects[0]);expect(first.publications).toEqual([]);expect(first.subject).toEqual(f.subjects[0]);
  const next=await observe(f.subjects[1]);expect(next.publications.map((p:any)=>p.owner)).toEqual([f.owners[0]]);
  const parent=await observe(f.subjects.at(-1));expect(parent.publications.map((p:any)=>p.owner)).toEqual(f.owners.slice(0,-1));expect(parent.clock.domainId).toBe('clock');expect(f.receiver.approvals).toBe(2);
  f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(json(f.owners.at(-1)));
  await expect(observe(f.subjects[0])).rejects.toThrow();
 }finally{await f.close();}
},45000);
it('late expiration of an earlier dependency cannot be spliced into an otherwise-current parent set',async()=>{
 let ready=false,queries=0,expire:()=>void=()=>{};const f=await fixture(()=>{if(ready&&++queries===2)expire();});try{expire=()=>f.f.setTime(10000);ready=true;await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);}finally{await f.close();}
},40000);
it('foreign subject and caller-selected inventory cannot redefine original native dependencies',async()=>{
 const f=await fixture();try{for(const query of [{subject:{...f.subjects.at(-1),sessionId:'foreign'}},{subject:f.subjects.at(-1),owners:[f.owners[0]]}])await expect((f.receiver.publication as any).observeIntentDependencies(query,f.f.peer,signal())).rejects.toThrow();expect(f.f.database.prepare('SELECT count(*) n FROM verification_owner_dependencies').get()).toEqual({n:3});}finally{await f.close();}
},40000);

it('final whole-set check rejects a dependency application entering pending during the last receiver query',async()=>{
 let ready=false,queries=0,change:()=>void=()=>{};const f=await fixture(()=>{if(ready&&++queries===2)change();});try{
  change=()=>{const before=f.f.composition.privateHost.authorityHost.inspectApplication(f.owners[0]).current!;const old=structuredClone(f.bindings[0]);const {contractHash:_,candidatePayloadHash:__,...raw}=old;const binding=createIntentApplicationBinding({...raw,candidateId:'replacement',candidateRevision:2});f.f.composition.privateHost.authorityHost.beginApplicationTransition({owner:f.owners[0],transitionId:'late-transition',previousBindingHash:before.bindingHash,binding,registrationHash:'a'.repeat(64)});};ready=true;
  await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);
 }finally{await f.close();}
},50000);

import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {readCurrentIntentPublicationDependencies} from '../../../src/runtime/intent-delegation/published-dependencies.js';
it('actual signed controller routes full original payload pages and last complete dependency observation through fixed reader',async()=>{
 const f=await fixture(),keys=generateKeyPairSync('ed25519'),socketPath=join(f.f.root,'intent-dependencies.sock');let reads=0,sets=0;
 const app=createApplicationBindingAuthority({database:f.f.database,authorityId:'authority',completion:f.f.composition,clock:f.f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(){throw Error('readonly');}});
 const router=createControllerOperationRouting({publication:f.receiver.publication,verification:f.f.operations,completion:f.f.composition.public,execution:{async invoke(){throw Error('readonly');}},assertCurrent(){},async renew(){}}),appRouter=createControllerApplicationRouting({application:app,assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[f.f.peer.uid],acceptPeer:()=>f.f.peer,invoke(method,payload,peer,signal){if(method==='publication.readOwnerPayload')reads++;if(method==='publication.observeIntentDependencies')sets++;return method.startsWith('application.')?appRouter.invoke(method,payload,peer,signal):router.invoke(method,payload,peer,signal);}});
 installed.factory=()=>createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:bytes=>callControllerIpc(socketPath,bytes,{timeoutMs:300000}),roundTripSync(){throw Error('unused');}});
 installed.route=(owner:any)=>({kind:'protected-unregistered',authorityId:'authority',owner:{...owner,profileId:f.owners[0].profileId}});
 try{const result=await readCurrentIntentPublicationDependencies(f.subjects.at(-1));expect(result.publications.map(p=>p.owner)).toEqual(f.owners.slice(0,-1));expect(reads).toBe(2);expect(sets).toBe(1);expect(f.receiver.approvals).toBe(2);for(const p of result.publications)expect(JSON.parse(p.bytes.toString()).application).toEqual(p.application);}finally{installed.factory=installed.route=undefined;await server.close();app.close();await f.close();}
},75000);

it('no qualified callback occurs after the final qualified authority clock in the dependency result',async()=>{
 let armed=false,reading=false,clocks=0,tails=0;
 const f=await fixture(undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2)armed=true;}},onAuthorityQualified(){if(armed){tails++;throw Error('qualified_callback_after_final_clock');}}});
 try{reading=true;const result=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());expect(result.publications).toHaveLength(2);expect(clocks).toBe(2);expect(tails).toBe(0);}finally{armed=false;reading=false;await f.close();}
},40000);

for(const row of ['expire','close'] as const)
 it.each([row])('final authority clock %s still fences the result without a wrapper callback',async mode=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationDependencies'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await f.close();}
},row==="expire"?45000:row==="close"?40000:30000);

// Explicit extended acceptance: the original 99-stage pre-publication chain exceeded
// 600s on 2026-09-27. Kept intact, not counted in routine component PASS.
it.runIf(process.env.SOLPI_INTENT_POPULATION === '1')('near-limit original contract retains its whole stage population through actual signed set RPC',async()=>{
 const f=await fixture(undefined,{},true),keys=generateKeyPairSync('ed25519'),socketPath=join(f.f.root,'intent-large-set.sock');let responseBytes=0;
 const router=createControllerOperationRouting({publication:f.receiver.publication,verification:f.f.operations,completion:f.f.composition.public,execution:{async invoke(){throw Error('readonly');}},assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[f.f.peer.uid],acceptPeer:()=>f.f.peer,invoke:(...args)=>router.invoke(...args)}),client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(bytes){const reply=await callControllerIpc(socketPath,bytes,{timeoutMs:300000});responseBytes=Math.max(responseBytes,reply.length);return reply;},roundTripSync(){throw Error('unused');}});
 const finalProfile=process.env.SOLPI_INTENT_FINAL_PROFILE==='1'?new InspectorSession():undefined;const finalPost=(method:string)=>new Promise<any>((resolve,reject)=>finalProfile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));if(finalProfile){finalProfile.connect();await finalPost('Profiler.enable');await finalPost('Profiler.start');console.info('population-final-set-start');}const finalStarted=Date.now();
 try{expect(Buffer.byteLength(json(f.contract))).toBeGreaterThan(60000);expect(f.contract.stages.length).toBeGreaterThan(80);const result:any=await client.publicationTransport.call('publication.observeIntentDependencies',{subject:f.subjects.at(-1)});expect(result.publications.map((v:any)=>v.owner)).toEqual(f.owners.slice(0,-1));expect(responseBytes).toBeLessThan(1024**2);console.info(JSON.stringify({contractBytes:Buffer.byteLength(json(f.contract)),stageCount:f.contract.stages.length,responseBytes}));}finally{console.info('population-final-set-ms '+(Date.now()-finalStarted));if(finalProfile){const result=await finalPost('Profiler.stop');writeFileSync('/tmp/solpi-intent-final-set.cpuprofile',JSON.stringify(result.profile));finalProfile.disconnect();}client.dispose();await server.close();await f.close();}
},3600000);
for(const row of ['noncanonical','subject','mandatory','registration'] as const)
 it.each([row])('whole graph read refuses actual sibling %s drift even for empty dependencies',async mode=>{
 const f=await fixture();try{
  const key=json(f.owners[1]),row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(key) as {logical_owner_key:string;contract_json:string};
  if(mode==='mandatory')f.f.database.prepare('DELETE FROM mandatory_observation_checks WHERE owner_key=?').run(key);
  else if(mode==='registration')f.f.database.prepare('UPDATE verification_owners SET migration_epoch=migration_epoch+1 WHERE owner_key=?').run(key);
  else {const value=JSON.parse(row.contract_json);if(mode==='subject')value.subject.stageId=f.subjects[0].stageId;const encoded=mode==='noncanonical'?JSON.stringify(value,null,1):json(value);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(encoded,key);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(encoded,row.logical_owner_key);}
  await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects[0]},f.f.peer,signal())).rejects.toThrow();
 }finally{await f.close();}
},row==="noncanonical"?40000:row==="subject"?40000:row==="mandatory"?40000:30000);
for(const row of ['valid','missing-parent','missing-sibling-edge','extra-edge','parent-noncanonical'] as const)
 it.each([row])('actual invocation-only append retains complete parent graph: %s',async mode=>{
 const f=await fixture();try{
  const parent=json(f.owners.at(-1)),sibling=json(f.owners[1]);
  if(mode==='missing-parent')f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(parent);
  if(mode==='missing-sibling-edge')f.f.database.prepare('DELETE FROM verification_owner_dependencies WHERE parent_key=? AND child_key=?').run(parent,sibling);
  if(mode==='extra-edge')f.f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES (?,?)').run(json(f.owners[0]),sibling);
  if(mode==='parent-noncanonical'){const row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(parent) as any,body=JSON.stringify(JSON.parse(row.contract_json),null,1);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(body,parent);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(body,row.logical_owner_key);}
  const invocation={sessionIdentity:f.contract.sessionId,compoundOperationId:'real-extra',validationInvocationId:'real-extra-validation'},proposal={enrollment:{...intentHostSubjectOwner(f.subjects[0]),invocations:[invocation]},registration:goalVerificationRegistration(f.contract.stages[0].verification)};
  const work=async()=>{const prepared:any=await f.f.composition.public.invoke('completion.prepare-owner',proposal,f.f.peer);return f.f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.f.peer);};
  if(mode==='valid'){await work();expect(f.f.composition.privateHost.enrollment.resolveOwnerKey(f.f.peer,invocation)).toBe(json(f.owners[0]));}else await expect(work()).rejects.toThrow();
 }finally{await f.close();}
},row==="valid"?40000:row==="missing-parent"?40000:30000);

it('completion observation includes its own actual publication and every original dependency without publishing the parent implicitly',async()=>{
 const f=await fixture();try{
  const first=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[0]},f.f.peer,signal());expect(first.scope).toBe('self-and-dependencies');expect(first.publications.map(p=>p.owner)).toEqual([f.owners[0]]);
  const second=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal());expect(second.publications.map(p=>p.owner)).toEqual([f.owners[1],f.owners[0]]);
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1],owners:[f.owners[1]]},f.f.peer,signal())).rejects.toThrow('publication_operation_shape');
 }finally{await f.close();}
},45000);
for(const row of ['expire','close'] as const)
 it.each([row])('completion observation final clock %s rejects the entire self and dependency set',async mode=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationCompletion')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationCompletion'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await f.close();}
},row==="expire"?45000:row==="close"?40000:30000);

it('parent completion final set rejects old native-approved child publication references after a same-proof child republishes',async()=>{
 const f=await fixture();try{
  const refs=f.contract.stages.map((stage:any,i:number)=>{const owner=f.owners[i],row=f.f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE owner_key=?').get(json(owner)) as {tuple_json:string},tuple=JSON.parse(row.tuple_json);return {subject:f.subjects[i],candidateId:f.bindings[i].candidateId,candidateRevision:1,bindingHash:intentApplicationBindingHash(f.bindings[i]),immutablePayloadHash:tuple.immutablePayloadHash,operationId:tuple.operationId,fullTupleHash:hashVerificationTuple(tuple),committedBusinessRevision:tuple.expectedBusinessRevision+1,receiverId:tuple.receiverId,receiverProtocolVersion:tuple.receiverProtocolVersion,receiverInstanceEpoch:tuple.receiverInstanceEpoch};});
  const subject=f.subjects.at(-1)!,owner=f.owners.at(-1)!,binding=createIntentApplicationBinding({version:1,kind:'intent',subject,candidateId:'actual-parent',candidateRevision:1,contract:f.contract,body:{kind:'intent-parent',summary:'actual complete result',stages:refs,artifacts:[]}});
  const application=createApplicationBindingAuthority({database:f.f.database,authorityId:'authority',completion:f.f.composition,clock:f.f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.f.peer.uid,auditSessionId:f.f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
  try{const prepared=application.prepare({requestSource:'user',binding},f.f.peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},f.f.peer,signal());}finally{application.close();}
  const invocation={sessionIdentity:f.contract.sessionId,compoundOperationId:'parent-operation',validationInvocationId:'parent-verification'};
  const enrollment:any=await f.f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:goalVerificationRegistration(f.contract.verification)},f.f.peer);await f.f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},f.f.peer);
  const selected=await f.f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.f.peer,signal()),grant=await f.f.material.authorize(selected.challengeId,f.f.peer,signal()),staged=await f.f.material.stage({grantHandle:grant,invocation},f.f.peer,signal());
  const operation=await f.f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.f.peer,signal());await f.f.operations.dispatch({operationHandle:operation.operationHandle},f.f.peer,signal());
  const parent=f.receiver.publication.prepare({...intentHostSubjectOwner(subject),requestSource:'user'},f.f.peer);await f.receiver.publication.approve({challengeId:parent.challengeId},f.f.peer,signal());
  expect((await f.receiver.publication.observeIntentCompletion({subject},f.f.peer,signal())).publications).toHaveLength(3);
  const second=f.receiver.publication.prepare({...intentHostSubjectOwner(f.subjects[0]),requestSource:'user'},f.f.peer);await f.receiver.publication.approve({challengeId:second.challengeId},f.f.peer,signal());
  expect(f.f.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).toBe('valid');
  await expect(f.receiver.publication.observeIntentCompletion({subject},f.f.peer,signal())).rejects.toThrow();
 }finally{await f.close();}
},105000);

it('the original final dependency set carries actual receiver identity for parent capture',async()=>{
 const f=await fixture();try{const observed=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());
  for(const p of observed.publications){const row=f.f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=?').get(p.operationId) as {tuple_json:string},tuple=JSON.parse(row.tuple_json);expect(p).toMatchObject({receiverId:tuple.receiverId,receiverProtocolVersion:tuple.receiverProtocolVersion,receiverInstanceEpoch:tuple.receiverInstanceEpoch});expect(p.fullTupleHash).toBe(hashVerificationTuple(tuple));}
 }finally{await f.close();}
},40000);
