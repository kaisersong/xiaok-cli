import {captureTask7Event} from '../../electron/task7-typed-ipc.js';
// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
const cleanups:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const c of cleanups.splice(0).reverse())await c();vi.restoreAllMocks();});
async function setup(){
 const dir=mkdtempSync(join(tmpdir(),'xiaok-live-answer-'));const store=new DesktopMultiAgentStore(join(dir,'groups.sqlite'));const coordinator=new DesktopExecutionCoordinator();
 let release!:()=>void;const released=new Promise<void>(r=>{release=r;});let answered!: (value:string)=>void;const answer=new Promise<string>(r=>{answered=r;});
 const service=new DesktopMultiAgentService({store,coordinator,createSession:async()=>({run:async()=>'',dispose:async()=>{}})});
 service.registerThread({threadId:'qa-thread',profileId:'qa',workspaceId:'qa',cwd:dir});
 const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(dir,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(dir,'materials'),maxBytes:1024*1024}),
  authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),
  assertTaskAdmission:(snapshot,kind)=>service.assertHostAdmission(snapshot,kind),
  decideCancellation:(snapshot,reason)=>service.decideHostCancellation(snapshot,reason),
  runner:input=>service.runRoot(input,async context=>{answered(await input.askUser!({prompt:'Choose a harmless QA value',choices:[{id:'qa',label:'QA selected'}]},context.signal));await released;}),
 });
 cleanups.push(async()=>{const closing=service.dispose();release();await closing;await host.drain();store.close();rmSync(dir,{recursive:true,force:true});});
 await service.initialize(host);const prepared=await service.prepareRoot(host,'qa-thread',{prompt:'Read-only QA',materials:[]});await host.startTask(prepared.taskId);
 let snapshot!:TaskSnapshot;await vi.waitFor(async()=>{snapshot=(await host.inspectTask(prepared.taskId))!;expect(snapshot.status).toBe('waiting_user');});
 const question=snapshot.events.findLast(e=>e.type==='needs_user');if(question?.type!=='needs_user')throw Error('missing QA question');
 return{service,store,host,snapshot,answer,input:{taskId:prepared.taskId,answer:{questionId:question.question.questionId,type:'choice' as const,choiceId:'qa'}}};
}
it('accepts input for the actual active root while keeping ordinary start admission closed',async()=>{
 const f=await setup();expect(f.store.getRootBinding(f.snapshot.taskId)?.phase).toBe('active');
 expect(()=>f.service.assertHostAdmission(f.snapshot)).toThrow('multi_agent_prepare_interrupted');
 await expect(f.host.answerQuestion(f.input)).resolves.toBeUndefined();expect(await f.answer).toBe('QA selected');
 const resolved=(await f.host.inspectTask(f.snapshot.taskId))!.events.filter(e=>e.type==='question_resolved');expect(resolved).toHaveLength(1);expect(captureTask7Event(resolved[0])).toEqual(resolved[0]);
});
it('still rejects revoked authorization without consuming the pending answer',async()=>{
 const f=await setup();const current=f.service.getExecutionAuthorization();const spy=vi.spyOn(f.service,'getExecutionAuthorization').mockReturnValue({...current,executionAllowed:false});
 await expect(f.host.answerQuestion(f.input)).rejects.toThrow('permission_revoked');
 expect((await f.host.inspectTask(f.snapshot.taskId))?.events.filter(e=>e.type==='question_resolved')).toHaveLength(0);
 spy.mockRestore();await f.host.answerQuestion(f.input);expect(await f.answer).toBe('QA selected');
});
it('rejects a forged epoch or stale preparation on the live-answer path',async()=>{
 const f=await setup();
 expect(()=>f.service.assertHostAdmission({...f.snapshot,multiAgentPreparation:{...f.snapshot.multiAgentPreparation!,rootEpoch:999}},'live_answer')).toThrow();
 const binding=f.store.getRootBinding(f.snapshot.taskId)!;const group=f.store.requireGroup(binding.groupId);f.store.putGroup({...group,currentRootEpoch:binding.rootEpoch+1},true);
 await expect(f.host.answerQuestion(f.input)).rejects.toThrow();
 expect((await f.host.inspectTask(f.snapshot.taskId))?.events.filter(e=>e.type==='question_resolved')).toHaveLength(0);
});
