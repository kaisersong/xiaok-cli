import {beforeEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateEveningReflection} from '../../electron/assistant-llm.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {DatabaseSync} from 'node:sqlite';
const wire=vi.hoisted(()=>({routes:new Map<string,any>(),applications:new Map<string,any>(),publications:new Map<string,any>(),current:undefined as any,change:undefined as undefined|(()=>void),reads:0,payloadGetter:undefined as undefined|(()=>void),payloadGetterReads:0}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(o:any)=>wire.routes.get(o.ownerId)}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js',()=>({createInstalledLoopApplicationClient:(b:any)=>({async inspect(){return {state:'active',current:wire.applications.get(b.candidateId),pendingTransitionId:null,pendingTarget:null};},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js',()=>({createInstalledCompletionPublisher:(o:any)=>({async prepareRequest(){wire.current=wire.publications.get(o.ownerId);return wire.current.challenge;},async approve(){return wire.current.observation;},dispose(){}})}));
vi.mock('../../../src/runtime/loop/published-candidate.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-candidate.js')>(),readCurrentLoopPublishedCandidate:async(b:any)=>{wire.reads++;const p=[...wire.publications.values()].find(p=>p.binding.candidateId===b.candidateId);if(wire.payloadGetter)return Object.freeze({binding:b,application:wire.applications.get(b.candidateId),owner:p.observation.owner,businessRevision:p.observation.businessRevision,operationId:p.observation.operationId,fullTupleHash:p.observation.fullTupleHash,payloadHash:'a'.repeat(64),get bytes(){wire.payloadGetterReads++;wire.payloadGetter?.();return Buffer.from('verified-fixture');}});return {...p.observation,binding:b,application:wire.applications.get(b.candidateId),payloadHash:'a'.repeat(64),bytes:Buffer.from('verified-fixture')};}}));
vi.mock('../../../src/runtime/loop/published-set.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-set.js')>(),readCurrentLoopPublicationSet:async(bs:any[])=>{wire.change?.();return {clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'a'.repeat(64)},publications:bs.map(b=>{const p=[...wire.publications.values()].find(p=>p.binding.candidateId===b.candidateId);const {owner,businessRevision,operationId,fullTupleHash}=p.observation;return {owner,businessRevision,operationId,fullTupleHash,application:wire.applications.get(b.candidateId)};})};}}));
import {loopPublicationFixture,readyLoopNative} from '../support/loop-publication-fixture.js';
import {createLoopPublicationWorkflow} from '../../electron/loop-publication-workflow.js';
import {createLoopBusinessPublicationHost} from '../../electron/loop-business-publication-host.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {LoopStore} from '../../electron/loop-store.js';
beforeEach(()=>{wire.routes.clear();wire.applications.clear();wire.publications.clear();wire.change=undefined;wire.reads=0;wire.payloadGetter=undefined;wire.payloadGetterReads=0;});
async function publishAll(store:LoopStore,candidates:ReturnType<LoopStore['listLoopPublicationCandidates']>){const workflow=createLoopPublicationWorkflow({store,assertAdmission(){},now:()=>40});
 try{for(const c of candidates){const native=readyLoopNative({store,candidate:c}),owner={profileId:'profile',...loopHostSubjectOwner(c.binding.subject)},route={kind:'protected-unregistered',authorityId:'authority',owner},application={binding:c.binding,bindingHash:c.bindingHash,revision:1};
  const challenge={challengeId:'challenge-'+c.candidateId,owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}},observation={owner,status:'committed',operationId:'operation-'+c.candidateId,fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'};
  wire.routes.set(owner.ownerId,route);wire.applications.set(c.candidateId,application);wire.publications.set(owner.ownerId,{binding:c.binding,challenge,observation});
  await workflow.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user'});
 }}finally{await workflow.close();}
}
async function fixture(missingStage=false){const f=loopPublicationFixture();await publishAll(f.store,[f.candidate,...(missingStage?[]:[f.scanCandidate])]);return f;}
it('requires both original scanner and Run publications and writes only one immutable origin',async()=>{const f=await fixture();const host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});let closed=false;try{
 const result=await host.project({runId:f.candidate.runId,requestSource:'scheduler'});expect(result.generation).toBe(1);expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('success');expect(f.store.listLoopStages(f.candidate.runId)[0].status).toBe('success');
 expect((await host.project({runId:f.candidate.runId,requestSource:'scheduler'})).generation).toBe(1);
 expect(f.store.recoverLoopPublicationCandidates({runId:f.candidate.runId,requestSource:'user'})).toHaveLength(2);
 f.store.close();closed=true;const reopened=new LoopStore(f.file);try{expect(reopened.getLoopBusinessProjection(f.candidate.runId)?.originHash).toBe(result.originHash);expect(reopened.recoverLoopPublicationCandidates({runId:f.candidate.runId,requestSource:'user'})).toHaveLength(2);}finally{reopened.close();}
 }finally{await host.close();if(closed)rmSync(f.root,{recursive:true,force:true});else f.close();}});
it('Run publication alone never promotes its scanner',async()=>{const f=await fixture(true),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{await expect(host.project({runId:f.candidate.runId,requestSource:'scheduler'})).rejects.toThrow();expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');expect(wire.reads).toBe(0);}finally{await host.close();f.close();}});
it('rejects local source mutation while the signed set is in flight with zero success rows',async()=>{const f=await fixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{wire.change=()=>{const db=new DatabaseSync(f.file);try{db.prepare("UPDATE loop_stages SET summary='changed' WHERE run_id=?").run(f.candidate.runId);}finally{db.close();}};await expect(host.project({runId:f.candidate.runId,requestSource:'user'})).rejects.toThrow();expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');}finally{await host.close();f.close();}});
it('never accepts an ordinary DTO as a projection capability',async()=>{const f=await fixture();try{expect(()=>f.store.applyLoopBusinessProjection({ticket:{},runId:f.candidate.runId,requestSource:'user'})).toThrow();expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');}finally{f.close();}});
it('revalidates through a new original native attempt without rewriting the immutable origin',async()=>{let projectionTime=50;const f=await fixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>projectionTime});const workflow=createLoopPublicationWorkflow({store:f.store,assertAdmission(){},now:()=>150});try{
 const first=await host.project({runId:f.candidate.runId,requestSource:'user'}),old=f.store.listLoopPublicationAttempts(f.candidate.candidateId).at(-1)!;
 let native=f.store.reserveLoopNativeAttempt({candidateId:f.candidate.candidateId,expectedLatestAttemptId:old.nativeAttemptId,requestSource:'user',now:100});
 for(const phase of ['enrolling','enrolled','binding','ready'] as const)native=f.store.advanceLoopNativeAttempt({attemptId:native.attemptId,expectedRevision:native.revision,phase,requestSource:'user',now:100+native.revision});
 const p=wire.publications.get(loopHostSubjectOwner(f.candidate.binding.subject).ownerId);p.challenge={...p.challenge,challengeId:'second',fullTupleHash:'b'.repeat(64)};p.observation={...p.observation,operationId:'second-operation',fullTupleHash:'b'.repeat(64),businessRevision:2};
 await workflow.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:old.attemptId,requestSource:'user'});
 projectionTime=200;const second=await host.project({runId:f.candidate.runId,requestSource:'user'});expect(second.generation).toBe(2);expect(second.origin).toEqual(first.origin);expect(second.originHash).toBe(first.originHash);expect(second.previousGenerationHash).toBe(first.generationHash);
 }finally{await workflow.close();await host.close();f.close();}});
it.each(['ignore','tail-config','tail-stage'])('rolls every projection row back after real SQL %s',async mode=>{const f=await fixture(),db=new DatabaseSync(f.file),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{
 if(mode==='ignore')db.exec("CREATE TRIGGER ignore_projection BEFORE UPDATE ON loop_stages WHEN NEW.status='success' BEGIN SELECT RAISE(IGNORE); END");
 else if(mode==='tail-config')db.exec("CREATE TRIGGER change_projection AFTER INSERT ON loop_projection_generations BEGIN UPDATE loop_publication_configs SET revision=revision+1; END");
 else db.exec("CREATE TRIGGER change_projection AFTER INSERT ON loop_projection_generations BEGIN UPDATE loop_stages SET summary='late'; END");
 await expect(host.project({runId:f.candidate.runId,requestSource:'user'})).rejects.toThrow();expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');expect(f.store.getLoopBusinessProjection(f.candidate.runId)).toBeUndefined();expect(f.store.listLoopStages(f.candidate.runId)[0].status).toBe('running');
 }finally{db.close();await host.close();f.close();}});
it('burns a genuine projection ticket on the wrong store and never retries it',async()=>{const f=await fixture(),other=loopPublicationFixture();let intercepted=0;const original=f.store.applyLoopBusinessProjection.bind(f.store);const spy=vi.spyOn(f.store,'applyLoopBusinessProjection').mockImplementation(input=>{intercepted++;expect(()=>other.store.applyLoopBusinessProjection(input)).toThrow();expect(()=>original(input)).toThrow();throw Error('burned');});const host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{await expect(host.project({runId:f.candidate.runId,requestSource:'user'})).rejects.toThrow('burned');expect(intercepted).toBe(1);expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');}finally{spy.mockRestore();await host.close();other.close();f.close();}});

const definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
it('opens only original evening members and preserves accepted decision overlay across refresh',async()=>{
 const root=mkdtempSync(join(tmpdir(),'loop-projection-evening-')),store=new LoopStore(join(root,'loop.sqlite')),loopId='personal-assistant-evening-reflection';store.ensureBuiltInLoops(1);
 store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'Asia/Shanghai',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});store.setLoopStatus(loopId,'active',1);
 store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'assistant',assistantKind:'evening',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
 const begin=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
 store.openLoopPublicationProducer(begin.run).recordAssistantOutput(validateEveningReflection({summary:'Original summary',candidates:[{kind:'memory',title:'Original',content:'Original body',scope:'global',confidence:1,evidenceRefs:[{kind:'task',id:'actual'}],dedupeKey:'original'}]}),10);
 const candidates=store.recoverLoopPublicationCandidates({runId:begin.run.id,requestSource:'user'});await publishAll(store,candidates);const host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>100,assistantTargets:{async ensureMemory(){return {targetRef:'memory:target'};},async ensureKnowledge(){throw Error('unexpected');},async ensureFollowUp(){throw Error('unexpected');}}});
 try{const first=await host.project({runId:begin.run.id,requestSource:'user'});const member=store.listAssistantCandidates({statuses:['pending']})[0];expect(member.content).toBe('Original body');
  await host.acceptAssistantCandidate({candidateId:member.id,requestSource:'user'});
  expect((await host.project({runId:begin.run.id,requestSource:'user'})).generation).toBe(first.generation);expect(store.listAssistantCandidates({statuses:['accepted']})).toHaveLength(1);expect(store.recoverLoopPublicationCandidates({runId:begin.run.id,requestSource:'user'})).toEqual(candidates);
  const candidate=candidates[0],old=store.listLoopPublicationAttempts(candidate.candidateId).at(-1)!;
  let native=store.reserveLoopNativeAttempt({candidateId:candidate.candidateId,expectedLatestAttemptId:old.nativeAttemptId,requestSource:'user',now:120});
  for(const phase of ['enrolling','enrolled','binding','ready'] as const)native=store.advanceLoopNativeAttempt({attemptId:native.attemptId,expectedRevision:native.revision,phase,requestSource:'user',now:120+native.revision});
  const p=wire.publications.get(loopHostSubjectOwner(candidate.binding.subject).ownerId);p.challenge={...p.challenge,challengeId:'evening-second',fullTupleHash:'b'.repeat(64)};p.observation={...p.observation,operationId:'evening-second',fullTupleHash:'b'.repeat(64),businessRevision:2};
  const publishing=createLoopPublicationWorkflow({store,assertAdmission(){},now:()=>150});try{await publishing.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:old.attemptId,requestSource:'user'});}finally{await publishing.close();}
  const second=await host.project({runId:begin.run.id,requestSource:'user'});expect(second.generation).toBe(2);expect(second.origin).toEqual(first.origin);expect(store.listAssistantCandidates({statuses:['accepted']})[0].acceptedTargetRef).toBe('memory:target');

 }finally{await host.close();store.close();rmSync(root,{recursive:true,force:true});}
});
it.each(['original','missing','changed'])('requires original actual TaskHost terminal snapshot before template projection: %s',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'loop-projection-template-')),store=new LoopStore(join(root,'loop.sqlite')),loopId='template';store.createUserLoopTemplate({loopId,kind:'task_completion',title:'Original',prompt:'Original task',now:1});
 store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:definition,stages:{execute:definition,verify:definition}}}});
 const begin=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(begin.status!=='started')throw Error('fixture');
 const producer=store.openLoopPublicationProducer(begin.run),execute=store.startLoopStage(begin.run.id,loopId,'execute',4,{taskId:'actual-task'}),snapshot:TaskSnapshot={taskId:'actual-task',sessionId:'original-session',status:'completed',prompt:'Original task',materials:[],events:[],createdAt:4,updatedAt:8};
 producer.recordTemplateExecution({executeStageId:execute.id,taskSnapshot:snapshot,summary:'Original execution',evidenceIds:[],artifacts:[],now:9});const verify=store.startLoopStage(begin.run.id,loopId,'verify',10,{taskId:'actual-task'});producer.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'Original verification',evidenceIds:[],artifacts:[],now:11});
 await publishAll(store,store.recoverLoopPublicationCandidates({runId:begin.run.id,requestSource:'user'}));
 const host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>100,...(mode==='missing'?{}:{taskPort:{async recoverTask(id:string){expect(id).toBe('actual-task');return mode==='changed'?{...snapshot,sessionId:'foreign'}:snapshot;}}})});
 try{const work=host.project({runId:begin.run.id,requestSource:'scheduler'});if(mode==='original'){await work;expect(store.listLoopStages(begin.run.id).every(s=>s.status==='success')).toBe(true);expect(store.recoverLoopPublicationCandidates({runId:begin.run.id,requestSource:'user'})).toHaveLength(3);}else{await expect(work).rejects.toThrow();expect(store.getLoopRun(begin.run.id)?.status).toBe('running');}}
 finally{await host.close();store.close();rmSync(root,{recursive:true,force:true});}
});
it('never treats a cached or forged protected success as a current completion observation',async()=>{const f=await fixture(),db=new DatabaseSync(f.file),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{
 await host.project({runId:f.candidate.runId,requestSource:'user'});expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');
 db.exec('DELETE FROM loop_projection_generations; DELETE FROM loop_projection_origins');
 expect(f.store.getLoopRunLifecycle(f.candidate.runId)?.businessState).toBe('publication_pending');
 expect(()=>f.store.recoverLoopPublicationCandidates({runId:f.candidate.runId,requestSource:'user'})).toThrow();
 }finally{db.close();await host.close();f.close();}});
it('fresh inspection reads all actual publications without writing a historical projection',async()=>{const f=await fixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{const state=await host.inspect({runId:f.candidate.runId,requestSource:'scheduler'});expect(state.businessState).toBe('success');expect(state.observation.publications).toHaveLength(2);expect(f.store.getLoopRun(f.candidate.runId)?.status).toBe('running');expect(f.store.getLoopBusinessProjection(f.candidate.runId)).toBeUndefined();}finally{await host.close();f.close();}});

// The fixed reader leaf reproduces its actual immutable wrapper + independent
// bytes getter. This tests the real host boundary, not signed controller I/O.
it.each(['snapshot','abort-during-getter','route-during-getter','getter-error','post-read-route','source'] as const)('captures a six-field user-template content snapshot at the actual host boundary: %s',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'loop-output-payload-')),store=new LoopStore(join(root,'loop.sqlite')),loopId='template-payload';
 let host:ReturnType<typeof createLoopBusinessPublicationHost>|undefined;
 try{
  store.createUserLoopTemplate({loopId,kind:'task_completion',title:'Original',prompt:'Original task',now:1});
  store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'user-template'},verificationDefinitions:{run:definition,stages:{execute:definition,verify:definition}}}});
  const began=store.beginLoopRun(loopId,{kind:'manual'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('fixture');
  const producer=store.openLoopPublicationProducer(began.run),execute=store.startLoopStage(began.run.id,loopId,'execute',4,{taskId:'payload-task'}),snapshot:TaskSnapshot={taskId:'payload-task',sessionId:'original-session',status:'completed',prompt:'Original task',materials:[],events:[],createdAt:4,updatedAt:8};
  producer.recordTemplateExecution({executeStageId:execute.id,taskSnapshot:snapshot,summary:'Original execution',evidenceIds:[],artifacts:[],now:9});
  const verify=store.startLoopStage(began.run.id,loopId,'verify',10,{taskId:'payload-task'});producer.recordTemplateTerminal({executeStageId:execute.id,verifyStageId:verify.id,summary:'Original verification',evidenceIds:[],artifacts:[],now:11});
  const candidates=store.recoverLoopPublicationCandidates({runId:began.run.id,requestSource:'user'});await publishAll(store,candidates);
  host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>100,taskPort:{async recoverTask(){return snapshot;}}});await host.project({runId:began.run.id,requestSource:'user'});
  const rootCandidate=candidates.find(c=>c.stageId===null)!,owner=loopHostSubjectOwner(rootCandidate.binding.subject),expected=wire.publications.get(owner.ownerId).observation,abort=new AbortController(),reason={original:'getter failure'};
  wire.payloadGetter=()=>{if(mode==='abort-during-getter')abort.abort(Error('payload_read_cancelled'));if(mode==='route-during-getter')wire.routes.set(owner.ownerId,{kind:'ordinary'});if(mode==='getter-error')throw reason;};
  const request={runId:began.run.id,requestSource:'user' as const,signal:abort.signal};
  if(mode==='source'){await expect(host.readUserTemplateOutput({...request,requestSource:'scheduler'})).rejects.toThrow('loop_output_source');expect(wire.payloadGetterReads).toBe(0);return;}
  const work=host.readUserTemplateOutput(request);
  if(mode==='abort-during-getter'||mode==='route-during-getter'||mode==='getter-error'){
   // Do not let a failed assertion's formatter itself evaluate the returned getter.
   const outcome=await work.then(()=>({failed:false,error:undefined}),(error:unknown)=>({failed:true,error}));
   expect(outcome.failed).toBe(true);if(mode==='getter-error')expect(outcome.error).toBe(reason);else expect(outcome.error).toBeInstanceOf(Error);expect(wire.payloadGetterReads).toBe(1);return;
  }
  const output=await work;
  if(mode==='post-read-route'){wire.routes.set(owner.ownerId,{kind:'ordinary'});expect(output.assertCurrent).toThrow();return;}
  expect(Reflect.ownKeys(output.payload).sort()).toEqual(['owner','businessRevision','operationId','fullTupleHash','payloadHash','bytes'].sort());
  const descriptors=Object.getOwnPropertyDescriptors(output.payload);expect(Object.values(descriptors).every(d=>'value'in d)).toBe(true);expect(Object.isFrozen(output.payload)).toBe(true);expect(wire.payloadGetterReads).toBe(1);
  expect(output.payload).toMatchObject({owner:expected.owner,businessRevision:expected.businessRevision,operationId:expected.operationId,fullTupleHash:expected.fullTupleHash,payloadHash:'a'.repeat(64)});
  const bytes=output.payload.bytes;expect(output.payload.bytes).toBe(bytes);expect(bytes.toString()).toBe('verified-fixture');bytes.fill(0);
  const next=await host.readUserTemplateOutput(request);expect(next.payload.bytes.toString()).toBe('verified-fixture');expect(next.payload.bytes).not.toBe(bytes);expect(wire.payloadGetterReads).toBe(2);
 }finally{await host?.close();store.close();rmSync(root,{recursive:true,force:true});}
});
