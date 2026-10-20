// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {registerConversationActivityIpc} from '../../electron/conversation-activity-ipc.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain} from '../../electron/shutdown-aware-ipc-main.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {ConversationActivityOwnerClient} from '../../../src/runtime/conversation-activity/owner-client.js';
import {activityOwnerConfigDigest,startConversationActivityOwner} from '../../../src/runtime/conversation-activity/owner-runtime.js';
import {FileTaskSnapshotStore,recoverTaskSnapshotSync} from '../../../src/runtime/task-host/snapshot-store.js';
const kswarmService={getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never;
it.each(['main','attached-owner','ipc-microtask','ipc-sender-after-inner','ipc-diagnostic-microtask','owner-socket-microtask','owner-source-profile-work','owner-source-profile-list','owner-source-workspace-work','owner-source-workspace-list','ipc-source-epoch','ipc-source-thread','owner-source-epoch-socket','owner-source-thread-socket','ipc-source-epoch-journal','owner-source-thread-journal-socket'] as const)('enforces current grant, scope and source identity at real %s Activity disclosure',async mode=>{
 const root=mkdtempSync(join(tmpdir(),'continuity-activity-disclosure-'));let refId='';
 let main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService,runner:async input=>{
  const p=main.continuity.port(),summary=input.prompt==='source'?'ACTIVITY_DERIVED_CANARY':p.service.resolveReference({...p.actor,requestSource:'agent',taskId:input.taskId},{refId}).messages.find(message=>message.role==='assistant')!.text;
  await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'test',stepId:'test',note:JSON.stringify({summary,artifacts:[]})});
 }});
 let owner:Awaited<ReturnType<typeof startConversationActivityOwner>>|undefined,client:ConversationActivityOwnerClient|undefined,qualification:{profileId:string;configDigest:string;generation:number}|undefined;
 const prior=process.env.XIAOK_CONVERSATION_ACTIVITY;
 try{
  const p=main.continuity.port(),source=p.service.createConversation(p.actor,{operationId:'source'}),target=p.service.createConversation(p.actor,{operationId:'target'});
  const a=await main.createTask({prompt:'source',materials:[],context:{threadId:source.id}});await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(a.taskId)).toBeTruthy());
  refId=p.service.createReference(p.actor,{conversationId:source.id,expectedRevision:p.service.getConversation(p.actor,source.id)!.revision,operationId:'ref'}).refId;
  const grant=p.service.attachReference(p.actor,{refId,targetConversationId:target.id,operationId:'grant'}),b=await main.createTask({prompt:'derive',materials:[],context:{threadId:target.id}});
  await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT 1 FROM effect_owner_receipts WHERE task_id=?').get(b.taskId)).toBeTruthy());
  const snapshot=(await main.recoverTask(b.taskId)).snapshot;expect(snapshot.result?.summary).toContain('ACTIVITY_DERIVED_CANARY');await main.disposeMultiAgent();
  // Persist a valid main-owned routing identity and watch. The actual production
  // source adapter below replays the real TaskHost journal; no cached summary is injected.
  main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService});await main.multiAgent!.ready;const m=main.multiAgent!,profileId=m.profileId,workspaceId=m.workspaceId;
  m.service.registerThread({threadId:source.id,profileId,workspaceId,cwd:m.cwd});m.service.registerThread({threadId:target.id,profileId,workspaceId,cwd:m.cwd});await main.disposeMultiAgent();
  const store=new ConversationActivityStore(join(root,'conversation-activity.sqlite'));
  try{store.prepareAssociation({operationId:'watch-op',creationIdempotencyKey:'watch-op',origin:{profileId,workspaceId,threadId:target.id,actorId:`desktop-user:${profileId}`}});
   store.bindWork({operationId:'watch-op',watchId:'derived-watch',source:'task_host',logicalSourceId:'task-host-local',sourceDataEpoch:snapshot.sessionId,workId:b.taskId,actualExecutionThreadId:target.id});
  }finally{store.close();}
  if(mode!=='main'&&!mode.startsWith('ipc-'))process.env.XIAOK_CONVERSATION_ACTIVITY='0';
  main=createDesktopServices({ knowledgeDbPath: join(root, 'knowledge.test.sqlite'),dataRoot:root,kswarmService});await main.multiAgent!.ready;
  const actor={requestSource:'user' as const,actorId:`desktop-user:${profileId}`};
  let getWork:()=>Promise<unknown>,list:()=>Promise<unknown>;
  if(mode==='main'||mode.startsWith('ipc-')){
   main.bindConversationProjectRoomClient({} as never);
   getWork=()=>main.conversationActivity!.getWork('derived-watch',actor);list=()=>main.conversationActivity!.list(target.id,actor);
  }else{
   const config={schemaVersion:1 as const,dataRoot:root,profileId,actorId:actor.actorId,identity:{kind:'desktop' as const,path:join(root,'multi-agent','groups.sqlite')}};owner=await startConversationActivityOwner(config);qualification={profileId,configDigest:activityOwnerConfigDigest(config),generation:4};
   getWork=()=>owner!.host.service.getWork('derived-watch',actor);list=()=>owner!.host.service.listActivities(target.id,actor);
  }
  await vi.waitFor(async()=>expect(JSON.stringify(await getWork())).toContain('ACTIVITY_DERIVED_CANARY'),{timeout:5000});
  expect(JSON.stringify(await list())).toContain('ACTIVITY_DERIVED_CANARY');
  const current=main.continuity.port();
  const identityRace=mode.includes('source-epoch')||mode.includes('source-thread');
  const replaceActualSource=async()=>{
   const checkpointPath=join(root,'tasks','snapshots',`${b.taskId}.json`),before=readFileSync(checkpointPath,'utf8');
   const changed={...(mode.includes('source-epoch')?{...snapshot,sessionId:`${snapshot.sessionId}_replacement`}:{...snapshot,context:{...snapshot.context,threadId:source.id}}),...(mode.includes('journal')?{status:'running' as const}:{})};
   await new FileTaskSnapshotStore(join(root,'tasks')).save(changed);
   if(mode.includes('journal')){expect(readFileSync(checkpointPath,'utf8')).toBe(before);expect(readFileSync(join(root,'tasks','snapshots',`${b.taskId}.journal.jsonl`),'utf8').length).toBeGreaterThan(0);}
   const disk=recoverTaskSnapshotSync(join(root,'tasks'),b.taskId)!;
   expect(mode.includes('source-epoch')?disk.sessionId:disk.context?.threadId).toBe(mode.includes('source-epoch')?changed.sessionId:source.id);
  };
  if(mode.startsWith('ipc-')){
   const api=main.conversationActivity!,original=api.getWork,ownerRead=ConversationActivityService.prototype.getWork;
   const diagnostic=mode==='ipc-diagnostic-microtask'?vi.spyOn(ConversationActivityService.prototype,'getWork').mockImplementation(async function(...args){await this.sourceUnavailable('derived-watch','unavailable','activity_source_forbidden');return ownerRead.apply(this,args);}):undefined;
   const senderRace=mode==='ipc-sender-after-inner';let allowed=true;
   const spy=vi.spyOn(api,'getWork').mockImplementation(async(...args)=>{const result=await original(...args);if(identityRace)await replaceActualSource();else if(!senderRace)queueMicrotask(()=>current.service.revokeGrant(current.actor,grant));return result;});
   const originalAssert=api.assertResultCurrent!;
   const finalSpy=senderRace?vi.spyOn(api,'assertResultCurrent').mockImplementation(result=>{originalAssert(result);queueMicrotask(()=>{allowed=false;});}):undefined;
   const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>(),raw={handle:(channel:string,handler:unknown)=>handlers.set(channel,handler as never)};
   const registrar=senderRace?new ShutdownAwareIpcMain(raw as never,new DesktopShutdownGate()):raw;
   const stop=registerConversationActivityIpc(registrar,api,()=>allowed?{actorId:actor.actorId}:null);
   try{await expect(handlers.get('desktop:activity:work')!({sender:{id:1}},{watchId:'derived-watch'})).rejects.toThrow(senderRace?'activity_actor_forbidden':'activity_source_forbidden');}
   finally{spy.mockRestore();diagnostic?.mockRestore();finalSpy?.mockRestore();stop();}
   if(senderRace)return;
  }else if(mode==='owner-socket-microtask'||identityRace&&mode.endsWith('-socket')){
   client=new ConversationActivityOwnerClient(root,'user',undefined,{qualification});await client.connect();
   const original=owner!.host.service.getWork.bind(owner!.host.service),spy=vi.spyOn(owner!.host.service,'getWork').mockImplementation(async(...args)=>{const result=await original(...args);if(mode==='owner-socket-microtask')queueMicrotask(()=>current.service.revokeGrant(current.actor,grant));else await replaceActualSource();return result;});
   try{await expect(client.request('work',{watchId:'derived-watch'})).rejects.toThrow('activity_source_forbidden');}finally{spy.mockRestore();}
  }else if(mode.startsWith('owner-source-')){
   const changed=new DatabaseSync(join(root,'multi-agent','groups.sqlite'));try{if(mode.includes('-profile-'))changed.prepare('UPDATE thread_bindings SET profile_id=? WHERE thread_id=?').run('foreign-profile',source.id);else changed.prepare('UPDATE thread_bindings SET workspace_id=? WHERE thread_id=?').run('foreign-workspace',source.id);}finally{changed.close();}
   client=new ConversationActivityOwnerClient(root,'user',undefined,{qualification});await client.connect();
   const route=mode.endsWith('-work')?'work':'list',params=route==='work'?{watchId:'derived-watch'}:{threadId:target.id};
   const result=await client.request(route,params).catch(error=>{if(error.message!=='activity_source_forbidden')throw error;return {error:'activity_source_forbidden'};});
   // Compare main only after capturing the daemon response: main persists sticky
   // invalidation, which would otherwise mask the daemon's missing scope check.
   await expect(main.recoverTask(b.taskId)).rejects.toThrow('not_readable');
   expect(JSON.stringify(result)).not.toContain('ACTIVITY_DERIVED_CANARY');
  }else current.service.revokeGrant(current.actor,grant);
  if(identityRace)return;
  await expect(main.recoverTask(b.taskId)).rejects.toThrow('not_readable');
  expect(JSON.stringify(await getWork())).not.toContain('ACTIVITY_DERIVED_CANARY');
  expect(JSON.stringify(await list())).not.toContain('ACTIVITY_DERIVED_CANARY');
 }finally{
  client?.dispose();await owner?.stop();await main.disposeMultiAgent();if(prior===undefined)delete process.env.XIAOK_CONVERSATION_ACTIVITY;else process.env.XIAOK_CONVERSATION_ACTIVITY=prior;
  rmSync(root,{recursive:true,force:true,maxRetries:3});
 }
},15000);
