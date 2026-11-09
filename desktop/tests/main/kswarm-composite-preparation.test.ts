import {createOriginalCompositeFixture} from '../support/original-composite-fixture.js';
// @vitest-environment node
// Original B/Host/source/journal components. IPC role port is controlled here;
// real window/actor admission is covered by project-planning-controls, no Native grant.
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHub} from '../../../../kswarm/src/core/hub.js';
import {createProjectInputAuthority} from '../../../../kswarm/src/core/project-input-authority.js';
import {ConversationProjectService} from '../../electron/conversation-project-service.js';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import {JsonKSwarmInitialPlanBootstrapStore,KSwarmInitialPlanBootstrapQueue} from '../../electron/kswarm-initial-plan-bootstrap.js';
import {createInitialPlanOwnerClient} from '../../electron/kswarm-initial-plan-owner-client.js';
import {registerProjectPlanningIpc} from '../../electron/project-planning-typed-ipc.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
const closes:Array<()=>Promise<void>>=[];beforeEach(resetIpcSchemaRegistryForTests);afterEach(async()=>{for(const close of closes.splice(0))await close();});
const fixture=()=>createOriginalCompositeFixture(closes);

it('the same original journal atomically prepares one frozen pending job/request while two actual source reads join',async()=>{
 const f=await fixture(),before=f.hub.getPersistenceHealth().revision;const results=await f.withTrigger(async proof=>Promise.all([f.prepare(proof),f.prepare(proof)]));expect(results[0].preparation).toEqual(results[1].preparation);expect(results[0].job.planRunId).toBe(results[1].job.planRunId);expect(f.store.list()).toHaveLength(1);const job=f.store.list()[0];expect(job.status).toBe('pending');expect(job.attempts).toBe(0);expect(Object.hasOwn(job,'claimToken')).toBe(false);expect(job.modelAttempted).toBeUndefined();expect(f.store.claimDue(1000,1)).toEqual([]);expect(f.hub.getPersistenceHealth().revision).toBe(before);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);
 expect(JSON.parse(readFileSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8')).revision).toBe(1);expect(readFileSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8').includes(f.prompt)).toBe(false);
});
it('the prepared exact request reaches the original B composite transaction without a second Main or B revision',async()=>{
 const f=await fixture(),result=await f.withTrigger(proof=>f.prepare(proof)),before=f.hub.getProject('p').projectRevision,source=(await import('../../electron/conversation-project-service.js')).resolveProjectUserSourceProof(f.sourceProof,f.projects);
 const applied=f.hub.applyOrdinaryTaskMetadataInput('p',result.submission.input,{requestSource:'user',projectInputAuthority:f.authority.user(source),initialPlanningAuthority:f.authority.planner(),initialPlanClaim:result.preparation.claimRequest});expect(applied.ok).toBe(true);expect(f.hub.getProject('p').projectRevision).toBe(before+1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);expect(f.hub.readInitialPlanInputs('p',f.authority.reader()).reservation.planRunId).toBe(result.job.planRunId);expect(f.store.claimDue(1000,1)).toEqual([]);
});

it('prepared journal recovery preserves the exact original run and frozen request across a new live explicit gesture',async()=>{
 const f=await fixture(),first=await f.withTrigger(proof=>f.prepare(proof)),second=await f.withTrigger(proof=>f.prepare(proof));expect(second.preparation).toEqual(first.preparation);expect(second.job).toEqual(first.job);expect(JSON.parse(readFileSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8')).revision).toBe(1);expect(new JsonKSwarmInitialPlanBootstrapStore(f.root).list()).toEqual([first.job]);
});
it('an expired, forged or foreign-owner gesture cannot write even a pending journal',async()=>{
 const f=await fixture();let expired:unknown;await f.withTrigger(async proof=>{expired=proof;return null;});for(const proof of [expired,{},Object.freeze(Object.create(null))])await expect(f.prepare(proof)).rejects.toThrow('project_planning_trigger_unverified');expect(f.store.list()).toEqual([]);expect(existsSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'))).toBe(false);
});
it('the original pending preparation cannot be silently replaced by a changed proposal or current CAS snapshot',async()=>{
 const f=await fixture(),first=await f.withTrigger(proof=>f.prepare(proof));await expect(f.withTrigger(proof=>f.prepare(proof,{title:'A changed command'}))).rejects.toThrow('bootstrap_composite_request_conflict');expect(f.store.list()).toEqual([first.job]);expect(JSON.parse(readFileSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8')).revision).toBe(1);
});
it('malformed proposal data cannot invoke a hook, supply an authority field, allocate an id or dirty the journal',async()=>{
 const f=await fixture();let hooks=0;const accessor={};Object.defineProperty(accessor,'title',{enumerable:true,get(){hooks++;return 'hidden';}});
 for(const proposal of [{qualified:true},{body:'caller rewritten'}, {tasks:[{id:'supplied',title:'new'}]}, {tasks:[{title:'new'}],brief:''},accessor])await expect(f.withTrigger(proof=>Reflect.apply(Reflect.get(f.store,'prepareOrJoinTaskComposite'),f.store,[f.payload,{triggerProof:proof,ownerStateProof:f.read.unclaimedProof,sourceProof:f.sourceProof},proposal,10]))).rejects.toThrow('bootstrap_composite_proposal_invalid');
 expect(hooks).toBe(0);expect(f.store.list()).toEqual([]);
});
it('the original source read cannot commit a preparation after its live actor is revoked',async()=>{
 const f=await fixture(),actual=f.projects.readOriginalTaskSource.bind(f.projects);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(yes=>{enter=yes;}),held=new Promise<void>(yes=>{release=yes;});const spy=vi.spyOn(f.projects,'readOriginalTaskSource').mockImplementation((...args)=>{const original=actual(...args);return original.then(async value=>{enter();await held;return value;});});
 try{const pending=f.withTrigger(proof=>f.prepare(proof)).then(value=>({value}),error=>({error}));await entered;f.revoke();release();const outcome=await pending;expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error.message).toBe('project_planning_trigger_unverified');expect(f.store.list()).toEqual([]);}finally{release();spy.mockRestore();}
});
it('the original journal lock makes a competing preparation fail without inventing a run or touching B',async()=>{
 const f=await fixture();writeFileSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json.lock'),'owned test conflict');try{await expect(f.withTrigger(proof=>f.prepare(proof))).rejects.toThrow('bootstrap_journal_busy');expect(f.store.list()).toEqual([]);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);}finally{rmSync(join(f.root,'kswarm-initial-plan-bootstrap-jobs.json.lock'));}
});
it('a rehashed malformed preparation cannot smuggle a second contract, run or unknown field through original journal loading',async()=>{
 const f=await fixture(),first=await f.withTrigger(proof=>f.prepare(proof)),path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),original=readFileSync(path,'utf8'),{compositeDigest}=await import('../../electron/kswarm-composite-journal-data.js');
 try{for(const patch of [{qualified:true},{projectId:'foreign'},{claimRequest:{...first.preparation.claimRequest,planRunId:'11111111-1111-4111-8111-111111111111'}}]){const data=JSON.parse(original);Object.assign(data.jobs[0].taskComposite,patch);const {preparationDigest,...record}=data.jobs[0].taskComposite;data.jobs[0].taskComposite.preparationDigest=compositeDigest(record);writeFileSync(path,JSON.stringify(data));expect(()=>new JsonKSwarmInitialPlanBootstrapStore(f.root).list()).toThrow('bootstrap_composite_journal_invalid');}}
 finally{writeFileSync(path,original);}
});

it('a present but falsy frozen preparation fails closed on restart instead of allowing a changed command',async()=>{
 const f=await fixture();await f.withTrigger(proof=>f.prepare(proof));const path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),original=readFileSync(path,'utf8');try{for(const invalid of [null,false,0,'']){const data=JSON.parse(original);data.jobs[0].taskComposite=invalid;writeFileSync(path,JSON.stringify(data));expect(()=>new JsonKSwarmInitialPlanBootstrapStore(f.root).list()).toThrow('bootstrap_composite_journal_invalid');}}finally{writeFileSync(path,original);}
});

it('actual foreign journal trigger, gateway proof and canonical source owner each fail before a pending write',async()=>{
 const f=await fixture(),g=await fixture(),method=Reflect.get(f.store,'prepareOrJoinTaskComposite'),otherGateway={...f.gateway},otherRead=await createInitialPlanOwnerClient(otherGateway,f.payload.ownerBinding,new AbortController().signal).read();
 await expect(g.withTrigger(proof=>Reflect.apply(method,f.store,[f.payload,{triggerProof:proof,ownerStateProof:f.read.unclaimedProof,sourceProof:f.sourceProof},{title:'new'},10]))).rejects.toThrow('project_planning_trigger_unverified');
 await expect(f.withTrigger(proof=>Reflect.apply(method,f.store,[f.payload,{triggerProof:proof,ownerStateProof:otherRead.unclaimedProof,sourceProof:f.sourceProof},{title:'new'},10]))).rejects.toThrow('bootstrap_unclaimed_owner_state_unverified');
 await expect(f.withTrigger(proof=>Reflect.apply(method,f.store,[f.payload,{triggerProof:proof,ownerStateProof:f.read.unclaimedProof,sourceProof:g.sourceProof},{title:'new'},10]))).rejects.toThrow('conversation_user_source_unverified');
 expect(f.store.list()).toEqual([]);expect(g.store.list()).toEqual([]);
});
it('a fresh authenticated original B control read cannot refresh the CAS of an already frozen Main composite',async()=>{
 const f=await fixture(),first=await f.withTrigger(proof=>f.prepare(proof)),path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),bytes=readFileSync(path,'utf8');
 f.hub.mutateProjectState('p',()=>{f.hub.getProject('p').goal='Updated by the original project owner';});
 const fresh=await createInitialPlanOwnerClient(f.gateway,f.payload.ownerBinding,new AbortController().signal).read();expect(fresh.state.projectControlDigest).not.toBe(first.preparation.claimRequest.expectedProjectControlDigest);
 await expect(f.withTrigger(proof=>Reflect.apply(Reflect.get(f.store,'prepareOrJoinTaskComposite'),f.store,[f.payload,{triggerProof:proof,ownerStateProof:fresh.unclaimedProof,sourceProof:f.sourceProof},{title:'User-added item'},11]))).rejects.toThrow('bootstrap_composite_request_conflict');expect(readFileSync(path,'utf8')).toBe(bytes);expect(f.store.list()[0]).toEqual(first.job);
});

it('two original authenticated readbacks can settle only the exact prepared metadata receipt in the same journal without an M claim',async()=>{
 const f=await fixture(),result=await f.withTrigger(proof=>f.prepare(proof)),source=(await import('../../electron/conversation-project-service.js')).resolveProjectUserSourceProof(f.sourceProof,f.projects);
 const committed=f.hub.applyOrdinaryTaskMetadataInput('p',result.submission.input,{requestSource:'user',projectInputAuthority:f.authority.user(source),initialPlanningAuthority:f.authority.planner(),initialPlanClaim:result.preparation.claimRequest});expect(committed.ok).toBe(true);
 const {observeTaskComposite}=await import('../../electron/kswarm-task-composite-observation.js'),proof=await observeTaskComposite(f.gateway,f.payload.ownerBinding,result.preparation,new AbortController().signal),record=Reflect.get(f.store,'recordTaskCompositeObservation');expect(typeof record).toBe('function');const settled=Reflect.apply(record,f.store,['p',proof]);expect(settled.outcome).toBe('metadata_applied');expect(settled.preparationDigest).toBe(result.preparation.preparationDigest);expect(f.store.list()[0].status).toBe('pending');expect(f.store.claimDue(100,1)).toEqual([]);expect(f.store.list()[0].attempts).toBe(0);expect(f.store.list()[0].modelAttempted).toBeUndefined();
 const path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),bytes=readFileSync(path,'utf8');expect(Reflect.apply(record,f.store,['p',proof])).toEqual(settled);expect(readFileSync(path,'utf8')).toBe(bytes);expect(new JsonKSwarmInitialPlanBootstrapStore(f.root).list()[0].taskCompositeObservation).toEqual(settled);
});

it('an original successful B result cannot mint an observation from altered receipt, reservation or owner transport data',async()=>{
 const f=await fixture(),result=await f.withTrigger(proof=>f.prepare(proof)),source=(await import('../../electron/conversation-project-service.js')).resolveProjectUserSourceProof(f.sourceProof,f.projects),applied=f.hub.applyOrdinaryTaskMetadataInput('p',result.submission.input,{requestSource:'user',projectInputAuthority:f.authority.user(source),initialPlanningAuthority:f.authority.planner(),initialPlanClaim:result.preparation.claimRequest});expect(applied.ok).toBe(true);const {observeTaskComposite}=await import('../../electron/kswarm-task-composite-observation.js'),actual=f.gateway.request.bind(f.gateway),path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),bytes=readFileSync(path,'utf8');
 const mutations:Array<[string,(value:any)=>void]>=[['operation',v=>{v.operation.envelopeDigest='f'.repeat(64);}],['operation',v=>{v.operation.status='accepted_pending';}],['operation',v=>{v.operation.bindingDigest='f'.repeat(64);}],['operation',v=>{v.taskReceipt.writerStoreId='11111111-1111-4111-8111-111111111111';}],['operation',v=>{v.taskReceipt.createReceiptDigest='f'.repeat(64);}],['operation',v=>{v.taskReceipt.operationDigest='f'.repeat(64);}],['operation',v=>{v.taskReceipt.semanticProof.addedTaskRows[0].rowDigest='f'.repeat(64);}],['operation',v=>{v.taskReceipt.qualified=true;}],['state',v=>{v.reservation.planRunId='11111111-1111-4111-8111-111111111111';}],['state',v=>{v.reservation.claimRequest.expectedProjectControlDigest='f'.repeat(64);}],['state',v=>{v.reservation.compositeEnvelopeDigest='f'.repeat(64);}],['state',v=>{v.reservation.commitCommandId='foreign';}],['state',v=>{v.reservation.scope.workspaceId='f'.repeat(64);}],['state',v=>{v.taskOwner.bindingDigest='f'.repeat(64);}],['state',v=>{v.reservation=null;}]];
 for(const [stage,mutate] of mutations){const spy=vi.spyOn(f.gateway,'request').mockImplementation(async(requestPath,...args)=>{const response=await actual(requestPath,...args),value=await response.json();if((stage==='operation')===requestPath.includes('/ordinary-inputs/'))mutate(value);return Response.json(value);});try{await expect(observeTaskComposite(f.gateway,f.payload.ownerBinding,result.preparation,new AbortController().signal)).rejects.toThrow();expect(readFileSync(path,'utf8')).toBe(bytes);}finally{spy.mockRestore();}}
});
it('copied observation data, a foreign gateway proof or a revoked read cannot settle the original job',async()=>{
 const f=await fixture(),result=await f.withTrigger(proof=>f.prepare(proof)),source=(await import('../../electron/conversation-project-service.js')).resolveProjectUserSourceProof(f.sourceProof,f.projects);expect(f.hub.applyOrdinaryTaskMetadataInput('p',result.submission.input,{requestSource:'user',projectInputAuthority:f.authority.user(source),initialPlanningAuthority:f.authority.planner(),initialPlanClaim:result.preparation.claimRequest}).ok).toBe(true);
 const {observeTaskComposite}=await import('../../electron/kswarm-task-composite-observation.js'),otherGateway={...f.gateway},other=await observeTaskComposite(otherGateway,f.payload.ownerBinding,result.preparation,new AbortController().signal),record=Reflect.get(f.store,'recordTaskCompositeObservation'),controller=new AbortController(),proof=await observeTaskComposite(f.gateway,f.payload.ownerBinding,result.preparation,controller.signal);
 for(const invalid of [{},Object.freeze(Object.create(null)),other])expect(()=>Reflect.apply(record,f.store,['p',invalid])).toThrow('bootstrap_composite_observation_unverified');const reason=Error('original Main read revoked');controller.abort(reason);try{Reflect.apply(record,f.store,['p',proof]);throw Error('unexpected accepted');}catch(error){expect(error).toBe(reason);}expect(f.store.list()[0].taskCompositeObservation).toBeUndefined();
});
it('the original observation body stays held through cancellation and cannot publish a late proof',async()=>{
 const f=await fixture(),result=await f.withTrigger(proof=>f.prepare(proof)),source=(await import('../../electron/conversation-project-service.js')).resolveProjectUserSourceProof(f.sourceProof,f.projects);expect(f.hub.applyOrdinaryTaskMetadataInput('p',result.submission.input,{requestSource:'user',projectInputAuthority:f.authority.user(source),initialPlanningAuthority:f.authority.planner(),initialPlanClaim:result.preparation.claimRequest}).ok).toBe(true);const {observeTaskComposite}=await import('../../electron/kswarm-task-composite-observation.js'),actual=f.gateway.request.bind(f.gateway),controller=new AbortController(),reason=Error('revoke held original response');let enter!:()=>void,release!:()=>void,settled=false;const entered=new Promise<void>(yes=>{enter=yes;}),held=new Promise<void>(yes=>{release=yes;});
 const spy=vi.spyOn(f.gateway,'request').mockImplementation(async(path,...args)=>{const response=await actual(path,...args);if(!path.includes('/ordinary-inputs/')){const original=response.json.bind(response);Object.defineProperty(response,'json',{value:async()=>{const value=await original();enter();await held;return value;}});}return response;});
 try{const pending=observeTaskComposite(f.gateway,f.payload.ownerBinding,result.preparation,controller.signal).then(value=>({value}),error=>({error})).finally(()=>{settled=true;});await entered;controller.abort(reason);await new Promise<void>(yes=>setImmediate(yes));expect(settled).toBe(false);release();const outcome=await pending;expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error).toBe(reason);expect(f.store.list()[0].taskCompositeObservation).toBeUndefined();}finally{release();spy.mockRestore();}
});
