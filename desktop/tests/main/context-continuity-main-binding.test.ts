// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
// Module import only: no App, BrowserWindow, UI or genuine-Main qualification.
it('binds the actual DesktopServices preparation and canonical history to the same journal owner',async()=>{
 const {createDesktopServices}=await import('../../electron/desktop-services.js');const {mockKSwarmService}=await import('../support/desktop-services-fixtures.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-real-main-owner-'));
 console.info('owned continuity root',root);let failure:{raw:unknown}|undefined;
 const services=createDesktopServices({dataRoot:root,knowledgeDbPath:join(root,'knowledge.test.sqlite'),kswarmService:mockKSwarmService(),runner:async()=>{}});
 try{
  const {service,actor}=services.continuity.port(),conversation=service.createConversation(actor,{operationId:'real-main-create'});
  const result=await services.createTask({prompt:'canonical original',materials:[],context:{threadId:conversation.id}});
  const read=await services.readTaskHistory(result.taskId);expect(read.snapshot.context?.threadId).toBe(conversation.id);expect(read.presentation?.prompt).toBe('canonical original');services.assertTaskHistoryCurrent(read);
  expect(()=>services.assertTaskHistoryCurrent(structuredClone(read))).toThrow();
  const next=service.createConversation(actor,{operationId:'real-goal-create'}),reply=await services.createGoal({threadId:next.id,objective:'visible goal objective',expectedEvidenceKinds:['answer']});
  expect((await services.getGoal(next.id))?.state.objective).toBe('visible goal objective');
  const goalRead=await services.readTaskHistory(reply.preparedTask.taskId);expect(goalRead.presentation?.prompt).toBe('visible goal objective');
  const receipt=await services.pauseGoal(next.id);expect(Object.keys(receipt).sort()).toEqual(['revision','status','threadId']);expect(receipt.status).toBe('paused');
  const afterPause=await services.readTaskHistory(reply.preparedTask.taskId);expect(afterPause.snapshot.status).toBe('cancelled');

 }catch(raw){failure={raw};}finally{let cleanup:{raw:unknown}|undefined;try{const result=await services.disposeMultiAgent();if(!result.drained)throw Error('continuity_fixture_close_unconfirmed '+root);rmSync(root,{recursive:true,force:true});}catch(raw){cleanup={raw};}if(failure&&cleanup)throw new AggregateError([failure.raw,cleanup.raw],'continuity_original_and_close_failed',{cause:failure.raw});if(failure)throw failure.raw;if(cleanup)throw cleanup.raw;}
});
