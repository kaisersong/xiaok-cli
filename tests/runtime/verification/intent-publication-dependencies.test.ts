import {createIntentDependencyFixtureLifetime} from '../../support/intent-dependency-fixture-lifetime.js';
import '../../support/installed-controller-fixture.js';
import {afterEach,beforeEach,describe,it,expect,vi,type TestContext} from 'vitest';
const installed=vi.hoisted(()=>({factory:undefined as any,route:undefined as any}));
vi.mock('../../../src/runtime/verification/controller-client.js',async original=>({...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(),createInstalledVerificationClient:()=>installed.factory()}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>installed.route(owner)}));
import {createHash,generateKeyPairSync} from 'node:crypto';
import {join} from 'node:path';
import {Session as InspectorSession} from 'node:inspector';
import {lstatSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';
import {intentApplicationCandidate} from '../../support/intent-application-fixture.js';
import {createIntentApplicationBinding,intentApplicationBindingHash} from '../../../src/runtime/verification/intent-application-binding.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {goalVerificationRegistration} from '../../../src/runtime/goal/verification-definition.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {canonicalVerificationJson as json,hashVerificationTuple} from '../../../src/runtime/verification/protocol.js';
import {fixture,runScenario,scenarioInvoke,transportSignal,hash,intentDependencyRunnerBudget} from './intent-publication-dependency-fixture.js';
it('actual original Intent dependency observation derives empty first-stage and whole parent inventory from native receipts',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const observe=(subject:any)=>(f.receiver.publication as any).observeIntentDependencies({subject},f.f.peer,signal());
  const first=await observe(f.subjects[0]);expect(first.publications).toEqual([]);expect(first.subject).toEqual(f.subjects[0]);
  const next=await observe(f.subjects[1]);expect(next.publications.map((p:any)=>p.owner)).toEqual([f.owners[0]]);
  const parent=await observe(f.subjects.at(-1));expect(parent.publications.map((p:any)=>p.owner)).toEqual(f.owners.slice(0,-1));expect(parent.clock.domainId).toBe('clock');expect(f.receiver.approvals).toBe(2);
  f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(json(f.owners.at(-1)));
  await expect(observe(f.subjects[0])).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(45000));
it('late expiration of an earlier dependency cannot be spliced into an otherwise-current parent set',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let ready=false,queries=0,expire:()=>void=()=>{};const f=await fixture(lifetime,()=>{if(ready&&++queries===2)expire();});try{expire=()=>f.f.setTime(10000);ready=true;await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);}finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(40000));
it('foreign subject and caller-selected inventory cannot redefine original native dependencies',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{for(const query of [{subject:{...f.subjects.at(-1),sessionId:'foreign'}},{subject:f.subjects.at(-1),owners:[f.owners[0]]}])await expect((f.receiver.publication as any).observeIntentDependencies(query,f.f.peer,signal())).rejects.toThrow();expect(f.f.database.prepare('SELECT count(*) n FROM verification_owner_dependencies').get()).toEqual({n:3});}finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(40000));

it('final whole-set check rejects a dependency application entering pending during the last receiver query',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let ready=false,queries=0,change:()=>void=()=>{};const f=await fixture(lifetime,()=>{if(ready&&++queries===2)change();});try{
  change=()=>{const before=f.f.composition.privateHost.authorityHost.inspectApplication(f.owners[0]).current!;const old=structuredClone(f.bindings[0]);const {contractHash:_,candidatePayloadHash:__,...raw}=old;const binding=createIntentApplicationBinding({...raw,candidateId:'replacement',candidateRevision:2});f.f.composition.privateHost.authorityHost.beginApplicationTransition({owner:f.owners[0],transitionId:'late-transition',previousBindingHash:before.bindingHash,binding,registrationHash:'a'.repeat(64)});};ready=true;
  await expect((f.receiver.publication as any).observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(queries).toBe(2);
 }finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(50000));

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
}),intentDependencyRunnerBudget(75000));

it('no qualified callback occurs after the final qualified authority clock in the dependency result',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let armed=false,reading=false,clocks=0,tails=0;
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2)armed=true;}},onAuthorityQualified(){if(armed){tails++;throw Error('qualified_callback_after_final_clock');}}});
 try{reading=true;const result=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());expect(result.publications).toHaveLength(2);expect(clocks).toBe(2);expect(tails).toBe(0);}finally{armed=false;reading=false;await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(40000));

for (const row of ['expire','close'] as const) {
it.for([row])('final authority clock %s still fences the result without a wrapper callback',{timeout:intentDependencyRunnerBudget(row==="expire"?45000:row==="close"?40000:30000)},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationDependencies')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationDependencies'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await lifetime.cleanup(()=>f.close());}
}));
}

// Explicit extended acceptance: the original 99-stage pre-publication chain exceeded
// 600s on 2026-09-27. Kept intact, not counted in routine component PASS.
it.runIf(process.env.SOLPI_INTENT_POPULATION === '1')('near-limit original contract retains its whole stage population through actual signed set RPC',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime,undefined,{},true),keys=generateKeyPairSync('ed25519'),socketPath=join(f.f.root,'intent-large-set.sock');let responseBytes=0;
 const router=createControllerOperationRouting({publication:f.receiver.publication,verification:f.f.operations,completion:f.f.composition.public,execution:{async invoke(){throw Error('readonly');}},assertCurrent(){},async renew(){}});
 const server=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:keys.privateKey,allowedUserIds:[f.f.peer.uid],acceptPeer:()=>f.f.peer,invoke:scenarioInvoke(lifetime,(...args)=>router.invoke(...args))}),client=createAuthenticatedControllerClient({authorityId:'authority',publicKey:keys.publicKey,async roundTrip(bytes,callerSignal){const reply=await callControllerIpc(socketPath,bytes,{timeoutMs:300000,signal:transportSignal(signal(),callerSignal)});responseBytes=Math.max(responseBytes,reply.length);return reply;},roundTripSync(){throw Error('unused');}});
 const finalProfile=process.env.SOLPI_INTENT_FINAL_PROFILE==='1'?new InspectorSession():undefined;const finalPost=(method:string)=>new Promise<any>((resolve,reject)=>finalProfile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));if(finalProfile){finalProfile.connect();await finalPost('Profiler.enable');await finalPost('Profiler.start');console.info('population-final-set-start');}const finalStarted=Date.now();
 try{expect(Buffer.byteLength(json(f.contract))).toBeGreaterThan(60000);expect(f.contract.stages.length).toBeGreaterThan(80);const result:any=await client.publicationTransport.call('publication.observeIntentDependencies',{subject:f.subjects.at(-1)});expect(result.publications.map((v:any)=>v.owner)).toEqual(f.owners.slice(0,-1));expect(responseBytes).toBeLessThan(1024**2);console.info(JSON.stringify({contractBytes:Buffer.byteLength(json(f.contract)),stageCount:f.contract.stages.length,responseBytes}));}finally{await lifetime.cleanup(()=>console.info('population-final-set-ms '+(Date.now()-finalStarted)));if(finalProfile){await lifetime.cleanup(async()=>{const result=await finalPost('Profiler.stop');writeFileSync('/tmp/solpi-intent-final-set.cpuprofile',JSON.stringify(result.profile));});await lifetime.cleanup(()=>finalProfile.disconnect());}await lifetime.cleanup(()=>client.dispose());await lifetime.cleanup(()=>server.close());await lifetime.cleanup(()=>f.close());}
}),3600000);
for (const row of ['noncanonical','subject','mandatory','registration'] as const) {
it.for([row])('whole graph read refuses actual sibling %s drift even for empty dependencies',{timeout:intentDependencyRunnerBudget(row==="noncanonical"?40000:row==="subject"?40000:row==="mandatory"?40000:30000)},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const key=json(f.owners[1]),row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(key) as {logical_owner_key:string;contract_json:string};
  if(mode==='mandatory')f.f.database.prepare('DELETE FROM mandatory_observation_checks WHERE owner_key=?').run(key);
  else if(mode==='registration')f.f.database.prepare('UPDATE verification_owners SET migration_epoch=migration_epoch+1 WHERE owner_key=?').run(key);
  else {const value=JSON.parse(row.contract_json);if(mode==='subject')value.subject.stageId=f.subjects[0].stageId;const encoded=mode==='noncanonical'?JSON.stringify(value,null,1):json(value);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(encoded,key);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(encoded,row.logical_owner_key);}
  await expect(f.receiver.publication.observeIntentDependencies({subject:f.subjects[0]},f.f.peer,signal())).rejects.toThrow();
 }finally{await lifetime.cleanup(()=>f.close());}
}));
}
// Only infrastructure moves out of these five row-specific case budgets.
for (const row of ['valid','missing-parent','missing-sibling-edge','extra-edge','parent-noncanonical'] as const) describe('fresh invocation dependency fixture '+row,()=>{
 let ready:Awaited<ReturnType<typeof fixture>>|undefined,running:Promise<void>|undefined;
 beforeEach((ctx:TestContext)=>runScenario(ctx,async(_signal,lifetime)=>{ready=undefined;running=undefined;ready=await fixture(lifetime);}),intentDependencyRunnerBudget(90_000));
 afterEach(async()=>{const owned=ready,work=running;ready=undefined;running=undefined;try{await work;}catch(raw){owned?.fail(raw);}await owned?.close();},30_000);
it.for([row])('actual invocation-only append retains complete parent graph: %s',{timeout:row==="valid"?40000:row==="missing-parent"?40000:30000},(mode,ctx:TestContext)=>{
 const raw=runScenario(ctx,async(signal,lifetime)=>{
 if(!ready)throw Error('intent_dependency_fixture_not_ready');
 const f=ready;try{
  const parent=json(f.owners.at(-1)),sibling=json(f.owners[1]);
  if(mode==='missing-parent')f.f.database.prepare('DELETE FROM owner_enrollment_intent_contracts WHERE owner_key=?').run(parent);
  if(mode==='missing-sibling-edge')f.f.database.prepare('DELETE FROM verification_owner_dependencies WHERE parent_key=? AND child_key=?').run(parent,sibling);
  if(mode==='extra-edge')f.f.database.prepare('INSERT INTO verification_owner_dependencies(parent_key,child_key) VALUES (?,?)').run(json(f.owners[0]),sibling);
  if(mode==='parent-noncanonical'){const row=f.f.database.prepare('SELECT logical_owner_key,contract_json FROM owner_enrollment_intent_contracts WHERE owner_key=?').get(parent) as any,body=JSON.stringify(JSON.parse(row.contract_json),null,1);f.f.database.prepare('UPDATE owner_enrollment_intent_contracts SET contract_json=? WHERE owner_key=?').run(body,parent);f.f.database.prepare('UPDATE owner_enrollment_intents SET intent_contract_json=? WHERE logical_owner_key=?').run(body,row.logical_owner_key);}
  const invocation={sessionIdentity:f.contract.sessionId,compoundOperationId:'real-extra',validationInvocationId:'real-extra-validation'},proposal={enrollment:{...intentHostSubjectOwner(f.subjects[0]),invocations:[invocation]},registration:goalVerificationRegistration(f.contract.stages[0].verification)};
  const work=async()=>{const prepared:any=await f.f.composition.public.invoke('completion.prepare-owner',proposal,f.f.peer,signal());return f.f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.f.peer,signal());};
  if(mode==='valid'){await work();expect(f.f.composition.privateHost.enrollment.resolveOwnerKey(f.f.peer,invocation)).toBe(json(f.owners[0]));}else await expect(work()).rejects.toThrow();
 }catch(raw){f.fail(raw);throw raw;}finally{await lifetime.cleanup(()=>f.close());}
 });running=raw;return raw;
});
});
