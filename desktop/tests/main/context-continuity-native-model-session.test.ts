// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {streamDesktopTaskRecovery} from '../../electron/desktop-task-stream.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {ChildProcess} from 'node:child_process';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {ContinuityStore} from '../../electron/context-continuity/store.js';
import {ContinuityService} from '../../electron/context-continuity/service.js';
import {createContextResolverTool} from '../../electron/context-continuity/tool.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {runDesktopToolLoop,createDesktopServices} from '../../electron/desktop-services.js';
import {openTestNativeModelSession,openNativeModelSession,isOwnedNativeModelAdapter} from '../../electron/context-continuity/native-model-session.js';
import type {Message,ToolDefinition} from '../../../src/types.js';

const binary=process.env.XIAOK_NATIVE_TEST_BINARY;
const native=it.skipIf(!binary||process.platform!=='darwin'||process.arch!=='arm64');
const cleanup:Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{for(const action of cleanup.splice(0).reverse())await action();});
const binding={taskId:'task_actual',sourceEpoch:'session_actual',executionEpoch:1,ownerSession:'root_actual',inputId:'input_actual'};
function temporary(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'xiaok-native-model-'));cleanup.push(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:3}));return root;}
function sse(items:unknown[]){return [{type:'response.created',response:{id:'local'}},...items.map(item=>({type:'response.output_item.done',item})),{type:'response.completed',response:{id:'local',usage:{input_tokens:0,input_tokens_details:null,output_tokens:0,output_tokens_details:null,total_tokens:0}}}].map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');}
async function fixture(first:unknown[],control:{holdFirst?:boolean;release?:()=>void;assertAdmission?:()=>void;responses?:unknown[][]}={}){
 const root=temporary(),requests:Record<string,any>[]=[];
 const server=http.createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);requests.push(JSON.parse(Buffer.concat(chunks).toString()));res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});const finish=()=>res.end(sse(control.responses?.[requests.length-1]??(requests.length===1?first:[{type:'message',role:'assistant',id:'final',content:[{type:'output_text',text:'native final answer'}]}])));if(control.holdFirst&&requests.length===1)control.release=finish;else finish();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));
 const home=path.join(root,'home');fs.mkdirSync(home,{mode:0o700});
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 fs.writeFileSync(path.join(home,'config.toml'),['model = "mock-model"','model_provider = "local_mock"','cli_auth_credentials_store = "file"','[features]','shell_snapshot = false','[model_providers.local_mock]','name = "Local test endpoint"',`base_url = "${url}/v1"`,'wire_api = "responses"','supports_websockets = false','request_max_retries = 0','stream_max_retries = 0'].join('\n'),{mode:0o600});
 const jwt=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
 fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{id_token:`${jwt({alg:'none'})}.${jwt({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic',chatgpt_plan_type:'plus'}})}.`,access_token:'synthetic-local-only',refresh_token:'synthetic-local-only',account_id:'synthetic'},last_refresh:new Date().toISOString()}),{mode:0o600});
 const service=new ContinuityService({dbPath:path.join(root,'continuity.sqlite'),profileId:'profile_test'}),store=service.store;cleanup.push(()=>service.close());
 const session=await openTestNativeModelSession({binary:binary!,home,stateRoot:root,store,binding,model:'mock-model',assertAdmission:()=>control.assertAdmission?.()});cleanup.push(async()=>{await session.closeAndDrain();const closure=session.readClosure();expect(closure.workerClosed).toBe(true);expect(()=>process.kill(Number(closure.pid),0)).toThrow();expect(()=>process.kill(-Number(closure.pid),0)).toThrow();console.info('OWNED_NATIVE_MODEL_REAPED',JSON.stringify(closure));});
 return {root,home,service,store,session,requests,first};
}
const call=(id='call-original',name='resolve_context_reference',args:Record<string,unknown>={})=>({type:'function_call',call_id:id,namespace:'xiaok',name:'invoke',arguments:JSON.stringify({name,arguments:args})});
const definitions:ToolDefinition[]=[{name:'read_original',description:'read',inputSchema:{type:'object',properties:{}}}];
const input:Message[]=[{role:'user',content:[{type:'text',text:'original input 中文'}]}];
async function chunks(session:Awaited<ReturnType<typeof fixture>>['session'],messages:Message[],tools=definitions,system='main system'){const out=[];for await(const chunk of session.adapter.stream(messages,tools,system))out.push(chunk);return out;}

native('actual restricted native sampling reaches the original Desktop loop and resolver, then receives its exact result',async()=>{
 // This uses the original store/service/tool/registry/loop, not a second executor.
 const f=await fixture([]),service=f.service,actor={requestSource:'user' as const,actorId:'desktop-user:profile_test',profileId:'profile_test'};
 const source=service.createConversation(actor,{operationId:'source'}),target=service.createConversation(actor,{operationId:'target'});
 service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'task_source',sourceDataEpoch:'source_epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'ORIGINAL_CANONICAL_RESULT',executionState:'settled'});
 const ref=service.createReference(actor,{conversationId:source.id,expectedRevision:service.getConversation(actor,source.id)!.revision,operationId:'ref'});
 service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'});service.bindTask(actor,{taskId:binding.taskId,conversationId:target.id});
 // First fixture model payload can be fixed before any turn reaches the server.
 f.requests.length=0;
 const tool=createContextResolverTool(()=>({service,actor}));
 const registry=new ToolRegistry({autoMode:true,requireEffectGuard:true,settledLocalExecutors:new Map([[tool,tool.execute]])},[tool]);cleanup.push(()=>registry.dispose());
 // Replace the harmless fixture response body by a second endpoint using same original factory.
 // The endpoint's first dynamic payload is selected through the fixture array reference.
 const payload=f.first;
 expect(payload).toBeDefined();payload.push(call('call-original',tool.definition.name,{refId:ref.refId}));
 const unknown:string[]=[],events:unknown[]=[];
 expect(isOwnedNativeModelAdapter(f.session.adapter)).toBe(true);
 const result=await runDesktopToolLoop({adapter:f.session.adapter,systemPrompt:'main system',messages:structuredClone(input),allToolDefs:[tool.definition],registry,
  requireEffectGuard:true,recordUnprovenEffect:(_id,name)=>unknown.push(name),signal:new AbortController().signal,taskDeadline:Date.now()+30000,sessionId:binding.sourceEpoch,turnId:'turn-main',intentId:'intent',stepId:'step',taskId:binding.taskId,materials:[],skillInvocation:null,skillCatalog:{list:()=>[]} as never,dataRoot:f.root,taskStartTime:Date.now(),emitRuntimeEvent:async event=>{events.push(event);},
  strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:messages=>messages,processToolResult:result=>result,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
 expect(result.reply).toContain('native final answer');expect(result.totalToolCalls).toBe(1);expect(unknown).toEqual([]);
 expect(JSON.stringify(f.requests[1])).toContain('ORIGINAL_CANONICAL_RESULT');expect(JSON.stringify(f.requests[1])).not.toContain('synthetic-local-only');
 await f.session.closeAndDrain();expect(f.session.readClosure()).toMatchObject({workerClosed:true,stdioClosed:true});
 expect(f.store.db.prepare("SELECT status FROM native_model_resources").get()?.status).toBe('drained');
 expect(f.store.db.prepare("SELECT count(*) AS n FROM native_model_sends WHERE status='intent'").get()?.n).toBe(0);
},45000);

native('logical tool boundary returns before main executes and rejects substituted history or duplicate result without replay',async()=>{
 const f=await fixture([call('main-call','read_original',{})]);
 const first=await chunks(f.session,structuredClone(input));expect(first).toEqual([{type:'tool_use',id:'main-call',name:'read_original',input:{}},{type:'done'}]);expect(f.requests).toHaveLength(1);
 const bad:Message[]=[...structuredClone(input),{role:'assistant',content:[{type:'tool_use',id:'main-call',name:'read_original',input:{forged:true}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'main-call',content:'never'}]}];
 await expect(chunks(f.session,bad)).rejects.toThrow('native_history_changed');expect(f.requests).toHaveLength(1);
 await f.session.closeAndDrain();
},30000);

native('actual parallel native calls are delivered one at a time through the original result continuation',async()=>{
 const f=await fixture([call('one','read_original',{}),call('two','read_original',{x:2})]);
 const messages=structuredClone(input);const one=await chunks(f.session,messages);expect(one[0]).toMatchObject({id:'one'});
 messages.push({role:'assistant',content:[one[0] as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'one',content:'ONE_RESULT'}]});
 const two=await chunks(f.session,messages);expect(two[0]).toMatchObject({type:'tool_use',id:'two',input:{x:2}});
 messages.push({role:'assistant',content:[two[0] as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'two',content:'TWO_RESULT'}]});
 const final=await chunks(f.session,messages);expect(JSON.stringify(final)).toContain('native final answer');
 expect(JSON.stringify(f.requests[1])).toContain('ONE_RESULT');expect(JSON.stringify(f.requests[1])).toContain('TWO_RESULT');
},30000);

native('empty tools rejects actual dynamic callbacks and unsupported images never send model work',async()=>{
 const f=await fixture([call('forbidden','read_original',{})]);await expect(chunks(f.session,structuredClone(input),[])).rejects.toThrow('native_tool_not_admitted');await f.session.closeAndDrain();
 const image=await fixture([]);await expect(chunks(image.session,[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'never'}}]}])).rejects.toThrow('native_images_unsupported');expect(image.requests).toHaveLength(0);
},30000);

it('production factory refuses unsupported platform and cannot adopt a test binding or a global executable',async()=>{
 const root=temporary(),service=new ContinuityService({dbPath:path.join(root,'continuity.sqlite'),profileId:'profile'});cleanup.push(()=>service.close());
 await expect(openNativeModelSession({resourcesRoot:root,stateRoot:root,service,binding,model:'gpt-test'})).rejects.toThrow('native_execution_binding_unavailable');
 expect(isOwnedNativeModelAdapter({stream(){}})).toBe(false);
});

native('stateful native timeout never enters transparent Desktop recovery or reopens a sampling turn',async()=>{
 const control={holdFirst:true},f=await fixture([],control),onRecovery=vi.fn();
 const stream=streamDesktopTaskRecovery({adapter:f.session.adapter,messages:structuredClone(input),tools:definitions,systemPrompt:'main system',invocationId:'inv_original',deadline:Date.now()+3000,options:{signal:new AbortController().signal},onRecovery,policy:{windowMs:100,idleMs:40,initialDelayMs:1,maxDelayMs:1}});
 await expect((async()=>{for await(const _chunk of stream){/* wait actual held sampling */}})()).rejects.toThrow();
 expect(f.requests).toHaveLength(1);expect(onRecovery).not.toHaveBeenCalled();await f.session.closeAndDrain();
},10000);

native('native continuation refuses changed system and tool schemas instead of silently retaining older instructions',async()=>{
 for(const mode of ['system','schema']){
  const f=await fixture([call('original-call','read_original',{})]);
  const first=await chunks(f.session,structuredClone(input));const messages:Message[]=[...structuredClone(input),{role:'assistant',content:[first[0] as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'original-call',content:'original result'}]}];
  await expect(chunks(f.session,messages,mode==='schema'?[{...definitions[0],description:'changed'}]:definitions,mode==='system'?'changed system':'main system')).rejects.toThrow('native_instructions_changed');
  expect(f.requests).toHaveLength(1);await f.session.closeAndDrain();
 }
},20000);

native('native final IO admission rechecks the original context after main already produced a tool result',async()=>{
 let revoked=false;const control={assertAdmission:()=>{if(revoked)throw new Error('original_context_revoked');}},f=await fixture([call('held-call','read_original',{})],control);
 const first=await chunks(f.session,structuredClone(input));revoked=true;
 const continuation:Message[]=[...structuredClone(input),{role:'assistant',content:[first[0] as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'held-call',content:'MUST_NEVER_SEND_REVOKED_RESULT'}]}];
 await expect(chunks(f.session,continuation)).rejects.toThrow('original_context_revoked');expect(f.requests).toHaveLength(1);await f.session.closeAndDrain();
},15000);

it('current execution admission uses the original bound input owner and its actual synchronous snapshot',async()=>{
 const root=temporary();let entered=false,release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 const main=createDesktopServices({dataRoot:root,knowledgeDbPath:path.join(root,'knowledge.test.sqlite'),kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never,runner:async()=>{entered=true;await hold;}});
 cleanup.push(async()=>{release();await main.disposeMultiAgent();});
 const p=main.continuity.port(),conversation=p.service.createConversation(p.actor,{operationId:'owned_input'});
 const task=await main.createTask({inputId:'owned-original-input',prompt:'original prepared input',materials:[],context:{threadId:conversation.id}},{requestSource:'user',actorId:p.actor.actorId});await vi.waitFor(()=>expect(entered).toBe(true));
 expect(()=>p.service.assertCurrentInputExecution(task.taskId)).not.toThrow();
 const row=p.service.store.db.prepare('SELECT prepared_hash FROM conversation_inputs WHERE task_id=?').get(task.taskId)!;
 p.service.store.db.prepare('UPDATE conversation_inputs SET prepared_hash=? WHERE task_id=?').run('changed',task.taskId);
 expect(()=>p.service.assertCurrentInputExecution(task.taskId)).toThrow('input_authority_changed');
 p.service.store.db.prepare('UPDATE conversation_inputs SET prepared_hash=? WHERE task_id=?').run(row.prepared_hash!,task.taskId);
 expect(()=>p.service.assertCurrentInputExecution(task.taskId)).not.toThrow();
});

/** Fault only the exact owned child's original stdout ACK, retaining its real IO. */
function holdNativeAck(id:number){
 const prototype=ChildProcess.prototype as any,original=prototype.spawn;let release:(()=>void)|undefined;const observed=new Set<string>();
 const spy=vi.spyOn(prototype,'spawn').mockImplementation(function(this:any,options:any){
  const result=original.call(this,options);
  if(options.file===binary){
   const stdout=this.stdout,emit=stdout.emit;let buffer=Buffer.alloc(0);
   stdout.emit=function(event:string,...args:any[]){
    if(event!=='data')return emit.call(this,event,...args);
    buffer=Buffer.concat([buffer,args[0]]);let end;const ready:Buffer[]=[];
    while((end=buffer.indexOf(10))>=0){const line=buffer.subarray(0,end+1);buffer=buffer.subarray(end+1);let frame;try{frame=JSON.parse(line.toString());}catch{ready.push(line);continue;}
     if(typeof frame.method==='string')observed.add(frame.method);if(frame.id===id&&!frame.method){release=()=>emit.call(stdout,'data',line);}else ready.push(line);
    }
    if(ready.length)return emit.call(this,'data',Buffer.concat(ready));return true;
   };
  }
  return result;
 });
 cleanup.push(()=>spy.mockRestore());return {held:()=>!!release,observed:(method:string)=>observed.has(method),release(){expect(release).toBeTypeOf('function');release!();}};
}

native('original grant revoked during a held native steer ACK blocks the already computed resolver result at final write',async()=>{
 const ack=holdNativeAck(4),control:{assertAdmission?:()=>void;responses?:unknown[][]}={},f=await fixture([],control),service=f.service,actor={requestSource:'user' as const,actorId:'desktop-user:profile_test',profileId:'profile_test'};
 const source=service.createConversation(actor,{operationId:'source'}),target=service.createConversation(actor,{operationId:'target'});
 service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'task_source',sourceDataEpoch:'source_epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'PRIVATE_REVOKED_DURING_ACK',executionState:'settled'});
 const ref=service.createReference(actor,{conversationId:source.id,expectedRevision:service.getConversation(actor,source.id)!.revision,operationId:'ref'}),grant=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'});service.bindTask(actor,{taskId:binding.taskId,conversationId:target.id});
 control.assertAdmission=()=>service.assertTaskReadable(binding.taskId);f.first.push(call('read-call','resolve_context_reference',{refId:ref.refId}));
 const tool=createContextResolverTool(()=>({service,actor})),first=await chunks(f.session,structuredClone(input),[tool.definition]);
 const result=await tool.execute({refId:ref.refId},{taskId:binding.taskId} as never);expect(result).toContain('PRIVATE_REVOKED_DURING_ACK');
 const messages:Message[]=[...structuredClone(input),{role:'assistant',content:[first[0] as never]},{role:'user',content:[{type:'tool_result',tool_use_id:'read-call',content:result}]},{role:'user',content:[{type:'text',text:'one additional mailbox input'}]}];
 const pending=chunks(f.session,messages,[tool.definition]);pending.catch(()=>{});await vi.waitFor(()=>expect(ack.held()).toBe(true));
 service.revokeGrant(actor,grant);ack.release();await expect(pending).rejects.toThrow('not_readable');expect(f.requests).toHaveLength(1);await f.session.closeAndDrain();
},20000);

native('lost real start ACK remains unknown and close reentry returns one original completion before native callbacks',async()=>{
 const ack=holdNativeAck(3),f=await fixture([call('never-execute','read_original',{})]);
 const pending=chunks(f.session,structuredClone(input));pending.catch(()=>{});await vi.waitFor(()=>expect(ack.held()).toBe(true));await vi.waitFor(()=>expect(f.requests).toHaveLength(1));
 let inside:Promise<void>|undefined;f.store.db.function('reenter_native_close',()=>{inside=f.session.closeAndDrain();inside.catch(()=>{});return 0;});
 f.store.db.exec("CREATE TRIGGER reenter_unknown_close AFTER UPDATE ON native_model_sends WHEN NEW.status='unknown' BEGIN SELECT reenter_native_close(); END");
 const outside=f.session.closeAndDrain();outside.catch(()=>{});const same=inside===outside;
 await Promise.allSettled([pending,outside,...(inside?[inside]:[])]);
 expect(same).toBe(true);expect(f.store.db.prepare("SELECT status FROM native_model_sends WHERE kind='turn/start'").get()?.status).toBe('unknown');expect(f.requests).toHaveLength(1);
},20000);

for(const mode of ['normal','closure-fault','other-unknown','other-native','collision','collision-same-name'] as const)native(`real original Host and durable input settle only after native owner obligations: ${mode}`,async()=>{
 const calls:unknown[]=[],control={responses:[[{type:'message',role:'assistant',id:'source-answer',content:[{type:'output_text',text:'SOURCE_FROM_REAL_NATIVE'}]}],calls]},f=await fixture([],control);await f.session.closeAndDrain();
 const dataRoot=path.join(f.root,'actual-desktop');fs.mkdirSync(dataRoot,{mode:0o700});let main!:ReturnType<typeof createDesktopServices>;
 let opaqueBodies=0;const counts=new Map<string,number>(),lateChildren:Awaited<ReturnType<typeof openTestNativeModelSession>>[]=[];
 const runner=async (input:import('../../../src/runtime/task-host/task-runtime-host.js').TaskRunnerInput)=>{
  counts.set(input.taskId,(counts.get(input.taskId)??0)+1);const p=main.continuity.port(),row=p.service.store.db.prepare('SELECT * FROM conversation_inputs WHERE task_id=?').get(input.taskId)!;
  const session=await openTestNativeModelSession({binary:binary!,home:f.home,stateRoot:f.root,store:p.service.store,binding:{taskId:input.taskId,sourceEpoch:input.sessionId,executionEpoch:Number(row.execution_epoch),ownerSession:input.sessionId,inputId:String(row.input_id)},model:'mock-model',assertAdmission:()=>{p.service.assertCurrentInputExecution(input.taskId);p.service.assertTaskReadable(input.taskId);}});
  const tool=createContextResolverTool(()=>p),opaque={permission:'safe' as const,definition:{name:mode==='collision-same-name'?'native_sampling_worker':'opaque_fixture',description:'Unknown harmless fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>{opaqueBodies++;return 'OPAQUE_BODY_EXECUTED';}},registry=new ToolRegistry({autoMode:true,requireEffectGuard:true,settledLocalExecutors:new Map([[tool,tool.execute]])},[tool,opaque]);
  if(input.prompt==='target request'&&mode.startsWith('collision')){
   const resource=p.service.store.db.prepare('SELECT id FROM native_model_resources WHERE task_id=? AND source_epoch=? AND owner_session=?').get(input.taskId,input.sessionId,input.sessionId)!;
   calls[0]=call(String(resource.id),opaque.definition.name,{});
  }
  try{
   const messages:Message[]=[...input.history.map(message=>({role:message.role,content:[{type:'text' as const,text:message.content}]})),{role:'user',content:[{type:'text',text:input.prompt}]}];
   const result=await runDesktopToolLoop({adapter:session.adapter,systemPrompt:'main original Host native test',messages,allToolDefs:registry.getToolDefinitions(),registry,authorizeContext:()=>p.service.assertTaskReadable(input.taskId),requireEffectGuard:true,recordUnprovenEffect:(id,name)=>p.service.recordUnprovenEffect(p.actor,input.taskId,id,name),signal:input.signal,taskDeadline:Date.now()+30000,sessionId:input.sessionId,turnId:input.taskId,intentId:'intent',stepId:'step',taskId:input.taskId,materials:input.materials,skillInvocation:null,skillCatalog:{list:()=>[]} as never,dataRoot,taskStartTime:Date.now(),emitRuntimeEvent:input.emitRuntimeEvent,
    strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:messages=>messages,processToolResult:result=>result,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}});
   await input.emitRuntimeEvent({type:'receipt_emitted',sessionId:input.sessionId,turnId:input.taskId,intentId:'intent',stepId:'step',note:result.reply});
   if(input.prompt==='target request'){
    if(mode==='closure-fault')p.service.store.db.exec("CREATE TRIGGER reject_native_drain BEFORE UPDATE ON native_model_resources WHEN NEW.status='drained' BEGIN SELECT RAISE(ABORT,'synthetic_closure_persist_failure'); END");
    if(mode==='other-unknown')p.service.recordUnprovenEffect(p.actor,input.taskId,'original-opaque-command','bash');
    if(mode==='other-native'){
     const home=fs.mkdtempSync(path.join(f.root,'child-home-'));fs.chmodSync(home,0o700);for(const name of ['config.toml','auth.json'])fs.copyFileSync(path.join(f.home,name),path.join(home,name));
     lateChildren.push(await openTestNativeModelSession({binary:binary!,home,stateRoot:f.root,store:p.service.store,binding:{taskId:input.taskId,sourceEpoch:input.sessionId,executionEpoch:Number(row.execution_epoch),ownerSession:input.sessionId+':child',inputId:String(row.input_id)},model:'mock-model',assertAdmission:()=>{p.service.assertCurrentInputExecution(input.taskId);p.service.assertTaskReadable(input.taskId);}}));
    }
   }
  }finally{
   registry.dispose();
   try{await session.closeAndDrain();}finally{const state=session.readClosure();expect(state.stdioClosed).toBe(true);expect(()=>process.kill(Number(state.pid),0)).toThrow();expect(()=>process.kill(-Number(state.pid),0)).toThrow();console.info('OWNED_HOST_NATIVE_REAPED',JSON.stringify(state));}
  }
 };
 main=createDesktopServices({dataRoot,knowledgeDbPath:path.join(dataRoot,'knowledge.test.sqlite'),runner,kswarmService:{getStatus:()=>({running:false,port:0}),request:async()=>new Response('{}'),getDesktopMutationToken:()=> 'test'} as never});cleanup.push(async()=>{for(const child of lateChildren){await child.closeAndDrain();const state=child.readClosure();expect(()=>process.kill(Number(state.pid),0)).toThrow();expect(()=>process.kill(-Number(state.pid),0)).toThrow();console.info('OWNED_HOST_CHILD_REAPED',JSON.stringify(state));}await main.disposeMultiAgent();});
 const p=main.continuity.port(),source=p.service.createConversation(p.actor,{operationId:'actual_source'}),target=p.service.createConversation(p.actor,{operationId:'actual_target'}),actor={requestSource:'user' as const,actorId:p.actor.actorId};
 const first=await main.createTask({inputId:'source_input',prompt:'source request',materials:[],context:{threadId:source.id}},actor);
 await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('source_input')?.status).toBe('completed'));
 const ref=p.service.createReference(p.actor,{conversationId:source.id,expectedRevision:p.service.getConversation(p.actor,source.id)!.revision,operationId:'real_ref'});p.service.attachReference(p.actor,{refId:ref.refId,targetConversationId:target.id,operationId:'attach'});calls.push(call('actual-resolver-call','resolve_context_reference',{refId:ref.refId}));
 const second=await main.createTask({inputId:'target_input',prompt:'target request',materials:[],context:{threadId:target.id}},actor);
 await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('target_input')?.status).not.toBe('claimed'));
 if(!mode.startsWith('collision'))expect(JSON.stringify(f.requests[2])).toContain('SOURCE_FROM_REAL_NATIVE');expect(counts.get(first.taskId)).toBe(1);expect(counts.get(second.taskId)).toBe(1);
 const receipt=p.service.store.db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(second.taskId);
 if(mode.startsWith('collision')){expect(opaqueBodies).toBe(0);expect(receipt).toBeDefined();}
 else if(mode==='normal'){
  expect(receipt).toBeDefined();expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('target_input')?.status).toBe('completed');
  const next=await main.createTask({inputId:'next_input',prompt:'next original input',materials:[],context:{threadId:target.id}},actor);
  await vi.waitFor(()=>expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('next_input')?.status).toBe('completed'));expect(counts.get(next.taskId)).toBe(1);
  const publicMessages=p.service.listMessages(p.actor,target.id);expect(publicMessages.filter(message=>message.role==='user').map(message=>message.text)).toEqual(['target request','next original input']);
  expect(publicMessages.every(message=>message.executionState==='settled')).toBe(true);
 }else{
  expect(receipt).toBeUndefined();expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('target_input')?.status).toBe('unknown');
  expect(p.service.store.db.prepare('SELECT 1 FROM unproven_effects WHERE task_id=?').get(second.taskId)).toBeDefined();
  if(mode==='other-unknown')expect(p.service.store.db.prepare("SELECT tool_name FROM unproven_effects WHERE task_id=? AND invocation_id='original-opaque-command'").get(second.taskId)?.tool_name).toBe('bash');
  if(mode==='other-native'){
   expect(p.service.store.db.prepare("SELECT count(*) AS n FROM unproven_effects WHERE task_id=? AND tool_name='native_sampling_worker'").get(second.taskId)?.n).toBe(1);
   await lateChildren[0].closeAndDrain();expect(p.service.store.db.prepare('SELECT * FROM effect_owner_receipts WHERE task_id=?').get(second.taskId)).toBeUndefined();expect(p.service.store.db.prepare('SELECT status FROM conversation_inputs WHERE input_id=?').get('target_input')?.status).toBe('unknown');
  }
 }
},45000);

native('new mailbox turns deliver their public final text even when the provider reuses a message id',async()=>{
 const f=await fixture([{type:'message',role:'assistant',id:'final',content:[{type:'output_text',text:'native final answer'}]}]),messages=structuredClone(input);
 for(let turn=0;turn<3;turn++){
  const output=await chunks(f.session,messages);expect(output.filter(chunk=>chunk.type==='text').map(chunk=>chunk.delta).join('')).toBe('native final answer');
  if(turn<2)messages.push({role:'assistant',content:[{type:'text',text:'native final answer'}]},{role:'user',content:[{type:'text',text:`next mailbox ${turn}`} ]});
 }
 expect(f.requests).toHaveLength(3);
},15000);

native('durable send-intent failure prevents actual model work and an original resource cannot be replayed after drain',async()=>{
 const f=await fixture([]);f.store.db.exec("CREATE TRIGGER reject_native_work_intent BEFORE INSERT ON native_model_sends WHEN NEW.kind='turn/start' BEGIN SELECT RAISE(ABORT,'synthetic_send_intent_failure'); END");
 await expect(chunks(f.session,structuredClone(input))).rejects.toThrow('synthetic_send_intent_failure');expect(f.requests).toHaveLength(0);await f.session.closeAndDrain();
 await expect(openTestNativeModelSession({binary:binary!,home:f.home,stateRoot:f.root,store:f.store,binding,model:'mock-model',assertAdmission:()=>{}})).rejects.toThrow('native_activation_not_replayable');expect(f.requests).toHaveLength(0);
},15000);

native('native resource IDs remain reserved after drain for all original unknown-tool observers',async()=>{
 const f=await fixture([]);await f.session.closeAndDrain();const id=String(f.store.db.prepare('SELECT id FROM native_model_resources').get()!.id);let bodies=0;
 const tool={permission:'safe' as const,definition:{name:'native_sampling_worker',description:'Original unknown fixture',inputSchema:{type:'object',properties:{}}},execute:async()=>{bodies++;return 'executed';}},registry=new ToolRegistry({autoMode:true,requireEffectGuard:true},[tool]);cleanup.push(()=>registry.dispose());
 try{await registry.executeTool(tool.definition.name,{},{taskId:binding.taskId,recordUnprovenEffect:(name:string)=>f.service.recordUnprovenEffect({requestSource:'user',actorId:'desktop-user:profile_test',profileId:'profile_test'},binding.taskId,id,name)} as never);}catch{/* Expected original guard failure before the body. */}
 expect(bodies).toBe(0);
},15000);

native('native initial owner marker strictly rejects an already recorded ordinary unknown invocation',async()=>{
 const f=await fixture([]);await f.session.closeAndDrain();const id='ffffffff-ffff-4fff-8fff-ffffffffffff',actor={requestSource:'user' as const,actorId:'desktop-user:profile_test',profileId:'profile_test'};
 f.service.recordUnprovenEffect(actor,binding.taskId,id,'native_sampling_worker');
 const original=crypto.randomUUID,spy=vi.spyOn(crypto,'randomUUID').mockImplementation(original).mockImplementationOnce(()=>id);syncBuiltinESMExports();
 let created:Awaited<ReturnType<typeof openTestNativeModelSession>>|undefined,error:unknown;
 try{created=await openTestNativeModelSession({binary:binary!,home:f.home,stateRoot:f.root,store:f.store,binding:{...binding,ownerSession:'later_owner'},model:'mock-model',assertAdmission:()=>{}});}catch(caught){error=caught;}finally{spy.mockRestore();syncBuiltinESMExports();}
 if(created)cleanup.push(async()=>{try{await created!.closeAndDrain();}catch{/* Failed baseline still must physically reap its own child. */}const state=created!.readClosure();expect(()=>process.kill(Number(state.pid),0)).toThrow();expect(()=>process.kill(-Number(state.pid),0)).toThrow();console.info('OWNED_REJECTED_NATIVE_REAPED',JSON.stringify(state));});
 expect(error).toBeDefined();expect(f.store.db.prepare('SELECT count(*) AS n FROM native_model_resources').get()?.n).toBe(1);expect(f.store.db.prepare('SELECT tool_name FROM unproven_effects WHERE task_id=? AND invocation_id=?').get(binding.taskId,id)?.tool_name).toBe('native_sampling_worker');
},15000);

for(const mode of ['during-ack','after-frame-admission'] as const)native(`public native final remains fenced with no later tool-result write: ${mode}`,async()=>{
 const ack=holdNativeAck(3);let revoked=false,armed=false;const control={assertAdmission:()=>{if(revoked)throw new Error('original_public_context_revoked');}};
 const shift=Array.prototype.shift;Array.prototype.shift=function(){const frame=shift.call(this);if(armed&&mode==='after-frame-admission'&&frame?.method==='item/completed'&&frame.params?.item?.text==='MUST_NOT_PROJECT_AFTER_REVOCATION'){armed=false;queueMicrotask(()=>{revoked=true;});}return frame;};cleanup.push(()=>{Array.prototype.shift=shift;});
 const f=await fixture([{type:'message',role:'assistant',id:'final',content:[{type:'output_text',text:'MUST_NOT_PROJECT_AFTER_REVOCATION'}]}],control),seen:unknown[]=[];
 const pending=(async()=>{for await(const chunk of f.session.adapter.stream(structuredClone(input),definitions,'main system'))seen.push(chunk);})();pending.catch(()=>{});
 await vi.waitFor(()=>expect(ack.held()).toBe(true));await vi.waitFor(()=>expect(f.requests).toHaveLength(1));await vi.waitFor(()=>expect(ack.observed('turn/completed')).toBe(true));if(mode==='during-ack')revoked=true;else armed=true;ack.release();
 await expect(pending).rejects.toThrow('original_public_context_revoked');expect(seen).toEqual([]);expect(f.requests).toHaveLength(1);expect(f.store.db.prepare("SELECT status FROM native_model_sends WHERE kind='turn/start'").get()?.status).toBe('accepted');await f.session.closeAndDrain();
},20000);

native('a native tool-use yield cannot continue with done after the original context is revoked',async()=>{
 let revoked=false;const f=await fixture([call('yielded-call','read_original',{})],{assertAdmission:()=>{if(revoked)throw new Error('original_yield_context_revoked');}}),iterator=f.session.adapter.stream(structuredClone(input),definitions,'main system')[Symbol.asyncIterator]();
 expect((await iterator.next()).value).toMatchObject({type:'tool_use',id:'yielded-call'});revoked=true;await expect(iterator.next()).rejects.toThrow('original_yield_context_revoked');expect(f.requests).toHaveLength(1);await f.session.closeAndDrain();
},15000);

for(const phase of ['progress','activity'] as const)native(`the original Desktop loop rechecks source policy at its actual public output sink: ${phase}`,async()=>{
 const control:{assertAdmission?:()=>void}={},f=await fixture([{type:'message',role:'assistant',id:'final',content:[{type:'output_text',text:'NO_REVOKED_PUBLIC_OUTPUT'}]}],control),service=f.service,actor={requestSource:'user' as const,actorId:'desktop-user:profile_test',profileId:'profile_test'};
 const source=service.createConversation(actor,{operationId:'sink_source'}),target=service.createConversation(actor,{operationId:'sink_target'});service.recordMessage(actor,{conversationId:source.id,sourceKind:'desktop_task',sourceId:'fixture_source',sourceDataEpoch:'source_epoch',sourceMessageId:'answer',sourceRevision:1,role:'assistant',text:'source policy fixture',executionState:'settled'});const ref=service.createReference(actor,{conversationId:source.id,expectedRevision:service.getConversation(actor,source.id)!.revision,operationId:'sink_ref'}),grant=service.attachReference(actor,{refId:ref.refId,targetConversationId:target.id,operationId:'sink_attach'});service.bindTask(actor,{taskId:binding.taskId,conversationId:target.id});const consumed=await createContextResolverTool(()=>({service,actor})).execute({refId:ref.refId},{taskId:binding.taskId} as never);expect(consumed).toContain('source policy fixture');control.assertAdmission=()=>service.assertTaskReadable(binding.taskId);
 const events:unknown[]=[],registry=new ToolRegistry({autoMode:true},[]);cleanup.push(()=>registry.dispose());let revoked=false;const revoke=()=>{if(!revoked){revoked=true;service.revokeGrant(actor,grant);}};
 await expect(runDesktopToolLoop({adapter:f.session.adapter,systemPrompt:'main system',messages:structuredClone(input),allToolDefs:[],registry,authorizeContext:()=>service.assertTaskReadable(binding.taskId),signal:new AbortController().signal,taskDeadline:Date.now()+10000,sessionId:binding.sourceEpoch,turnId:'sink-turn',intentId:'intent',stepId:'step',taskId:binding.taskId,materials:[],skillInvocation:null,skillCatalog:{list:()=>[]} as never,dataRoot:f.root,taskStartTime:Date.now(),onActivity:()=>{if(phase==='activity')revoke();},emitRuntimeEvent:async event=>{if(event.type==='execution_progress'&&phase==='progress')revoke();if(event.type==='assistant_delta')events.push(event);},strategies:{compact:{enabled:false,shouldCompact:()=>false,doCompact:async()=>{}},buildApiView:m=>m,processToolResult:r=>r,trackAutoProgress:false,trackReferenceReads:false,emitSkillArtifactTrace:false}})).rejects.toThrow('not_readable');expect(events).toEqual([]);await f.session.closeAndDrain();
},20000);
