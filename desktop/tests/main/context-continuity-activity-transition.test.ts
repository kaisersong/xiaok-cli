// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
// Only the external daemon birth is held/rejected. It produces no owner,
// Source, Native receipt or claimed physical process; real Main/read guards run.
const gate=vi.hoisted(()=>{
 let entered!:()=>void,reject!:(raw:unknown)=>void;
 const begun=new Promise<void>(yes=>{entered=yes;}),pending=new Promise<never>((_yes,no)=>{reject=no;});
 void pending.catch(()=>undefined);
 return{begun,pending,reject,entered};
});
vi.mock('../../../src/runtime/conversation-activity/owner-launcher.js',async original=>{
 const actual=await original<typeof import('../../../src/runtime/conversation-activity/owner-launcher.js')>();
 return{...actual,ensureConversationActivityOwner:()=>{gate.entered();return gate.pending;}};
});
it('denies a captured list at the real Main owner-transition output fence',async()=>{
 const {createDesktopServices}=await import('../../electron/desktop-services.js'),{mockKSwarmService}=await import('../support/desktop-services-fixtures.js');
 const root=mkdtempSync(join(tmpdir(),'continuity-activity-current-owner-'));
 const services=createDesktopServices({dataRoot:root,knowledgeDbPath:join(root,'knowledge.test.sqlite'),kswarmService:mockKSwarmService()});
 let attempt:Promise<void>|undefined,first:{raw:unknown}|undefined;
 try{
  await services.multiAgent!.ready;const m=services.multiAgent!,p=services.continuity.port(),conversation=p.service.createConversation(p.actor,{operationId:'transition'});
  await m.service.registerThreadWithOwnership({threadId:conversation.id,profileId:m.profileId,workspaceId:m.workspaceId,cwd:m.cwd},'user');
  const actor={requestSource:'user' as const,actorId:`desktop-user:${m.profileId}`},facade=services.conversationActivity!;
  const list=await facade.list(conversation.id,actor);expect(list).toEqual([]);facade.assertReadResultCurrent!(list,actor);
  attempt=services.attachConversationActivityOwner({});void attempt.catch(()=>undefined);
  expect(()=>facade.assertReadResultCurrent!(list,actor)).toThrow('activity_owner_unavailable');
 }catch(raw){first={raw};}
 finally{
  if(attempt){await gate.begun;gate.reject(Error('fixture_daemon_never_born'));await expect(attempt).rejects.toThrow('fixture_daemon_never_born');}
  let cleanup:{raw:unknown}|undefined;try{const result=await services.disposeMultiAgent();if(!result.drained)throw Error('activity_transition_close_unconfirmed '+root);rmSync(root,{recursive:true,force:true});}catch(raw){cleanup={raw};}
  if(first&&cleanup)throw new AggregateError([first.raw,cleanup.raw],'activity_transition_and_close_failed',{cause:first.raw});if(first)throw first.raw;if(cleanup)throw cleanup.raw;
 }
});
