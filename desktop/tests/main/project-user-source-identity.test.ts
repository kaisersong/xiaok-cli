// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as source from '../../electron/conversation-project-service.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
import type {GoalTurnExecutionScope} from '../../../src/runtime/task-host/types.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-user-source-'));const workspace=join(root,'workspace');mkdirSync(workspace);
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));const materials=new MaterialRegistry({workspaceRoot:workspace,maxBytes:1024});
 const population=createTaskSourceWriterPopulation(snapshots);const host=population.createHost({materialRegistry:materials,runner:async()=>{},aheGuards:{artifactEvidence:false,recoveryContinuity:false}});
 const kswarmService={request:vi.fn(async()=>Response.json({ok:true})),getDesktopMutationToken:()=> 'fixture-only'};
 const service=new source.ConversationProjectService({dataRoot:root,workspaceRoot:workspace,kswarmService});const ids:string[]=[];
 cleanup.push(async()=>{for(const id of ids){const snapshot=await host.inspectTask(id);if(snapshot&&!['cancelled','completed','failed'].includes(snapshot.status))await host.cancelTask(id,'fixture_cleanup');}await population.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});});
 const scope:GoalTurnExecutionScope={kind:'goal_turn',origin:'user',goalId:'goal',epoch:1,goalTurnId:'turn-1',threadId:'thread'};
 const prepare=async(prompt='另外做一个独立任务',executionScope:GoalTurnExecutionScope|undefined=scope)=>{
  return service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},async()=>{
   const prepared=await host.prepareTask({prompt,materials:[],context:{threadId:'thread'},executionScope,permissionMode:'auto'});ids.push(prepared.taskId);
   const actual=await host.inspectTask(prepared.taskId);if(!actual)throw Error('actual_prepared_missing');
   const recorded=service.recordPreparedUserTask(actual,{requestSource:'user'});return {prepared,recorded};
  });
 };
 return {root,workspace,service,scope,prepare,kswarmService};
}
it('real prepared user roots receive stable main message identity across runtime retries and reopen',async()=>{
 const f=fixture();const first=await f.prepare(),second=await f.prepare();
 expect(first.prepared.taskId).not.toBe(second.prepared.taskId);
 const a=source.resolveProjectUserSourceProof(f.service.readProjectUserSource(first.prepared.taskId)!);
 const b=source.resolveProjectUserSourceProof(f.service.readProjectUserSource(second.prepared.taskId)!);
 expect(a).toEqual(b);expect(a.canonicalMessageId).toMatch(/^main-user-message:/);
 const reopened=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:f.workspace,kswarmService:f.kswarmService});
 expect(source.resolveProjectUserSourceProof(reopened.readProjectUserSource(first.prepared.taskId)!)).toEqual(a);
 expect(f.kswarmService.request).not.toHaveBeenCalled();
});
it('same text from distinct trusted user turns remains two independent identities',async()=>{
 const f=fixture();const first=await f.prepare(),second=await f.prepare(undefined,{...f.scope,goalTurnId:'turn-2'});
 const a=source.resolveProjectUserSourceProof(f.service.readProjectUserSource(first.prepared.taskId)!);
 const b=source.resolveProjectUserSourceProof(f.service.readProjectUserSource(second.prepared.taskId)!);
 expect(a.canonicalMessageId).not.toBe(b.canonicalMessageId);
});
it('conflicting text under the same trusted canonical user turn is rejected',async()=>{
 const f=fixture();await f.prepare('original');await expect(f.prepare('changed')).rejects.toThrow('conversation_user_source_conflict');
 expect(f.kswarmService.request).not.toHaveBeenCalled();
});
it('a pre-write source conflict does not prevent a different valid user turn',async()=>{
 const f=fixture();await f.prepare('original');await expect(f.prepare('changed')).rejects.toThrow('conversation_user_source_conflict');
 await expect(f.prepare('next user message',{...f.scope,goalTurnId:'turn-2'})).resolves.toMatchObject({recorded:true});
});
it('plain fields cannot forge a source proof and another workspace cannot recover it as current input',async()=>{
 const f=fixture();const first=await f.prepare();const proof=f.service.readProjectUserSource(first.prepared.taskId)!;
 const view=source.resolveProjectUserSourceProof(proof);
 expect(()=>source.resolveProjectUserSourceProof({...view} as never)).toThrow('conversation_user_source_unverified');
 const other=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:join(f.root,'other-workspace'),kswarmService:f.kswarmService});
 expect(other.readProjectUserSource(first.prepared.taskId)).toBeUndefined();
});
it('writer seal invalidates both new and already issued source proofs',async()=>{
 const f=fixture();const first=await f.prepare();const proof=f.service.readProjectUserSource(first.prepared.taskId)!;
 f.service.sealUserTaskFacts();
 expect(()=>source.resolveProjectUserSourceProof(proof)).toThrow('conversation_user_admission_closed');
 expect(()=>f.service.readProjectUserSource(first.prepared.taskId)).toThrow('conversation_user_admission_closed');
});
it('continuations do not acquire a user source identity',async()=>{
 const f=fixture();const current=await f.prepare('background',{...f.scope,origin:'continuation'});
 expect(current.recorded).toBe(false);expect(f.service.readProjectUserSource(current.prepared.taskId)).toBeUndefined();
});
