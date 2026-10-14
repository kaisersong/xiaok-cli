import{describe,it,expect}from'vitest';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';
import{ActivityTaskSnapshotReader}from'../../../src/runtime/conversation-activity/owner-sources.js';
import{InProcessTaskRuntimeHost,type TaskRunnerInput}from'../../../src/runtime/task-host/task-runtime-host.js';
import{FileTaskSnapshotStore}from'../../../src/runtime/task-host/snapshot-store.js';import{MaterialRegistry}from'../../../src/runtime/task-host/material-registry.js';
describe('original native snapshot directory hints',()=>{
 it('sees a committed live result within two seconds while the active-task pointer remains unchanged',async()=>{
  const root=mkdtempSync(join(tmpdir(),'activity-snapshot-live-'));const signal=new AbortController();const reader=new ActivityTaskSnapshotReader(join(root,'tasks'));
  let release!:()=>void,ready!:(input:TaskRunnerInput)=>void;const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<TaskRunnerInput>(resolve=>ready=resolve);
  const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'workspace'),maxBytes:1024}),runner:async input=>{ready(input);await waiting;}});
  try{const task=await host.createTask({prompt:'native live hint',materials:[],context:{threadId:'thread'}});const input=await started;
   const before=(await host.inspectTask(task.taskId))!;const records=reader.records(task.taskId,{sinceIndex:before.events.length,signal:signal.signal})[Symbol.asyncIterator]();const next=records.next();
   await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:'turn',intentId:'intent',stepId:'step',note:'committed live result'});
   const event=await Promise.race([next,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('snapshot_hint_missing')),2000))]);
   expect(event.value?.event).toMatchObject({type:'result',result:{summary:'committed live result'}});signal.abort();if(!records.return)throw Error('activity_record_iterator_return_missing');await records.return();
  }finally{signal.abort();release();await host.drain();reader.close();rmSync(root,{recursive:true,force:true});}
 });
});
