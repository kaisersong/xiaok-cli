import {TASK7_EVENT} from '../../shared/task7-ipc-contract';
import {createCapturedTaskDeclarationAccumulator} from '../../../src/runtime/task-host/captured-task-declarations';
import { it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexTaskBridge } from '../../electron/codex-task-bridge';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store';
it('freezes native routing, uses standard snapshots, and rejects missing user provenance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-task-'));const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks'))});
 try{
  expect(bridge.selected()).toBe(false);bridge.select(true);expect(bridge.selected()).toBe(true);
  await expect(bridge.create({prompt:'test',materials:[],context:{threadId:'thread'}})).rejects.toThrow(/denied/);
  expect(bridge.owns('foreign')).toBe(false);
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

class NativeFixture {
 threadId='native-fixture'; activeTurnId:string|null=null; pid=0; exited=false; n=0;
 constructor(readonly options:any){}
 async connect(){} async create(){return {thread:{id:this.threadId}};} async resume(id:string){this.threadId=id;}
 async start(){this.activeTurnId=`turn-${++this.n}`;this.emit('turn/started',{turn:{id:this.activeTurnId,status:'inProgress'}});return {turnId:this.activeTurnId};}
 async steer(){return {turnId:this.activeTurnId};}
 async interrupt(){this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'interrupted'}});this.activeTurnId=null;}
 async close(){this.exited=true;}
 emit(method:string,params:any){this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});}
}
it('uses standard stream, failed tool state, one-use approval, and terminal snapshot',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-bridge-'));let client!:NativeFixture;
 const actor={requestSource:'user' as const,actorId:'u'};
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any});
 try{
  const {taskId}=await bridge.create({prompt:'test',materials:[],context:{threadId:'t'}},actor);
  await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());
  const events:any[]=[];const collect=(async()=>{for await(const e of bridge.host.subscribeTask(taskId)){events.push(e);if(e.type==='task_terminal')break;}})();
  client.emit('item/started',{item:{id:'cmd',type:'commandExecution',command:'false'}});
  const pending=client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,itemId:'cmd',command:'false'}});
  await vi.waitFor(()=>expect(events.some(e=>e.type==='needs_user')).toBe(true));
  const question=events.find(e=>e.type==='needs_user').question;
  await expect(bridge.answer({taskId,answer:{questionId:question.questionId,type:'choice',choiceId:'approve'}},{...actor,requestSource:'agent'})).rejects.toThrow(/denied/);
  await bridge.answer({taskId,answer:{questionId:question.questionId,type:'choice',choiceId:'deny'}},actor);
  expect(await pending).toEqual({decision:'decline'});
  await expect(bridge.answer({taskId,answer:{questionId:question.questionId,type:'choice',choiceId:'approve'}},actor)).rejects.toThrow(/approval/);
  client.emit('item/completed',{item:{id:'cmd',type:'commandExecution',status:'failed',exitCode:1,aggregatedOutput:'denied'}});
  client.emit('item/agentMessage/delta',{itemId:'answer',delta:'Done'});
  client.emit('turn/completed',{turn:{id:client.activeTurnId,status:'completed'}});
  await collect;
  expect(events.some(e=>e.type==='assistant_delta'&&e.delta==='Done')).toBe(true);
  expect(events.some(e=>e.type==='question_resolved'&&e.questionId===question.questionId)).toBe(true);
  expect(JSON.stringify(events)).toContain('denied');
  expect((await bridge.host.recoverTask(taskId)).snapshot.status).toBe('completed');
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('revocation prevents startup after asynchronous preparation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-revoke-'));const createClient=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient,admitThread:async()=>()=>{throw new Error('permission_revoked');}});
 try{
  await expect(bridge.create({prompt:'test',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'})).rejects.toThrow('permission_revoked');
  expect(createClient).not.toHaveBeenCalled();expect(await bridge.host.getActiveTasks()).toEqual([]);
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('shutdown keeps original native and route writers open until the actual close promise settles and shares final disposal',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-shutdown-'));let client!:NativeFixture;let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r);
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>{client=new NativeFixture(options);client.close=async()=>{entered();await gate;client.exited=true;};return client as any;}});
 try{
  await bridge.create({prompt:'actual native original turn',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());
  bridge.beginShutdown();const draining=bridge.drainShutdown(1000);await ready;
  expect(await bridge.drainShutdown(10)).toBe(false);expect(client.exited).toBe(false);expect(bridge.selected()).toBe(false);
  await expect(bridge.create({prompt:'late new turn',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'})).rejects.toThrow('native_access_denied');
  release();expect(await draining).toBe(true);expect(client.exited).toBe(true);expect(bridge.selected()).toBe(false);
  const original=bridge.dispose();expect(bridge.dispose()).toBe(original);await original;expect(()=>bridge.selected()).toThrow();
 }finally{release();await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('binds complete original question inventory to the actual task, thread and session without creating a new execution',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-inventory-bridge-'));let client!:NativeFixture;let clients=0;
 const actor={requestSource:'user' as const,actorId:'u'};
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>{clients++;return (client=new NativeFixture(options)) as any;}});
 try{
  const task=await bridge.create({prompt:'two native approvals',materials:[],context:{threadId:'t'}},actor);
  await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());
  const first=client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'one'}});
  const second=client.options.onApproval({id:2,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'two'}});
  const snapshot=(await bridge.host.inspectTask(task.taskId))!;
  const input={taskId:task.taskId,threadId:'t',sessionId:snapshot.sessionId};
  const frame=bridge.readQuestionInventory(input,actor);expect(frame.questions).toHaveLength(2);
  const firstQuestion=frame.questions.find(q=>q.description.includes('\"one\"'))!;const secondQuestion=frame.questions.find(q=>q.description.includes('\"two\"'))!;
  bridge.assertQuestionInventoryCurrent(actor,frame);
  expect(()=>bridge.assertQuestionInventoryCurrent(actor,structuredClone(frame))).toThrow(/inventory/);
  for(const bad of [{...input,taskId:'foreign'},{...input,threadId:'other'},{...input,sessionId:'other'}])expect(()=>bridge.readQuestionInventory(bad,actor)).toThrow(/inventory/);
  for(const auth of [{...actor,requestSource:'agent'},{...actor,requestSource:'scheduler'},{...actor,actorId:'foreign'}])expect(()=>bridge.readQuestionInventory(input,auth as any)).toThrow(/denied/);
  await bridge.answer({taskId:task.taskId,answer:{type:'choice',questionId:firstQuestion.token,choiceId:'approve'}},actor);
  expect(await first).toEqual({decision:'accept'});expect(()=>bridge.assertQuestionInventoryCurrent(actor,frame)).toThrow(/inventory/);
  expect(bridge.readQuestionInventory(input,actor).questions.map(q=>q.token)).toEqual([secondQuestion.token]);
  await bridge.answer({taskId:task.taskId,answer:{type:'choice',questionId:secondQuestion.token,choiceId:'deny'}},actor);expect(await second).toEqual({decision:'decline'});
  expect(bridge.readQuestionInventory(input,actor).questions).toEqual([]);expect(clients).toBe(1);expect(client.n).toBe(1);
  bridge.beginShutdown();expect(()=>bridge.assertQuestionInventoryCurrent(actor,frame)).toThrow(/denied/);
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('answers actual turn approvals before the original turn-start ACK returns',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-inventory-ack-'));let client!:NativeFixture;let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);const actor={requestSource:'user' as const,actorId:'u'};
 let collecting:Promise<void>|undefined;const events:any[]=[];
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>{
  client=new NativeFixture(options);const original=client.start.bind(client);client.start=async()=>{const result=await original();entered();await held;return result;};return client as any;
 }});
 try{
  const task=await bridge.create({prompt:'approval arrives before start ACK',materials:[],context:{threadId:'t'}},actor);await started;
  collecting=(async()=>{for await(const e of bridge.host.subscribeTask(task.taskId)){events.push(e);if(e.type==='task_terminal')break;}})();
  const first=client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'first'}});
  const second=client.options.onApproval({id:2,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'second'}});
  await vi.waitFor(()=>expect(events.filter(e=>e.type==='needs_user')).toHaveLength(2));
  expect(events.some(e=>e.type==='task_terminal'||e.type==='receipt_emitted')).toBe(false);
  const snapshot=(await bridge.host.inspectTask(task.taskId))!;const input={taskId:task.taskId,threadId:'t',sessionId:snapshot.sessionId};
  const frame=bridge.readQuestionInventory(input,actor);expect(frame.questions).toHaveLength(2);
  for(const event of events.filter(e=>e.type==='needs_user')){
   const actual=frame.questions.find(q=>q.token===event.question.questionId)!;
   expect(event.question.owner).toEqual({schemaVersion:1,kind:'codex_native_approval',taskSessionId:snapshot.sessionId,nativeIncarnation:frame.incarnation,nativeSessionId:frame.sessionId,nativeThreadId:frame.nativeThreadId,nativeTurnId:frame.turnId,nativeTurnGeneration:frame.generation,approvalToken:actual.token,requestDigest:actual.requestDigest});
   expect(TASK7_EVENT.safeParse(event).success).toBe(true);const captured=createCapturedTaskDeclarationAccumulator();captured.capture({events:[event]},'snapshot');expect(captured.finish(task.taskId,[snapshot.sessionId]).taskId).toBe(task.taskId);
  }
  const firstQuestion=frame.questions.find(q=>q.description.includes('\"first\"'))!;const secondQuestion=frame.questions.find(q=>q.description.includes('\"second\"'))!;
  await bridge.answer({taskId:task.taskId,answer:{type:'choice',questionId:firstQuestion.token,choiceId:'deny'}},actor);expect(await first).toEqual({decision:'decline'});
  await vi.waitFor(()=>expect(events.some(e=>e.type==='question_resolved'&&e.questionId===firstQuestion.token)).toBe(true));
  expect(bridge.readQuestionInventory(input,actor).questions.map(q=>q.token)).toEqual([secondQuestion.token]);
  await bridge.answer({taskId:task.taskId,answer:{type:'choice',questionId:secondQuestion.token,choiceId:'approve'}},actor);expect(await second).toEqual({decision:'accept'});
  release();client.emit('item/agentMessage/delta',{itemId:'final',delta:'Completed after approval'});client.emit('turn/completed',{turn:{id:client.activeTurnId,status:'completed'}});await collecting;
  expect((await bridge.host.inspectTask(task.taskId))?.status).toBe('completed');expect(client.n).toBe(1);
 }finally{release();await bridge.dispose();await collecting;rmSync(dir,{recursive:true,force:true});}
});

it('does not resolve an original Native approval if its pre-effect SQLite projection write fails',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-approval-io-'));let client!:NativeFixture;const actor={requestSource:'user' as const,actorId:'u'};
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any});
 let database:any;
 try{
  const task=await bridge.create({prompt:'actual approval projection fault',materials:[],context:{threadId:'t'}},actor);await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());
  const pending=client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'irreversible command'}});
  const snapshot=(await bridge.host.inspectTask(task.taskId))!;const input={taskId:task.taskId,threadId:'t',sessionId:snapshot.sessionId};const frame=bridge.readQuestionInventory(input,actor);
  database=(bridge as any).native.db;
  database.exec("CREATE TRIGGER inventory_decision_io_fault BEFORE INSERT ON codex_native_sessions BEGIN SELECT RAISE(ABORT,'inventory_decision_io_sentinel'); END");
  let resolved=false;void pending.then(()=>{resolved=true;});
  const answer={taskId:task.taskId,answer:{type:'choice' as const,questionId:frame.questions[0].token,choiceId:'approve'}};
  await expect(bridge.answer(answer,actor)).rejects.toThrow('inventory_decision_io_sentinel');await Promise.resolve();
  expect(resolved).toBe(false);expect(bridge.readQuestionInventory(input,actor).questions.map(q=>q.token)).toEqual([frame.questions[0].token]);
  database.exec('DROP TRIGGER inventory_decision_io_fault');
  await bridge.answer(answer,actor);expect(await pending).toEqual({decision:'accept'});
  await expect(bridge.answer(answer,actor)).rejects.toThrow(/approval/);
 }finally{
  database?.exec('DROP TRIGGER IF EXISTS inventory_decision_io_fault');await bridge.dispose();rmSync(dir,{recursive:true,force:true});
 }
});

it('checks the original Main admission after the real pre-effect Native SQLite write and retains the pending question on rejection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-main-admission-'));let client!:NativeFixture;const actor={requestSource:'user' as const,actorId:'u'},bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any});let db:any;
 try{
  const task=await bridge.create({prompt:'actual Main decision guard',materials:[],context:{threadId:'t'}},actor);await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());const request=client.options.onApproval({id:9,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'guarded'}});let accepted=false;void request.then((result:any)=>{accepted=result.decision==='accept';});const snapshot=(await bridge.host.inspectTask(task.taskId))!,input={taskId:task.taskId,threadId:'t',sessionId:snapshot.sessionId},frame=bridge.readQuestionInventory(input,actor),answer={taskId:task.taskId,answer:{type:'choice' as const,questionId:frame.questions[0].token,choiceId:'approve'}};
  await expect(bridge.answerFromQuestionInventory(answer,actor,structuredClone(frame),()=>{})).rejects.toThrow(/inventory_stale/);
  let allowed=true;db=(bridge as any).native.db;db.function('revoke_main_during_native_save',()=>{allowed=false;return 0;});db.exec('CREATE TRIGGER revoke_main_during_native_save AFTER INSERT ON codex_native_sessions BEGIN SELECT revoke_main_during_native_save(); END');
  await expect(bridge.answerFromQuestionInventory(answer,actor,frame,()=>{if(!allowed)throw Error('task_actor_forbidden');})).rejects.toThrow('task_actor_forbidden');await Promise.resolve();expect(accepted).toBe(false);expect(bridge.readQuestionInventory(input,actor).questions.map(q=>q.token)).toEqual([answer.answer.questionId]);
  db.exec('DROP TRIGGER revoke_main_during_native_save');allowed=true;await bridge.answerFromQuestionInventory(answer,actor,bridge.readQuestionInventory(input,actor),()=>{if(!allowed)throw Error('task_actor_forbidden');});expect(await request).toEqual({decision:'accept'});
 }finally{db?.exec('DROP TRIGGER IF EXISTS revoke_main_during_native_save');await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
it('rechecks original Native pending state after a narrowing guard reenters revocation and never sends a later accept',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-guard-reentry-'));let client!:NativeFixture;const actor={requestSource:'user' as const,actorId:'u'},bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any});
 try{
  const task=await bridge.create({prompt:'actual guard reentry',materials:[],context:{threadId:'t'}},actor);await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());const request=client.options.onApproval({id:10,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'guarded'}});const snapshot=(await bridge.host.inspectTask(task.taskId))!,frame=bridge.readQuestionInventory({taskId:task.taskId,threadId:'t',sessionId:snapshot.sessionId},actor),native=(bridge as any).native;
  await expect(native.decide(actor,frame.sessionId,frame.questions[0].token,'allow',()=>{native.beginShutdown();})).rejects.toThrow(/approval_expired/);expect(await request).toEqual({decision:'decline'});
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
it('runs the trusted original task activity birth while still prepared and before any Native client is created',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-activity-before-start-'));let bridge!:CodexTaskBridge,hookTaskId:string|undefined;const factory=vi.fn(options=>new NativeFixture(options) as any),actor={requestSource:'user' as const,actorId:'u'};
 bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:factory,beforeStartTask:async(task,user,current)=>{current();expect(user).toEqual(actor);hookTaskId=task.taskId;const snapshot=(await bridge.host.inspectTask(task.taskId))!;expect(snapshot.status).toBe('understanding');expect(bridge.host.getPreparedSourceReceipt(task.taskId)).toBeDefined();expect(factory).not.toHaveBeenCalled();}});
 try{const task=await bridge.create({prompt:'birth before start',materials:[],context:{threadId:'t'}},actor,()=>{});expect(hookTaskId).toBe(task.taskId);}finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
it('cancels the actual prepared task when its original creation guard is withdrawn during activity birth, without starting a Native client',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-birth-revoke-'));let bridge!:CodexTaskBridge,release!:()=>void,enter!:()=>void,taskId='',allowed=true;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r),factory=vi.fn(options=>new NativeFixture(options) as any),actor={requestSource:'user' as const,actorId:'u'};
 bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:factory,beforeStartTask:async(task)=>{taskId=task.taskId;enter();await gate;}});
 const creating=bridge.create({prompt:'revoke during birth',materials:[],context:{threadId:'t'}},actor,()=>{if(!allowed)throw Error('native_original_actor_revoked');});const observed=Promise.allSettled([creating]);
 try{await Promise.race([entered,creating.then(()=>{throw Error('native_birth_hook_missing');})]);allowed=false;release();const result=await observed;expect(result[0].status).toBe('rejected');if(result[0].status!=='rejected')throw Error('expected_native_birth_rejection');expect(result[0].reason.message).toBe('native_original_actor_revoked');expect(factory).not.toHaveBeenCalled();expect((await bridge.host.inspectTask(taskId))?.status).toBe('cancelled');expect(bridge.owns(taskId)).toBe(true);}finally{release();await observed;await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
