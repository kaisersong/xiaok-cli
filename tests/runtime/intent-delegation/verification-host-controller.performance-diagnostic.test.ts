import {runReceiverScenario} from './verification-host-controller.performance-diagnostic.receiver.js';
import '../../support/installed-controller-fixture.js';
import {loopPublicationReceiver} from '../../support/loop-publication-receiver.js';
import {it,expect,vi,type TestContext} from 'vitest';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
const leaf=vi.hoisted(()=>({factory:undefined as any,profile:undefined as any,changedOwner:undefined as string|undefined}));
vi.mock('../../../src/runtime/verification/controller-client.js',async original=>({...await original<typeof import('../../../src/runtime/verification/controller-client.js')>(),createInstalledVerificationClient:()=>leaf.factory()}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(owner:any)=>{const profile=leaf.profile();return profile.kind==='protected'?{kind:'protected-unregistered',authorityId:owner.ownerId===leaf.changedOwner?'changed-child-authority':profile.index.authorityId,owner:{profileId:profile.index.profileId,...owner}}:profile;}}));
import {verifiedOperationFixture} from '../../support/verified-operation-fixture.js';
import {createAuthenticatedControllerClient} from '../../../src/runtime/verification/controller-client.js';
import {createApplicationBindingAuthority} from '../../../src/runtime/verification/application-binding-authority.js';
import {createControllerApplicationRouting} from '../../../src/runtime/verification/controller-application-routing.js';
import {createControllerOperationRouting} from '../../../src/runtime/verification/controller-operation-routing.js';
import {applicationBindingReviewBytes} from '../../../src/runtime/verification/application-binding-review.js';
import {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
import {callControllerIpc} from '../../../src/runtime/verification/controller-ipc.js';
import {parsePublicProfileIndex} from '../../../src/runtime/verification/profile-index-publication.js';
import {SQLiteSessionStore} from '../../../src/ai/runtime/session-store/sqlite-store.js';
import {FileSessionStore} from '../../../src/ai/runtime/session-store/file-store.js';
import {createSessionExecutionAuthority,createSessionExecutionContext} from '../../../src/ai/runtime/session-store/execution-authority.js';
import {createIntentNativeContractHost} from '../../../src/runtime/intent-delegation/native-contract-host.js';
import {createIntentPublicationHost} from '../../../src/runtime/intent-delegation/publication-host.js';
import {createIntentVerificationHost} from '../../../src/runtime/intent-delegation/verification-host.js';
import {createIntentPlan} from '../../../src/ai/intent-delegation/planner.js';
import {intentHostSubjectOwner} from '../../../src/runtime/verification/intent-host-subject.js';
import {intentProducerLedgerHash} from '../../../src/runtime/intent-delegation/producer-facts.js';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
// Original actual authority/material/raw/recipe assemblies; only engine/native OS peer/locator are fixture leaves.
const scenarios=['normal','lost-dispatch','lost-prepare','lost-stage','receiver','receiver-lost-prepare','receiver-lost-ack','receiver-sqlite','receiver-self','receiver-route-switch','receiver-project','receiver-project-sqlite','receiver-project-parent','receiver-project-parent-sqlite','receiver-project-parent-recovery-route','receiver-project-parent-retry-route'] as const;
async function actualIntentControllerScenario(mode:typeof scenarios[number],testSignal:AbortSignal){
 leaf.changedOwner=undefined;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(100000);const f=await verifiedOperationFixture();
 const account='11111111-AAAA-BBBB-CCCC-555555555555',signal=testSignal,unused=()=>{throw Error('unused');};
 const application=createApplicationBindingAuthority({database:f.database,authorityId:'authority',completion:f.composition,clock:f.clock,assertCurrent(){},resolvePrincipal:p=>({...p,accountGeneration:account,source:'macos-local-generateduid'}),async approve(review){return {uid:f.peer.uid,auditSessionId:f.peer.auditSessionId,reviewHash:hash(applicationBindingReviewBytes(review))};}}),appRouter=createControllerApplicationRouting({application,assertCurrent(){},async renew(){}});
 const receiver=await loopPublicationReceiver(f);/* receiverHost is held by scenarioState. */const router=createControllerOperationRouting({assertCurrent(){},async renew(){},completion:f.composition.public,verification:f.operations,publication:receiver.publication,execution:{invoke:unused}});
 const scenarioState={dispatches:0,loseParentApplication:false,loseParentPrepare:false,applicationRecoveries:0,checkedTicket:false,receiverHost:undefined as any};let stages=0,lost=false;const socketPath=join(f.root,'intent.sock');
 const controller=await startPublicController({socketPath,authorityId:'authority',serviceEpoch:'boot',privateKey:f.keys.privateKey,allowedUserIds:[f.peer.uid],acceptPeer:()=>f.peer,async invoke(method,payload:any,peer,serverSignal){
  const signal=AbortSignal.any([serverSignal,testSignal]);signal.throwIfAborted();
  if(method==='materials.prepareRequest')return f.material.prepareRequest(payload,peer,signal);
  if(method==='materials.authorize')return f.material.authorize(payload.challengeId,peer,signal);
  if(method==='materials.stage'){stages++;const result=await f.material.stage(payload,peer,signal);if(mode==='lost-stage'&&!lost){lost=true;throw Error('actual staged reply lost');}return result;}
  if(method==='materials.lookupRequest')return f.material.lookupRequest(payload,peer);
  if(method==='materials.retireRequest')return f.material.retireRequest(payload,peer);
  if(method==='verification.dispatch')scenarioState.dispatches++;if(method==='application.recoverRequest')scenarioState.applicationRecoveries++;
  const result=await (method.startsWith('application.')?appRouter:router).invoke(method,payload,peer,signal);
  if(method==='application.prepareRequest'&&scenarioState.loseParentPrepare){scenarioState.loseParentPrepare=false;throw Error('actual parent prepare reply lost');}
  if(method==='application.authorize'&&scenarioState.loseParentApplication){scenarioState.loseParentApplication=false;throw Error('actual parent application reply lost');}
  if(method==='publication.prepareRequest'&&mode==='receiver-lost-prepare'&&!lost){lost=true;throw Error('actual publication prepared reply lost');}
  if(method==='publication.approve'&&mode==='receiver-lost-ack'&&!lost){lost=true;throw Error('actual publication committed reply lost');}
  if(method==='verification.prepareRequest'&&mode==='lost-prepare'&&!lost){lost=true;throw Error('actual prepared reply lost');}
  if(method==='verification.dispatch'&&mode==='lost-dispatch'&&!lost){lost=true;throw Error('actual terminal reply lost');}return result;
 }});
 leaf.factory=()=>createAuthenticatedControllerClient({authorityId:'authority',publicKey:f.keys.publicKey,roundTrip:(bytes,callerSignal)=>{const activeSignal=callerSignal===undefined?signal:AbortSignal.any([callerSignal,signal]);activeSignal.throwIfAborted();return callControllerIpc(socketPath,bytes,{signal:activeSignal});},roundTripSync:unused});leaf.profile=()=>({kind:'protected',index:parsePublicProfileIndex(JSON.parse(readFileSync(join(f.root,'migrations','principals',`${f.peer.uid}.json`),'utf8')))});
 const sessionRoot=join(f.root,'sessions'),store=mode.endsWith('sqlite')?new SQLiteSessionStore(join(sessionRoot,'sessions.db')):new FileSessionStore(sessionRoot),authority=createSessionExecutionAuthority({root:sessionRoot,sessionIdentity:'intent-session',hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'intent-host'})});const options={store,authority,sessionId:'intent-session',instanceId:'host',workspaceRoot:f.root,now:()=>100000,assertAdmission(){}};
 const originalParentWrite=store.reserveIntentParentPublicationCandidate.bind(store);scenarioState.checkedTicket=false;
 store.reserveIntentParentPublicationCandidate=async raw=>{await expect(originalParentWrite({ticket:{...raw.ticket},lease:raw.lease})).rejects.toThrow('intent_parent_ticket');const result=await originalParentWrite(raw);await expect(originalParentWrite(raw)).rejects.toThrow('intent_parent_ticket');scenarioState.checkedTicket=true;return result;};
 const {workspaceRoot,...nativeOptions}=options;const native=createIntentNativeContractHost(nativeOptions),publication=createIntentPublicationHost(options);let verification=createIntentVerificationHost(options);
 let bodyFailure:{error:unknown}|undefined;
 try{
  await store.save({sessionId:'intent-session',cwd:f.root,createdAt:1,updatedAt:1,lineage:['intent-session'],messages:mode.startsWith('receiver-project')?[{role:'user',content:[{type:'text',text:'original archived stage input'}]}]:[],usage:{inputTokens:0,outputTokens:0},compactions:[],memoryRefs:[],approvalRefs:[],backgroundJobRefs:[]});
  const planned=createIntentPlan({sessionId:'intent-session',instanceId:'host',input:'请写报告，然后生成幻灯片',skills:[]});if(planned.kind!=='plan')throw Error('planner');
  const definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe:{kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes' as const}]}}]};
  const original=await native.reserve({plan:planned.plan,definition:{verification:definition,stages:planned.plan.stages.map(s=>({order:s.order,templateId:s.templateId,verification:definition}))},requestSource:'user'});for(const _ of original.subjects)await native.advance({intentId:original.intentId,requestSource:'user'});
  async function artifact(stageIndex:number,lease:Parameters<typeof store.recordIntentProducerAction>[0]['lease']){if(!mode.includes('parent'))return;const stage=original.contract.stages[stageIndex],path=join(f.root,`original-stage-${stageIndex}.txt`);if(mode.endsWith('sqlite'))writeFileSync(path,'result');const ledger=store.getIntentNativeLedgerSync(options.sessionId)!;await store.recordIntentProducerAction({sessionId:options.sessionId,instanceId:'host',intentId:original.intentId,expectedLedgerHash:intentProducerLedgerHash(ledger),requestSource:'user',now:100000,lease,action:{kind:'artifact-report',stageId:stage.stageId,kindOfArtifact:'report',storage:mode.endsWith('sqlite')?'file_ref':'inline',label:'original child artifact',path:mode.endsWith('sqlite')?path:null,inlineValue:mode.endsWith('sqlite')?null:'result',summary:null,reportedStructuralValidation:'pending',reportedSemanticValidation:'pending',origin:{kind:'model-report',providerInvocationId:'artifact-provider-'+stageIndex,toolInvocationId:'artifact-tool-'+stageIndex}}});}
  function selections(stageIndex:number){return (store.getIntentNativeLedgerSync(options.sessionId)!.intents[0].artifacts??[]).filter(a=>storedFixtureObject(a).stageId===original.contract.stages[stageIndex].stageId).map(a=>({artifactId:storedFixtureString(storedFixtureObject(a).artifactId),obligationId:'original',path:'result'}));}
  const lease=await authority.acquire({kind:'direct-mutation',invocationId:'original-producer'});try{await artifact(0,lease);for(const step of original.contract.stages[0].steps){const ledger=store.getIntentNativeLedgerSync(options.sessionId)!;await store.recordIntentProducerAction({sessionId:options.sessionId,instanceId:'host',intentId:original.intentId,expectedLedgerHash:intentProducerLedgerHash(ledger),requestSource:'user',now:100000,lease,action:{kind:'step-report',stepId:step.stepId,status:'completed',breadcrumb:'actual producer',receiptNote:null,blockedReason:null,origin:{kind:'model-report',providerInvocationId:step.stepId,toolInvocationId:step.stepId}}});}}finally{await lease.releaseAfterDrain();}
  let candidate=await publication.capture({artifactSelections:selections(0),requestSource:'user'});candidate=await publication.advance({candidateId:candidate.id,requestSource:'user'});expect(candidate.applicationAttempts.at(-1)!.phase).toBe('ready');
  let row=await verification.reserve({candidateId:candidate.id,obligationId:'original',exactCommand:{argv:['/bin/true'],cwdRelative:'.'},materials:[{path:'/workspace/a',byteLimit:1}],expiresAt:105000,requestSource:'user'});row=await verification.advance({id:row.id,requestSource:'user'});const before=store.getIntentNativeLedgerSync(options.sessionId)!.intents;
  if(mode==='normal'||mode.startsWith('receiver'))row=await verification.execute({id:row.id,requestSource:'user'});else{await expect(verification.execute({id:row.id,requestSource:'user'})).rejects.toThrow();await verification.close();verification=createIntentVerificationHost(options);row=await verification.recover({id:row.id,requestSource:'user'});}
  if(mode==='lost-prepare'||mode==='lost-stage'){expect(row.operation?.phase).toBe('retired');expect(row.operation?.verificationObservation).toMatchObject(mode==='lost-prepare'?{state:'operation',operation:{state:'cancelled'}}:{state:'not_prepared'});expect(stages).toBe(1);expect(scenarioState.dispatches).toBe(0);expect(store.getIntentNativeLedgerSync(options.sessionId)!.intents).toEqual(before);return;}
  expect(row.operation?.phase).toBe('terminal');expect(row.operation?.verificationObservation).toMatchObject({operation:{terminalResult:{verificationAtCompletion:'valid'}}});expect(scenarioState.dispatches).toBe(1);expect(stages).toBe(1);expect(store.getIntentNativeLedgerSync(options.sessionId)!.intents).toEqual(before);
  const owner=JSON.parse(row.route).owner;expect(f.composition.privateHost.authorityService.getCurrentDependencies(owner)).toHaveLength(1);const payload=f.operations.stageVerifiedPayload(owner);expect(payload.payloadId).toBeTruthy();
  if(mode.startsWith('receiver')){await runReceiverScenario({mode,f,store,options,original,publication,verification,receiver,authority,candidate,artifact,selections,leaf,hash,storedFixtureStages,storedFixtureObject,storedFixtureString,intentProducerLedgerHash,intentHostSubjectOwner,scenarioState,before,sessionRoot,owner,FileSessionStore,createSessionExecutionAuthority,createSessionExecutionContext});return;}
 }catch(error){bodyFailure={error};throw error;}
 finally{
  const cleanupErrors:unknown[]=[];
  for(const close of [()=>scenarioState.receiverHost?.close(),()=>verification.close(),()=>publication.close(),()=>native.close(),()=>authority.dispose(),()=>{if(store instanceof SQLiteSessionStore)store.dispose();},()=>controller.close(),()=>application.close(),()=>receiver.close(),()=>f.close(),()=>vi.useRealTimers()]){
   try{await close();}catch(error){cleanupErrors.push(error);}
  }
  if(cleanupErrors.length)throw new AggregateError([...(bodyFailure?[bodyFailure.error]:[]),...cleanupErrors],'intent_controller_scenario_cleanup_failed');
 }
}
function runActualIntentControllerScenario(mode:typeof scenarios[number],ctx:TestContext){
 const scenario=actualIntentControllerScenario(mode,ctx.signal);
 const settledOutcome=scenario.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
 ctx.onTestFinished(async()=>{
  const outcome=await settledOutcome;
  if(ctx.signal.aborted&&outcome.failed&&outcome.error!==ctx.signal.reason)throw outcome.error;
 });
 return scenario;
}
// Vitest each supplies only case arguments; for also supplies the actual TestContext.
it.for(scenarios.filter(mode=>!mode.includes('parent')))('DIAGNOSTIC ONLY Intent signed controller actual material and independent recipe: %s',{timeout:180000},runActualIntentControllerScenario);
// New three-subject end-to-end scenario includes the extra parent native/material/recipe/receiver chain. Existing two-stage bounds stay unchanged.
it.for(scenarios.filter(mode=>mode.includes('parent')))('DIAGNOSTIC ONLY Intent signed controller actual material and independent recipe: %s',{timeout:180000},runActualIntentControllerScenario);

// Test-only observations keep original raw references; no authority or modern ledger assertion.
function isStoredFixtureObject(value:unknown):value is Record<string,unknown>{
 return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function storedFixtureObject(value:unknown):Record<string,unknown>{
 if(!isStoredFixtureObject(value))throw Error('stored_fixture_object');
 return value;
}
function storedFixtureString(value:unknown):string{
 if(typeof value!=='string')throw Error('stored_fixture_string');
 return value;
}
function storedFixtureStages<T>(value:T[]|null|undefined):T[]{
 if(!Array.isArray(value))throw Error('stored_fixture_stages');
 return value;
}
