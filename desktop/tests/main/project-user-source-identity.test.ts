// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as source from '../../electron/conversation-project-service.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {createTaskSourceWriterPopulation,getTaskPreparedSourceReceipt} from '../../../src/runtime/task-host/task-runtime-host.js';
import type {GoalTurnExecutionScope} from '../../../src/runtime/task-host/types.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'project-user-source-'));const workspace=join(root,'workspace');mkdirSync(workspace);
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));const materials=new MaterialRegistry({workspaceRoot:workspace,maxBytes:1024});
 const population=createTaskSourceWriterPopulation(snapshots);const host=population.createHost({materialRegistry:materials,runner:async()=>{},aheGuards:{artifactEvidence:false,recoveryContinuity:false}});
 const kswarmService={request:vi.fn(async()=>Response.json({ok:true})),getDesktopMutationToken:()=> 'fixture-only'};
 const service=new source.ConversationProjectService({dataRoot:root,workspaceRoot:workspace,kswarmService,sourceSnapshots:snapshots});const ids:string[]=[];
 cleanup.push(async()=>{for(const id of ids){const snapshot=await host.inspectTask(id);if(snapshot&&!['cancelled','completed','failed'].includes(snapshot.status))await host.cancelTask(id,'fixture_cleanup');}await population.close();await materials.sealAndDrainInstanceMutations();rmSync(root,{recursive:true,force:true});});
 const scope:GoalTurnExecutionScope={kind:'goal_turn',origin:'user',goalId:'goal',epoch:1,goalTurnId:'turn-1',threadId:'thread'};
 const prepare=async(prompt='另外做一个独立任务',executionScope:GoalTurnExecutionScope|undefined=scope,actualPermissionMode:'auto'|'plan'='auto')=>{
  return service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},async()=>{
   const prepared=await host.prepareTask({prompt,materials:[],context:{threadId:'thread'},executionScope,permissionMode:actualPermissionMode});ids.push(prepared.taskId);
   const actual=await host.inspectTask(prepared.taskId);if(!actual)throw Error('actual_prepared_missing');
   const nativeReceipt=host.getPreparedSourceReceipt(prepared.taskId)!;
   const recorded=service.recordPreparedUserTask(actual,{requestSource:'user',preparedSource:nativeReceipt});return {prepared,recorded,nativeReceipt};
  });
 };
 return {root,workspace,service,scope,prepare,kswarmService,host,snapshots};
}
function creationFixture(){
 const f=fixture();const projects:Record<string,unknown>[]=[];
 f.kswarmService.request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='/agents')return Response.json({agents:[{id:'po'},{id:'worker'}]});
  if(path==='/projects')return Response.json({projects});
  if(path==='/projects/room-first'){
   const project={...JSON.parse(String(init?.body)),id:'project-'+projects.length};projects.push(project);
   return Response.json({ok:true,project});
  }
  throw Error('unexpected_route');
 });
 const rooms={createRoom:vi.fn(async()=>({ok:true,room:{roomId:'room'}})),sendRoomMessage:vi.fn(async()=>({ok:true,message:{messageId:'message'}})),getRoomSnapshot:vi.fn(async()=>({ok:true,room:{revision:2}}))};
 f.service.bindRoomClient(rooms);
 const prompt='创建一个项目，交付报告';
 const proposal={name:'报告',goal:'交付报告',poAgent:'po',members:['worker']};
 const bind=async(taskId:string,service=f.service)=>service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},()=>service.bindPreparedTask({taskId,prompt,permissionMode:'auto',executionScope:{kind:'goal_turn',origin:'user'}},{requestSource:'user'}));
 return {...f,prompt,proposal,projects,rooms,bind};
}
it('one canonical user input creates one project across concurrent runtime tasks and restart',async()=>{
 const f=creationFixture();const a=await f.prepare(f.prompt),b=await f.prepare(f.prompt);
 expect(await f.bind(a.prepared.taskId)).toBe(true);expect(await f.bind(b.prepared.taskId)).toBe(true);
 const results=await Promise.all([a,b].map(item=>f.service.create(f.proposal,{requestSource:'agent',taskId:item.prepared.taskId})));
 expect(results.every(value=>value.ok===true)).toBe(true);expect(f.projects).toHaveLength(1);
 expect(f.rooms.createRoom).toHaveBeenCalledOnce();expect(f.rooms.sendRoomMessage).toHaveBeenCalledOnce();
 const reopened=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:f.workspace,kswarmService:f.kswarmService});reopened.bindRoomClient(f.rooms);
 expect(await f.bind(b.prepared.taskId,reopened)).toBe(true);
 expect(await reopened.create(f.proposal,{requestSource:'agent',taskId:b.prepared.taskId})).toMatchObject({ok:true,reused:true,projectId:'project-0'});
 expect(f.projects).toHaveLength(1);
});
it('identical project requests from two genuine user turns keep distinct creation operations',async()=>{
 const f=creationFixture();const a=await f.prepare(f.prompt),b=await f.prepare(f.prompt,{...f.scope,goalTurnId:'turn-2'});
 await f.bind(a.prepared.taskId);await f.bind(b.prepared.taskId);
 await f.service.create(f.proposal,{requestSource:'agent',taskId:a.prepared.taskId});
 await f.service.create(f.proposal,{requestSource:'agent',taskId:b.prepared.taskId});
 expect(f.projects).toHaveLength(2);expect(f.projects[0].clientRequestKey).not.toBe(f.projects[1].clientRequestKey);
});
it('an unknown creation response is observed on restart without repeating its POST',async()=>{
 const f=creationFixture();const a=await f.prepare(f.prompt),b=await f.prepare(f.prompt);
 await f.bind(a.prepared.taskId);await f.bind(b.prepared.taskId);
 const request=f.kswarmService.request.getMockImplementation()!;
 f.kswarmService.request.mockImplementation(async(path:string,init?:RequestInit)=>{
  if(path==='/projects/room-first')throw Error('connection_closed');
  return request(path,init);
 });
 expect(await f.service.create(f.proposal,{requestSource:'agent',taskId:a.prepared.taskId})).toMatchObject({ok:false});
 const reopened=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:f.workspace,kswarmService:f.kswarmService});reopened.bindRoomClient(f.rooms);
 expect(await reopened.create(f.proposal,{requestSource:'agent',taskId:b.prepared.taskId})).toMatchObject({ok:false,error:'conversation_project_creation_outcome_unknown'});
 expect(f.kswarmService.request.mock.calls.filter(([path])=>path==='/projects/room-first')).toHaveLength(1);
 expect(f.rooms.createRoom).toHaveBeenCalledOnce();
});
it('a corrupt existing canonical creation journal cannot be replaced by a new bind',async()=>{
 const f=creationFixture();const first=await f.prepare(f.prompt);await f.bind(first.prepared.taskId);
 await f.service.create(f.proposal,{requestSource:'agent',taskId:first.prepared.taskId});
 const directory=join(f.root,'conversation-projects'),name=readdirSync(directory).find(name=>name.startsWith('canonical-')&&name.endsWith('.json'))!;
 const path=join(directory,name);writeFileSync(path,'{"truncated":');
 await expect(Promise.resolve().then(()=>f.bind(first.prepared.taskId))).rejects.toThrow('conversation_project_operation_invalid');
 expect(readFileSync(path,'utf8')).toBe('{"truncated":');expect(f.projects).toHaveLength(1);expect(f.rooms.createRoom).toHaveBeenCalledOnce();
});
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
it.each([undefined,{kind:'goal_turn',origin:'user'}])('a refused real preparation cannot fall back to legacy create with caller scope %j',async executionScope=>{
 const f=fixture();const prompt='创建一个项目，交付报告';const current=await f.prepare(prompt,{...f.scope,origin:'continuation'});
 expect(current.recorded).toBe(false);
 const authorized=await f.service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},()=>f.service.bindPreparedTask({taskId:current.prepared.taskId,prompt,permissionMode:'auto',executionScope},{requestSource:'user'}));
 expect(authorized).toBe(false);expect(f.service.isAuthorized(current.prepared.taskId)).toBe(false);
 expect(await f.service.create({name:'P',goal:'G',poAgent:'po'},{requestSource:'agent',taskId:current.prepared.taskId})).toMatchObject({ok:false,error:'conversation_project_user_authorization_required'});
 expect(f.kswarmService.request).not.toHaveBeenCalled();
});
it.each([{goalId:''},{goalTurnId:''},{epoch:-1},{threadId:'another-thread'}])('a present malformed Goal scope is rejected rather than becoming legacy: %j',async invalid=>{
 const f=fixture();const prompt='创建一个项目，交付报告';const current=await f.prepare(prompt,{...f.scope,...invalid});
 expect(current.recorded).toBe(false);expect(f.service.readProjectUserSource(current.prepared.taskId)).toBeUndefined();
 expect(await f.service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},()=>f.service.bindPreparedTask({taskId:current.prepared.taskId,prompt},{requestSource:'user'}))).toBe(false);
 expect(f.kswarmService.request).not.toHaveBeenCalled();
});
it('the actual prepared plan task cannot inherit an auto-mode source claim',async()=>{
 const f=fixture();const prompt='创建一个项目';const current=await f.prepare(prompt,f.scope,'plan');
 expect(current.recorded).toBe(false);expect(f.service.readProjectUserSource(current.prepared.taskId)).toBeUndefined();
 expect(await f.service.withUserRequest({prompt,threadId:'thread',permissionMode:'auto'},{requestSource:'user'},()=>f.service.bindPreparedTask({taskId:current.prepared.taskId,prompt,permissionMode:'auto'},{requestSource:'user'}))).toBe(false);
});
it('the Host preparation receipt is opaque and cancellation invalidates old handles before execution',async()=>{
 const f=fixture();const current=await f.prepare();expect(getTaskPreparedSourceReceipt(current.nativeReceipt)).toMatchObject({taskId:current.prepared.taskId,permissionMode:'auto'});
 expect(()=>getTaskPreparedSourceReceipt({...current.nativeReceipt})).toThrow('task_prepared_source_receipt_invalid');
 await f.host.cancelTask(current.prepared.taskId,'cancel_prepared_source');
 expect(()=>getTaskPreparedSourceReceipt(current.nativeReceipt)).toThrow('task_prepared_source_receipt_stale');
});
it('a canonical source in another workspace cannot fall back to a new legacy creation journal',async()=>{
 const f=creationFixture();const current=await f.prepare(f.prompt);await f.bind(current.prepared.taskId);await f.service.create(f.proposal,{requestSource:'agent',taskId:current.prepared.taskId});
 const other=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:join(f.root,'another-workspace'),kswarmService:f.kswarmService});other.bindRoomClient(f.rooms);
 await expect(Promise.resolve().then(()=>f.bind(current.prepared.taskId,other))).rejects.toThrow('conversation_project_workspace_mismatch');
 expect(f.projects).toHaveLength(1);expect(f.rooms.createRoom).toHaveBeenCalledOnce();
});

it('binds an admitted user root to the actual Host thread when the UI omitted its thread hint',async()=>{
 const f=creationFixture(),prepared=await f.prepare(f.prompt);
 const bound=await f.service.withUserRequest({prompt:f.prompt,permissionMode:'auto'},{requestSource:'user'},()=>f.service.bindPreparedTask({taskId:prepared.prepared.taskId,prompt:f.prompt,permissionMode:'auto',executionScope:f.scope},{requestSource:'user'}));
 expect(bound).toBe(true);
 const name=readdirSync(join(f.root,'conversation-projects')).find(name=>name.startsWith('canonical-'))!;
 expect(JSON.parse(readFileSync(join(f.root,'conversation-projects',name),'utf8')).originThreadId).toBe('thread');
});
it('a legacy ordinary creation keeps the original producer and never preflights or enqueues a second Main producer',async()=>{
 const f=creationFixture(),enqueue=vi.fn();
 const service=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:f.workspace,kswarmService:f.kswarmService,initialPlanBootstrap:{enqueue}});service.bindRoomClient(f.rooms);
 expect(await service.withUserRequest({prompt:f.prompt,threadId:'thread'},{requestSource:'user'},()=>service.bindPreparedTask({taskId:'legacy_task',prompt:f.prompt},{requestSource:'user'}))).toBe(true);
 expect(await service.create(f.proposal,{requestSource:'agent',taskId:'legacy_task'})).toMatchObject({ok:true});
 expect(f.projects).toHaveLength(1);expect(f.projects[0]).not.toHaveProperty('initialPlanProducer');expect(enqueue).not.toHaveBeenCalled();
 expect(f.kswarmService.request.mock.calls.some(([path])=>path==='/desktop/project-protocol')).toBe(false);
});
it('the actual canonical source proof is bound to its original Main source owner before task-composite preparation',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!;
 const other=new source.ConversationProjectService({dataRoot:f.root,workspaceRoot:f.workspace,kswarmService:f.kswarmService});
 expect(source.resolveProjectUserSourceProof(proof,f.service)).toMatchObject({schemaVersion:1,promptSha256:expect.any(String)});
 expect(()=>source.resolveProjectUserSourceProof(proof,other)).toThrow('conversation_user_source_unverified');expect(()=>source.resolveProjectUserSourceProof({} as never,f.service)).toThrow('conversation_user_source_unverified');
});
it('the original source owner reconstructs a real Goal body from the same native task and session',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!,inspect=Reflect.get(f.service,'inspectOriginalTaskSource'),read=Reflect.get(f.service,'readOriginalTaskSource');expect(typeof inspect).toBe('function');expect(typeof read).toBe('function');
 const binding=Reflect.apply(inspect,f.service,[proof]);expect(binding.sourceTaskId).toBe(prepared.prepared.taskId);expect(binding.sourceSessionId).toBe((await f.host.inspectTask(prepared.prepared.taskId))?.sessionId);const captured=await Reflect.apply(read,f.service,[proof,new AbortController().signal]);expect(captured.body).toBe('另外做一个独立任务');expect(captured.binding).toEqual(binding);
});
it('the original source owner cannot reconstruct a removed body from the actual Host cache',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!;rmSync(join(f.root,'tasks','snapshots',prepared.prepared.taskId+'.json'));rmSync(join(f.root,'tasks','snapshots',prepared.prepared.taskId+'.journal.jsonl'),{force:true});expect((await f.host.inspectTask(prepared.prepared.taskId))?.prompt).toBe('另外做一个独立任务');const read=Reflect.get(f.service,'readOriginalTaskSource');expect(typeof read).toBe('function');
 await expect(Reflect.apply(read,f.service,[proof,new AbortController().signal])).rejects.toThrow('conversation_user_body_unavailable');
});
it('the current physical body must match the actual original source hash rather than a previous task cache',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!,path=join(f.root,'tasks','snapshots',prepared.prepared.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.prompt='Different physical input';writeFileSync(path,JSON.stringify(value));const read=Reflect.get(f.service,'readOriginalTaskSource');expect(typeof read).toBe('function');await expect(Reflect.apply(read,f.service,[proof,new AbortController().signal])).rejects.toThrow('conversation_user_source_body_invalid');
});
it('source seal holds the original body-read promise through its actual caller tail and prevents a late source result',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!;let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(yes=>{entered=yes;}),hold=new Promise<void>(yes=>{release=yes;}),original=f.snapshots.readOriginalUserInput.bind(f.snapshots);
 vi.spyOn(f.snapshots,'readOriginalUserInput').mockImplementation(async(...args)=>{const result=await original(...args);entered();await hold;return result;});
 const pending=f.service.readOriginalTaskSource(proof,new AbortController().signal).then(value=>({value}),error=>({error}));await ready;f.service.sealUserTaskFacts();let drained=false;const drain=f.service.drainOriginalTaskReads().then(()=>{drained=true;});await new Promise<void>(yes=>setImmediate(yes));expect(drained).toBe(false);release();const outcome=await pending;await drain;expect(drained).toBe(true);expect(Object.hasOwn(outcome,'error')).toBe(true);if('error' in outcome)expect(outcome.error.message).toBe('conversation_user_source_sealed');
});
it('the actual retained Goal scope cannot change under the same native task/session and user body hash',async()=>{
 const f=fixture(),prepared=await f.prepare(),proof=f.service.readProjectUserSource(prepared.prepared.taskId)!,path=join(f.root,'tasks','snapshots',prepared.prepared.taskId+'.json'),value=JSON.parse(readFileSync(path,'utf8'));value.executionScope={...value.executionScope,epoch:99};writeFileSync(path,JSON.stringify(value));await expect(f.service.readOriginalTaskSource(proof,new AbortController().signal)).rejects.toThrow('conversation_user_source_body_invalid');
});
