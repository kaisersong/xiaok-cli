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
it('completion observation includes its own actual publication and every original dependency without publishing the parent implicitly',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{
  const first=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[0]},f.f.peer,signal());expect(first.scope).toBe('self-and-dependencies');expect(first.publications.map(p=>p.owner)).toEqual([f.owners[0]]);
  const second=await f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal());expect(second.publications.map(p=>p.owner)).toEqual([f.owners[1],f.owners[0]]);
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects.at(-1)},f.f.peer,signal())).rejects.toThrow();
  await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1],owners:[f.owners[1]]},f.f.peer,signal())).rejects.toThrow('publication_operation_shape');
 }finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(45000));
for (const row of ['expire','close'] as const) {
it.for([row])('completion observation final clock %s rejects the entire self and dependency set',{timeout:intentDependencyRunnerBudget(row==="expire"?45000:row==="close"?40000:30000)},(mode,ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 let reading=false,clocks=0,change:()=>void=()=>{};
 const f=await fixture(lifetime,undefined,{onClock(){if(reading&&new Error().stack?.includes('inspectIntentPublicationCompletion')){clocks++;if(clocks===2&&mode==='close')change();}},onAuthorityQualified(){if(reading&&clocks===1&&mode==='expire'&&new Error().stack?.includes('inspectIntentPublicationCompletion'))change();}});
 try{change=()=>mode==='close'?f.f.composition.close():f.f.setTime(10000);reading=true;await expect(f.receiver.publication.observeIntentCompletion({subject:f.subjects[1]},f.f.peer,signal())).rejects.toThrow();expect(clocks).toBe(2);}finally{reading=false;await lifetime.cleanup(()=>f.close());}
}));
}

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
}),105000);

it('the original final dependency set carries actual receiver identity for parent capture',(ctx:TestContext)=>runScenario(ctx,async(signal,lifetime)=>{
 const f=await fixture(lifetime);try{const observed=await f.receiver.publication.observeIntentDependencies({subject:f.subjects.at(-1)},f.f.peer,signal());
  for(const p of observed.publications){const row=f.f.database.prepare('SELECT tuple_json FROM settlement_decisions WHERE operation_id=?').get(p.operationId) as {tuple_json:string},tuple=JSON.parse(row.tuple_json);expect(p).toMatchObject({receiverId:tuple.receiverId,receiverProtocolVersion:tuple.receiverProtocolVersion,receiverInstanceEpoch:tuple.receiverInstanceEpoch});expect(p.fullTupleHash).toBe(hashVerificationTuple(tuple));}
 }finally{await lifetime.cleanup(()=>f.close());}
}),intentDependencyRunnerBudget(40000));
