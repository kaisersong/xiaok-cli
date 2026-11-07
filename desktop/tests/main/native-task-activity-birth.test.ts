// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {ConversationActivityStore} from '../../../src/runtime/conversation-activity/store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import * as atomicFile from '../../../src/utils/atomic-file.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import type {NativeOptions,SessionProbe} from '../../electron/codex-native-transport.js';
import {DatabaseSync} from 'node:sqlite';
import {registerConversationActivityIpc} from '../../electron/conversation-activity-ipc.js';
import {ConversationActivityService} from '../../../src/runtime/conversation-activity/service.js';

class NativeClient {
  threadId='actual-native-thread';activeTurnId:string|null=null;pid=0;exited=false;
  constructor(readonly options:NativeOptions){}
  async connect(){}async create(){return{thread:{id:this.threadId}};}async resume(id:string){this.threadId=id;}
  async start(){this.activeTurnId='actual-native-turn';this.emit('turn/started',{turn:{id:this.activeTurnId,status:'inProgress'}});return{turnId:this.activeTurnId};}
  async steer(){return{turnId:this.activeTurnId};}
  async interrupt(){this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'interrupted'}});this.activeTurnId=null;}
  async close(){this.exited=true;}
  emit(method:string,params:Record<string,unknown>){this.options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});}
}
async function open(){
  const root=mkdtempSync(join(tmpdir(),'native-default-birth-')),config=join(root,'config'),dataRoot=join(root,'data'),workspace=join(root,'workspace');mkdirSync(config);mkdirSync(workspace);
  const old={config:process.env.XIAOK_CONFIG_DIR,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS,activity:process.env.XIAOK_CONVERSATION_ACTIVITY};
  process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';delete process.env.XIAOK_CONVERSATION_ACTIVITY;
  const file=join(workspace,'material.txt');writeFileSync(file,'Original user material.');
  let client:NativeClient|undefined,calls=0,birthObserved=false;
  const gateway={request:vi.fn(async(..._args:unknown[])=>Response.json({agents:[],projects:[]})),getDesktopMutationToken:()=> 'fixture-only',getStatus:()=>({running:false}),onStatusChange:()=>()=>{},submitTaskMetadataOnce:vi.fn(async(..._args:unknown[]):Promise<unknown>=>{throw Error('unexpected metadata submission');})};
  const services=createDesktopServices({dataRoot,workspaceRoot:workspace,knowledgeDbPath:join(root,'knowledge.db'),
    kswarmService:gateway as never,
    codexClientFactory:options=>{
      calls++;const store=new ConversationActivityStore(join(dataRoot,'conversation-activity.sqlite'),{readOnly:true});
      try{
        const watches=store.listWatches();expect(watches).toHaveLength(1);expect(watches[0]).toMatchObject({watchId:`task:${watches[0].workId}`,source:'task_host',actualExecutionThreadId:'user-thread'});
        const records=readdirSync(join(dataRoot,'conversation-projects','user-inputs')).filter(name=>name.endsWith('.json')&&!name.startsWith('canonical-')).map(name=>JSON.parse(readFileSync(join(dataRoot,'conversation-projects','user-inputs',name),'utf8')));
        expect(records.some(record=>record.taskId===watches[0].workId&&record.sessionId===watches[0].sourceDataEpoch)).toBe(true);birthObserved=true;
      }finally{store.close();}
      return(client=new NativeClient(options)) as unknown as SessionProbe;
    }});
  const actor={requestSource:'user' as const,actorId:`desktop-user:${services.multiAgent!.profileId}`};
  await services.saveModelConfig({providerId:'local-codex',modelId:'local-codex'},actor,'user');
  return{root,dataRoot,file,services,actor,gateway,get client(){return client;},get calls(){return calls;},get birthObserved(){return birthObserved;},async close(){
    try{expect(await services.disposeMultiAgent()).toEqual({drained:true});await services.closeMaterialRegistryAndArtifactFileManagerInstances();}
    finally{for(const[key,value]of[['XIAOK_CONFIG_DIR',old.config],['XIAOK_DISABLE_GLOBAL_PLUGINS',old.plugins],['XIAOK_CONVERSATION_ACTIVITY',old.activity]]as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}rmSync(root,{recursive:true,force:true});}
  }};
}
it.each(['canonical-materials','canonical-files','legacy-materials','legacy-files'] as const)('creates the original activity source before default Main %s starts a Native client',async entry=>{
  const f=await open();try{
    const common={prompt:'Inspect this temporary workspace.',context:{threadId:'user-thread'}};
    const current=vi.fn(()=>{});
    const task=entry.startsWith('canonical')
      ?await f.services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:entry.endsWith('files')?{...common,kind:'files',filePaths:[f.file]}:{...common,kind:'materials',materials:[]}},f.actor,current)
      :entry.endsWith('files')?await f.services.createTaskWithFiles({...common,filePaths:[f.file]},f.actor,current):await f.services.createTask({...common,materials:[]},f.actor,current);
    await vi.waitFor(()=>expect(f.client?.activeTurnId).toBe('actual-native-turn'));
    expect(f.calls).toBe(1);expect(f.birthObserved).toBe(true);expect(current).toHaveBeenCalled();
    const activities=await f.services.conversationActivity!.list('user-thread',f.actor);
    expect(activities.some(activity=>activity.watchId===`task:${task.taskId}`)).toBe(true);
  }finally{await f.close();}
},15000);
it('preserves a prepared-source write failure and starts no Native client through default Main',async()=>{
  const f=await open(),failure=Error('actual_native_prepared_source_write_failed'),original=atomicFile.writeFileAtomicallySync;
  const writer=vi.spyOn(atomicFile,'writeFileAtomicallySync').mockImplementation((path,...args)=>{if(path.includes('user-inputs'))throw failure;return original(path,...args);});
  try{
    await expect(f.services.createTask({prompt:'Read.',materials:[],context:{threadId:'user-thread'}},f.actor,()=>{})).rejects.toBe(failure);
    expect(f.calls).toBe(0);
    const store=new ConversationActivityStore(join(f.dataRoot,'conversation-activity.sqlite'),{readOnly:true});try{expect(store.listWatches()).toEqual([]);}finally{store.close();}
  }finally{writer.mockRestore();await f.close();}
});
it('rechecks the original sender after actual new-thread ownership inspection before durable registration',async()=>{
  const f=await open(),failure=Error('sender_revoked_during_thread_inspection'),original=InProcessTaskRuntimeHost.prototype.getActiveTasks;let allowed=true;
  const registered=vi.spyOn(DesktopMultiAgentStore.prototype,'registerThread');
  const inspect=vi.spyOn(InProcessTaskRuntimeHost.prototype,'getActiveTasks').mockImplementation(async function(){const tasks=await original.call(this);allowed=false;return tasks;});
  try{
    await expect(f.services.createTask({prompt:'Read.',materials:[],context:{threadId:'user-thread'}},f.actor,()=>{if(!allowed)throw failure;})).rejects.toBe(failure);
    expect(inspect).toHaveBeenCalled();expect(registered.mock.calls.filter(([binding])=>binding.threadId==='user-thread')).toEqual([]);expect(f.calls).toBe(0);
  }finally{inspect.mockRestore();registered.mockRestore();await f.close();}
});
it.each(['canonical-files','legacy-files']as const)('withdraws %s during actual material IO without swallowing its guard or starting Native',async entry=>{
  const f=await open(),failure=Error('actual_sender_withdrawn'),original=MaterialRegistry.prototype.importMaterial;let allowed=true;
  const importing=vi.spyOn(MaterialRegistry.prototype,'importMaterial').mockImplementation(async function(input,current){allowed=false;return original.call(this,input,current);});
  const current=()=>{if(!allowed)throw failure;};
  try{
    const input={prompt:'Read.',filePaths:[f.file],context:{threadId:'user-thread'}};
    const result=entry==='canonical-files'?f.services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:{...input,kind:'files'}},f.actor,current):f.services.createTaskWithFiles(input,f.actor,current);
    await expect(result).rejects.toBe(failure);expect(importing).toHaveBeenCalledOnce();expect(f.calls).toBe(0);
  }finally{importing.mockRestore();await f.close();}
});
it('rechecks legacy Native answers after the real SQLite display save and retains the same question for a fresh explicit answer',async()=>{
  const f=await open();let statementSpy:ReturnType<typeof vi.spyOn>|undefined;
  try{
    const task=await f.services.createTask({prompt:'Read.',materials:[],context:{threadId:'user-thread'}},f.actor);await vi.waitFor(()=>expect(f.client?.activeTurnId).toBeTruthy());
    const client=f.client!,pending=client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'original command'}});
    let questionId='';await vi.waitFor(async()=>{const snapshot=(await f.services.recoverTask(task.taskId)).snapshot;const event=snapshot.events.find(event=>event.type==='needs_user');questionId=event?.type==='needs_user'?event.question.questionId:'';expect(questionId).toBeTruthy();});
    let allowed=true;const failure=Error('sender_revoked_in_actual_sql_save'),original=DatabaseSync.prototype.prepare;
    statementSpy=vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(sql){const statement=original.call(this,sql);if(sql.startsWith('INSERT OR REPLACE INTO codex_native_sessions')){const run=statement.run.bind(statement);statement.run=(...args)=>{const result=run(...args);allowed=false;return result;};}return statement;});
    await expect(f.services.answerQuestion({taskId:task.taskId,answer:{type:'choice',questionId,choiceId:'approve'}},f.actor,()=>{if(!allowed)throw failure;})).rejects.toBe(failure);
    let settled=false;void pending.then(()=>{settled=true;});await Promise.resolve();expect(settled).toBe(false);
    statementSpy.mockRestore();statementSpy=undefined;
    await f.services.answerQuestion({taskId:task.taskId,answer:{type:'choice',questionId,choiceId:'deny'}},f.actor,()=>{});expect(await pending).toEqual({decision:'decline'});
  }finally{statementSpy?.mockRestore();await f.close();}
});
it('uses the same real Native question and decision owners through default Main local activity service',async()=>{
  const f=await open(),handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>();let dispose:undefined|(()=>void);
  try{
    const task=await f.services.createTask({prompt:'Read.',materials:[],context:{threadId:'user-thread'}},f.actor);await vi.waitFor(()=>expect(f.client?.activeTurnId).toBeTruthy());
    const client=f.client!,requests=['first local command','second local command'].map((command,index)=>client.options.onApproval({id:index+1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command}}));
    await vi.waitFor(async()=>{const snapshot=(await f.services.recoverTask(task.taskId)).snapshot;expect(snapshot.events.filter(event=>event.type==='needs_user')).toHaveLength(2);});
    dispose=registerConversationActivityIpc({handle:(channel,handler)=>handlers.set(channel,handler as never)},f.services.conversationActivity,()=>({actorId:f.actor.actorId}),{authorize:()=>({actorId:f.actor.actorId})});
    const event={sender:{id:1,isDestroyed:()=>false,on:vi.fn(),once:vi.fn(),removeListener:vi.fn(),send:vi.fn()}},watchId=`task:${task.taskId}`;
    const forms=await handlers.get('desktop:activity:nativeQuestions')!(event,{watchId}) as Array<{questionRef:string;questionId:string;expectedDigest:string;prompt:string}>;
    expect(forms).toHaveLength(2);const first=forms.find(form=>form.prompt.includes('first local command'))!,second=forms.find(form=>form.prompt.includes('second local command'))!;
    await handlers.get('desktop:activity:nativeAnswer')!(event,{watchId,questionRef:first.questionRef,expectedDigest:first.expectedDigest,choiceId:'deny'});expect(await requests[0]).toEqual({decision:'decline'});
    const remaining=await handlers.get('desktop:activity:nativeQuestions')!(event,{watchId}) as typeof forms;expect(remaining).toHaveLength(1);expect(remaining[0]).toMatchObject({questionRef:second.questionRef,expectedDigest:second.expectedDigest});
    await handlers.get('desktop:activity:nativeAnswer')!(event,{watchId,questionRef:second.questionRef,expectedDigest:second.expectedDigest,choiceId:'approve'});expect(await requests[1]).toEqual({decision:'accept'});expect(f.calls).toBe(1);
    client.emit('item/agentMessage/delta',{itemId:'answer',delta:'Done'});client.emit('turn/completed',{turn:{id:client.activeTurnId,status:'completed'}});client.activeTurnId=null;
    await vi.waitFor(async()=>expect((await f.services.recoverTask(task.taskId)).snapshot.status).toBe('completed'));
    await vi.waitFor(async()=>expect(await handlers.get('desktop:activity:nativeQuestions')!(event,{watchId})).toEqual([]));
  }finally{dispose?.();await f.close();}
});
it('keeps the actual Bridge frame current through local qualification authorization before enrolling the source',async()=>{
  const f=await open(),handlers=new Map<string,(event:unknown,input:unknown)=>Promise<unknown>>();let dispose:undefined|(()=>void),spy:ReturnType<typeof vi.spyOn>|undefined;
  try{
    const task=await f.services.createTask({prompt:'Read.',materials:[],context:{threadId:'user-thread'}},f.actor);await vi.waitFor(()=>expect(f.client?.activeTurnId).toBeTruthy());const client=f.client!;
    void client.options.onApproval({id:1,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'first'}});
    await vi.waitFor(async()=>expect((await f.services.recoverTask(task.taskId)).snapshot.events.some(event=>event.type==='needs_user')).toBe(true));
    dispose=registerConversationActivityIpc({handle:(name,handler)=>handlers.set(name,handler as never)},f.services.conversationActivity,()=>({actorId:f.actor.actorId}),{authorize:()=>({actorId:f.actor.actorId})});
    const original=ConversationActivityService.prototype.authorizeRead;
    spy=vi.spyOn(ConversationActivityService.prototype,'authorizeRead').mockImplementationOnce(async function(...args){const result=await original.apply(this,args);void client.options.onApproval({id:2,method:'item/commandExecution/requestApproval',params:{threadId:client.threadId,turnId:client.activeTurnId,command:'changes the actual inventory during original authorization'}});return result;});
    const event={sender:{id:1,isDestroyed:()=>false,on:vi.fn(),once:vi.fn(),removeListener:vi.fn(),send:vi.fn()}},watchId=`task:${task.taskId}`;
    await expect(handlers.get('desktop:activity:nativeQuestions')!(event,{watchId})).rejects.toThrow(/inventory_stale/);
    const store=new ConversationActivityStore(join(f.dataRoot,'conversation-activity.sqlite'),{readOnly:true});try{expect(store.getNativeAttentionEnrollment(watchId)).toBeNull();}finally{store.close();}
    spy.mockRestore();spy=undefined;expect(await handlers.get('desktop:activity:nativeQuestions')!(event,{watchId})).toHaveLength(2);
  }finally{spy?.mockRestore();dispose?.();await f.close();}
});
it('the default Main planning branch admits the real retained user source into the original B task transaction and rejects missing thread access',async()=>{
  const f=await open();let hub:ReturnType<typeof import('../../../../kswarm/src/core/hub.js')['createHub']>|undefined;
  try{
    const {createHub}=await import('../../../../kswarm/src/core/hub.js'),{createProjectInputAuthority}=await import('../../../../kswarm/src/core/project-input-authority.js'),{registerProjectPlanningIpc}=await import('../../electron/project-planning-typed-ipc.js'),{resetIpcSchemaRegistryForTests}=await import('../../electron/ipc-runtime.js');resetIpcSchemaRegistryForTests();
    const task=await f.services.submitUserTask({action:'submit_new',gestureId:randomUUID(),input:{kind:'materials',prompt:'Add one independent local item.',materials:[],context:{threadId:'user-thread'},permissionMode:'auto'}},f.actor,()=>{});await vi.waitFor(()=>expect(f.client?.activeTurnId).toBeTruthy());
    const scope={profileId:f.services.multiAgent!.profileId,workspaceId:f.services.multiAgent!.workspaceId},authority=createProjectInputAuthority(scope);
    hub=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(f.root,'b.sqlite')},brokerClient:{async getRoomSnapshot(){return{ok:true,room:{status:'active'},members:[{status:'active',subject:{kind:'agent',logicalAgentId:'po'}}]};},async acquireRoomMembershipLease(){return{ok:true};}}});
    expect(hub.prepareOrdinaryTaskInputWriter({requestSource:'user',projectInputAuthority:authority.reader()}).ok).toBe(true);await hub.createProject({id:'p',name:'Actual B project',goal:'Plan the original user item',poAgent:'po',members:[],primaryRoomId:'room',requestedStartPolicy:'plan_only',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('main-create','ordinary_initial_plan_additive_v2')});
    f.gateway.request.mockImplementation(async(path:unknown)=>{if(path==='/projects/p')return Response.json({ok:true,project:hub!.getProject('p')});const value=String(path).includes('/ordinary-inputs/')?hub!.readOrdinaryProjectOperation('p',decodeURIComponent(String(path).split('/ordinary-inputs/')[1]),authority.reader()):hub!.readInitialPlanInputs('p',authority.reader());return Response.json(value,{status:value.ok?200:409});});
    f.gateway.submitTaskMetadataOnce.mockImplementation(async(projectId:unknown,raw:unknown)=>{const envelope=raw as any,body=hub!.applyOrdinaryTaskMetadataInput(projectId,envelope.input,{requestSource:'user',projectInputAuthority:authority.user(envelope.source),initialPlanningAuthority:authority.planner(),initialPlanClaim:envelope.initialPlanClaim});return{ok:body.ok,status:body.ok?200:409,body};});
    const handlers=new Map<string,any>();registerProjectPlanningIpc({handle:(name,handler)=>handlers.set(name,handler)},(_event,input,proof)=>f.services.startProjectPlanning(input,'user',()=>{},proof),{nativeTrigger:{owner:f.services.getProjectPlanningTriggerOwner(),authorize:()=>({actorId:f.actor.actorId})}});
    const input={action:'add_task_and_plan',projectId:'p',sourceTaskId:task.taskId,proposal:{title:'Actual user follow-up item'}},result=await handlers.get('desktop:kswarm:startProjectPlanning')({},input);
    expect(result).toMatchObject({ok:true,status:'metadata_applied',execution:{state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'}});expect(hub.getBoard('p').getAllTasks()).toHaveLength(1);expect(f.gateway.submitTaskMetadataOnce).toHaveBeenCalledTimes(1);expect(f.calls).toBe(1);
    expect(await handlers.get('desktop:kswarm:startProjectPlanning')({},input)).toEqual(result);expect(f.gateway.submitTaskMetadataOnce).toHaveBeenCalledTimes(1);
    // A second pristine project requires actual source permission anew.
    await hub.createProject({id:'p2',name:'Second',goal:'Second',poAgent:'po',members:[],primaryRoomId:'room',requestedStartPolicy:'plan_only',autoAssignPo:false},{requestSource:'user',projectInputAuthority:authority.creator('main-create-2','ordinary_initial_plan_additive_v2')});
    const get=vi.spyOn(DesktopMultiAgentStore.prototype,'getThread');get.mockImplementation(()=>null);
    try{await expect(handlers.get('desktop:kswarm:startProjectPlanning')({},{...input,projectId:'p2'})).rejects.toThrow('task_scope_forbidden');expect(f.gateway.submitTaskMetadataOnce).toHaveBeenCalledTimes(1);}finally{get.mockRestore();}
  }finally{hub?.closePersistence();await f.close();}
},15000);
