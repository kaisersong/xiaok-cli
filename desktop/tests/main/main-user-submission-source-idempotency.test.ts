// @vitest-environment node
import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {MainUserSubmissionOwner} from '../../electron/main-user-submission.js';
import {ConversationProjectService} from '../../electron/conversation-project-service.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation} from '../../../src/runtime/task-host/task-runtime-host.js';
it('recording the same actual prepared native source twice is idempotent after persisted schema-three parsing',async()=>{
 const root=mkdtempSync(join(tmpdir(),'main-source-idempotency-')),workspaceRoot=join(root,'workspace');
 const sha=(value:string)=>createHash('sha256').update(resolve(value)).digest('hex');
 const owner=new MainUserSubmissionOwner({dataRoot:root,profileId:sha(root),workspaceId:sha(workspaceRoot)});
 const store=new FileTaskSnapshotStore(join(root,'tasks')),population=createTaskSourceWriterPopulation(store),materials=new MaterialRegistry({workspaceRoot,maxBytes:1024});
 const projects=new ConversationProjectService({dataRoot:root,workspaceRoot,userSubmissions:owner,sourceSnapshots:store,kswarmService:{request:async()=>{throw Error('unexpected business effect');},getDesktopMutationToken:()=>''}});
 const host=population.createHost({materialRegistry:materials,runner:async()=>{throw Error('must remain prepared');}});
 try{
  await owner.submit({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',prompt:'Ordinary prepared human source',materials:[],context:{threadId:'original-thread'}}},{requestSource:'user',actorId:`desktop-user:${sha(root)}`},async input=>{
   owner.beginEffects();const task=await host.prepareTask(input),snapshot=(await host.inspectTask(task.taskId))!,receipt=host.getPreparedSourceReceipt(task.taskId)!;
   owner.recordPreparedTask(snapshot,receipt);
   await projects.withUserRequest({prompt:input.prompt,threadId:snapshot.context?.threadId},{requestSource:'user'},async()=>{
    const context={requestSource:'user' as const,preparedSource:receipt,submissionSource:owner.currentPreparedSourceProof()!};
    expect(projects.recordPreparedUserTask(snapshot,context)).toBe(true);
    owner.recordPreparedTask(snapshot,receipt);
    expect(projects.recordPreparedUserTask(snapshot,{...context,submissionSource:owner.currentPreparedSourceProof()!})).toBe(true);
    const source=projects.readProjectUserSource(snapshot.taskId)!;const original=await projects.readOriginalTaskSource(source,new AbortController().signal);expect(original.body).toBe(snapshot.prompt);expect(original.binding.sourceTaskId).toBe(snapshot.taskId);expect(original.binding.sourceSessionId).toBe(snapshot.sessionId);expect(original.binding.identity).toMatchObject({schemaVersion:2,sourceFamily:'main_user_submission'});
   });return task;
  });
 }finally{projects.sealUserTaskFacts();await population.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});}
});
