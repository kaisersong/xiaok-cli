// @vitest-environment node
import {afterEach,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createKSwarmRuntimeBridge,createKSwarmRuntimeBridgeBrokerClient} from '../../electron/kswarm-runtime-bridge.js';
import {sealAndDrainKSwarmServiceInstance} from '../../electron/kswarm-service.js';
import {openOwnedWorkflowNormalCase} from '../support/owned-workflow-normal-case.js';
import {holdOriginalExecutionReadFault,assertOriginalExecutionReadFailure,assertOriginalStopFailure} from '../support/transport-start-http-fault.js';
const cleanup:Array<()=>Promise<void>|void>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function original(){const owned=await openOwnedWorkflowNormalCase({project:{id:'p',name:'Transport ordinary',goal:'Read state'},workflowName:'transport_fixture',phaseTitle:'Read',prompt:'Read state',label:'Read'});cleanup.push(()=>owned.close());return owned.kswarmService;}
function handoff(){const root=mkdtempSync(join(tmpdir(),'transport-start-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));const handoffPath=join(root,'handoff.json');writeFileSync(handoffPath,JSON.stringify({kind:'kswarm_task_handoff_v1',runId:'run',project:{id:'p'},task:{id:'p__t'},workspaceContext:{protocolVersion:1,claimId:'c'}}));return{handoffPath,projectId:'p',taskId:'p__t',runId:'run'};}
function event(){return JSON.stringify({type:'new_intent',event:{kind:'request_task',fromParticipantId:'kswarm-hub',taskId:'p__t',payload:{projectId:'p',taskId:'p__t',runId:'run',handoffPath:'/owned/handoff.json',targetAgentId:'xiaok-worker'}}});}
it('denies a direct physical bridge handoff without the original reader before started or workspace execution',async()=>{
 const input=handoff(),started=vi.fn(async()=>{}),runWorkspaceTask=vi.fn(async()=>({ok:true as const}));
 const bridge=createKSwarmRuntimeBridge({runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkspaceTask});
 let failure:unknown,result:unknown;try{result=await bridge.handleTaskHandoff({...input,onExecutionStarted:started});}catch(error){failure=error;}
 expect(started).not.toHaveBeenCalled();expect(runWorkspaceTask).not.toHaveBeenCalled();expect(failure??result).toBeDefined();
});
it('rechecks the original bridge receipt after started reporting before a Room runtime can obtain a fresh reader',async()=>{
 const manager=await original(),input=handoff(),runWorkspaceTask=vi.fn(async()=>({ok:true as const}));
 const bridge=createKSwarmRuntimeBridge({kswarmService:manager,runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkspaceTask} as any);
 try{await bridge.handleTaskHandoff({...input,onExecutionStarted:()=>sealAndDrainKSwarmServiceInstance(manager)});}catch{}
 expect(runWorkspaceTask).not.toHaveBeenCalled();
});
it('denies broker task admission without an original reader before accept, progress, heartbeat or handler',async()=>{
 const posts:any[]=[],handled=vi.fn(async()=>({ok:true as const}));
 const client=createKSwarmRuntimeBridgeBrokerClient({participantId:'desktop',taskHeartbeatIntervalMs:1,bridge:{handleTaskHandoff:handled},fetchImpl:(async(_url:any,init:any)=>{posts.push(JSON.parse(init.body));return Response.json({ok:true});}) as any});
 try{await client.handleSocketMessage(event()).catch(()=>{});expect(posts.filter(p=>['accept_task','report_progress'].includes(p.kind))).toEqual([]);expect(handled).not.toHaveBeenCalled();}finally{await client.stop();}
});
it('preserves an actual accept ACK but stops later progress and handler when its original reader is sealed during the accept POST',async()=>{
 const manager=await original(),posts:any[]=[],handled=vi.fn(async()=>({ok:true as const}));
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',taskHeartbeatIntervalMs:1,bridge:{reportsExecutionStart:true,handleTaskHandoff:handled},fetchImpl:(async(_url:any,init:any)=>{const p=JSON.parse(init.body);posts.push(p);if(p.kind==='accept_task')await sealAndDrainKSwarmServiceInstance(manager);return Response.json({ok:true});}) as any} as any);
 try{await client.handleSocketMessage(event()).catch(()=>{});expect(posts.filter(p=>p.kind==='accept_task')).toHaveLength(1);expect(posts.filter(p=>p.kind==='report_progress')).toEqual([]);expect(handled).not.toHaveBeenCalled();}finally{await client.stop();}
});
it.each(['ready_return','fallback_retry'] as const)('narrows the original service request inside its %s frame before actual HTTP',async boundary=>{
 const manager=await original(),receipt=await manager.readProjectExecutionStart('p');const previousFetch=globalThis.fetch;
 let calls=0,closing:Promise<void>|undefined;const sentinel=Error('original_request_source_revoked'),networkError=Error('actual_first_network_failure');
 const narrow=()=>{try{manager.assertProjectExecutionStartRead('p',receipt);}catch{throw sentinel;}};
 globalThis.fetch=async(input,init)=>{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(url.pathname==='/dsh-request-frame'){calls++;if(boundary==='fallback_retry'){closing=manager.stop();throw networkError;}}return previousFetch(input,init);};
 try{
   const operation=Reflect.apply(manager.request,manager,['/dsh-request-frame',undefined,narrow]);if(boundary==='ready_return')closing=manager.stop();
   let failure:unknown;try{await operation;}catch(error){failure=error;}
   expect(calls).toBe(boundary==='ready_return'?0:1);if(boundary==='ready_return')expect(failure).toBe(sentinel);else{expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).cause).toBe(sentinel);expect((failure as AggregateError).errors).toEqual([sentinel,networkError]);expect((failure as AggregateError).errors[0]).toBe(sentinel);expect((failure as AggregateError).errors[1]).toBe(networkError);}await closing;
 }finally{globalThis.fetch=previousFetch;await closing;}
});
it('keeps cancellation registered during the real pending reader and returns the original capacity for the next task',async()=>{
 const manager=await original(),previousFetch=globalThis.fetch,posts:any[]=[],handled=vi.fn(async()=>({ok:true as const}));
 let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);let first=true;
 globalThis.fetch=async(input,init)=>{const response=await previousFetch(input,init);const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(url.pathname.endsWith('/execution-start-admission')&&first){first=false;entered();await held;}return response;};
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',maxConcurrentTasks:1,taskHeartbeatIntervalMs:1,bridge:{handleTaskHandoff:handled},fetchImpl:(async(_url:any,init:any)=>{posts.push(JSON.parse(init.body));return Response.json({ok:true});}) as any} as any);
 let work:Promise<void>|undefined;
 try{
   work=client.handleSocketMessage(event());await ready;
   await client.handleSocketMessage(JSON.stringify({type:'new_intent',event:{kind:'cancel_task',taskId:'p__t',payload:{taskId:'p__t'}}}));release();await work;
   expect(posts.filter(p=>['accept_task','report_progress'].includes(p.kind))).toEqual([]);expect(handled).not.toHaveBeenCalled();
   await client.handleSocketMessage(event());expect(handled).toHaveBeenCalledTimes(1);expect(posts.filter(p=>p.kind==='accept_task')).toHaveLength(1);
 }finally{release();await work;await client.stop();globalThis.fetch=previousFetch;}
});
it('returns the original capacity and removes its timer/controller when the first accept HTTP request fails',async()=>{
 const manager=await original(),posts:any[]=[],handled=vi.fn(async()=>({ok:true as const}));let fail=true;
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',maxConcurrentTasks:1,taskHeartbeatIntervalMs:1,bridge:{handleTaskHandoff:handled},fetchImpl:(async(_url:any,init:any)=>{const p=JSON.parse(init.body);posts.push(p);if(p.kind==='accept_task'&&fail){fail=false;return Response.json({ok:false},{status:500});}return Response.json({ok:true});}) as any} as any);
 try{await client.handleSocketMessage(event()).catch(()=>{});await client.handleSocketMessage(event());expect(handled).toHaveBeenCalledTimes(1);expect(posts.some(p=>p.payload?.failureReason==='desktop_capacity_full')).toBe(false);}finally{await client.stop();}
});

it('publishes the direct cancellation owner before the original reader can synchronously reenter its lifecycle',async()=>{
 const manager=await original(),input=handoff(),runWorkspaceTask=vi.fn(async()=>({ok:true as const}));
 const bridge=createKSwarmRuntimeBridge({kswarmService:manager,runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkspaceTask});
 const previousFetch=globalThis.fetch;let observed=0;
 const spy=vi.spyOn(manager,'readProjectExecutionStart').mockImplementation(()=>{throw Error('public_reader_tamper_must_not_run');});
 globalThis.fetch=async(url,init)=>{const response=await previousFetch(url,init);const target=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);if(target.pathname==='/projects/p/execution-start-admission'){observed++;bridge.cancelTask(input.taskId);}return response;};
 try{await bridge.handleTaskHandoff(input).catch(()=>{});expect(observed).toBe(1);expect(spy).not.toHaveBeenCalled();expect(runWorkspaceTask).not.toHaveBeenCalled();}finally{globalThis.fetch=previousFetch;spy.mockRestore();}
});
it.each([{kind:'task',failureKind:'io'},{kind:'workflow',failureKind:'io'},{kind:'task',failureKind:'abort'},{kind:'workflow',failureKind:'abort'}])('keeps an original nested $kind reader $failureKind failure in the existing stop owner after failure reporting succeeds',async({kind,failureKind})=>{
 const manager=await original(),input=handoff(),posts:any[]=[],sentinel=failureKind==='abort'?new DOMException('actual_nested_reader_abort','AbortError'):Error('actual_nested_reader_failure');
 const runDesktopTask=vi.fn(),runWorkspaceTask=vi.fn(async()=>({ok:true as const})),submitResult=vi.fn(),runWorkflowNode=vi.fn(),submitWorkflowNodeResult=vi.fn();
 const bridge=createKSwarmRuntimeBridge({kswarmService:manager,runDesktopTask,runWorkspaceTask,submitResult,runWorkflowNode,submitWorkflowNodeResult});
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',bridge,fetchImpl:(async(_url:any,init:any)=>{posts.push(JSON.parse(init.body));return Response.json({ok:true});}) as any});
 const fault=holdOriginalExecutionReadFault(2,sentinel);
 const taskMessage={type:'new_intent',event:{kind:'request_task',fromParticipantId:'kswarm-hub',taskId:input.taskId,payload:input}};
 const workflowMessage={type:'new_intent',event:{kind:'workflow_node_handoff',fromParticipantId:'kswarm-hub',payload:{projectId:'p',workflowRunId:'wf',workflowId:'wf',nodeId:'n',nodeKind:'agent_task',attempt:1,handoffId:'h'}}};
 const work=client.handleSocketMessage(JSON.stringify(kind==='task'?taskMessage:workflowMessage)).then(()=>({ok:true}),error=>({error}));
 let stopped:Promise<unknown>|undefined;
 try{
   await fault.waitEntered(work);stopped=client.stop().then(()=>({ok:true}),error=>({error}));fault.release();const outcome=await work,result=await stopped;
   const sourceError=(outcome as {error:unknown}).error;
   assertOriginalExecutionReadFailure(sourceError,sentinel,fault);
   assertOriginalStopFailure((result as {error:unknown}).error,[sourceError]);
   for(const effect of [runDesktopTask,runWorkspaceTask,submitResult,runWorkflowNode,submitWorkflowNodeResult])expect(effect).not.toHaveBeenCalled();
   expect(posts.filter(p=>p.kind===(kind==='task'?'task_failed':'workflow_node_failed'))).toHaveLength(1);
 }finally{fault.release();await work;await stopped;fault.restore();}
});
it('does not create a new failed heartbeat owner after stop while the original handler is still draining',async()=>{
 const manager=await original();await manager.readProjectExecutionStart('p');let finish!:()=>void,entered!:()=>void,tick!:()=>void,afterStop=false;
 const held=new Promise<void>(r=>finish=r),ready=new Promise<void>(r=>entered=r),nextTick=new Promise<void>(r=>tick=r),posts:any[]=[];
 const nativeInterval=globalThis.setInterval;
 const intervalSpy=vi.spyOn(globalThis,'setInterval').mockImplementation(((callback:any,ms:number,...args:any[])=>nativeInterval((...values:any[])=>{Reflect.apply(callback,globalThis,values);if(afterStop)tick();},ms,...args)) as never);
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',taskHeartbeatIntervalMs:2,bridge:{handleTaskHandoff:async()=>{entered();await held;return{ok:true};}},fetchImpl:(async(_url:any,init:any)=>{posts.push(JSON.parse(init.body));return Response.json({ok:true});}) as any});
 const work=client.handleSocketMessage(event()).then(()=>({ok:true}),error=>({error}));let stopping:Promise<any>|undefined;
 try{await ready;const progress=posts.filter(p=>p.kind==='report_progress').length;afterStop=true;stopping=client.stop().then(()=>({ok:true}),error=>({error}));await nextTick;finish();await work;expect(await stopping).toEqual({ok:true});expect(posts.filter(p=>p.kind==='report_progress')).toHaveLength(progress);}finally{finish();await work;await stopping;intervalSpy.mockRestore();}
});
it.each([1,2])('preserves both workflow reader %s and failure-reporting errors in the same original stop owner',async failAt=>{
 const manager=await original(),source=Error('actual_workflow_reader_failed'),settlement=Error('actual_failure_post_failed');let failedPosts=0;
 const fault=holdOriginalExecutionReadFault(failAt,source);
 const bridge=createKSwarmRuntimeBridge({kswarmService:manager,runDesktopTask:vi.fn(),submitResult:vi.fn(),runWorkflowNode:vi.fn(),submitWorkflowNodeResult:vi.fn()});
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',bridge,fetchImpl:(async(_url:any,init:any)=>{if(JSON.parse(init.body).kind==='workflow_node_failed'){failedPosts++;throw settlement;}return Response.json({ok:true});}) as any});
 const message={type:'new_intent',event:{kind:'workflow_node_handoff',payload:{projectId:'p',workflowRunId:'wf',workflowId:'wf',nodeId:'n',attempt:1,handoffId:'h'}}};
 const work=client.handleSocketMessage(JSON.stringify(message)).then(()=>({ok:true}),error=>({error}));let stopping:Promise<any>|undefined;
 try{
   await fault.waitEntered(work);stopping=client.stop().then(()=>({ok:true}),error=>({error}));fault.release();const result=await work,closed=await stopping;
   const failure=(result as {error:AggregateError}).error;
   expect(failure).toBeInstanceOf(AggregateError);expect(failure.message).toBe('runtime_bridge_workflow_failure_settlement_failed');
   assertOriginalExecutionReadFailure(failure.cause,source,fault);
   expect(failure.errors).toEqual([failure.cause,settlement]);expect(failure.errors[0]).toBe(failure.cause);expect(failure.errors[1]).toBe(settlement);
   assertOriginalStopFailure(closed.error,[settlement,failure]);expect(failedPosts).toBe(1);
 }finally{fault.release();await work;await stopping;fault.restore();}
});

it('retains the actual workflow handoff file IO error after failure reporting succeeds during stop',async()=>{
 const manager=await original(),input=handoff(),missing=input.handoffPath+'.missing';let entered!:()=>void,release!:()=>void;
 const ready=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r),handled=vi.fn();
 const client=createKSwarmRuntimeBridgeBrokerClient({kswarmService:manager,participantId:'desktop',allowedRoots:[dirname(missing)],bridge:{handleTaskHandoff:vi.fn(),handleWorkflowNodeHandoff:handled},fetchImpl:(async(_url:any,init:any)=>{if(JSON.parse(init.body).kind==='workflow_node_failed'){entered();await held;}return Response.json({ok:true});}) as any});
 const work=client.handleSocketMessage(JSON.stringify({type:'new_intent',event:{kind:'workflow_node_handoff',payload:{projectId:'p',workflowRunId:'wf',workflowId:'wf',nodeId:'n',attempt:1,handoffId:'h',handoffPath:missing}}})).then(()=>({ok:true}),error=>({error}));let stopping:Promise<any>|undefined;
 try{await ready;stopping=client.stop().then(()=>({ok:true}),error=>({error}));release();const result=await work,closed=await stopping;expect((result as any).error).toMatchObject({code:'ENOENT',path:missing});const causes=(error:unknown):unknown[]=>error instanceof AggregateError?[error,...error.errors.flatMap(causes)]:[error];expect(causes(closed.error)).toContain((result as any).error);expect(handled).not.toHaveBeenCalled();}finally{release();await work;await stopping;}
});
