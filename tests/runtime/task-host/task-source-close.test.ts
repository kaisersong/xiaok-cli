import {buildTaskUnderstanding} from '../../../src/runtime/task-host/task-understanding.js';
import {afterEach,expect,it,vi} from 'vitest';
const gate=vi.hoisted(()=>({entered:undefined as undefined|(()=>void),wait:undefined as undefined|Promise<void>}));
vi.mock('node:fs/promises',async original=>{const actual=await original<typeof import('node:fs/promises')>();return{...actual,async writeFile(...args:Parameters<typeof actual.writeFile>){if(gate.wait&&String(args[0]).includes('/snapshots/')){gate.entered?.();await gate.wait;}return actual.writeFile(...args);}};});
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {InProcessTaskRuntimeHost,type TaskRunner} from '../../../src/runtime/task-host/task-runtime-host.js';
const roots:string[]=[];
function setup(runner:TaskRunner=async()=>{},extra:Partial<ConstructorParameters<typeof InProcessTaskRuntimeHost>[0]>={}){const root=mkdtempSync(join(tmpdir(),'task-source-close-'));roots.push(root);const store=new FileTaskSnapshotStore(join(root,'tasks'));const host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner,...extra});return{store,host};}
afterEach(()=>{gate.wait=undefined;gate.entered=undefined;for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
it('drains a preparation already in actual IO including its later event writes',async()=>{
 const{host,store}=setup();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r);gate.entered=entered;gate.wait=new Promise<void>(r=>release=r);
 const preparation=host.prepareTask({prompt:'bounded source close',materials:[]});await ready;
 try{expect(typeof host.closeSourceWriterForMigration).toBe('function');let closed=false;const closing=host.closeSourceWriterForMigration().then(()=>{closed=true;});
 await expect(host.prepareTask({prompt:'new task',materials:[]})).rejects.toThrow('task_source_closing');await Promise.resolve();expect(closed).toBe(false);
 gate.wait=undefined;release();const task=await preparation;await closing;expect(closed).toBe(true);
 const saved=await store.recoverTask(task.taskId);expect(saved?.events.map(event=>event.type)).toEqual(['task_started','understanding_updated']);
 await expect(host.recoverTask(task.taskId)).rejects.toThrow('task_source_closing');await expect(host.getActiveTasks()).rejects.toThrow('task_source_closing');
 await expect(host.answerQuestion({taskId:task.taskId,answer:{questionId:'q',type:'choice',choiceId:'confirm'}})).rejects.toThrow('task_source_closing');
 await host.closeSourceWriterForMigration();await expect(store.clearActiveTask(task.taskId)).rejects.toThrow('task_store_closed');
 }finally{gate.wait=undefined;release();await preparation.catch(()=>{});}
});
it('allows the already admitted runner to finish its original durable tail before closing',async()=>{
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const{host,store}=setup(async input=>{entered();await wait;await input.emitRuntimeEvent({type:'assistant_delta',sessionId:input.sessionId,turnId:'turn',intentId:'intent',stepId:'step',delta:'finished'});});
 const task=await host.createTask({prompt:'original',materials:[]});await ready;
 try{expect(typeof host.closeSourceWriterForMigration).toBe('function');let closed=false;const closing=host.closeSourceWriterForMigration().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);release();await closing;expect((await store.recoverTask(task.taskId))?.status).toBe('completed');}
 finally{release();await host.drain();}
});
it('retains accepted preparation failure and keeps the writer closed after failed close',async()=>{
 const{host,store}=setup();let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const original=store.save.bind(store);let first=true;
 vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(first){first=false;entered();await wait;throw Error('original preparation failed');}return original(...args);});
 const preparation=host.prepareTask({prompt:'original failure',materials:[]});const failure=preparation.catch(error=>error);await ready;
 try{expect(typeof host.closeSourceWriterForMigration).toBe('function');const close=host.closeSourceWriterForMigration();const result=close.catch(error=>error);release();expect((await failure).message).toBe('original preparation failed');expect((await result).message).toBe('task_source_close_unconfirmed');await expect(store.clearActiveTask('task')).rejects.toThrow('task_store_closed');expect(host.closeSourceWriterForMigration()).toBe(close);}
 finally{release();await failure;}
});

it('finishes an accepted createTask whose preparation crosses the closing boundary',async()=>{
 let calls=0;const{host,store}=setup(async()=>{calls++;});let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r);gate.entered=entered;gate.wait=new Promise<void>(r=>release=r);
 const creating=host.createTask({prompt:'accepted create',materials:[]});const created=creating.catch(error=>error);await ready;const close=host.closeSourceWriterForMigration();const closed=close.catch(error=>error);gate.wait=undefined;release();const task=await created;expect(task).toHaveProperty('taskId');expect(await closed).toBeUndefined();expect(calls).toBe(1);expect((await store.recoverTask(task.taskId))?.status).toBe('completed');
});
it('finishes an accepted confirmation after asynchronous original admission',async()=>{
 let calls=0,delay=true,entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const{host,store}=setup(async()=>{calls++;},{assertTaskAdmission:async()=>{if(delay){delay=false;entered();await wait;}}});
 await store.save({taskId:'confirm',sessionId:'session',status:'waiting_user',prompt:'confirm original',understanding:buildTaskUnderstanding({prompt:'confirm original',materials:[]}),materials:[],events:[{type:'needs_user',question:{questionId:'q',taskId:'confirm',kind:'confirm_understanding',prompt:'Confirm?',choices:[{id:'confirm',label:'Confirm'}]}}],createdAt:1,updatedAt:1});await host.recoverTask('confirm');
 const answer=host.answerQuestion({taskId:'confirm',answer:{questionId:'q',type:'choice',choiceId:'confirm'}});const answered=answer.catch(error=>error);await ready;const closed=host.closeSourceWriterForMigration().catch(error=>error);release();expect(await answered).toBeUndefined();expect(await closed).toBeUndefined();expect(calls).toBe(1);expect((await store.recoverTask('confirm'))?.status).toBe('completed');
});
it('rejects a detached continuation after its actual admitted invocation has settled',async()=>{
 let release!:()=>void,late:Promise<unknown>|undefined,first=true;const trigger=new Promise<void>(r=>release=r);
 const{host,store}=setup(async()=>{},{assertTaskAdmission:()=>{if(first){first=false;late=trigger.then(()=>host.prepareTask({prompt:'detached new task',materials:[]})).catch(error=>error);}}});
 await host.createTask({prompt:'original invocation',materials:[]});await host.drain();await host.closeSourceWriterForMigration();const writes=vi.spyOn(store,'save');release();expect((await late as Error).message).toBe('task_source_closing');expect(writes).not.toHaveBeenCalled();
});
it('does not replace an existing shutdown reason with migration continuation authority',async()=>{
 let calls=0,entered!:()=>void,release!:()=>void;const{host}=setup(async()=>{calls++;});const ready=new Promise<void>(r=>entered=r);gate.entered=entered;gate.wait=new Promise<void>(r=>release=r);
 const created=host.createTask({prompt:'before shutdown',materials:[]}).catch(error=>error);await ready;host.stopAccepting('app_shutdown');const closed=host.closeSourceWriterForMigration().catch(error=>error);gate.wait=undefined;release();expect(String(await created)).toContain('app_shutdown');expect(await closed).toBeUndefined();expect(calls).toBe(0);
});
for (const closeBeforeSettlement of [true,false]) it(`retains actual execution persistence failure when close is ${closeBeforeSettlement?'pending':'later'}`,async()=>{
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const {host,store}=setup(async()=>{entered();await wait;});
 const task=await host.createTask({prompt:'execution save failure',materials:[]});await ready;
 const original=store.save.bind(store);let failures=0;
 vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(args[0].taskId===task.taskId){failures++;throw Error('actual terminal persistence unavailable');}return original(...args);});
 const closing=closeBeforeSettlement?host.closeSourceWriterForMigration().catch(error=>error):undefined;
 release();await host.drain();const result=closing?await closing:await host.closeSourceWriterForMigration().catch(error=>error);
 expect(failures).toBeGreaterThan(0);expect(result).toBeInstanceOf(AggregateError);expect((result as AggregateError).message).toBe('task_source_close_unconfirmed');expect((result as AggregateError).errors.some(error=>String(error).includes('actual terminal persistence unavailable'))).toBe(true);
 await expect(store.clearActiveTask(task.taskId)).rejects.toThrow('task_store_closed');
});
it('allows migration after a business failure with all original failure facts persisted',async()=>{
 const{host,store}=setup(async()=>{throw Error('ordinary model failure');});const task=await host.createTask({prompt:'ordinary failed task',materials:[]});await host.drain();expect((await store.recoverTask(task.taskId))?.status).toBe('failed');await expect(host.closeSourceWriterForMigration()).resolves.toBeUndefined();
});
it('retains a failed actual detached receipt mutation while closing',async()=>{
 let entered!:()=>void,release!:()=>void,observed:Promise<unknown>|undefined;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const{host,store}=setup(async input=>{observed=input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'original',intentId:'intent',stepId:'step',note:'actual detached receipt'}).catch(error=>error);});
 const original=store.save.bind(store);let fail=true;
 vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(fail&&args[0].events.some(event=>event.type==='result')){fail=false;entered();await wait;throw Error('pending_detached_write_failed');}return original(...args);});
 const task=await host.createTask({prompt:'detached receipt',materials:[]});await ready;
 const closing=host.closeSourceWriterForMigration().catch(error=>error);release();const result=await closing;
 expect(String(await observed)).toContain('pending_detached_write_failed');expect(result).toBeInstanceOf(AggregateError);expect((result as AggregateError).errors.some(error=>String(error).includes('pending_detached_write_failed'))).toBe(true);
 expect((await store.recoverTask(task.taskId))?.status).toBe('completed');
});
it('waits an actual detached observation persistence admitted before execution settles',async()=>{
 const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const session=new AgentSessionState();
 let entered!:()=>void,release!:()=>void,published=false,observed:Promise<unknown>|undefined;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const{host,store}=setup(async input=>{const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');session.restoreSnapshot({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});session.addProtectedObservationReferences([]);observed=input.persistObservationSnapshot!(session.exportSnapshot()).catch(error=>error);});
 const persist=store.observations.persistSession.bind(store.observations);vi.spyOn(store.observations,'persistSession').mockImplementation(async(...args)=>{entered();await wait;await persist(...args);published=true;});
 await host.createTask({prompt:'detached sidecar',materials:[]});await ready;await host.drain();let closed=false;const closing=host.closeSourceWriterForMigration().then(()=>{closed=true;},error=>error);
 await new Promise(resolve=>setTimeout(resolve,10));const prematurelyClosed=closed;release();await closing;await observed;expect(published).toBe(true);expect(prematurelyClosed).toBe(false);
});
it('retains an actual cancellation write failure which happened before close',async()=>{
 const{host,store}=setup();const task=await host.prepareTask({prompt:'cancel before migration',materials:[]});const original=store.save.bind(store);
 vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(args[0].status==='cancelled')throw Error('actual_cancel_snapshot_failed');return original(...args);});
 await expect(host.cancelTask(task.taskId)).rejects.toThrow('actual_cancel_snapshot_failed');await expect(host.closeSourceWriterForMigration()).rejects.toThrow('task_source_close_unconfirmed');
});
it('does not treat a pure canonical reference rejection as a failed write',async()=>{
 const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const session=new AgentSessionState();session.addProtectedObservationReferences([]);const ticket=Object.freeze({id:'actual-test-reference'});let taskId='';
 const{host,store}=setup(async input=>{taskId=input.taskId;await host.publishGroupObservationReference(ticket);},{groupObservationSource:{inspectGroupObservationReference(actual){if(actual!==ticket)throw Error('fake');return{taskId,canonicalTaskId:'absent-canonical',closure:session.getProtectedObservationClosure()!};},async commitGroupObservationReference(){throw Error('must not commit');}}});
 const task=await host.createTask({prompt:'pure validation failure',materials:[]});await host.drain();expect((await store.recoverTask(task.taskId))?.status).toBe('failed');await expect(host.closeSourceWriterForMigration()).resolves.toBeUndefined();
});
it('allows close after a pure reference rejection during the accepted runner',async()=>{
 const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const session=new AgentSessionState();session.addProtectedObservationReferences([]);const ticket=Object.freeze({id:'actual-test-reference'});let taskId='',entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const{host,store}=setup(async input=>{taskId=input.taskId;await host.publishGroupObservationReference(ticket);},{groupObservationSource:{inspectGroupObservationReference(actual){if(actual!==ticket)throw Error('fake');return{taskId,canonicalTaskId:'absent-canonical',closure:session.getProtectedObservationClosure()!};},async commitGroupObservationReference(){throw Error('must not commit');}}});
 const read=store.observations.read.bind(store.observations);vi.spyOn(store.observations,'read').mockImplementation(async id=>{if(id==='absent-canonical'){entered();await wait;}return read(id);});
 const task=await host.createTask({prompt:'pure rejection while closing',materials:[]});await ready;const closed=host.closeSourceWriterForMigration().catch(error=>error);release();expect(await closed).toBeUndefined();expect((await store.recoverTask(task.taskId))?.status).toBe('failed');
});
for(const afterClose of [false,true])it(`rejects the original late usage callback ${afterClose?'after source close':'after execution settlement'}`,async()=>{
 let emit:Parameters<TaskRunner>[0]['emitUsage']|undefined;const{host,store}=setup(async input=>{emit=input.emitUsage;await emit({inputTokens:1,outputTokens:2});});
 const task=await host.createTask({prompt:'late usage',materials:[]});await host.drain();if(afterClose)await host.closeSourceWriterForMigration();const save=vi.spyOn(store,'save');
 await expect(emit!({inputTokens:7,outputTokens:9})).rejects.toThrow('SOL_PI_DESKTOP_EXECUTION_EXPIRED');expect(save).not.toHaveBeenCalled();expect((await store.recoverTask(task.taskId))?.usage).toEqual({inputTokens:1,outputTokens:2,known:true});if(!afterClose)await host.closeSourceWriterForMigration();
});
it('waits for the original detached execution store IO before source close',async()=>{
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
 let entered!:()=>void,release!:()=>void,observed:Promise<unknown>|undefined,written=false;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);const original=FileSessionStore.prototype.save;
 const spy=vi.spyOn(FileSessionStore.prototype,'save').mockImplementation(async function(this:import('../../../src/ai/runtime/session-store/file-store.js').FileSessionStore,snapshot,options){entered();await wait;await original.call(this,snapshot,options);written=true;});
 try{const {host}=setup(async input=>{const session=new AgentSessionState();observed=input.executionPersistence!.store.save({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)}).catch(error=>error);});await host.createTask({prompt:'detached execution store',materials:[]});await ready;await host.drain();let closed=false;const closing=host.closeSourceWriterForMigration().then(()=>{closed=true;});await new Promise(r=>setTimeout(r,10));const early=closed;release();await closing;await observed;expect(written).toBe(true);expect(early).toBe(false);}finally{release();spy.mockRestore();}
});
it('does not poison source close with original task admission policy rejection',async()=>{
 const {host}=setup(async()=>{throw Error('runner must not run');},{assertTaskAdmission:()=>{throw Error('original_policy_denied');}});await host.createTask({prompt:'policy rejection',materials:[]}).catch(()=>{});await host.drain();await expect(host.closeSourceWriterForMigration()).resolves.toBeUndefined();
});
it('retains original execution port IO failure even after runner failure is durably recorded',async()=>{
 const {FileSessionStore}=await import('../../../src/ai/runtime/session-store/file-store.js');const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');
 const spy=vi.spyOn(FileSessionStore.prototype,'save').mockRejectedValue(Error('actual_execution_port_io_failed'));
 try{const {host,store}=setup(async input=>{const session=new AgentSessionState();await input.executionPersistence!.store.save({...session.exportSnapshot(),sessionId:desktopObservationSessionId(input.taskId)});});const task=await host.createTask({prompt:'original port io failure',materials:[]});await host.drain();expect((await store.recoverTask(task.taskId))?.status).toBe('failed');await expect(host.closeSourceWriterForMigration()).rejects.toThrow('task_source_close_unconfirmed');}finally{spy.mockRestore();}
});
it('closes after a confirmed original scoped CAS precommit rejection without a write',async()=>{
 const {AgentSessionState}=await import('../../../src/ai/runtime/session.js');const {desktopObservationSessionId}=await import('../../../src/runtime/task-host/protected-observation-store.js');const {createSessionExecutionAuthority,createSessionExecutionContext}=await import('../../../src/ai/runtime/session-store/execution-authority.js');
 const {host}=setup(async input=>{const port=input.executionPersistence!,session=new AgentSessionState(),id=desktopObservationSessionId(input.taskId);session.addProtectedObservationReferences([]);await port.store.save({...session.exportSnapshot(),sessionId:id});const old=(await port.store.load(id))!;const authority=createSessionExecutionAuthority({root:port.root,sessionIdentity:id,hostContext:createSessionExecutionContext({requestSource:'user',ownerId:'host',scopeId:'scope'})});const lease=await authority.acquire({invocationId:'precommit',kind:'compaction'});try{await expect(port.store.compareAndSave!({expectedStoreRevision:old.storeRevision!,expectedHistoryDigest:old.historyDigest!,nextSnapshot:old,lease,beforeCommit(){throw Error('original_precommit_policy_changed');}})).rejects.toThrow('original_precommit_policy_changed');expect(await port.store.load(id)).toEqual(old);}finally{await lease.releaseAfterDrain();authority.dispose();}});await host.createTask({prompt:'actual scoped precommit rejection',materials:[]});await host.drain();await expect(host.closeSourceWriterForMigration()).resolves.toBeUndefined();
});
it('does not lend a still-open ingress to its detached persisted-event consumer after close',async()=>{
 let entered!:()=>void,release!:()=>void,done!:()=>void,closing:Promise<unknown>|undefined,late:unknown;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r),consumed=new Promise<void>(r=>done=r);let first=true;
 const {host,store}=setup(async()=>{},{onPersistedEvent:async()=>{if(!first)return;first=false;await ready;closing=host.closeSourceWriterForMigration().catch(error=>error);try{late=await host.prepareTask({prompt:'fresh from detached consumer',materials:[]}).catch(error=>error);}finally{release();done();}}});
 const save=store.save.bind(store);let calls=0;vi.spyOn(store,'save').mockImplementation(async(...args)=>{if(++calls===3){entered();await wait;}return save(...args);});const original=host.prepareTask({prompt:'original ingress held in IO',materials:[]});await consumed;expect(await original).toHaveProperty('taskId');expect(await closing).toBeUndefined();expect(String(late)).toContain('task_source_closing');
});
it('isolates a detached policy callback Promise created before close and resolved while original ingress remains open',async()=>{
 let entered!:()=>void,release!:()=>void,trigger!:()=>void,late:Promise<unknown>|undefined,first=true;const ready=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r),branch=new Promise<void>(r=>trigger=r);
 const {host}=setup(async()=>{},{assertTaskAdmission:async()=>{if(first){first=false;late=branch.then(()=>host.prepareTask({prompt:'detached policy branch',materials:[]})).catch(error=>error);entered();await wait;}}});
 const creating=host.createTask({prompt:'accepted original admission',materials:[]});await ready;const closed=host.closeSourceWriterForMigration();trigger();const result=await late;release();expect(await creating).toHaveProperty('taskId');await closed;expect(String(result)).toContain('task_source_closing');
});
it('does not lend admitted ingress to the actual checkpoint diagnostics observer',async()=>{
 const root=mkdtempSync(join(tmpdir(),'task-source-diagnostics-'));roots.push(root);
 let first=true,closing:Promise<unknown>|undefined,late:Promise<unknown>|undefined;
 let host!:InProcessTaskRuntimeHost;
 const store=new FileTaskSnapshotStore(join(root,'tasks'),{onWrite(operation){
  if(operation!=='checkpoint'||!first)return;first=false;
  closing=host.closeSourceWriterForMigration().catch(error=>error);
  late=host.prepareTask({prompt:'new diagnostics ingress',materials:[]}).catch(error=>error);
 }});
 host=new InProcessTaskRuntimeHost({snapshotStore:store,materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async()=>{}});
 const original=await host.prepareTask({prompt:'accepted checkpoint',materials:[]});
 expect(String(await late)).toContain('task_source_closing');expect(await closing).toBeUndefined();
 expect((await store.recoverTask(original.taskId))?.events.map(event=>event.type)).toEqual(['task_started','understanding_updated']);
});
