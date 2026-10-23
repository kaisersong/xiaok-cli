import {beforeEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {validateEveningReflection} from '../../electron/assistant-llm.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {DatabaseSync} from 'node:sqlite';
const wire=vi.hoisted(()=>({routes:new Map<string,any>(),applications:new Map<string,any>(),publications:new Map<string,any>(),current:undefined as any,change:undefined as undefined|(()=>void),reads:0,hold:undefined as Promise<void>|undefined}));
vi.mock('../../../src/runtime/verification/installed-owner-state.js',()=>({readInstalledCurrentOwner:(o:any)=>wire.routes.get(o.ownerId)??{kind:'ordinary'}}));
vi.mock('../../../src/runtime/verification/installed-loop-application.js',()=>({createInstalledLoopApplicationClient:(b:any)=>({async inspect(){return {state:'active',current:wire.applications.get(b.candidateId),pendingTransitionId:null,pendingTarget:null};},dispose(){}})}));
vi.mock('../../../src/runtime/verification/installed-completion-publication.js',()=>({createInstalledCompletionPublisher:(o:any)=>({async prepareRequest(){wire.current=wire.publications.get(o.ownerId);return wire.current.challenge;},async approve(){return wire.current.observation;},dispose(){}})}));
vi.mock('../../../src/runtime/loop/published-candidate.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-candidate.js')>(),readCurrentLoopPublishedCandidate:async(b:any)=>{wire.reads++;await wire.hold;const p=[...wire.publications.values()].find(p=>p.binding.candidateId===b.candidateId);return {...p.observation,binding:b,application:wire.applications.get(b.candidateId),payloadHash:'a'.repeat(64),bytes:Buffer.from('verified-fixture')};}}));
vi.mock('../../../src/runtime/loop/published-set.js',async original=>({...await original<typeof import('../../../src/runtime/loop/published-set.js')>(),readCurrentLoopPublicationSet:async(bs:any[])=>{wire.change?.();return {clock:{domainId:'clock',qualificationEpoch:1,lowerBound:1000,upperBound:1001,evidenceHash:'a'.repeat(64)},publications:bs.map(b=>{const p=[...wire.publications.values()].find(p=>p.binding.candidateId===b.candidateId);const {owner,businessRevision,operationId,fullTupleHash}=p.observation;return {owner,businessRevision,operationId,fullTupleHash,application:wire.applications.get(b.candidateId)};})};}}));
import {loopPublicationFixture,readyLoopNative} from '../support/loop-publication-fixture.js';
import {createLoopPublicationWorkflow} from '../../electron/loop-publication-workflow.js';
import {createLoopBusinessPublicationHost} from '../../electron/loop-business-publication-host.js';
import {loopHostSubjectOwner} from '../../../src/runtime/verification/loop-host-subject.js';
import {LoopStore} from '../../electron/loop-store.js';
beforeEach(()=>{wire.routes.clear();wire.applications.clear();wire.publications.clear();wire.change=undefined;wire.reads=0;wire.hold=undefined;});
async function publishAll(store:LoopStore,candidates:ReturnType<LoopStore['listLoopPublicationCandidates']>){const workflow=createLoopPublicationWorkflow({store,assertAdmission(){},now:()=>40});
 try{for(const c of candidates){const native=readyLoopNative({store,candidate:c}),owner={profileId:'profile',...loopHostSubjectOwner(c.binding.subject)},route={kind:'protected-unregistered',authorityId:'authority',owner},application={binding:c.binding,bindingHash:c.bindingHash,revision:1};
  const challenge={challengeId:'challenge-'+c.candidateId,owner,fullTupleHash:'a'.repeat(64),deadline:{domainId:'clock',qualificationEpoch:1,notBefore:1000,validUntil:2000}},observation={owner,status:'committed',operationId:'operation-'+c.candidateId,fullTupleHash:'a'.repeat(64),businessRevision:1,currentVerification:'valid'};
  wire.routes.set(owner.ownerId,route);wire.applications.set(c.candidateId,application);wire.publications.set(owner.ownerId,{binding:c.binding,challenge,observation});
  await workflow.start({nativeAttemptId:native.attemptId,expectedLatestAttemptId:null,requestSource:'user'});
 }}finally{await workflow.close();}
}
async function fixture(missingStage=false){const f=loopPublicationFixture({kind:'manual',logicalRunKey:'original'});await publishAll(f.store,[f.candidate,...(missingStage?[]:[f.scanCandidate])]);return f;}

import {CompletionEvidenceStore} from '../../electron/completion-evidence-store.js';
import {createLoopRunner} from '../../electron/loop-executor.js';
import {createAssistantRuntime} from '../../electron/assistant-runtime.js';
async function projected(){const f=await fixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});await host.project({runId:f.candidate.runId,requestSource:'user'});await host.close();return f;}
it('normal runner consumes fresh all-member publication for same logical key without scanning again',async()=>{
 const f=await projected(),evidence=new CompletionEvidenceStore(join(f.root,'consumer.sqlite')),scan=vi.fn(()=>{throw Error('must not rerun');}),runner=createLoopRunner({loopStore:f.store,evidenceStore:evidence,scanner:{scan},now:()=>60});
 try{const before=wire.reads;expect(await runner.runLoopNow(f.loopId,{kind:'manual',logicalRunKey:'original'},undefined,{requestSource:'scheduler'})).toEqual({status:'already_completed',completedRunId:f.candidate.runId});expect(wire.reads-before).toBe(2);expect(scan).not.toHaveBeenCalled();wire.change=()=>{throw Error('revoked');};expect((await runner.runLoopNow(f.loopId,{kind:'manual',logicalRunKey:'original'},undefined,{requestSource:'user'})).status).toBe('publication_pending');expect(scan).not.toHaveBeenCalled();}finally{evidence.close();f.close();}
});
it('actual assistant runner uses the same fresh completion path without a second LLM call',async()=>{
 const f=loopPublicationFixture(),store=f.store,loopId='personal-assistant-evening-reflection',evidence=new CompletionEvidenceStore(join(f.root,'assistant.sqlite'));
 store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'UTC',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});store.setLoopStatus(loopId,'active',1);
 const definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};
 store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'assistant',assistantKind:'evening',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
 const complete=vi.fn(async()=>({text:JSON.stringify({summary:'Original',candidates:[]})})),runner=createAssistantRuntime({loopStore:store,evidenceStore:evidence,collect:async()=>({}),llmPort:{complete} as any,now:()=>10});
 const host=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>100});
 try{const first=await runner.runLoopNow(loopId,undefined,undefined,{requestSource:'user'});if(!('run'in first))throw Error('missing run');await publishAll(store,store.recoverLoopPublicationCandidates({runId:first.run.id,requestSource:'user'}));await host.project({runId:first.run.id,requestSource:'user'});const before=wire.reads;expect(await runner.runLoopNow(loopId,undefined,undefined,{requestSource:'scheduler'})).toEqual({status:'already_completed',completedRunId:first.run.id});expect(wire.reads-before).toBe(1);expect(complete).toHaveBeenCalledTimes(1);}finally{await host.close();evidence.close();f.close();}
});

import {consumeLoopCompletedRun} from '../../electron/loop-business-publication-host.js';
import {readLoopCompletedRun} from '../../electron/loop-completion-consumer.js';
function completionInput(f:Awaited<ReturnType<typeof projected>>){return {runId:f.candidate.runId,loopId:f.loopId,logicalRunKey:'original',requestSource:'user' as const};}
it.each(['copy','wrong-store','wrong-source','replay','route','vector','cancel'] as const)('single-use completion rejects %s without blessing cached facts',async mode=>{
 const f=await projected(),other=loopPublicationFixture(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){}}),abort=new AbortController(),input={...completionInput(f),signal:abort.signal};
 try{const ticket=await host.prepareCompletedRun(input);
  if(mode==='copy'){expect(()=>consumeLoopCompletedRun(f.store,input,{...ticket})).toThrow('ticket');consumeLoopCompletedRun(f.store,input,ticket);}
  else if(mode==='wrong-store'){expect(()=>consumeLoopCompletedRun(other.store,input,ticket)).toThrow('ticket');}
  else if(mode==='wrong-source'){expect(()=>consumeLoopCompletedRun(f.store,{...input,requestSource:'scheduler'},ticket)).toThrow('ticket');}
  else if(mode==='replay'){consumeLoopCompletedRun(f.store,input,ticket);}
  else if(mode==='route'){wire.routes.set(loopHostSubjectOwner(f.candidate.binding.subject).ownerId,{kind:'unavailable'});expect(()=>consumeLoopCompletedRun(f.store,input,ticket)).toThrow();}
  else if(mode==='vector'){f.store.setLoopStatus(f.loopId,'paused',70);expect(()=>consumeLoopCompletedRun(f.store,input,ticket)).toThrow();}
  else {abort.abort(Error('cancel original read'));expect(()=>consumeLoopCompletedRun(f.store,input,ticket)).toThrow();}
  expect(()=>consumeLoopCompletedRun(f.store,input,ticket)).toThrow('ticket');
 }finally{await host.close();other.close();f.close();}
});
it('a ticket binds the routes actually checked by the host even if the caller restores an earlier route',async()=>{
 const f=await projected(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){}}),input=completionInput(f),id=loopHostSubjectOwner(f.candidate.binding.subject).ownerId,route=wire.routes.get(id);
 try{const pending=host.prepareCompletedRun(input);wire.routes.set(id,{...route,authorityId:'different-authority'});const ticket=await pending;wire.routes.set(id,route);expect(()=>consumeLoopCompletedRun(f.store,input,ticket)).toThrow();}finally{await host.close();f.close();}
});
it('full vector changes during the final set read cannot receive a completion ticket',async()=>{
 const f=await projected(),host=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){}});try{wire.change=()=>f.store.setLoopStatus(f.loopId,'paused',70);await expect(host.prepareCompletedRun(completionInput(f))).rejects.toThrow();}finally{await host.close();f.close();}
});
it('fixed helper never invokes input accessors, including the rejection cleanup path',async()=>{
 const f=await projected();let calls=0;try{expect(await readLoopCompletedRun(f.store,{...completionInput(f),get signal(){calls++;return undefined;}})).toBe(false);expect(calls).toBe(0);}finally{f.close();}
});
it('ordinary success remains compatible but its original route is checked again at consumption',async()=>{
 const f=loopPublicationFixture(),store=new LoopStore(join(f.root,'ordinary.sqlite'));store.ensureBuiltInLoops(1);const began=store.beginLoopRun(f.loopId,{kind:'manual',logicalRunKey:'original'},3,1000,{requestSource:'user'});if(began.status!=='started')throw Error('begin');store.finishLoopRunSuccess(began.run.id,[],4,'Original');
 const input={runId:began.run.id,loopId:f.loopId,logicalRunKey:'original',requestSource:'scheduler' as const},host=createLoopBusinessPublicationHost({store,assertAdmission(){}});
 try{expect(await readLoopCompletedRun(store,input)).toBe(true);const ticket=await host.prepareCompletedRun(input);wire.routes.set(completionConsumerOwner({ownerKind:'loop_run',ownerId:began.run.id}).ownerId,{kind:'unavailable'});expect(()=>consumeLoopCompletedRun(store,input,ticket)).toThrow();}finally{await host.close();store.close();f.close();}
});
import {completionConsumerOwner} from '../../../src/runtime/verification/completion-consumer-owner.js';

import {TimedActionStore} from '../../electron/timed-action-store.js';
import {createLoopTimedCompletionHost} from '../../electron/loop-timed-completion.js';
import {TimedActionScheduler} from '../../electron/timed-action-scheduler.js';
async function timedFixture(published=true){let clock=60;const root=mkdtempSync(join(tmpdir(),'timed-published-')),timed=new TimedActionStore(join(root,'timed.sqlite'));timed.createAction({id:'timed',title:'Original',trigger:{kind:'once',at:2},executor:{kind:'loop',loopId:'artifact-evidence-regression'},source:'user',now:1});const [claim]=timed.claimDueActions(2,1,{recoveryReason:'normal_tick'});timed.markRunRunning('timed',claim.runId,2);const f=loopPublicationFixture({kind:'scheduled',timedActionId:'timed',timedActionRunId:claim.runId,scheduledDueAt:2});const host=createLoopTimedCompletionHost({timedStore:timed,loopStore:f.store,captureAdmission:()=>()=>{},now:()=>clock});const publish=async()=>{await publishAll(f.store,f.store.listLoopPublicationCandidates(f.candidate.runId));const business=createLoopBusinessPublicationHost({store:f.store,assertAdmission(){},now:()=>50});try{await business.project({runId:f.candidate.runId,requestSource:'scheduler'});}finally{await business.close();}};if(published)await publish();return{...f,timed,host,publish,setTime(value:number){clock=value;},input:{actionId:'timed',timedRunId:claim.runId,loopRunId:f.candidate.runId,mode:'normal' as const,requestSource:'scheduler' as const},async close(){await host.close();timed.close();f.close();rmSync(root,{recursive:true,force:true});}};}
it.each([false,true])('pending receipt upgrades only the original history, cancelled=%s, and never counts twice',async cancel=>{
 const f=await timedFixture(false);try{expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',outcome:'publication_pending'});expect(f.timed.getAction('timed')).toMatchObject({status:'paused',runCount:1});if(cancel)f.timed.cancelAction('timed','user',61);f.setTime(70);await f.publish();const result=await f.host.finalize({...f.input,mode:'stale'});expect(result).toMatchObject({status:'applied',outcome:'success'});expect(f.timed.getAction('timed')).toMatchObject({status:cancel?'cancelled':'completed',runCount:1});expect(f.timed.listRuns('timed')[0].status).toBe('success');}finally{await f.close();}
});
it('same scheduler tick is single-flight and a version conflict retries on the next tick before stale timeout',async()=>{
 const f=await timedFixture(),scheduler=new TimedActionScheduler(f.timed,{loopCompletion:f.host,executors:{},now:()=>60,staleAfterMs:999999});let release!:()=>void;wire.hold=new Promise<void>(r=>release=r);
 try{const first=scheduler.runOnce(),second=scheduler.runOnce();expect(first).toBe(second);await vi.waitFor(()=>expect(wire.reads).toBeGreaterThan(2));f.timed.createAction({id:'unrelated',title:'Other',trigger:{kind:'once',at:9999},executor:{kind:'notify',message:'Other'},source:'user',now:3});release();await first;expect(f.timed.listRuns('timed')[0].status).toBe('running');wire.hold=undefined;await scheduler.runOnce();expect(f.timed.listRuns('timed')[0].status).toBe('success');expect(f.timed.getAction('timed')?.runCount).toBe(1);}finally{release();scheduler.stopAccepting();await f.close();}
});
it('actual held SDK read is drained before close resolves, with no late durable success',async()=>{
 const f=await timedFixture();let release!:()=>void;wire.hold=new Promise<void>(r=>release=r);const work=f.host.finalize(f.input);void work.catch(()=>{});
 try{await vi.waitFor(()=>expect(wire.reads).toBeGreaterThan(2));let drained=false;const close=f.host.close().then(()=>drained=true);await Promise.resolve();expect(drained).toBe(false);release();await Promise.allSettled([work,close]);expect(drained).toBe(true);expect(f.timed.listRuns('timed')[0].status).toBe('running');}finally{release();await f.close();}
});
it('a precise changed original publication configuration rejects an unconsumed occurrence',async()=>{
 const f=await timedFixture(false);try{const original=f.store.getLoopPublicationConfiguration(f.loopId)!;f.store.saveLoopPublicationConfiguration({loopId:f.loopId,expectedRevision:original.revision,requestSource:'user',now:55,configuration:original.configuration});expect(await f.host.finalize(f.input)).toMatchObject({status:'applied',outcome:'rejected'});expect(f.timed.getAction('timed')).toMatchObject({runCount:0,lockedRunId:undefined});}finally{await f.close();}
});
it.each(['unavailable','rebound'] as const)('original publication route %s cannot silently advance the occurrence',async fault=>{
 const f=await timedFixture();try{const id=loopHostSubjectOwner(f.candidate.binding.subject).ownerId,original=wire.routes.get(id);wire.routes.set(id,fault==='unavailable'?{kind:'unavailable'}:{...original,authorityId:'different'});expect(await f.host.finalize(f.input)).toMatchObject(fault==='unavailable'?{status:'retry_pending'}:{status:'applied',outcome:'rejected'});expect(f.timed.getAction('timed')?.runCount).toBe(0);}finally{await f.close();}
});
it('temporary pending route with a new authority remains retryable',async()=>{
 const f=await timedFixture();try{const id=loopHostSubjectOwner(f.candidate.binding.subject).ownerId;wire.routes.set(id,{...wire.routes.get(id),kind:'pending',authorityId:'new'});expect(await f.host.finalize(f.input)).toEqual({status:'retry_pending'});expect(f.timed.getAction('timed')?.runCount).toBe(0);}finally{await f.close();}
});
it('pending original configuration cannot be replaced by a different revision before upgrade',async()=>{
 const f=await timedFixture(false);try{await f.host.finalize(f.input);await f.publish();const original=f.store.getLoopPublicationConfiguration(f.loopId)!;f.store.saveLoopPublicationConfiguration({loopId:f.loopId,expectedRevision:original.revision,requestSource:'user',now:55,configuration:original.configuration});await expect(f.host.finalize(f.input)).rejects.toThrow('identity');expect(f.timed.getLoopTimedReceipt(f.input.timedRunId)?.disposition).toBe('pending');}finally{await f.close();}
});
it.each([false,true])('actual assistant reused occurrence has durable original identity across pending=%s',async pending=>{
 const f=loopPublicationFixture(),store=f.store,loopId='personal-assistant-evening-reflection',evidence=new CompletionEvidenceStore(join(f.root,'reuse-evidence.sqlite')),timed=new TimedActionStore(join(f.root,'reuse-timed.sqlite'));
 store.ensureAssistantProfile({id:'default-personal-assistant',status:'active',locale:'zh',timeZone:'UTC',eveningTime:'20:00',morningTime:'08:00',workdays:[1],quietHours:{start:'22:00',end:'07:00'},dataScopes:['tasks'],createdAt:1,updatedAt:1});store.setLoopStatus(loopId,'active',1);
 const definition={version:1,obligations:[{obligationId:'original',predicateId:'content',predicateVersion:'1',semantics:'current-subject',recipe:{kind:'artifact-content',checks:[{id:'check',path:'report',sha256:'a'.repeat(64),structure:'bytes'}]}}]};store.saveLoopPublicationConfiguration({loopId,expectedRevision:null,requestSource:'user',now:2,configuration:{version:1,contract:{kind:'assistant',assistantKind:'evening',objective:'Original',completionCriterion:'Original'},verificationDefinitions:{run:definition,stages:{}}}});
 const complete=vi.fn(async()=>({text:JSON.stringify({summary:'Original',candidates:[]})})),runner=createAssistantRuntime({loopStore:store,evidenceStore:evidence,collect:async()=>({}),llmPort:{complete} as any,now:()=>10}),business=createLoopBusinessPublicationHost({store,assertAdmission(){},now:()=>50}),host=createLoopTimedCompletionHost({timedStore:timed,loopStore:store,captureAdmission:()=>()=>{},now:()=>60});
 try{const first=await runner.runLoopNow(loopId,{kind:'scheduled',scheduledDueAt:2},undefined,{requestSource:'scheduler'});if(!('run'in first))throw Error('run');await publishAll(store,store.recoverLoopPublicationCandidates({runId:first.run.id,requestSource:'user'}));await business.project({runId:first.run.id,requestSource:'scheduler'});timed.createAction({id:'reuse',title:'Reused',trigger:{kind:'once',at:2},executor:{kind:'loop',loopId},source:'user',now:1});const claim=timed.claimDueActions(2,1,{recoveryReason:'normal_tick'})[0];timed.markRunRunning('reuse',claim.runId,2);const input={actionId:'reuse',timedRunId:claim.runId,loopRunId:first.run.id,mode:'reused' as const,requestSource:'scheduler' as const};if(pending)wire.change=()=>{throw Error('expired');};expect(await host.finalize(input)).toMatchObject({status:'applied',outcome:pending?'publication_pending':'success'});if(pending){wire.change=undefined;expect(await host.finalize({...input,mode:'stale'})).toMatchObject({status:'applied',outcome:'success'});}expect(timed.getAction('reuse')?.runCount).toBe(pending?1:0);expect(timed.getLoopTimedReceipt(claim.runId)?.decision?.reused).toBe(true);expect(complete).toHaveBeenCalledTimes(1);}finally{await host.close();await business.close();timed.close();evidence.close();f.close();}
});

import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {createLoopCurrentViews,registerLoopCurrentViewIpc} from '../../electron/loop-current-views.js';
it('Main views distinguish a fresh read observation from expired historical success without rerunning',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{},now:()=>80});try{expect((await views.getLoopRuns(f.loopId))[0]).toMatchObject({status:'success',businessState:'success',completionObservation:{state:'verified_at_read',checkedAt:80}});wire.routes.set(completionConsumerOwner({ownerKind:'loop_run',ownerId:f.candidate.runId}).ownerId,{kind:'unavailable'});expect((await views.getLoopRuns(f.loopId))[0]).toMatchObject({status:'success',businessState:'publication_pending',completionObservation:{state:'needs_revalidation'}});expect((await views.getRunHistory())[0]).toMatchObject({status:'publication_pending',historyStatus:'success',completionObservation:{state:'needs_revalidation'}});expect(f.timed.getAction('timed')?.runCount).toBe(0);}finally{await views.close();await f.close();}
});
it('Main view downgrades success if the original timed population changes during the actual read',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});try{wire.change=()=>f.timed.cancelAction('timed','changed',65);expect((await views.getRunHistory())[0]).toMatchObject({status:'publication_pending',completionObservation:{state:'needs_revalidation'}});}finally{await views.close();await f.close();}
});
it('Main view close retains the actual read until its SDK leaf drains',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});let release!:()=>void;wire.hold=new Promise<void>(r=>release=r);const work=views.getLoopRuns(f.loopId);void work.catch(()=>{});try{await vi.waitFor(()=>expect(wire.reads).toBeGreaterThan(2));let closed=false;const closing=views.close().then(()=>closed=true);await Promise.resolve();expect(closed).toBe(false);release();await Promise.allSettled([work,closing]);expect(closed).toBe(true);await expect(views.getLoopRuns(f.loopId)).rejects.toThrow('closed');}finally{release();await views.close();await f.close();}
});
it('Main history refuses a naked decision linking a timed occurrence to an unrelated successful run',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});try{const other=f.store.beginLoopRun('kswarm-service-health',{kind:'manual'},61,1000,{requestSource:'user'});if(other.status!=='started')throw Error('begin');f.store.finishLoopRunSuccess(other.run.id,[],62,'Other');const db=(f.timed as unknown as {db:DatabaseSync}).db;db.prepare('UPDATE timed_action_runs SET decision_json=? WHERE run_id=?').run(JSON.stringify({loopRunId:other.run.id,loopStatus:'success'}),f.input.timedRunId);const rows=await views.getRunHistory();expect(rows.find(row=>row.scheduleRunId===f.input.timedRunId)).toMatchObject({status:'publication_pending',completionObservation:{state:'needs_revalidation'}});}finally{await views.close();await f.close();}
});

it('actual view IPC binds Main user ingress and rejects fabricated source or extra arguments',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}}),handlers=new Map<string,Function>(),event={trusted:true};registerLoopCurrentViewIpc({handle:(name,fn)=>{handlers.set(name,fn);}},views,value=>value===event);
 try{const list=handlers.get('desktop:loops:listRuns')!,history=handlers.get('desktop:automations:getRunHistory')!;expect(()=>list({},f.loopId)).toThrow('denied');expect(()=>list(event,f.loopId,{requestSource:'user'})).toThrow('denied');expect(()=>history(event,{success:true})).toThrow('denied');expect((await list(event,f.loopId))[0]).toMatchObject({completionObservation:{state:'verified_at_read'}});expect((await history(event))[0].completionObservation.state).toBe('verified_at_read');}finally{await views.close();await f.close();}
});

it('a completed concurrent ordinary read does not close another request host and every real read owns its gate token',async()=>{
 const f=await timedFixture(),gate=new DesktopShutdownGate(),views=createLoopCurrentViews({gate,loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});let release!:()=>void;wire.hold=new Promise<void>(r=>release=r);const ordinary=f.store.beginLoopRun('kswarm-service-health',{kind:'manual'},65,1000,{requestSource:'user'});if(ordinary.status!=='started')throw Error('begin');f.store.finishLoopRunSuccess(ordinary.run.id,[],66,'Other');const work=views.getLoopRuns(f.loopId);void work.catch(()=>{});
 try{await vi.waitFor(()=>expect(wire.reads).toBeGreaterThan(2));expect(gate.outstanding).toBe(1);expect((await views.getLoopRuns('kswarm-service-health'))[0]).toMatchObject({completionObservation:{state:'verified_at_read'}});expect(gate.outstanding).toBe(1);release();expect((await work)[0]).toMatchObject({completionObservation:{state:'verified_at_read'}});expect(gate.outstanding).toBe(0);}finally{release();await views.close();await f.close();}
});

it.each(['transport','storage'] as const)('view propagates actual %s errors without hiding them as a normal pending response',async fault=>{
 const f=await timedFixture(),gate=new DesktopShutdownGate(),views=createLoopCurrentViews({gate,loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});let spy:{mockRestore():void}|undefined;try{if(fault==='transport')wire.change=()=>{throw Error('ECONNRESET');};else spy=vi.spyOn(f.timed,'getLoopTimedTarget').mockImplementation(()=>{throw Error('disk_io_error');});await expect(views.getRunHistory()).rejects.toThrow(fault==='transport'?'ECONNRESET':'disk_io_error');expect(gate.outstanding).toBe(0);}finally{spy?.mockRestore();await views.close();await f.close();}
});

it('a dependency error cannot impersonate a host verification decision by copying its message',async()=>{
 const f=await timedFixture(),views=createLoopCurrentViews({gate:new DesktopShutdownGate(),loopStore:f.store,timedStore:f.timed,captureAdmission:()=>()=>{}});try{wire.change=()=>{throw Error('loop_projection_task_changed');};await expect(views.getRunHistory()).rejects.toThrow('loop_projection_task_changed');}finally{await views.close();await f.close();}
});
