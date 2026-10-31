import '../../support/installed-controller-fixture.js';
import {it,expect,vi,type TestContext} from 'vitest';
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
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
type ScenarioLifetime={
 readonly signal:()=>AbortSignal;
 cleanup(close:()=>unknown|Promise<unknown>):Promise<void>;
 after(body:()=>Promise<void>,close:()=>unknown|Promise<unknown>):Promise<void>;
 retainLateFailure(error:unknown):void;
};
function runScenario(ctx:TestContext,body:(signal:()=>AbortSignal,lifetime:ScenarioLifetime)=>Promise<void>){
 const cleanupErrors:unknown[]=[],lateErrors:unknown[]=[];
 const lifetime:ScenarioLifetime={
  signal(){ctx.signal.throwIfAborted();return ctx.signal;},
  async cleanup(close){try{await close();}catch(error){cleanupErrors.push(error);}},
  async after(body,close){
   let failed=false;
   try{await body();}catch(error){failed=true;throw error;}
   finally{try{await close();}catch(error){cleanupErrors.push(error);if(!failed)throw error;}}
  },
  retainLateFailure(error){if(!ctx.signal.aborted||error!==ctx.signal.reason)lateErrors.push(error);},
 };
 const scenarioPromise=(async()=>{
  let bodyFailure:{error:unknown}|undefined;
  try{lifetime.signal();await body(lifetime.signal,lifetime);}catch(error){bodyFailure={error};throw error;}
  finally{const errors=[...lateErrors,...cleanupErrors];if(errors.length)throw new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...errors],'intent_dependency_scenario_cleanup_or_transport_failed');}
 })();
 const settledOutcome=scenarioPromise.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
 ctx.onTestFinished(async()=>{
  const outcome=await settledOutcome;
  if(ctx.signal.aborted&&outcome.failed&&outcome.error!==ctx.signal.reason)throw outcome.error;
 });
 return scenarioPromise;
}
function transportSignal(testSignal:AbortSignal,callerSignal?:AbortSignal){
 const signal=callerSignal===undefined?testSignal:AbortSignal.any([callerSignal,testSignal]);signal.throwIfAborted();return signal;
}
function scenarioInvoke(lifetime:ScenarioLifetime,invoke:Parameters<typeof startPublicController>[0]['invoke']):Parameters<typeof startPublicController>[0]['invoke']{
 return async(method,payload,peer,serverSignal)=>{
  try{const signal=transportSignal(lifetime.signal(),serverSignal);return await invoke(method,payload,peer,signal);}
  catch(error){lifetime.retainLateFailure(error);throw error;}
 };
}
async function fixture(lifetime:ScenarioLifetime,afterQuery?:()=>void,options:Parameters<typeof verifiedOperationFixture>[1]={},large=false){
 const {signal}=lifetime;signal();
 const f=await verifiedOperationFixture('dispatch',options),raw=structuredClone(intentApplicationCandidate()),recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes' as const}]},definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe}]};
 raw.contract.verification=definition;for(const stage of raw.contract.stages)stage.verification=definition;
 if(large){const sample=structuredClone(raw.contract.stages[0]);raw.contract.stages=[];for(let i=0;;i++){const stage={...structuredClone(sample),stageId:`s${i}`,order:i,label:'stage',deliverable:'result',templateId:'template',dependsOnStageIds:[],steps:[{...sample.steps[0],stepId:`p${i}`,key:'main',order:0,skillName:null,dependsOn:[]}]};raw.contract.stages.push(stage);if(Buffer.byteLength(json(raw.contract))>61000){raw.contract.stages.pop();break;}}}
 const contract=raw.contract,subjects=[...contract.stages.map((s:any)=>({...raw.subject,stageId:s.stageId})),{...raw.subject,stageId:null}],owners:any[]=[];
 for(const subject of subjects){const prepared:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract},invocations:[]},registration:goalVerificationRegistration(definition)},f.peer,signal());const actual:any=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.peer,signal());owners.push(actual.owner);if(large)await new Promise<void>(resolve=>setImmediate(resolve));}
 const receiver=await loopPublicationReceiver(f,{afterQuery}),bindings:any[]=[];
 const profile=large&&process.env.SOLPI_INTENT_PROFILE==='1'?new InspectorSession():undefined;
 const post=(method:string)=>new Promise<any>((resolve,reject)=>profile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));
 if(profile){profile.connect();await post('Profiler.enable');await post('Profiler.start');console.info('population-profile-start native-subjects='+subjects.length);}
 let profileStopped=false;
 const started=Date.now();
 try{
  for(let i=0;i<contract.stages.length;i++){
   const stage=contract.stages[i],subject=subjects[i],binding=createIntentApplicationBinding({...raw,subject,candidateId:`candidate-${i}`,body:{kind:'intent-stage',stageId:stage.stageId,summary:'actual result',executionReports:[],artifacts:[]}});bindings.push(binding);
   const phase=(name:string)=>{if(large)console.info('population-stage-phase '+i+' '+name+' elapsedMs='+(Date.now()-started));};phase('application');
   const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
   await lifetime.after(async()=>{signal();const prepared=application.prepare({requestSource:'user',binding},f.peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},f.peer,signal());},()=>application.close());
   phase('invocation');const invocation={sessionIdentity:contract.sessionId,compoundOperationId:`stage-${i}`,validationInvocationId:`verification-${i}`};
   const add:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:goalVerificationRegistration(definition)},f.peer,signal());await f.composition.public.invoke('completion.authorize-owner',{challengeId:add.challengeId},f.peer,signal());
   phase('materials-prepare');const selected=await f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.peer,signal());phase('materials-authorize');const grant=await f.material.authorize(selected.challengeId,f.peer,signal());phase('materials-stage');const staged=await f.material.stage({grantHandle:grant,invocation},f.peer,signal());
   phase('verification-prepare');const operation=await f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.peer,signal());phase('verification-dispatch');await f.operations.dispatch({operationHandle:operation.operationHandle},f.peer,signal());
   phase('publication');signal();const pub=receiver.publication.prepare({...intentHostSubjectOwner(subject),requestSource:'user'},f.peer);await receiver.publication.approve({challengeId:pub.challengeId},f.peer,signal());
   if(large&&!profile){console.info('population-actual-publication '+(i+1)+'/'+contract.stages.length+' elapsedMs='+(Date.now()-started));await new Promise<void>(resolve=>setImmediate(resolve));}
   if(profile){console.info('population-publication-ms '+i+' '+(Date.now()-started));if(i===2){const result=await post('Profiler.stop');profileStopped=true;try{writeFileSync('/tmp/solpi-intent-population.cpuprofile',JSON.stringify(result.profile));}finally{await lifetime.cleanup(()=>profile.disconnect());}throw Error('explicit_profile_stopped_after_three_actual_publications');}}
  }
 }catch(error){if(profile&&!profileStopped){await lifetime.cleanup(async()=>{const result=await post('Profiler.stop');profileStopped=true;writeFileSync('/tmp/solpi-intent-population-failure.cpuprofile',JSON.stringify(result.profile));});await lifetime.cleanup(()=>profile.disconnect());}await lifetime.cleanup(()=>receiver.close());await lifetime.cleanup(()=>f.close());throw error;}
 return {f,receiver,subjects,owners,bindings,contract,async close(){await lifetime.cleanup(()=>receiver.close());await lifetime.cleanup(()=>f.close());}};
}
it('actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const observe=(subject:any)=>(f.receiver.publication as any).observeIntentDependencies({subject},f.f.peer,signal());
  const first=await observe(f.subjects[0]);expect(first.publications).toEqual([]);expect(first.subject).toEqual(f.subjects[0]);
  const next=await observe(f.subjects[1]);expect(next.publications.map((p:any)=>p.owner)).toEqual([f.owners[0]]);
  const parent=await observe(f.subjects.at(-1));expect(parent.publications.map((p:any)=>p.owner)).toEqual(f.owners.slice(0,-1));expect(parent.clock.domainId).toBe('clock');expect(f.receiver.approvals).toBe(2);
  f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(json(f.owners.at(-1)));
  await expect(observe(f.subjects[0])).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}),30000);
it('late expiration of an earlier dependency cannot be spliced into an otherwise-current parent set',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let ready=false,queries=0,expire:()=>void=()=>{};const f=await fixture(lifetime,()=>{if(ready&&++queries===2)expire();});try{expire=()=>f.f.setTime(10000);ready=true;await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);}finally{await lifetime.cleanup(()=>f.close());}
}),30000);
it('foreign subject and caller-selected inventory cannot redefine original native dependencies',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{for(const query of [{subject:{...f.subjects.at(-1),sessionId:'foreign'}},{subject:f.subjects.at(-1),owners:[f.owners[0]]}])await expect((f.receiver.publication as any).observeIntentDependencies(query,f.f.peer,signal())).rejects.toThrow();expect(f.f.database.prepare('SELECT count(*) n FROM verification_owner_dependencies').get()).toEqual({n:3});}finally{await lifetime.cleanup(()=>f.close());}
}),30000);

it('final whole-set check rejects a dependency application entering pending during the last receiver query',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let ready=false,queries=0,change:()=>void=()=>{};const f=await fixture(lifetime,()=>{if(ready&&++queries===2)change();});try{
  change=()=>{const before=f.f.composition.privateHost.authorityHost.inspectApplication(f.owners[0]).current!;const old=structuredClone(f.bindings[0]);const {contractHash:_,candidatePayloadHash:__,...raw}=old;const binding=createIntentApplicationBinding({...raw,candidateId:'replacement',candidateRevision:2});f.f.composition.privateHost.authorityHost.beginApplicationTransition({owner:f.owners[0],transitionId:'late-transition',previousBindingHash:before.bindingHash,binding,registrationHash:'a'.repeat(64)});};ready=true;
  await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);
 }finally{await lifetime.cleanup(()=>f.close());}
}),30000);

import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {readCurrentIntentPublicationDependencies} from '../../../src/runtime/intent-delegation/published-dependencies.js';
it('actual signed controller routes full original payload pages and last complete dependency observation through fixed reader',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime),keys=generateKeyPairSync('ed25519'),socketPath=join(f.f.root,'intent-dependencies.sock');let reads=0,sets=0;
 const app=createApplicationBindingAuthority({database:f.f.database,authorityId:'authority',completion:f.f.composition,clock:f.f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(){throw Error('readonly');}});
 const router=createControllerOperationRouting({publication:f.receiver.publication,verification:f.f.operations,completion:f.f.composition.public,execution:{async invoke(){throw Error('readonly');}},assertCurrent(){},async renew(){}}),appRouter=createControllerApplicationRouting({application:app,assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[f.f.peer.uid],acceptPeer:()=>f.f.peer,invoke:scenarioInvoke(lifetime,async(method,payload,peer,signal)=>{if(method==='publication.readOwnerPayload')reads++;if(method==='publication.observeIntentDependencies')sets++;return method.startsWith('application.')?appRouter.invoke(method,payload,peer,signal):router.invoke(method,payload,peer,signal);})});
 installed.factory=()=>createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,roundTrip:(bytes,callerSignal)=>callControllerIpc(socketPath,bytes,{signal:transportSignal(signal(),callerSignal)}),roundTripSync(){throw Error('unused');}});
 installed.route=(owner:any)=>({kind:'protected-unregistered',authorityId:'authority',owner:{...owner,profileId:f.owners[0].profileId}});
 try{const result=await readCurrentIntentPublicationDependencies(f.subjects.at(-1),signal());expect(result.publications.map(p=>p.owner)).toEqual(f.owners.slice(0,-1));expect(reads).toBe(2);expect(sets).toBe(1);expect(f.receiver.approvals).toBe(2);for(const p of result.publications)expect(JSON.parse(p.bytes.toString()).application).toEqual(p.application);}finally{installed.factory=installed.route=undefined;await lifetime.cleanup(()=>server.close());await lifetime.cleanup(()=>app.close());await lifetime.cleanup(()=>f.close());}
}),30000);

it('no qualified callback occurs after the final qualified authority clock in the dependency result',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let armed=false,reading=false,clocks=0,tails=0;
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2)armed=true;}},onAuthorityQualified(){if(armed){tails++;throw Error('qualified_callback_after_final_clock');}}});
 try{reading=true;const result=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());expect(result.publications).toHaveLength(2);expect(clocks).toBe(2);expect(tails).toBe(0);}finally{armed=false;reading=false;await lifetime.cleanup(()=>f.close());}
}),30000);

it.for(['expire','close'] as const)('final authority clock %s still fences the result without a wrapper callback',{timeout:30000},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationDependencies'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await lifetime.cleanup(()=>f.close());}
}));

// Explicit extended acceptance: the original 99-stage pre-publication chain exceeded
// 600s on 2026-09-27. Kept intact, not counted in routine component PASS.
it.runIf(process.env.SOLPI_INTENT_POPULATION === '1')('near-limit original contract retains its whole stage population through actual signed set RPC',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime,undefined,{},true),keys=generateKeyPairSync('ed25519'),socketPath=join(f.f.root,'intent-large-set.sock');let responseBytes=0;
 const router=createControllerOperationRouting({publication:f.receiver.publication,verification:f.f.operations,completion:f.f.composition.public,execution:{async invoke(){throw Error('readonly');}},assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[f.f.peer.uid],acceptPeer:()=>f.f.peer,invoke:scenarioInvoke(lifetime,(...args)=>router.invoke(...args))}),client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(bytes,callerSignal){const reply=await callControllerIpc(socketPath,bytes,{timeoutMs:300000,signal:transportSignal(signal(),callerSignal)});responseBytes=Math.max(responseBytes,reply.length);return reply;},roundTripSync(){throw Error('unused');}});
 const finalProfile=process.env.SOLPI_INTENT_FINAL_PROFILE==='1'?new InspectorSession():undefined;const finalPost=(method:string)=>new Promise<any>((resolve,reject)=>finalProfile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));if(finalProfile){finalProfile.connect();await finalPost('Profiler.enable');await finalPost('Profiler.start');console.info('population-final-set-start');}const finalStarted=Date.now();
 try{expect(Buffer.byteLength(json(f.contract))).toBeGreaterThan(60000);expect(f.contract.stages.length).toBeGreaterThan(80);const result:any=await client.publicationTransport.call('publication.observeIntentDependencies',{subject:f.subjects.at(-1)});expect(result.publications.map((v:any)=>v.owner)).toEqual(f.owners.slice(0,-1));expect(responseBytes).toBeLessThan(1024**2);console.info(JSON.stringify({contractBytes:Buffer.byteLength(json(f.contract)),stageCount:f.contract.stages.length,responseBytes}));}finally{await lifetime.cleanup(()=>console.info('population-final-set-ms '+(Date.now()-finalStarted)));if(finalProfile){await lifetime.cleanup(async()=>{const result=await finalPost('Profiler.stop');writeFileSync('/tmp/solpi-intent-final-set.cpuprofile',JSON.stringify(result.profile));});await lifetime.cleanup(()=>finalProfile.disconnect());}await lifetime.cleanup(()=>client.dispose());await lifetime.cleanup(()=>server.close());await lifetime.cleanup(()=>f.close());}
}),3600000);
it.for(['noncanonical','subject','mandatory','registration'] as const)('whole graph read refuses actual sibling %s drift even for empty dependencies',{timeout:30000},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const key=json(f.owners[1]),row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(key) as {logical_owner_key:string;contract_json:string};
  if(mode==='mandatory')f.f.database.prepare('DELETE FROM mandatory_observation_checks WHERE owner_key=?').run(key);
  else if(mode==='registration')f.f.database.prepare('UPDATE verification_owners SET migration_epoch=migration_epoch+1 WHERE owner_key=?').run(key);
  else {const value=JSON.parse(row.contract_json);if(mode==='subject')value.subject.stageId=f.subjects[0].stageId;const encoded=mode==='noncanonical'?JSON.stringify(value,null,1):json(value);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(encoded,key);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(encoded,row.logical_owner_key);}
  await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects[0]},f.f.peer,signal())).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}));
it.for(['valid','missing-parent','missing-sibling-edge','extra-edge','parent-noncanonical'] as const)('actual invocation-only append retains complete parent graph: %s',{timeout:30000},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const parent=json(f.owners.at(-1)),sibling=json(f.owners[1]);
  if(mode==='missing-parent')f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(parent);
  if(mode==='missing-sibling-edge')f.f.database.prepare('DELETE FROM verification_owner_dependencies WHERE parent_key=? AND child_key=?').run(parent,sibling);
  if(mode==='extra-edge')f.f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES (?,?)').run(json(f.owners[0]),sibling);
  if(mode==='parent-noncanonical'){const row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(parent) as any,body=JSON.stringify(JSON.parse(row.contract_json),null,1);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(body,parent);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(body,row.logical_owner_key);}
  const invocation={sessionIdentity:f.contract.sessionId,compoundOperationId:'real-extra',validationInvocationId:'real-extra-validation'},proposal={enrollment:{...intentHostSubjectOwner(f.subjects[0]),invocations:[invocation]},registration:goalVerificationRegistration(f.contract.stages[0].verification)};
  const work=async()=>{const prepared:any=await f.f.composition.public.invoke('completion.prepare-owner',proposal,f.f.peer,signal());return f.f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.f.peer,signal());};
  if(mode==='valid'){await work();expect(f.f.composition.privateHost.enrollment.resolveOwnerKey(f.f.peer,invocation)).toBe(json(f.owners[0]));}else await expect(work()).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}));

it('completion observation includes its own actual publication and every original dependency without publishing the parent implicitly',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const first=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[0]},f.f.peer,signal());expect(first.scope).toBe('self-and-dependencies');expect(first.publications.map(p=>p.owner)).toEqual([f.owners[0]]);
  const second=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal());expect(second.publications.map(p=>p.owner)).toEqual([f.owners[1],f.owners[0]]);
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1],owners:[f.owners[1]]},f.f.peer,signal())).rejects.toThrow('publication_operation_shape');
 }finally{await lifetime.cleanup(()=>f.close());}
}),30000);
it.for(['expire','close'] as const)('completion observation final clock %s rejects the entire self and dependency set',{timeout:30000},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationCompletion')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationCompletion'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await lifetime.cleanup(()=>f.close());}
}));

it('parent completion final set rejects old native-approved child publication references after a same-proof child republishes',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const refs=f.contract.stages.map((stage:any,i:number)=>{const owner=f.owners[i],row=f.f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE owner_key=?').get(json(owner)) as {tuple_json:string},tuple=JSON.parse(row.tuple_json);return {subject:f.subjects[i],candidateId:f.bindings[i].candidateId,candidateRevision:1,bindingHash:intentApplicationBindingHash(f.bindings[i]),immutablePayloadHash:tuple.immutablePayloadHash,operationId:tuple.operationId,fullTupleHash:hashVerificationTuple(tuple),committedBusinessRevision:tuple.expectedBusinessRevision+1,receiverId:tuple.receiverId,receiverProtocolVersion:tuple.receiverProtocolVersion,receiverInstanceEpoch:tuple.receiverInstanceEpoch};});
  const subject=f.subjects.at(-1)!,owner=f.owners.at(-1)!,binding=createIntentApplicationBinding({version:1,kind:'intent',subject,candidateId:'actual-parent',candidateRevision:1,contract:f.contract,body:{kind:'intent-parent',summary:'actual complete result',stages:refs,artifacts:[]}});
  const application=createApplicationBindingAuthority({database:f.f.database,authorityId:'authority',completion:f.f.composition,clock:f.f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:'11111111-AAAA-BBBB-CCCC-555555555555',source:'macos-local-generateduid' as const}),async approve(review){return {uid:f.f.peer.uid,auditSessionId:f.f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}});
  await lifetime.after(async()=>{signal();const prepared=application.prepare({requestSource:'user',binding},f.f.peer);await application.authorize({requestSource:'user',challengeId:prepared.challengeId},f.f.peer,signal());},()=>application.close());
  const invocation={sessionIdentity:f.contract.sessionId,compoundOperationId:'parent-operation',validationInvocationId:'parent-verification'};
  const enrollment:any=await f.f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),invocations:[invocation]},registration:goalVerificationRegistration(f.contract.verification)},f.f.peer,signal());await f.f.composition.public.invoke('completion.authorize-owner',{challengeId:enrollment.challengeId},f.f.peer,signal());
  const selected=await f.f.material.prepare({purpose:'isolated-command',invocation,materials:[{path:'/workspace/a',byteLimit:1}],exactCommand:{argv:['/bin/true'],cwdRelative:'.'},expiresAt:105000},f.f.peer,signal()),grant=await f.f.material.authorize(selected.challengeId,f.f.peer,signal()),staged=await f.f.material.stage({grantHandle:grant,invocation},f.f.peer,signal());
  const operation=await f.f.operations.prepare({mountPlanHandle:staged.mountPlanHandle,obligationId:'original',expectedAttemptEpoch:0,requestSource:'agent'},f.f.peer,signal());await f.f.operations.dispatch({operationHandle:operation.operationHandle},f.f.peer,signal());
  signal();const parent=f.receiver.publication.prepare({...intentHostSubjectOwner(subject),requestSource:'user'},f.f.peer);await f.receiver.publication.approve({challengeId:parent.challengeId},f.f.peer,signal());
  expect((await f.receiver.publication.observeIntentCompletion({subject},f.f.peer,signal())).publications).toHaveLength(3);
  signal();const second=f.receiver.publication.prepare({...intentHostSubjectOwner(f.subjects[0]),requestSource:'user'},f.f.peer);await f.receiver.publication.approve({challengeId:second.challengeId},f.f.peer,signal());
  expect(f.f.composition.privateHost.authorityService.inspectOwner(owner)?.currentVerification).toBe('valid');
  await expect(f.receiver.publication.observeIntentCompletion({subject},f.f.peer,signal())).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}),60000);

it('the original final dependency set carries actual receiver identity for parent capture',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{const observed=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());
  for(const p of observed.publications){const row=f.f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=?').get(p.operationId) as {tuple_json:string},tuple=JSON.parse(row.tuple_json);expect(p).toMatchObject({receiverId:tuple.receiverId,receiverProtocolVersion:tuple.receiverProtocolVersion,receiverInstanceEpoch:tuple.receiverInstanceEpoch});expect(p.fullTupleHash).toBe(hashVerificationTuple(tuple));}
 }finally{await lifetime.cleanup(()=>f.close());}
}),30000);
