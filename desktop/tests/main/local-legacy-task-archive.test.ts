// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {rmSync,readFileSync,renameSync,symlinkSync} from 'node:fs';
import {ownedProfileTempDir} from '../support/profile-storage-fixture.js';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import type {TaskSnapshot} from '../../../src/runtime/task-host/types.js';
import {resolveDesktopMainIdentity} from '../../electron/desktop-main-identity.js';
vi.mock('electron',()=>({app:{getPath:()=>'/tmp/local-legacy-archive-ipc'},BrowserWindow:{getAllWindows:()=>[],fromWebContents:()=>undefined},webContents:{fromId:()=>undefined},clipboard:{read:vi.fn()},dialog:{},shell:{}}));
import {registerDesktopIpc} from '../../electron/ipc.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {resolveDesktopServiceScope} from '../../electron/desktop-service-scope.js';

afterEach(()=>vi.restoreAllMocks());
async function fixture(realGroups=false){
 const root=ownedProfileTempDir(join(tmpdir(),'local-legacy-archive-'));
 const identity=resolveDesktopMainIdentity(root);expect(identity.continuity,identity.failure).not.toBeNull();
 const mainIdentity=identity,main=createDesktopServices({dataRoot:root,mainIdentity,knowledgeDbPath:join(root,'knowledge.test.sqlite'),...(realGroups?{}:{runner:async()=>{}}),kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never});
 const p=main.continuity.port(),actor=Object.freeze({requestSource:'user' as const,actorId:'desktop-user:'+mainIdentity.profileId});
 const task:TaskSnapshot={taskId:'task_local_archive_fixture',sessionId:'session_local_archive_fixture',prompt:'RAW_PROMPT_CANARY',materials:[],status:'completed',events:[{type:'canvas_tool_call',toolName:'bash',input:{command:'TOOL_INPUT_CANARY'},toolUseId:'fixture-tool',eventId:'fixture-call'},{type:'canvas_tool_result',toolName:'bash',toolUseId:'fixture-tool',ok:true,response:'TOOL_RESULT_CANARY',eventId:'fixture-result'},{type:'assistant_delta',delta:'Actual old assistant content'},{type:'result',result:{summary:'Actual old assistant content',artifacts:[]}}],createdAt:1,updatedAt:2} as TaskSnapshot;
 const store=new FileTaskSnapshotStore(join(root,'tasks'));await store.save(task);
 return {root,main,p,actor,store,task,mainIdentity,close:async()=>{await main.disposeMultiAgent();main.getKnowledgeBaseStore().close();rmSync(root,{recursive:true,force:true});}};
}
it('reads actual unbound private-file assistant data without granting ownership, exposing raw input, or observing completion',async()=>{
 const f=await fixture();try{
  f.p.service.recordUnprovenEffect(f.p.actor,f.task.taskId,'owner_inventory','legacy_task_without_closure');
  const path=join(f.root,'tasks','snapshots',f.task.taskId+'.json'),before=readFileSync(path),anchors=f.p.service.store.db.prepare('SELECT * FROM message_anchors').all();
  const value=await f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor);
  expect(value).toEqual({taskId:f.task.taskId,sourceEpoch:f.task.sessionId,messages:[{sourceMessageId:'assistant:event:3',role:'assistant',text:'Actual old assistant content'}]});
  for(const canary of ['RAW_PROMPT_CANARY','TOOL_INPUT_CANARY','TOOL_RESULT_CANARY'])expect(JSON.stringify(value)).not.toContain(canary);expect(Object.isFrozen(value)).toBe(true);expect(Object.isFrozen(value.messages)).toBe(true);
  f.main.assertLocalLegacyTaskArchiveCurrent(value,f.actor);
  expect(()=>f.main.assertLocalLegacyTaskArchiveCurrent(JSON.parse(JSON.stringify(value)),f.actor)).toThrow();
  expect(()=>f.main.assertLocalLegacyTaskArchiveCurrent(value,{...f.actor,actorId:'desktop-user:other'})).toThrow();
  const recovery=vi.spyOn(FileTaskSnapshotStore.prototype,'recoverTask').mockRejectedValue(Error('recovery_must_not_run'));
  expect((await f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor)).messages[0].text).toContain('Actual old assistant');expect(recovery).not.toHaveBeenCalled();
  expect(readFileSync(path)).toEqual(before);expect(f.p.service.store.db.prepare('SELECT * FROM message_anchors').all()).toEqual(anchors);
  expect(()=>f.p.service.assertEffectsClosed()).toThrow('blocked_unsettled');
 }finally{await f.close();}
});
it.skipIf(process.platform==='win32')('refuses a symlink escape from the actual snapshot directory',async()=>{
 const f=await fixture();try{const path=join(f.root,'tasks','snapshots',f.task.taskId+'.json'),outside=join(f.root,'outside-snapshot.json');renameSync(path,outside);symlinkSync(outside,path);await expect(f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor)).rejects.toThrow();}finally{await f.close();}
});
it('authorizes the actual local IPC sender and refuses a binding introduced at final output recheck',async()=>{
 const f=await fixture();try{
  const handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>(),frame={},sender={id:1,mainFrame:frame,send:vi.fn(),isDestroyed:()=>false},event={sender,senderFrame:frame};let checks=0,invalidate=false;
  await registerDesktopIpc({handle:(name:string,handler:never)=>handlers.set(name,handler)} as never,{isDestroyed:()=>false,once:vi.fn(),webContents:sender} as never,f.main,{multiAgentAuthorize:input=>{
   if(input.sender!==sender||input.senderFrame!==frame)return null;checks++;if(invalidate&&checks===3)f.p.service.registerGuardedRun(f.p.actor,f.task.taskId,f.task.sessionId);return {actorId:f.actor.actorId};
  }});
  const read=handlers.get('desktop:readLocalLegacyTaskArchive')!;expect(typeof read).toBe('function');
  const result=await read(event,{taskId:f.task.taskId});expect(JSON.stringify(result)).toContain('Actual old assistant content');expect(JSON.stringify(result)).not.toContain('RAW_PROMPT_CANARY');
  await expect(read({sender:{},senderFrame:frame},{taskId:f.task.taskId})).rejects.toThrow(/forbidden|unavailable/);
  checks=0;invalidate=true;await expect(read(event,{taskId:f.task.taskId})).rejects.toThrow('local_legacy_archive_unavailable');
 }finally{await f.close();}
});
it('reads legacy context as local assistant data without inventing a thread owner',async()=>{
 const f=await fixture();try{f.task.context={threadId:'unknown-historical-thread'};await f.store.save(f.task);const before=readFileSync(join(f.root,'tasks','snapshots',f.task.taskId+'.json'));const value=await f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor);expect(value.messages[0].text).toBe('Actual old assistant content');expect(f.p.service.store.db.prepare('SELECT 1 FROM task_bindings WHERE task_id=?').get(f.task.taskId)).toBeUndefined();expect(readFileSync(join(f.root,'tasks','snapshots',f.task.taskId+'.json'))).toEqual(before);}finally{await f.close();}
});
it.each(['foreign','delete_pending'] as const)('refuses an actual %s groups-store thread in the original Main services',async kind=>{
 const f=await fixture(true);let groups:DesktopMultiAgentStore|undefined;try{
  const scope=resolveDesktopServiceScope({dataRoot:f.root,profileId:f.mainIdentity.profileId});groups=new DesktopMultiAgentStore(join(f.root,'multi-agent','groups.sqlite'));
  groups.registerThread({threadId:'historical-thread',profileId:kind==='foreign'?'f'.repeat(64):scope.profileId,workspaceId:scope.workspaceId,cwd:scope.cwd});
  if(kind==='delete_pending')groups.beginThreadDeletion('historical-thread',{operationId:'archive-denial-fixture',requestHash:'fixture',actorId:f.actor.actorId,bootId:groups.bootId,expectedRevision:0,startedAt:1,result:{operationId:'archive-denial-fixture',state:'cleanup_pending',cleanupPending:true,resourcesReleased:false}});
  expect(groups.getThread('historical-thread')?.deleteState).toBe(kind==='delete_pending'?'delete_pending':'none');
  f.task.context={threadId:'historical-thread'};await f.store.save(f.task);await expect(f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor)).rejects.toThrow('task_scope_forbidden');
 }finally{groups?.close();await f.close();}
});
it.each(['executionScope','binding','publicInput','presentation','guardedRun'] as const)('refuses an actual %s instead of using the local archive as a protected-history fallback',async kind=>{
 const f=await fixture();try{
  if(kind==='executionScope'){f.task.executionScope={kind:'goal_turn',threadId:'foreign-thread'} as TaskSnapshot['executionScope'];await f.store.save(f.task);}
  else{
   const c=f.p.service.createConversation(f.p.actor,{operationId:'archive-test-conversation'}),db=f.p.service.store.db;
   if(['binding','publicInput','presentation'].includes(kind))db.prepare('INSERT INTO task_bindings VALUES (?,?,0)').run(f.task.taskId,c.id);
   if(kind==='publicInput')db.prepare('INSERT INTO task_public_inputs VALUES (?,?,?,1)').run(f.task.taskId,'private','desktop_task');
   if(kind==='presentation')db.prepare('INSERT INTO task_presentation_sources VALUES (?,?,?,?,?,?)').run(f.task.taskId,1,f.task.sessionId,'raw','scope','input');
   if(kind==='guardedRun')f.p.service.registerGuardedRun(f.p.actor,f.task.taskId,f.task.sessionId);
  }
  await expect(f.main.readLocalLegacyTaskArchive(f.task.taskId,f.actor)).rejects.toThrow();
 }finally{await f.close();}
});
