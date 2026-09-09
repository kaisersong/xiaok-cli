// @vitest-environment node
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {it,expect,vi} from 'vitest';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {RoomWorkspaceLocalStore} from '../../electron/room-workspace-local.js';
import {createRoomWorkspaceService} from '../../electron/room-workspace-service.js';
import {createRoomWorkspaceBrokerClient} from '../../electron/room-workspace-broker-client.js';
import {createCollaborationRoomBrokerClient} from '../../electron/collaboration-room-broker-client.js';
import {createRoomWorkspaceRuntime} from '../../electron/room-workspace-runtime.js';
import {createRoomWorkspaceProjectAdapter} from '../../electron/room-workspace-project-adapter.js';
import {createRoomWorkspaceProjectDispatch} from '../../electron/room-workspace-project-dispatch.js';
import {createRoomProjectScopeGuard} from '../../electron/room-project-scope-guard.js';
import {createKSwarmRuntimeBridge,createKSwarmRuntimeBridgeBrokerClient} from '../../electron/kswarm-runtime-bridge.js';

it('existing dispatch button reaches real KSwarm HTTP, broker handoff, scoped SSE children and unique project result owner',async()=>{
 const root=mkdtempSync(join(tmpdir(),'project-provider-')),cwd=join(root,'selected-root'),projectCwd=join(cwd,'chosen-project'),stateRoot=join(root,'kswarm');
 mkdirSync(projectCwd,{recursive:true});mkdirSync(stateRoot);
 mkdirSync(join(cwd,'separate-project'));
 const previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=join(root,'config');mkdirSync(process.env.XIAOK_CONFIG_DIR);
 const requests:any[]=[];let serial=0,discussionObserved=false;
 const model=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push(body);
  const text=JSON.stringify(body.messages),rootTurn=text.includes('PROJECT_ROOT_FLOW');
  const called=body.messages.flatMap((m:any)=>(m.tool_calls??[]).map((t:any)=>t.function.name));
  let name:string|undefined,input:any={};
  if(text.includes('UNMAPPED_PROJECT_DISCUSSION')){
   discussionObserved=true;expect(text).toContain('无文件执行权的讨论模式');
   const tools=(body.tools??[]).map((t:any)=>t.function.name);for(const denied of ['read','write','edit','glob','bash','grep'])expect(tools).not.toContain(denied);
  }else if(rootTurn){
   if(!called.includes('spawn_agent')){name='spawn_agent';input={task_name:'helper',message:'CHILD_ONE'};}
   else if(!called.includes('write')){name='write';input={file_path:'root.txt',content:'root physical output'};}
   else if(!called.includes('wait_agent')){name='wait_agent';input={targets:['/root/helper'],timeout_ms:10000};}
   else if(!called.includes('followup_task')){name='followup_task';input={target:'/root/helper',message:'CHILD_TWO'};}
   else if(called.filter((n:string)=>n==='wait_agent').length<2){name='wait_agent';input={targets:['/root/helper'],timeout_ms:10000};}
  }else if(!called.includes('write')){name='write';input={file_path:text.includes('CHILD_TWO')?'child2.txt':'child.txt',content:'child physical output'};}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(delta:unknown,finish_reason:string|null=null)=>res.write(`data: ${JSON.stringify({id:`fixture-${++serial}`,object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})}\n\n`);
  if(name){emit({tool_calls:[{index:0,id:`call-${serial}`,type:'function',function:{name,arguments:JSON.stringify(input)}}]});emit({},'tool_calls');}
  else{emit({content:rootTurn?'PROJECT_SSE_DONE with verified root and two child deliverables produced and checked in the authorized project directory.':'CHILD_SSE_DONE'});emit({},'stop');}
  res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));
 writeFileSync(join(process.env.XIAOK_CONFIG_DIR,'config.json'),JSON.stringify({schemaVersion:2,defaultProvider:'openai',defaultModelId:'fixture',providers:{openai:{type:'first_party',protocol:'openai_legacy',apiKey:'fixture',baseUrl:`http://127.0.0.1:${(model.address() as any).port}/v1`}},models:{fixture:{provider:'openai',model:'gpt-project-fixture',label:'fixture',runtimeOptions:{contextLimit:100000}}},defaultMode:'interactive',contextBudget:100000,channels:{}}));
 const nodeImport=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;
 const siblings=resolve(process.cwd(),'..','..');
 const {createBrokerService}=await nodeImport(pathToFileURL(join(siblings,'intent-broker/src/broker/service.js')).href);
 const {createServer:createBrokerServer}=await nodeImport(pathToFileURL(join(siblings,'intent-broker/src/http/server.js')).href);
 const {createHub}=await nodeImport(pathToFileURL(join(siblings,'kswarm/src/core/hub.js')).href);
 const broker=createBrokerService({dbPath:join(root,'broker.sqlite')}),store=new RoomWorkspaceLocalStore(join(root,'local.sqlite'));
 const brokerServer=createBrokerServer({broker,roomService:broker.room,roomDesktopToken:'desktop-test',roomKSwarmToken:'kswarm-test'});
 broker.attachWebSocket(brokerServer.raw());
 await brokerServer.listen(0,'127.0.0.1');const baseUrl=`http://127.0.0.1:${brokerServer.address().port}`;
 const client=createRoomWorkspaceBrokerClient({token:'desktop-test',baseUrl,isMutationOwner:()=>true});
 const roomClient=createCollaborationRoomBrokerClient({token:'desktop-test',fetchImpl:(input,init)=>fetch(`${baseUrl}${new URL(String(input)).pathname}${new URL(String(input)).search}`,init)});
 const created=await roomClient.createRoom({title:'Project chain',memberAgentIds:['xiaok-worker']});expect(created.ok).toBe(true);const roomId=(created.room as any).roomId;
 const seed=createHub({silent:true,dataDir:{backend:'sqlite',filePath:join(stateRoot,'state.sqlite')},projectStorageRoot:join(stateRoot,'projects')});
 const project=seed.createProject({id:'p',name:'Project',goal:'PROJECT_ROOT_FLOW',poAgent:'xiaok-po',members:['xiaok-worker']});
 seed.handleCreateTasks('p',[{id:'t',title:'PROJECT_ROOT_FLOW',brief:'Create the three requested text deliverables',assignedAgent:'xiaok-worker'}],'xiaok-po');seed.handleApprove('p');
 project.primaryRoomId=roomId;project.requiredProtocol='room_workspace_v1';project.workspaceMapping={state:'mapping_required'};
 const unmapped=seed.createProject({id:'unmapped',name:'Discussion without directory',goal:'Discussion only',poAgent:'xiaok-po',members:['xiaok-worker']});unmapped.primaryRoomId=roomId;unmapped.requiredProtocol='room_workspace_v1';unmapped.workspaceMapping={state:'mapping_required'};
 const peers=['shared','separate'].map(id=>{
  const p=seed.createProject({id,name:id,goal:'Other authorized project',poAgent:'xiaok-po',members:['xiaok-worker']});
  seed.handleCreateTasks(id,[{id:'t',title:'Other task',assignedAgent:'xiaok-worker'}],'xiaok-po');seed.handleApprove(id);
  p.primaryRoomId=roomId;p.requiredProtocol='room_workspace_v1';p.workspaceMapping={state:'mapping_required'};return p;
 });
 seed.createProject({id:'legacy',name:'Legacy standalone',goal:'Preserve compatibility',poAgent:'xiaok-po',members:['xiaok-worker']});
 seed.persistState();seed.closePersistence();
 const reservation=createServer();await new Promise<void>(done=>reservation.listen(0,'127.0.0.1',done));const port=(reservation.address() as any).port;await new Promise<void>(done=>reservation.close(()=>done()));
 let serverLog='';const child=spawn(process.execPath,[join(siblings,'kswarm/src/server/index.js')],{cwd:join(siblings,'kswarm'),env:{...process.env,KSWARM_DATA_ROOT:stateRoot,KSWARM_PORT:String(port),BROKER_URL:baseUrl,KSWARM_DESKTOP_MUTATION_TOKEN:'desktop-mutation',INTENT_BROKER_KSWARM_TOKEN:'kswarm-test'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',c=>serverLog+=String(c));child.stderr.on('data',c=>serverLog+=String(c));
 const kswarmRequest=(path:string,init:RequestInit={})=>fetch(`http://127.0.0.1:${port}${path}`,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),'x-kswarm-mutation-token':'desktop-mutation'}});
 let host:ReturnType<typeof createKSwarmRuntimeBridgeBrokerClient>|undefined;
 try{
  await vi.waitFor(async()=>{expect(child.exitCode,serverLog).toBeNull();expect((await(await kswarmRequest('/health')).json()).brokerConnected,serverLog).toBe(true);},{timeout:10000,interval:100});
  await vi.waitFor(()=>expect(serverLog).toContain('"reason":"workspace_mapping_required"'),{timeout:11000,interval:100});
  expect(serverLog).not.toContain('Scheduled recovery failed');
  let mappingSendFailed=false;
  let workspaceService=createRoomWorkspaceService({store,broker:client,kswarmRequest:async(path,init)=>{
    if(path==='/projects/p/workspace-mapping'&&init?.method==='POST'&&!mappingSendFailed){mappingSendFailed=true;throw new Error('fixture_mapping_network_failure');}
    return kswarmRequest(path,init);
  },isMutationOwner:()=>true,ensureProtocol:async()=>{}});
  const preview=await workspaceService.previewCollaborationRoomWorkspace({roomId,mode:'existing',selectedPath:cwd,expectedRevision:0,templateEntries:[],instructionsText:'FROZEN_PROJECT_RULES'});expect(preview.ok,JSON.stringify(preview)).toBe(true);
  const bound=await workspaceService.commitCollaborationRoomWorkspace({roomId,previewId:preview.previewId!,expectedRevision:0,idempotencyKey:'bind',confirmOverlap:true,confirmSharedReadGrant:true});expect(bound.ok,JSON.stringify(bound)).toBe(true);
  const state=await client.get(roomId);
  const mapped=await workspaceService.mapCollaborationRoomWorkspaceProject({roomId,projectId:'p',expectedRevision:(state.config as any).revision,expectedProjectRevision:project.projectRevision,workFolderRelativePath:'chosen-project',artifactsRelativePath:'chosen-project',idempotencyKey:'map'});
  expect(mapped.ok).toBe(false);expect(mappingSendFailed).toBe(true);
  const pendingMapping=store.listRecords<any>('pending-mapping')[0];expect(pendingMapping.ticketId).toBeTruthy();expect(pendingMapping.applied).toBe(false);
  // Reconstruct the service with only its durable SQLite journal. Recovery owns
  // the historical ticket; it must not require the original in-memory closure.
  workspaceService=createRoomWorkspaceService({store,broker:client,kswarmRequest,isMutationOwner:()=>true,ensureProtocol:async()=>{}});
  await workspaceService.recoverMappings();
  expect(store.listRecords<any>('pending-mapping')[0].applied).toBe(true);
  for(const peer of peers){
    const current=await client.get(roomId),directory=peer.id==='shared'?'chosen-project':'separate-project';
    const mappedPeer=await workspaceService.mapCollaborationRoomWorkspaceProject({roomId,projectId:peer.id,expectedRevision:(current.config as any).revision,expectedProjectRevision:peer.projectRevision,workFolderRelativePath:directory,artifactsRelativePath:directory,idempotencyKey:`map-${peer.id}`});
    expect(mappedPeer.ok,JSON.stringify(mappedPeer)).toBe(true);
  }
  const adapter=createRoomWorkspaceProjectAdapter({kswarmRequest,broker:client,journal:store});
  expect(await adapter.listDispatchCandidates('legacy')).toBeNull();
  const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:{request:kswarmRequest,getDesktopMutationToken:()=> 'desktop-mutation'} as any});
  const guarded=createRoomProjectScopeGuard({roomClient,workspaceBroker:client,kswarmRequest});
  const runtime=createRoomWorkspaceRuntime({store,broker:guarded.workspaceBroker,wake:guarded.roomClient,execute:services.runCollaborationRoomAgentTask,executeProject:services.runWorkspaceProjectTask,projectAdapter:adapter,ensureProtocol:async()=>{},flushOutbox:workspaceService.flushOutbox});
  const discussion=await roomClient.sendRoomMessage({roomId,text:'UNMAPPED_PROJECT_DISCUSSION',contextScope:{kind:'project',projectId:'unmapped'},idempotencyKey:'discussion',responsePolicy:'mentioned',mentions:[{kind:'agent',logicalAgentId:'xiaok-worker'}]});expect(discussion.ok,JSON.stringify(discussion)).toBe(true);
  const source=discussion.message as any;
  expect(await runtime.run({roomId,roomTitle:'Project discussion',roomRevision:1,roomMessageId:source.messageId,logicalAgentId:'xiaok-worker',contextScope:{kind:'project',projectId:'unmapped'},attachmentPaths:[],messages:[source],contextWindow:{fromSequence:source.roomSequence,toSequence:source.roomSequence,totalMessages:1,isComplete:true,snapshotAt:new Date().toISOString()}})).toEqual({ok:true});expect(discussionObserved).toBe(true);
  const runWorkspaceTask=vi.fn(runtime.runProjectTask);
  const bridge=createKSwarmRuntimeBridge({allowedRoots:[join(stateRoot,'projects')],runWorkspaceTask,runDesktopTask:async()=>{throw new Error('legacy_runner_bypass');},submitResult:async()=>{throw new Error('duplicate_result_owner');}});
  host=createKSwarmRuntimeBridgeBrokerClient({brokerUrl:baseUrl,participantId:'xiaok-desktop',participantKind:'service',roles:['desktop_runtime_host'],capabilities:['research','analysis','coding','testing','planning','reporting'],bridge});await host.start();
  const dispatch=createRoomWorkspaceProjectDispatch({adapter,runtime});
  const dispatched=await dispatch('p');expect(dispatched,serverLog).toMatchObject({ok:true,dispatched:['p__t']});
  await vi.waitFor(()=>{const records=store.listRecords<any>('project-execution');expect(records.some(r=>r.status==='completed'),JSON.stringify(records)+'\n'+serverLog).toBe(true);},{timeout:20000,interval:100});
  expect(runWorkspaceTask).toHaveBeenCalledOnce();
  for(const name of ['root.txt','child.txt','child2.txt'])expect(readFileSync(join(projectCwd,name),'utf8')).toContain('physical output');
  expect(readdirSync(cwd).sort()).toEqual(['chosen-project','separate-project']);expect(readdirSync(projectCwd).sort()).toEqual(['child.txt','child2.txt','root.txt']);expect(readdirSync(join(cwd,'separate-project'))).toEqual([]);
  const mapping=await(await kswarmRequest('/projects/p/workspace-mapping?logicalAgentId=xiaok-worker')).json();
  expect(JSON.stringify(mapping.tasks)).toContain('PROJECT_SSE_DONE');
  expect(mapping.tasks[0].result.artifacts).toHaveLength(3);
  expect(Object.keys(mapping.project.workspaceResultOperations)).toHaveLength(1);
  // Public Room state deliberately excludes project-private claims. Inspect the
  // actual broker journal read-only instead of widening the production API.
  const {DatabaseSync}=await nodeImport('node:sqlite');const journal=new DatabaseSync(join(root,'broker.sqlite'),{readOnly:true});
  const claims=journal.prepare("SELECT value_json FROM room_workspace_records WHERE kind='claim' AND room_id=?").all(roomId).map((row:any)=>JSON.parse(row.value_json));journal.close();
  expect(claims).toHaveLength(3);expect(claims.every((c:any)=>c.executionState==='released'),JSON.stringify(claims)).toBe(true);
  expect((await workspaceService.getCollaborationRoomWorkspace({roomId})).artifacts).toEqual([]);
  const record=store.listRecords<any>('project-execution')[0],before=requests.length;
  expect(await runtime.prepareProjectTask({roomId,projectId:'p',taskId:'p__t',logicalAgentId:'xiaok-worker',requestId:record.requestId})).toMatchObject({ok:true,reused:true});expect(requests).toHaveLength(before);
  const probe=await client.request(roomId,'acquire',{logicalAgentId:'xiaok-worker',runId:'scope-probe',executorInstanceId:'scope-probe-executor',contextScope:{kind:'project',projectId:'p'},projectMappingRevision:mapping.mapping.mappingRevision,capability:{contextVersion:1,resultVersion:1,releaseVersion:1,canSetCwd:true,canTrackChildren:true,canRelease:true}});
  expect(probe.ok,JSON.stringify(probe)).toBe(true);const probeClaim=probe.claim as any;
  expect((await client.request(roomId,'ack',{...probeClaim,actualCwd:projectCwd,cwdVerified:true})).ok).toBe(true);
  for(const peer of peers){
    const denial=await(await kswarmRequest(`/projects/${peer.id}/workspace-dispatch`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({taskId:`${peer.id}__t`,claimId:probeClaim.claimId})})).json();
    expect(denial.ok,JSON.stringify(denial)).toBe(false);
  }
  await client.request(roomId,'cancel',{claimId:probeClaim.claimId});
  await client.request(roomId,'release',{...probeClaim,cleanupOutcome:'released',terminationEvidence:{kind:'resources-disposed',executorInstanceId:probeClaim.executorInstanceId,verified:true}});
  await runtime.shutdown();
 }finally{
  host?.stop();child.kill('SIGTERM');await new Promise<void>(done=>child.exitCode!==null?done():child.once('exit',()=>done()));
  writeFileSync(join(root,'server.log'),serverLog);
  await brokerServer.close();broker.close();store.close();model.closeAllConnections();await new Promise<void>(done=>model.close(()=>done()));
  if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;
 }
},40000);
