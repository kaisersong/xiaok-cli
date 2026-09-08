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
