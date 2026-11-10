import {describe,it,expect,vi} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {closeConversationActivity} from '../../../src/runtime/conversation-activity/close.js';
import {ConversationActivityOwnerHost} from '../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {ConversationActivityAttachedService} from '../../../src/runtime/conversation-activity/owner-service.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ActivityOwnerMcp} from '../../../src/runtime/conversation-activity/owner-mcp.js';
import {ActivityNativeIdentityRepository} from '../../../src/runtime/conversation-activity/native-identity.js';
import {ConversationMcpActivities} from '../../../src/runtime/conversation-activity/mcp.js';
import {createMcpClientConnection} from '../../../src/platform/mcp/transport.js';
import {callMcpToolWithTasks} from '../../../src/platform/mcp/tasks.js';

describe('real stdio SDK, authenticated source reader and original daemon SQLite',()=>{
 it('keeps the real native connection in Main while the original owner finalizes the actual SDK inventory',async()=>{
  const root=mkdtempSync(join(tmpdir(),'attention-sdk-owner-')),identities=join(root,'sessions');mkdirSync(identities);
  writeFileSync(join(identities,'thread.json'),JSON.stringify({schemaVersion:1,sessionId:'thread',cwd:root,intentDelegation:{ownership:{state:'owned',ownerInstanceId:'instance'}},messages:[]}));
  const identity=new ActivityNativeIdentityRepository({kind:'cli',path:identities,workspaceRoot:root,profileId:'profile',instanceId:'instance'});
  let ownerMcp!:ActivityOwnerMcp;
  const host=new ConversationActivityOwnerHost({dataRoot:join(root,'activity'),profileId:'profile',actorId:'user',getThread:id=>identity.getThread(id),authorizeProducer:(id,instance)=>identity.authorizeProducer(id,instance),
   canObserveWork:watch=>ownerMcp.canObserve(watch),mcpRequest:(method,input,clientId)=>method==='mcpRegister'?ownerMcp.register(input,clientId):Promise.reject(Error('fixture_method_unavailable')),disconnected:id=>ownerMcp.disconnected(id)});
  ownerMcp=new ActivityOwnerMcp({root:join(root,'activity'),store:host.store,service:host.service,actorId:'user'});await host.start();
  let mcp!:ConversationMcpActivities;
  const assertNative=(watch:import('../../../src/runtime/conversation-activity/types.js').WorkWatch,actor:import('../../../src/runtime/conversation-activity/service.js').ActivityActor)=>{
    const thread=identity.getThread(watch.origin.threadId);if(actor.requestSource!=='user'||actor.actorId!=='user'||!thread||thread.deleteState!=='none'||thread.workspaceId!==watch.origin.workspaceId)throw Error('activity_thread_forbidden');
  };
  const client=new ConversationActivityOwnerClient(join(root,'activity'),'producer','instance'),service=new ConversationActivityAttachedService(client,'user',{assertNative,
   reader:{hasBinding:id=>mcp.hasAttentionReaderBinding(id),collect:(slot,actor)=>mcp.collectAttentionInventory(slot,actor),assertCurrent:(slot,actor)=>mcp.assertAttentionInventoryCurrent(slot,actor)}}),readonlyStore=new ConversationActivityStore(join(root,'activity','conversation-activity.sqlite'),{readOnly:true});
  const connection=await createMcpClientConnection('input-task',{type:'stdio',command:process.execPath,args:[join(process.cwd(),'tests/support/mcp-tasks-stdio-server.js')],env:{XIAOK_TEST_TASK_DELAY_MS:'20',XIAOK_TEST_TWO_INPUTS:'1'},protocol:{mode:'modern',version:'2026-07-28'}});
  mcp=new ConversationMcpActivities({store:readonlyStore,service,actorId:'user',originThread:async()=> 'thread',
   endpointReady:async connection=>{await client.request('mcpRegister',{endpointId:connection.tasks!.endpointId,name:connection.activityEndpoint!.name});},
   assertLocalUserRead:assertNative});
  mcp.register(connection);const actor={requestSource:'user' as const,actorId:'user'};
  let expectedMcpCloseError:unknown,expectedServiceCloseError:unknown;
  try{
   const observer=await mcp.observer('task','call',connection);await callMcpToolWithTasks(connection,{name:'work',arguments:{ask:true}},{observer,detachOnTask:true,timeout:2000});
   await vi.waitFor(()=>expect(host.store.getProjection('mcp:call')?.executionState).toBe('input_required'),{timeout:3000});
   const round=await client.request<any>('attentionReadBegin',{watchId:'mcp:call'}),inventory=await mcp.collectAttentionInventory(round.readerSlots[0],actor);
   const result=await client.request<any>('attentionReadFinalize',{roundId:round.roundId,inventories:[inventory]});expect(result.view.presentation.questions).toHaveLength(2);expect(result.view.presentation.questions[0].sourceRevision).toBe(1);
   const collect=vi.spyOn(mcp,'collectAttentionInventory'),[one,two]=await Promise.all([service.getWork('mcp:call',actor),service.getWork('mcp:call',actor)]);
   expect(one.presentation?.questions).toHaveLength(2);expect(two.attentionState).toEqual(one.attentionState);expect(collect).toHaveBeenCalledOnce();
   const dismissed=await service.dismissAttention('mcp:call',{expectedProjectionVersion:one.presentation!.projectionVersion,expectedPresentationIncarnation:one.attentionState!.presentationIncarnation},actor);
   expect(dismissed.attentionState?.dismissed).toBe(true);expect(dismissed.presentation?.questions).toHaveLength(2);
   expect(()=>readonlyStore.getAttentionPresentation('mcp:call')).toThrow('conversation_activity_readonly');
   const forms=await mcp.inputs('mcp:call',actor),format=forms.find(form=>form.inputId==='format')!,scope=forms.find(form=>form.inputId==='scope')!;
   await mcp.answerInput('mcp:call',{inputId:format.inputId,expectedDigest:format.expectedDigest,action:'accept',content:{format:'pdf',count:2}},actor);
   const remaining=await service.getWork('mcp:call',actor);expect(remaining.presentation?.questions).toHaveLength(1);expect(remaining.presentation?.questions[0].sourceRevision).toBe(1);expect(remaining.attentionState?.dismissed).toBe(false);
   await expect(mcp.answerInput('mcp:call',{inputId:format.inputId,expectedDigest:format.expectedDigest,action:'accept',content:{format:'pdf',count:2}},actor)).rejects.toThrow('activity_mcp_input_stale');
   await mcp.answerInput('mcp:call',{inputId:scope.inputId,expectedDigest:scope.expectedDigest,action:'accept',content:{scope:'team'}},actor);
   const completed=await service.getWork('mcp:call',actor);expect(completed.presentation?.questions).toEqual([]);expect(completed.projection.executionState).toBe('completed');
   const stats=await connection.client.callTool({name:'stats',arguments:{}});expect(JSON.parse((stats.content[0] as {text:string}).text)).toEqual({calls:1,updates:2,cancels:0});
   await connection.client.callTool({name:'fixture-read-delay',arguments:{ms:250}});
   const task=connection.tasks!.task.bind(connection.tasks);let snapshotEntered=false;
   vi.spyOn(connection.tasks!,'task').mockImplementation(id=>{const actual=task(id);return Object.assign(Object.create(actual),{snapshot:()=>{snapshotEntered=true;return actual.snapshot();}});});
   const heldRead=service.getWork('mcp:call',actor),observedRead=Promise.allSettled([heldRead]);await vi.waitFor(()=>expect(snapshotEntered).toBe(true));
   let closed=false;const close=closeConversationActivity({mcp,service,store:readonlyStore}),observedClose=close.then(()=>{closed=true;return undefined;},error=>{closed=true;return error;});
   await new Promise(resolve=>setTimeout(resolve,30));expect(closed).toBe(false);expect(readonlyStore.getWatch('mcp:call')).not.toBeNull();
   expect((await observedRead)[0].status).toBe('rejected');expect(await observedClose).toBeInstanceOf(AggregateError);expect(closed).toBe(true);
   expectedMcpCloseError=await mcp.close().catch(error=>error);expectedServiceCloseError=await service.close().catch(error=>error);

  }finally{
   const failures:unknown[]=[];for(const stop of [async()=>{try{await mcp.close();}catch(error){if(error!==expectedMcpCloseError)throw error;}},()=>connection.close(),async()=>{try{await service.close();}catch(error){if(error!==expectedServiceCloseError)throw error;}readonlyStore.close();},()=>ownerMcp.close(),()=>host.stop(),()=>identity.close()])try{await stop();}catch(error){failures.push(error);}
   rmSync(root,{recursive:true,force:true});if(failures.length)throw new AggregateError(failures,'actual attention wire cleanup failed');
  }
 });
});
