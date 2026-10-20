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
it('refuses an unavailable continuity execution gate before preparing a task or allocating any native resources',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'codex-unavailable-gate-')),createClient=vi.fn(),admitThread=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient,admitThread,assertNativeExecutionAvailable:()=>{throw new Error('native_execution_gate_unavailable');}});
 try{await expect(bridge.create({prompt:'work',materials:[],context:{threadId:'thread'}},{requestSource:'user',actorId:'u'})).rejects.toThrow('native_execution_gate_unavailable');expect(createClient).not.toHaveBeenCalled();expect(admitThread).not.toHaveBeenCalled();expect(await bridge.host.inspectActiveTasks()).toEqual([]);}
 finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

class NativeFixture {
 threadId='native-fixture'; activeTurnId:string|null=null; pid=0; exited=false; n=0;
 constructor(readonly options:any){}
 async connect(){} async create(){return {thread:{id:this.threadId}};} async resume(id:string){this.threadId=id;}
 async assertNoExternalTools(){}
 async start(){this.activeTurnId=`turn-${++this.n}`;this.emit('turn/started',{turn:{id:this.activeTurnId,status:'inProgress'}});return {turnId:this.activeTurnId};}
 async steer(){return {turnId:this.activeTurnId};}
 async interrupt(){this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'interrupted'}});this.activeTurnId=null;}
 async close(){this.exited=true;}
 emit(method:string,params:any){this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});}
}
it('checks the current context after native connection setup and before the first actual send', async () => {
 const dir=mkdtempSync(join(tmpdir(),'codex-context-gate-')); let client!:NativeFixture; let valid=true; let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;}); const start=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),
  assertContextAdmission:()=>{if(!valid)throw new Error('context_revoked');}, createClient:options=>{client=new NativeFixture(options);client.connect=()=>gate;client.start=start;return client as any;}});
 try {
  const task=await bridge.create({prompt:'private cached history',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});
  await vi.waitFor(()=>expect(client).toBeDefined()); valid=false; release();
  await vi.waitFor(()=>expect(bridge.host.activeExecutionCount()).toBe(0));
  expect(start).not.toHaveBeenCalled(); expect((await bridge.host.recoverTask(task.taskId)).snapshot.status).toBe('failed');
 }finally{release();await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
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

it('does not turn a native connection failure into a physical settlement proof', async () => {
 const dir=mkdtempSync(join(tmpdir(),'codex-proof-'));let client!:NativeFixture; const onExecutionSettled=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any,onExecutionSettled});
 try {
  await bridge.create({prompt:'test',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});
  await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());
  client.options.onFailure(new Error('transport lost while provider still owns tools'));
  await vi.waitFor(()=>expect(bridge.host.activeExecutionCount()).toBe(0));
  expect(client.exited).toBe(false);
  expect(onExecutionSettled).not.toHaveBeenCalled();
 } finally {await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('does not bind a previous turn completion received before the new send ACK to the new task settlement', async () => {
 const dir=mkdtempSync(join(tmpdir(),'codex-stale-proof-')); let client!:NativeFixture; const onExecutionSettled=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any,onExecutionSettled});
 try {
  await bridge.create({prompt:'first',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});
  await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy()); const old=client.activeTurnId;
  client.emit('item/agentMessage/delta',{itemId:'first-answer',delta:'first'});client.emit('turn/completed',{turn:{id:old,status:'completed'}});client.activeTurnId=null;
  await vi.waitFor(()=>expect(onExecutionSettled).toHaveBeenCalledTimes(1));
  const start=client.start.bind(client);client.start=async()=>{client.emit('turn/completed',{turnId:old,turn:{id:old,status:'completed'}});return start();};
  await bridge.create({prompt:'second',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});
  await vi.waitFor(()=>expect(client.activeTurnId).toBe('turn-2'));
  client.options.onFailure(new Error('connection failed while new turn still owns effects'));
  await vi.waitFor(()=>expect(bridge.host.activeExecutionCount()).toBe(0));
  expect(onExecutionSettled).toHaveBeenCalledTimes(1);
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('accepts only the matching turn completion before ACK and emits a bounded source proof after IO', async () => {
 const dir=mkdtempSync(join(tmpdir(),'codex-early-proof-'));const onExecutionSettled=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),onExecutionSettled,createClient:options=>{
  const client=new NativeFixture(options);const start=client.start.bind(client);client.start=async()=>{const ack=await start();client.emit('item/agentMessage/delta',{itemId:'answer',delta:'before ACK'});client.emit('turn/completed',{turn:{id:ack.turnId,status:'completed'}});client.activeTurnId=null;return ack;};return client as any;
 }});
 try{
  const task=await bridge.create({prompt:'first',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});
  await vi.waitFor(()=>expect(onExecutionSettled).toHaveBeenCalledTimes(1));
  const [snapshot,receipt]=onExecutionSettled.mock.calls[0];expect(snapshot.taskId).toBe(task.taskId);expect(snapshot.status).toBe('completed');
  expect(receipt).toMatchObject({physicallySettled:false,sourceEpoch:snapshot.sessionId,eventCount:snapshot.events.length});expect(receipt.prefixHash).toMatch(/^[a-f0-9]{64}$/);
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});

it('preserves a matching physical interrupt receipt on user cancellation', async () => {
 const dir=mkdtempSync(join(tmpdir(),'codex-interrupt-proof-'));let client!:NativeFixture;const onExecutionSettled=vi.fn();
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),onExecutionSettled,createClient:options=>(client=new NativeFixture(options)) as any});
 try{
  const actor={requestSource:'user' as const,actorId:'u'};const task=await bridge.create({prompt:'first',materials:[],context:{threadId:'t'}},actor);
  await vi.waitFor(()=>expect(client?.activeTurnId).toBeTruthy());await bridge.cancel(task.taskId,actor);
  await vi.waitFor(()=>expect(onExecutionSettled).toHaveBeenCalledTimes(1));expect(onExecutionSettled.mock.calls[0][0].status).toBe('cancelled');
 }finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
it('runs the native context gate after connection and immediately before the actual send',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-revocable-gate-'));let client!:NativeFixture;let called=0;
 const bridge=new CodexTaskBridge({dataRoot:dir,profileId:'u',cwd:dir,materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'workspace')}),snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),createClient:options=>(client=new NativeFixture(options)) as any,
  acquireNativeContext:()=>{called++;throw new Error('native_revocable_context_unsupported');}});
 try{await bridge.create({prompt:'must not send',materials:[],context:{threadId:'t'}},{requestSource:'user',actorId:'u'});await vi.waitFor(()=>expect(bridge.host.activeExecutionCount()).toBe(0));expect(called).toBe(1);expect(client.n).toBe(0);}
 finally{await bridge.dispose();rmSync(dir,{recursive:true,force:true});}
});
