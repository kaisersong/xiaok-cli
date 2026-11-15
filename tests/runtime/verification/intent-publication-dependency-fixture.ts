/** Original test fixtures and cleanup; no Source, grant or positive verdict. */
import {createIntentDependencyFixtureLifetime} from '../../support/intent-dependency-fixture-lifetime.js';
import '../../support/installed-controller-fixture.js';
import type {TestContext} from 'vitest';
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
function diagnosticProfileWriter(directory:string|undefined){
 const names=['solpi-intent-population.cpuprofile','solpi-intent-population-failure.cpuprofile'] as const;
 if(directory===undefined)return (name:typeof names[number],data:string)=>writeFileSync('/tmp/'+name,data);
 const identity=lstatSync(directory);
 if(realpathSync(directory)!==directory||!identity.isDirectory()||identity.isSymbolicLink()||identity.uid!==process.getuid?.()||(identity.mode&0o777)!==0o700||readdirSync(directory).length!==0)throw Error('profile_output_directory_invalid');
 return (name:typeof names[number],data:string)=>{
  const current=lstatSync(directory);
  if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==identity.dev||current.ino!==identity.ino||current.uid!==identity.uid||(current.mode&0o777)!==0o700||realpathSync(directory)!==directory)throw Error('profile_output_directory_changed');
  writeFileSync(join(directory,name),data,{flag:'wx',mode:0o600});
 };
}
async function fixture(lifetime:ScenarioLifetime,afterQuery?:()=>void,options:Parameters<typeof verifiedOperationFixture>[1]={},large=false){
 const {signal}=lifetime;signal();
 const writeProfile=large&&process.env.SOLPI_INTENT_PROFILE==='1'?diagnosticProfileWriter(process.env.SOLPI_INTENT_PROFILE_DIR):undefined;
 const owned=createIntentDependencyFixtureLifetime();
 try{
 const f=await owned.captureFixture(verifiedOperationFixture('dispatch',large?{...options,controllerMetadataMinimumBytes:96*1024**2}:options,owned)),raw=structuredClone(intentApplicationCandidate()),recipe={kind:'artifact-content' as const,checks:[{id:'content',path:'result',sha256:hash('result'),structure:'bytes' as const}]},definition={version:1 as const,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject' as const,recipe}]};
 raw.contract.verification=definition;for(const stage of raw.contract.stages)stage.verification=definition;
 if(large){const sample=structuredClone(raw.contract.stages[0]);raw.contract.stages=[];for(let i=0;;i++){const stage={...structuredClone(sample),stageId:`s${i}`,order:i,label:'stage',deliverable:'result',templateId:'template',dependsOnStageIds:[],steps:[{...sample.steps[0],stepId:`p${i}`,key:'main',order:0,skillName:null,dependsOn:[]}]};raw.contract.stages.push(stage);if(Buffer.byteLength(json(raw.contract))>61000){raw.contract.stages.pop();break;}}}
 const contract=raw.contract,subjects=[...contract.stages.map((s:any)=>({...raw.subject,stageId:s.stageId})),{...raw.subject,stageId:null}],owners:any[]=[];
 for(const subject of subjects){const prepared:any=await f.composition.public.invoke('completion.prepare-owner',{enrollment:{...intentHostSubjectOwner(subject),intentContract:{subject,contract},invocations:[]},registration:goalVerificationRegistration(definition)},f.peer,signal());const actual:any=await f.composition.public.invoke('completion.authorize-owner',{challengeId:prepared.challengeId},f.peer,signal());owners.push(actual.owner);if(large)await new Promise<void>(resolve=>setImmediate(resolve));}
 const receiver=await owned.captureReceiver(loopPublicationReceiver(f,{afterQuery})),bindings:any[]=[];
 const profile=large&&process.env.SOLPI_INTENT_PROFILE==='1'?new InspectorSession():undefined;
 const post=(method:string)=>new Promise<any>((resolve,reject)=>profile!.post(method as any,(error,result)=>error?reject(error):resolve(result)));
 if(profile){if(process.env.SOLPI_INTENT_PROFILE_DIR!==undefined)console.info('population-profile-output-mode owned-private');profile.connect();await post('Profiler.enable');await new Promise<void>((resolve,reject)=>profile.post('Profiler.setSamplingInterval',{interval:10000},error=>error?reject(error):resolve()));console.info('population-profile-sampling-interval-us 10000');await post('Profiler.start');console.info('population-profile-start native-subjects='+subjects.length);}
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
   if(profile){console.info('population-publication-ms '+i+' '+(Date.now()-started));if(i===2){const result=await post('Profiler.stop');profileStopped=true;try{writeProfile!('solpi-intent-population.cpuprofile',JSON.stringify(result.profile));}finally{await lifetime.cleanup(()=>profile.disconnect());}throw Error('explicit_profile_stopped_after_three_actual_publications');}}
  }
 }catch(error){if(profile&&!profileStopped){await lifetime.cleanup(async()=>{const result=await post('Profiler.stop');profileStopped=true;writeProfile!('solpi-intent-population-failure.cpuprofile',JSON.stringify(result.profile));});await lifetime.cleanup(()=>profile.disconnect());}throw error;}
 return {f,receiver,subjects,owners,bindings,contract,fail(raw:unknown){owned.fail(raw);},close(){return owned.close();}};
 }catch(raw){owned.fail(raw);await owned.close();throw raw;}
}

import type {startPublicController} from '../../../src/runtime/verification/controller-public-daemon.js';
export {fixture,runScenario,scenarioInvoke,transportSignal,hash};
/** Quality-reviewed observation window; Native clocks and cancellation stay real. */
export function intentDependencyRunnerBudget(original:number):number {
 if(process.platform!=='darwin')return original;
 const major=Number(process.versions.node.split('.')[0]);
 return major>=24?Math.max(original,90_000):major>=22?Math.max(original,60_000):original;
}
