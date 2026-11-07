// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createOriginalCompositeFixture} from '../support/original-composite-fixture.js';
import {PROJECT_PLANNING_INPUT,PROJECT_PLANNING_OUTPUT} from '../../shared/project-planning-ipc-contract.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of closes.splice(0).reverse())await close();resetIpcSchemaRegistryForTests();});
async function fixture(){
 const f=await createOriginalCompositeFixture(closes),source=f.projects.inspectOriginalTaskSource(f.sourceProof),input={action:'add_task_and_plan',projectId:'p',sourceTaskId:source.sourceTaskId,proposal:{title:'One explicit user item'}};
 const scope={profileId:source.identity.profileId,workspaceId:source.identity.workspaceId};let allowed=true,checks=0;
 const sourceGuard=()=>{checks++;if(!allowed)throw Error('actual_source_access_denied');};
 const execute=async(proof:unknown,raw:unknown=input)=>{const m=await import('../../electron/kswarm-task-planning-action.js');return m.executeTaskMetadataPlanning({store:f.store,gateway:f.gateway,projects:f.projects,scope,now:()=>10,authorizeSource:async()=>{sourceGuard();return sourceGuard;}},raw,{requestSource:'user',triggerProof:proof as any,current:()=>{}});};
 return{...f,input,scope,execute,source,deny(){allowed=false;},checks:()=>checks};
}
it('the existing strict planning wire admits only the closed new action and truthful metadata output',()=>{
 const input={action:'add_task_and_plan',projectId:'p',sourceTaskId:'task-source',proposal:{title:'An explicit item'}};
 expect(PROJECT_PLANNING_INPUT.safeParse(input).success).toBe(true);
 for(const bad of [{...input,body:'renderer text'},{...input,ownerBinding:{}},{...input,proposal:{title:'x',body:'rewrite'}}])expect(PROJECT_PLANNING_INPUT.safeParse(bad).success).toBe(false);
 expect(PROJECT_PLANNING_OUTPUT.safeParse({ok:true,status:'metadata_applied',projectId:'p',operationId:'ordinary-input:'+'a'.repeat(64),planRunId:'11111111-1111-4111-8111-111111111111',ownerRevision:2,execution:{state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'}}).success).toBe(true);
 expect(PROJECT_PLANNING_OUTPUT.safeParse({ok:true,status:'metadata_applied'}).success).toBe(false);
});
it('actual registered action issues one original task delta/claim and exact receipt, without enqueuing an M run',async()=>{
 const f=await fixture(),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');const result=await f.withActionTrigger(f.input,proof=>f.execute(proof));
 expect(result).toMatchObject({ok:true,status:'metadata_applied',projectId:'p',execution:{state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'}});expect(PROJECT_PLANNING_OUTPUT.safeParse(result).success).toBe(true);
 const job=f.store.list()[0];expect(result.planRunId).toBe(job.planRunId);expect(job.taskComposite?.operationId).toBe(result.operationId);expect(send).toHaveBeenCalledTimes(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);expect(f.store.claimDue(100,1)).toEqual([]);expect(job.attempts).toBe(0);expect(job.modelAttempted).toBeUndefined();expect(f.checks()).toBeGreaterThan(0);
 const again=await f.withActionTrigger(f.input,proof=>f.execute(proof));expect(again).toEqual(result);expect(send).toHaveBeenCalledTimes(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
});
it('an acknowledged retry matches the retained proposal without reading purged source body or issuing another POST',async()=>{
 const f=await fixture();const result=await f.withActionTrigger(f.input,proof=>f.execute(proof));const read=vi.spyOn(f.projects,'readOriginalTaskSource').mockImplementation(()=>{throw Error('purged_body_must_not_be_read');}),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');
 expect(await f.withActionTrigger(f.input,proof=>f.execute(proof))).toEqual(result);expect(read).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 await expect(f.withActionTrigger({...f.input,proposal:{title:'Different item'}},proof=>f.execute(proof,{...f.input,proposal:{title:'Different item'}}))).rejects.toThrow('bootstrap_composite_request_conflict');expect(read).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it('unknown ACK reconciles the original committed receipt before any second body read or POST',async()=>{
 const f=await fixture(),send=f.gateway.submitTaskMetadataOnce.bind(f.gateway);vi.spyOn(f.gateway,'submitTaskMetadataOnce').mockImplementation(async(...args)=>{await send(...args);throw Error('actual transport ACK lost');});
 const result=await f.withActionTrigger(f.input,proof=>f.execute(proof));expect(result.status).toBe('metadata_applied');expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
 const path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),data=JSON.parse(readFileSync(path,'utf8'));delete data.jobs[0].taskCompositeObservation;writeFileSync(path,JSON.stringify(data));
 const read=vi.spyOn(f.projects,'readOriginalTaskSource').mockImplementation(()=>{throw Error('must_reconcile_first');});expect(await f.withActionTrigger(f.input,proof=>f.execute(proof))).toEqual(result);expect(read).not.toHaveBeenCalled();expect(f.gateway.submitTaskMetadataOnce).toHaveBeenCalledTimes(1);
});
it('source authorization failure rejects before authenticated B discovery and never falls through to legacy planning',async()=>{
 const f=await fixture(),request=vi.spyOn(f.gateway,'request'),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');f.deny();await expect(f.withActionTrigger(f.input,proof=>f.execute(proof))).rejects.toThrow('actual_source_access_denied');expect(request).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(f.store.list()).toEqual([]);
});
it('the original journal drain owns a held authenticated discovery response and seal prevents a late metadata write',async()=>{
 const f=await fixture(),actual=f.gateway.request.bind(f.gateway);let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(yes=>{enter=yes;}),held=new Promise<void>(yes=>{release=yes;});vi.spyOn(f.gateway,'request').mockImplementation(async(...args)=>{const response=await actual(...args);enter();await held;return response;});
 const result=f.withActionTrigger(f.input,proof=>f.execute(proof)).then(value=>({value}),error=>({error}));await entered;f.store.stopAcceptingTaskComposites();f.store.abortTaskComposites(Error('actual journal seal'));let drained=false;const drain=f.store.drainTaskComposites().then(()=>{drained=true;});await new Promise<void>(yes=>setImmediate(yes));expect(drained).toBe(false);release();const outcome=await result;await drain;expect('error'in outcome).toBe(true);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);expect(f.store.list()).toEqual([]);
});
it.each([1,2])('actual source access withdrawn inside original retained read %i fences the preparation or final POST',async readNumber=>{
 const f=await fixture(),original=f.projects.readOriginalTaskSource.bind(f.projects);let reads=0;vi.spyOn(f.projects,'readOriginalTaskSource').mockImplementation(async(...args)=>{const value=await original(...args);if(++reads===readNumber)f.deny();return value;});const send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');
 await expect(f.withActionTrigger(f.input,proof=>f.execute(proof))).rejects.toThrow('actual_source_access_denied');expect(send).not.toHaveBeenCalled();expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(0);if(readNumber===1)expect(f.store.list()).toEqual([]);
});
it('two registered callers share the same original metadata operation and immutable run',async()=>{
 const f=await fixture(),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');
 const results=await f.withActionTrigger(f.input,async proof=>Promise.all([f.execute(proof),f.execute(proof)]));expect(results[0]).toEqual(results[1]);expect(send).toHaveBeenCalledTimes(1);expect(f.store.list()).toHaveLength(1);expect(f.hub.getBoard('p').getAllTasks()).toHaveLength(1);
});
it('a historical schema1 preparation retains its original readback but cannot acquire a newly supplied proposal association',async()=>{
 const f=await fixture();await f.withActionTrigger(f.input,proof=>f.execute(proof));const {compositeDigest}=await import('../../electron/kswarm-composite-journal-data.js'),path=join(f.root,'kswarm-initial-plan-bootstrap-jobs.json'),data=JSON.parse(readFileSync(path,'utf8')),job=data.jobs[0];
 const {proposalDigest:_,preparationDigest:__,...legacy}=job.taskComposite;legacy.schemaVersion=1;job.taskComposite={...legacy,preparationDigest:compositeDigest(legacy)};job.taskCompositeSubmission.preparationDigest=job.taskComposite.preparationDigest;
 const {observationDigest:___,...observation}=job.taskCompositeObservation;observation.preparationDigest=job.taskComposite.preparationDigest;job.taskCompositeObservation={...observation,observationDigest:compositeDigest(observation)};writeFileSync(path,JSON.stringify(data));
 const bytes=readFileSync(path,'utf8'),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');await expect(f.withActionTrigger(f.input,proof=>f.execute(proof))).rejects.toThrow('bootstrap_composite_request_upgrade_required');expect(readFileSync(path,'utf8')).toBe(bytes);expect(send).not.toHaveBeenCalled();expect((await f.store.reconcileTaskComposite('p',new AbortController().signal)).outcome).toBe('metadata_applied');
});
it('a current source grant cannot cross an authenticated owner scope mismatch',async()=>{
 const f=await fixture(),request=f.gateway.request.bind(f.gateway),send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');vi.spyOn(f.gateway,'request').mockImplementation(async(...args)=>{const response=await request(...args),value=await response.json();if(value.ownerBinding)value.ownerBinding.workspaceId='f'.repeat(64);return Response.json(value,{status:response.status});});
 await expect(f.withActionTrigger(f.input,proof=>f.execute(proof))).rejects.toThrow('bootstrap_owner_scope_mismatch');expect(send).not.toHaveBeenCalled();expect(f.store.list()).toEqual([]);
});
it('readback IO failure and concurrent caller revocation both survive without a second POST',async()=>{
 const f=await fixture();await f.withActionTrigger(f.input,proof=>f.execute(proof));const error=Error('original readback IO rejected'),original=f.gateway.request.bind(f.gateway);let enter!:()=>void,reject!:(error:unknown)=>void;const entered=new Promise<void>(yes=>{enter=yes;}),held=new Promise<Response>((_yes,no)=>{reject=no;});
 vi.spyOn(f.gateway,'request').mockImplementation((...args)=>{if(String(args[0]).includes('/ordinary-inputs/')){enter();return held;}return original(...args);});const send=vi.spyOn(f.gateway,'submitTaskMetadataOnce');
 const pending=f.withActionTrigger(f.input,proof=>f.execute(proof)).then(value=>({value}),error=>({error}));await entered;f.revoke();reject(error);const result=await pending;expect('error'in result).toBe(true);if('error'in result){expect(result.error).toBeInstanceOf(AggregateError);expect(result.error.cause).toBe(error);expect(result.error.errors).toContain(error);expect(result.error.errors.some((item:unknown)=>item instanceof Error&&item.message==='project_planning_trigger_unverified')).toBe(true);}expect(send).not.toHaveBeenCalled();
});
