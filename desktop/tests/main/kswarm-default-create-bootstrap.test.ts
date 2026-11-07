// @vitest-environment node
// Real create_project tool -> Main journal/queue -> isolated broker + KSwarm
// HTTP + SQLite -> real scoped Host -> atomic plan/task owner commit. Only the
// provider transport is simulated; this is not an installation/OS qualification.
import {it,expect,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import net from 'node:net';
import WebSocket from 'ws';
import {createKSwarmRuntimeBridge,createKSwarmRuntimeBridgeBrokerClient,submitKSwarmRuntimeResultToBroker} from '../../electron/kswarm-runtime-bridge.js';
import {createDesktopServices} from '../../electron/desktop-services.js';
import {createKSwarmService,sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {createCollaborationRoomBrokerClient} from '../../electron/collaboration-room-broker-client.js';
import {OpenAIAdapter} from '../../../src/ai/adapters/openai.js';
import {createServer} from '../../../../intent-broker/src/http/server.js';
import {createBrokerService} from '../../../../intent-broker/src/broker/service.js';
import {protocolDigest} from '../../../../kswarm/src/core/project-protocol.js';
vi.mock('node:worker_threads',async importActual=>{
 const native=await importActual<typeof import('node:worker_threads')>();
 return {...native,Worker:class extends native.Worker{
  constructor(script:string|URL,options?:import('node:worker_threads').WorkerOptions){super(String(script).endsWith('/delivery-verifier-worker.js')?new URL('../../../dist/runtime/task-host/delivery-verifier-worker.js',import.meta.url):script,options);}
 }};
});
async function runDefaultMainCase(startPolicy:'plan_only'|'activate_and_dispatch_after_plan',fault:'none'|'reader_after_commit'='none'){
 const root=mkdtempSync(join(tmpdir(),'default-create-main-')),dataRoot=join(root,'main'),workspace=join(root,'workspace'),config=join(root,'config');mkdirSync(config);mkdirSync(workspace);
 const previous={config:process.env.XIAOK_CONFIG_DIR,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS,activity:process.env.XIAOK_CONVERSATION_ACTIVITY,entry:process.env.KSWARM_SERVER_PATH,fetch:globalThis.fetch};
 process.env.XIAOK_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';process.env.XIAOK_CONVERSATION_ACTIVITY='0';
 writeFileSync(join(config,'config.json'),JSON.stringify({schemaVersion:1,defaultModel:'custom',models:{custom:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'fixture-only',model:'fixture'}},defaultMode:'interactive',channels:{},skillDebug:false}));
 const scope={profileId:createHash('sha256').update(dataRoot).digest('hex'),workspaceId:createHash('sha256').update(workspace).digest('hex')};
 const broker=createBrokerService({dbPath:join(root,'broker.sqlite')});
 const server=createServer({broker,roomService:broker.room,roomDesktopToken:'room-user',roomKSwarmToken:'room-owner'});broker.attachWebSocket(server.raw());await server.listen(0,'127.0.0.1');
 const brokerUrl='http://127.0.0.1:'+server.address().port;
 const probe=net.createServer();await new Promise<void>(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=(probe.address() as net.AddressInfo).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 process.env.KSWARM_SERVER_PATH=fileURLToPath(new URL('../../../../kswarm/src/server/index.js',import.meta.url));
 const gateway=createKSwarmService({desktopProjectScope:scope,spawnProcess:(()=>{throw Error('fixture_unowned_spawn_denied');}) as never,findPortOwner:async()=>null,killStalePortOwner:async()=>{throw Error('fixture_unowned_kill_denied');}});
 const child=spawn(process.execPath,['src/server/index.js'],{cwd:fileURLToPath(new URL('../../../../kswarm',import.meta.url)),env:{...process.env,HOME:root,USERPROFILE:root,KSWARM_DATA_ROOT:join(root,'kswarm'),KSWARM_PORT:String(port),BROKER_URL:brokerUrl,INTENT_BROKER_KSWARM_TOKEN:'room-owner',KSWARM_DESKTOP_MUTATION_TOKEN:gateway.getDesktopMutationToken(),KSWARM_DESKTOP_PROFILE_ID:scope.profileId,KSWARM_DESKTOP_WORKSPACE_ID:scope.workspaceId},stdio:['ignore','pipe','pipe']});
 let diagnostics='';child.stdout!.on('data',chunk=>diagnostics+=String(chunk));child.stderr!.on('data',chunk=>diagnostics+=String(chunk));
 console.log(JSON.stringify({test:'default-create-main-started',pid:child.pid,startPolicy,root}));
 const close=new Promise<void>(resolve=>child.once('exit',(code,signal)=>{console.log(JSON.stringify({test:'default-create-main-child',pid:child.pid,code,signal,reaped:true}));resolve();}));
 let services:ReturnType<typeof createDesktopServices>|undefined;let poRuns=0,projectPosts=0,nativeWriteInputPath='',commitAcknowledged=false,activationPosts=0;
 let roomCaptureWire:Parameters<ReturnType<typeof createDesktopServices>['captureRoomConversion']>[0]|undefined;let roomCapture:Awaited<ReturnType<ReturnType<typeof createDesktopServices>['captureRoomConversion']>>|undefined;let roomSourceReads=0;
 let primaryFailure:{error:unknown}|undefined;
 let desktopBridge:ReturnType<typeof createKSwarmRuntimeBridgeBrokerClient>|undefined;const testAbort=new AbortController();
 const stream=vi.spyOn(OpenAIAdapter.prototype,'stream').mockImplementation(async function*(messages){
  const text=messages.flatMap(message=>message.content).filter(block=>block.type==='text').map(block=>block.type==='text'?block.text:'').join('\n');
  const planning=messages.some(message=>message.content.some(block=>block.type==='text'&&block.text.includes('KSwarm PO 规划任务。')));
  if(planning){expect(JSON.parse(readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8')).jobs[0].modelAttempted).toBe(true);poRuns++;yield {type:'text',delta:JSON.stringify({analysis:'Produce the requested report without altering the user goal.',successCriteria:['A complete report'],phases:[{id:'phase-1',name:'Report',items:[{id:'item-1',title:'Write report',brief:'Create the complete requested report in the project workspace.',assignedAgent:'xiaok-worker',dependencies:[],acceptanceCriteria:'The complete report exists and is checked.',requiredOutputs:['markdown']}]}]})};}
  else if(text.includes('KSwarm 项目任务执行')){
   if(!messages.some(message=>message.content.some(block=>block.type==='tool_result'))){
    const artifactsDir=text.split('\n').find(line=>line.startsWith('产物目录：'))?.slice('产物目录：'.length).trim();if(!artifactsDir)throw Error('artifact_dir_missing');
    nativeWriteInputPath=join(artifactsDir,'report.md');
    yield {type:'tool_use',id:'write-report',name:'write',input:{file_path:join(artifactsDir,'report.md'),content:'# Project report\n\n## Goal\nProduce a complete report through the original project execution chain.\n\n## Process\nThe Main initial plan created the owner task once. The worker wrote this report through the actual native file tool.\n\n## Result\nThe report is available in the project artifacts directory for review.\n'}};
   }else yield {type:'text',delta:'The complete report has been written to artifacts/report.md through the native file tool and is ready for review.'};
  }
  else if(text.includes('KSwarm PO 验收任务提交'))yield {type:'text',delta:JSON.stringify({passed:true,feedback:'The report exists and covers goal, process and result.',failureClass:null,planRevisionNeeded:false})};
  else if(text.includes('KSwarm 项目收尾'))yield {type:'text',delta:'# Project summary\n\nThe report has been produced and reviewed through the existing project execution chain.'};
  else if(text.trim()==='ping')yield {type:'text',delta:'ok'};
  else if(!messages.some(message=>message.content.some(block=>block.type==='tool_result')))yield {type:'tool_use',id:'create-once',name:'create_project',input:{name:'Default Main test',goal:'Write a complete report',members:['xiaok-worker'],memberCount:1}};
  else yield {type:'text',delta:'正式项目已创建并登记在项目列表，初始规划状态以项目卡片为准。当前不声称任务已经执行或交付。'};
  yield {type:'done'};
 });
 const originalStartRead=gateway.readProjectExecutionStart!.bind(gateway);
 gateway.readProjectExecutionStart=async projectId=>{if(fault==='reader_after_commit'&&commitAcknowledged)throw Error('fixture_next_start_read_denied');return originalStartRead(projectId);};
 const base='http://127.0.0.1:'+port;
 const headers={'x-kswarm-mutation-token':gateway.getDesktopMutationToken()};
 globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.port==='4400'){if(url.pathname==='/projects/room-first'&&init?.method==='POST')projectPosts++;if(url.pathname.endsWith('/activate-and-start')&&init?.method==='POST')activationPosts++;const response=await previous.fetch(base+url.pathname+url.search,init);if(url.pathname.endsWith('/initial-plan-inputs/commit')){const json=response.json.bind(response);response.json=async()=>{const value=await json();if(value.receipt?.outcome==='applied')commitAcknowledged=true;return value;};}return response;}if((url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.port==='4318')return previous.fetch(brokerUrl+url.pathname+url.search,init);return previous.fetch(input,init);};
 const roomCall=async(path:string,body?:unknown)=>{
  const response=await fetch(brokerUrl+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-intent-broker-room-token':'room-user'},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok||!value.ok)throw Error(JSON.stringify(value));return value;
 };
 const rooms={createRoom:(input:unknown)=>roomCall('/rooms',input),sendRoomMessage:(input:any)=>roomCall('/rooms/'+input.roomId+'/messages',input),getRoomSnapshot:(id:string)=>roomCall('/rooms/'+id)};
 const createServices=()=>{const result=createDesktopServices({dataRoot,workspaceRoot:workspace,knowledgeDbPath:join(root,'knowledge.db'),kswarmService:gateway as never});result.bindConversationProjectRoomClient(rooms);return result;};
 try{
  for(let n=0;;n++){try{if((await fetch(base+'/health')).ok)break;}catch{}if(n===400||child.exitCode!==null)throw Error('startup_failed: '+diagnostics);await new Promise(resolve=>setTimeout(resolve,25));}
  services=createServices();
  if(startPolicy!=='plan_only'){
   const runtime={...createKSwarmRuntimeBridge({kswarmService:gateway,allowedRoots:[join(root,'kswarm','projects'),join(root,'kswarm','handoff-packages')],
    runDesktopTask:input=>services!.runKSwarmHandoffTask({...input,signal:input.signal?AbortSignal.any([input.signal,testAbort.signal]):testAbort.signal}),submitResult:input=>submitKSwarmRuntimeResultToBroker({brokerUrl,participantId:'xiaok-desktop',logicalParticipantId:input.targetParticipantId || 'xiaok-worker',projectId:input.projectId,taskId:input.taskId,runId:input.runId,result:input.result})}),
    handleAssignPo:(input:any)=>services!.runKSwarmAssignPo(input),handleReviewSubmission:(input:any)=>services!.runKSwarmReviewSubmission(input),handlePlanApproved:(input:any)=>services!.runKSwarmPlanApproved(input),handleReadinessProbe:(input:any)=>services!.runKSwarmReadinessProbe(input)};
   desktopBridge=createKSwarmRuntimeBridgeBrokerClient({kswarmService:gateway,brokerUrl,participantId:'xiaok-desktop',participantKind:'service',alias:'Main test',roles:['desktop_runtime_host'],capabilities:['planning','review','writing','reporting'],bridge:runtime,WebSocketImpl:WebSocket as any});await desktopBridge.start();
  }
  const actor={requestSource:'user' as const,actorId:'desktop-user:'+scope.profileId};
  const wire={action:'submit_new' as const,gestureId:'123e4567-e89b-42d3-a456-426614174000',input:{kind:'materials' as const,prompt:startPolicy==='plan_only'?'创建一个项目，只做计划，交付完整报告':'创建一个项目，交付完整报告',materials:[]}};
  const submissions=await Promise.all(Array.from({length:100},()=>services!.submitUserTask(wire,actor)));const task=submissions[0];expect(new Set(submissions.map(value=>value.taskId)).size).toBe(1);
  const deadline=Date.now()+25000;let detail:any,state:any;
  for(;;){
   const list=await (await fetch(base+'/projects')).json();
   if(list.projects.length){detail=await (await fetch(base+'/projects/'+list.projects[0].id)).json();state=await (await fetch(base+'/projects/'+detail.project.id+'/initial-plan-inputs',{headers})).json();}
   const jobFile=join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json');
   const observedJob=existsSync(jobFile)?JSON.parse(readFileSync(jobFile,'utf8')).jobs[0]:undefined;
   const expectedJob=fault==='reader_after_commit'?observedJob?.status==='pending'&&observedJob.lastError==='fixture_next_start_read_denied':observedJob?.status==='succeeded';
   if(state?.commitReceipt?.outcome==='applied' && expectedJob
     && (await services.recoverTask(task.taskId)).snapshot.status==='completed')break;
   if(Date.now()>deadline)throw Error('initial plan not committed: '+JSON.stringify({detail,state,poRuns,journal:existsSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'))?readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8'):null,task:(await services.recoverTask(task.taskId)).snapshot})+'\n'+diagnostics);
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  if(fault==='reader_after_commit'){
   for(;;){const journal=JSON.parse(readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8'));if(journal.jobs[0].status!=='running')break;if(Date.now()>deadline)throw Error('bootstrap post-commit did not settle');await new Promise(resolve=>setTimeout(resolve,10));}
   expect(commitAcknowledged).toBe(true);expect(activationPosts).toBe(0);expect(poRuns).toBe(1);
   const persisted=await (await fetch(base+'/projects/'+detail.project.id+'/initial-plan-inputs',{headers})).json();expect(persisted.commitReceipt.outcome).toBe('applied');
   const current=await (await fetch(base+'/projects/'+detail.project.id)).json();expect(current.project.status).toBe('planning');expect(current.tasks).toHaveLength(1);return;
  }
  expect(projectPosts).toBe(1);expect(poRuns).toBe(1);expect(detail.tasks).toHaveLength(1);expect(detail.project.status).toBe(startPolicy==='plan_only'?'planning':'active');expect(detail.project.requestedStartPolicy).toBe(startPolicy);
  if(startPolicy!=='plan_only'){
   for(;;){detail=await (await fetch(base+'/projects/'+detail.project.id)).json();if(detail.tasks[0]?.status==='done')break;if(Date.now()>deadline)throw Error('automatic worker did not finish: '+JSON.stringify(detail)+'\n'+diagnostics);await new Promise(resolve=>setTimeout(resolve,25));}
   expect(nativeWriteInputPath).not.toBe('');expect(existsSync(nativeWriteInputPath),JSON.stringify({nativeWriteInputPath,result:detail.tasks[0].result})).toBe(true);
   await desktopBridge?.stop();desktopBridge=undefined;
  }
  // Actual production Broker source HTTP -> authenticated KSwarm context HTTP
  // -> original Main source root/journal. No source/owner metadata doubles.
  const primaryRoomId=detail.project.primaryRoomId;expect(typeof primaryRoomId).toBe('string');
  const message=await rooms.sendRoomMessage({roomId:primaryRoomId,text:'Create an independent followup report from this original Room message',contextScope:{kind:'project',projectId:detail.project.id},idempotencyKey:'followup-source:'+startPolicy,responsePolicy:'none'});
  const nativeSourceClient=createCollaborationRoomBrokerClient({token:'room-user',fetchImpl:((input,init)=>{
   const url=new URL(String(input));expect(url.origin).toBe('http://127.0.0.1:4318');roomSourceReads++;return fetch(brokerUrl+url.pathname,init);
  }) as typeof fetch});
  services.bindRoomConversionBroker(nativeSourceClient);
  const currentContext=await (await fetch(base+'/projects/'+detail.project.id+'/followup-context',{headers})).json();expect(currentContext.ok).toBe(true);
  roomCaptureWire={action:'add_task',roomId:primaryRoomId,messageId:message.message.messageId,projectId:detail.project.id,expectedProjectRevision:currentContext.projectRevision,title:'Independent followup report'};
  const captures=await Promise.all(Array.from({length:100},()=>services!.captureRoomConversion(roomCaptureWire,actor,()=>{})));roomCapture=captures[0];
  expect(new Set(captures.map(value=>value.capture.captureId)).size).toBe(1);expect(roomCapture.execution).toEqual({state:'blocked',reasonCode:'CANDIDATE_WORKSPACE_UNAVAILABLE'});
  expect(JSON.stringify(roomCapture)).not.toContain('original Room message');expect(poRuns).toBe(1);
  expect((await (await fetch(base+'/projects/'+detail.project.id)).json()).tasks).toHaveLength(1);
  console.log(JSON.stringify({test:'real-room-capture-source-chain',startPolicy,observations:captures.length,brokerSourceReads:roomSourceReads,canonicalCaptureId:roomCapture.capture.captureId,businessTasksCreated:0,additionalPlanRuns:0}));
  // Contract-only transport: actual Main original capture -> real B HTTP.
  // Test holds the isolated machine credential; production capture still sends
  // NO B mutation and no fresh execution-intent/native qualification is claimed.
  for(const brief of ['b'.repeat(65536),'\0'.repeat(60000)]){
   const original=await rooms.sendRoomMessage({roomId:primaryRoomId,text:'Original body for maximum brief contract',contextScope:{kind:'project',projectId:detail.project.id},idempotencyKey:'max-source:'+startPolicy+':'+brief.length,responsePolicy:'none'});
   const captured=await services.captureRoomConversion({action:'add_task',roomId:primaryRoomId,messageId:original.message.messageId,projectId:detail.project.id,expectedProjectRevision:currentContext.projectRevision,brief},actor,()=>{});
   const record=JSON.parse(readFileSync(join(dataRoot,'conversation-projects','user-submissions','room-'+captured.capture.captureId.split(':')[1]+'.json'),'utf8'));
   const {roomId:_room,messageId:_message,projectId:_project,...frozen}=record.payload.input;
   const ordinaryInput={...frozen,sourceMessageId:record.identity.canonicalMessageId,body:record.payload.input.brief};
   const ordinarySource={...record.identity,schemaVersion:3,inputDigest:protocolDigest(['ordinary-input-envelope-v1',detail.project.id,ordinaryInput]),promptSha256:createHash('sha256').update(ordinaryInput.body).digest('hex'),permissionMode:'default'};
   const transportBody=JSON.stringify({source:ordinarySource,input:ordinaryInput});expect(Buffer.byteLength(transportBody,'utf8')).toBeGreaterThan(131072);expect(Buffer.byteLength(transportBody,'utf8')).toBeLessThan(1048576);
   const response=await fetch(base+'/projects/'+detail.project.id+'/ordinary-inputs',{method:'POST',headers:{...headers,'content-type':'application/json','x-kswarm-source-contract':'main_room_conversion_v1'},body:transportBody});
   expect(response.status).toBe(409);expect((await response.json()).error).toBe('CANDIDATE_WORKSPACE_UNAVAILABLE');
   expect((await (await fetch(base+'/projects/'+detail.project.id)).json()).tasks).toHaveLength(1);expect(poRuns).toBe(1);
   console.log(JSON.stringify({test:'actual-main-capture-room-source-v3-http-boundary',startPolicy,briefBytes:Buffer.byteLength(brief,'utf8'),requestBytes:Buffer.byteLength(transportBody,'utf8'),metadataContractOnly:true,executionQualified:false}));
  }
  const journal=JSON.parse(readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8'));expect(journal.jobs).toHaveLength(1);
  expect(journal.jobs[0]).toMatchObject({ownerBinding:state.ownerBinding,modelAttempted:true,ownerClaimRequest:{planRunId:state.reservation.planRunId}});
  const firstRun=journal.jobs[0].planRunId;
  expect(await services.startProjectPlanning({projectId:detail.project.id,projectName:'stale UI title',goal:'stale UI goal',requirements:'',planningGuidance:'',poAgent:'untrusted-po',members:[],startPolicy:'plan_only'},'user')).toEqual({ok:true,status:'succeeded'});
  expect(poRuns).toBe(1);expect(JSON.parse(readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8')).jobs[0].payloadHash).toBe(journal.jobs[0].payloadHash);
  expect(await services.runKSwarmAssignPo({payload:{projectId:detail.project.id,poAgent:detail.project.poAgent,members:detail.project.members,goal:detail.project.goal}})).toMatchObject({ok:false,error:'INITIAL_PLAN_MAIN_RECOVERY_REQUIRED'});
  expect(poRuns).toBe(1);expect((await (await fetch(base+'/projects/'+detail.project.id)).json()).tasks).toHaveLength(1);
  services.goalShutdown.ingress.stopAccepting();expect(await services.goalShutdown.ingress.drain(5000)).toBe(true);
  await services.closeTaskSourceWritersForMigration();await services.disposeMultiAgent();services=undefined;
  services=createServices();await services.multiAgent?.ready;await new Promise(resolve=>setTimeout(resolve,150));
  expect(await services.submitUserTask({action:'retry_existing',submissionId:task.submissionId},actor)).toEqual(task);
  expect(poRuns).toBe(1);expect(projectPosts).toBe(1);
  const sourceReadsBeforeHistory=roomSourceReads;
  // This recreated Main root has no source client binding: a lost ACK replay
  // is own historical metadata, independent of live source availability.
  expect(await services.captureRoomConversion(roomCaptureWire,actor,()=>{})).toEqual(roomCapture);expect(roomSourceReads).toBe(sourceReadsBeforeHistory);
  const restored=JSON.parse(readFileSync(join(dataRoot,'kswarm-initial-plan-bootstrap-jobs.json'),'utf8'));expect(restored.jobs).toHaveLength(1);expect(restored.jobs[0].planRunId).toBe(firstRun);
  const after=await (await fetch(base+'/projects/'+detail.project.id)).json();expect(after.tasks).toHaveLength(1);
 }catch(error){primaryFailure={error};console.error('DEFAULT_MAIN_FAILURE',String(error),diagnostics);throw error;}finally{
  const cleanupFailures:unknown[]=[];
  const cleanup=async(work:()=>unknown|Promise<unknown>)=>{try{await work();}catch(error){cleanupFailures.push(error);}};
  await cleanup(()=>{testAbort.abort(new Error('fixture_cleanup'));services?.kswarmBootstrapShutdown.stopAccepting();services?.kswarmBootstrapShutdown.abortAllActive('fixture_cleanup');});
  await cleanup(()=>desktopBridge?.stop());
  await cleanup(async()=>{const result=await services?.disposeMultiAgent();if(result)console.log(JSON.stringify({test:'default-create-main-task-disposal',drained:result.drained,scope:'ordinary-business-fixture-not-Native-qualification'}));});
  await cleanup(()=>sealAndDrainKSwarmServiceInstance(gateway));
  stream.mockRestore();
  await cleanup(async()=>{const killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},2000);try{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await close;}finally{clearTimeout(killTimer);}});
  await cleanup(async()=>{const socketDeadline=Date.now()+2000;while(broker.getWebSocketNotifier().listConnections().length){if(Date.now()>socketDeadline)throw Error('fixture_broker_sockets_not_closed');await new Promise(resolve=>setTimeout(resolve,5));}});
  // This notifier belongs to this isolated fixture server only.
  await cleanup(()=>broker.getWebSocketNotifier().close());
  await cleanup(()=>server.close());await cleanup(()=>broker.close());
  for(const [key,value] of [['XIAOK_CONFIG_DIR',previous.config],['XIAOK_DISABLE_GLOBAL_PLUGINS',previous.plugins],['XIAOK_CONVERSATION_ACTIVITY',previous.activity],['KSWARM_SERVER_PATH',previous.entry]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  globalThis.fetch=previous.fetch;
  if(cleanupFailures.length){console.error(JSON.stringify({test:'default-create-fixture-retained',root,cleanupFailures:cleanupFailures.length}));throw new AggregateError([...(primaryFailure?[primaryFailure.error]:[]),...cleanupFailures],'default_create_fixture_cleanup_unconfirmed',{cause:primaryFailure?.error});}
  rmSync(root,{recursive:true,force:true});
 }
}
it.each(['plan_only','activate_and_dispatch_after_plan'] as const)('the real default create_project entry keeps one Main run across restart with policy %s',async startPolicy=>runDefaultMainCase(startPolicy),40000);
it('keeps the actual committed plan when the next activation reader is denied',async()=>runDefaultMainCase('activate_and_dispatch_after_plan','reader_after_commit'),40000);
