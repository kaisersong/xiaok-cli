// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopMultiAgentService,type DesktopAgentExecutionContext,type DesktopMultiAgentServiceOptions} from '../../electron/desktop-multi-agent-service.js';
import {DesktopMultiAgentApprovalTransport} from '../../electron/desktop-multi-agent-approval-transport.js';
import {DesktopCapabilityCatalog} from '../../electron/desktop-multi-agent-capabilities.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {registerDesktopMultiAgentIpc} from '../../electron/desktop-multi-agent-ipc.js';
import {DesktopShutdownGate,ShutdownAwareIpcMain} from '../../electron/shutdown-aware-ipc-main.js';
import {resetIpcSchemaRegistryForTests} from '../../electron/ipc-runtime.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {mcpTestContext} from '../../../tests/support/mcp-cancellation-context.js';

function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const action of cleanup.splice(0).reverse())await action();resetIpcSchemaRegistryForTests();});

// Only model/session work is a bounded leaf. Store, actor admission, root Host,
// catalog approval, operation writers and the registered IPC listeners are real.
async function liveFixture(createSession:DesktopMultiAgentServiceOptions['createSession']=async()=>{throw Error('unexpected child session');}) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'multi-ipc-producer-')));
 const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));
 const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession,
   executionDomain:{profileId:'profile',workspaceId:'workspace',actorId:'real-user',cwd:root}});
 service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
 const entered=deferred<DesktopAgentExecutionContext>(),release=deferred<void>();
 const snapshots=new FileTaskSnapshotStore(join(root,'tasks'));
 const host=new InProcessTaskRuntimeHost({snapshotStore:snapshots,
   materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024*1024}),
   authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),
   assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),
   decideCancellation:(snapshot,reason)=>service.decideHostCancellation(snapshot,reason),
   runner:input=>service.runRoot(input,async context=>{entered.resolve(context);context.signal.addEventListener('abort',()=>release.resolve(),{once:true});await release.promise;})});
 await service.initialize(host);
 const prepared=await service.prepareRoot(host,'thread',{prompt:'Actual IPC producer root.',materials:[]});
 await host.startTask(prepared.taskId);const context=await entered.promise;
 const mainFrame={url:'file:///actual-producer/index.html'};
 const sender=Object.assign(new EventEmitter(),{id:17,mainFrame,isDestroyed:()=>false,send:(_channel:string,_value:unknown)=>{}});
 const event={sender,senderFrame:mainFrame},handlers=new Map<string,Function>();
 const gate=new DesktopShutdownGate();
 const dispose=registerDesktopMultiAgentIpc(new ShutdownAwareIpcMain({handle:(channel,handler)=>handlers.set(channel,handler)},gate) as never,
   {service,ready:Promise.resolve(),profileId:'profile',workspaceId:'workspace',cwd:root},
   {authorize:candidate=>candidate.sender===sender&&candidate.senderFrame===mainFrame?{actorId:'real-user'}:null});
 cleanup.push(async()=>{dispose();await host.cancelTask(prepared.taskId);release.resolve();await host.drain();await service.dispose();store.close();rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const invoke=(key:string,input:Record<string,unknown>)=>Promise.resolve(handlers.get(`desktop:${key}`)!(event,input));
 const groupInput={threadId:'thread',groupId:context.groupId};
 return {root,store,service,host,context,invoke,groupInput,releaseRoot:()=>release.resolve()};
}

it.each(['approve','deny'] as const)('registered IPC consumes a real pending approval and %s decision once',async decision=>{
 const f=await liveFixture(),transport=new DesktopMultiAgentApprovalTransport({store:f.store,service:f.service});
 const catalog=new DesktopCapabilityCatalog(),destination=join(f.root,'actual-tool-effect.txt');let effects=0;
 const descriptor=catalog.publish({requestSource:'scheduler',ownerId:'actual-tool-owner',entry:{
   definition:{name:'write',description:'bounded actual file effect',inputSchema:{type:'object',properties:{}}},aliases:[],permission:'write',
   scope:{workspaceId:'workspace',materialIds:[],permissions:['write']},bindInvocation:()=>async input=>{effects++;writeFileSync(destination,String(input.content));return 'actual file written';}}});
 catalog.authorize({requestSource:'user',capabilityId:descriptor.capabilityId});
 const scoped=catalog.createScopedRegistry(catalog.snapshotPolicy(),{...f.context,workspaceId:'workspace',materialIds:[],deadlineAt:f.context.effectiveDeadline,
   assertCurrent:()=>f.service.assertInvocation(f.context.actor,f.context),getApprovalDeadline:()=>f.service.getApprovalDeadline(f.context.actor),
   requestApproval:invocation=>transport.requestApproval({context:f.context,invocation})},{autoMode:false});
 cleanup.push(async()=>{await transport.dispose();scoped.dispose();});
 const input={content:'ACTUAL_PRIVATE_TOOL_INPUT'},running=scoped.registry.executeTool('write',input,mcpTestContext(f.context.signal));
 await vi.waitFor(()=>expect(transport.getGroupProjection(f.context.groupId).pendingApprovals).toHaveLength(1));
 const pending=transport.getGroupProjection(f.context.groupId).pendingApprovals[0]!;
 const before=f.store.getThread('thread')!;
 const view=await f.invoke('getMultiAgentApproval',{...f.groupInput,approvalId:pending.approvalId,inputOffset:0});
 expect(view).toMatchObject({approvalId:pending.approvalId,status:'pending',persistenceState:'confirmed',canDecide:true});
 expect(JSON.stringify(f.store.getOperation(f.context.groupId,`approval-request:${pending.approvalId}`))).not.toContain(input.content);
 const payload={...f.groupInput,approvalId:pending.approvalId,operationId:'actual-approval-decision',decision};
 const result=await f.invoke('decideMultiAgentApproval',payload);await running;
 expect(result).toMatchObject({operationId:payload.operationId,state:'applied',groupId:f.context.groupId,targetAgentId:f.context.agentId,expectedTurn:f.context.turn});
 expect(effects).toBe(decision==='approve'?1:0);expect(existsSync(destination)).toBe(decision==='approve');
 if(decision==='approve')expect(readFileSync(destination,'utf8')).toBe(input.content);
 expect(f.store.getThread('thread')).toMatchObject({pendingApprovalCount:0,threadRevision:before.threadRevision!+1});
 const events=f.store.readEvents(f.context.groupId).filter(row=>row.kind==='approval');expect(events).toHaveLength(2);
 expect(await f.invoke('decideMultiAgentApproval',payload)).toEqual(result);
 expect(f.store.readEvents(f.context.groupId).filter(row=>row.kind==='approval')).toEqual(events);
 expect(effects).toBe(decision==='approve'?1:0);
 const terminal=await f.invoke('getMultiAgentApproval',{...f.groupInput,approvalId:pending.approvalId,inputOffset:0});
 expect(terminal).toMatchObject({approvalId:pending.approvalId,canDecide:false});
});

it('registered root message produces an actual durable message and idempotent operation DTO',async()=>{
 const f=await liveFixture();const payload={...f.groupInput,agentId:f.context.agentId,expectedTurn:f.context.turn,operationId:'actual-root-message',message:'actual user-to-root text'};
 const result=await f.invoke('sendAgentMessage',payload);
 expect(result).toMatchObject({operationId:payload.operationId,state:'applied',targetAgentId:f.context.agentId});
 expect(f.store.getOperation(f.context.groupId,payload.operationId)).toMatchObject({applyState:'applied',command:'send',result});
 expect(await f.invoke('sendAgentMessage',payload)).toEqual(result);
 const operation=await f.invoke('getMultiAgentOperation',{...f.groupInput,operationId:payload.operationId});
 expect(operation).toMatchObject({operationId:payload.operationId,applyState:'applied',result});
 const snapshot=await f.invoke('getMultiAgentSnapshot',f.groupInput);expect(snapshot).toMatchObject({group:{groupId:f.context.groupId},root:{id:f.context.agentId}});
});

it('registered controls follow up and physically close a real settled child',async()=>{
 const runs:Array<{message:string;turn:number}>=[];let disposed=0;
 const f=await liveFixture(async input=>({run:async message=>{runs.push({message,turn:input.getTurnContext().turn});return `actual child result: ${message}`;},suspend:async()=>{},dispose:async()=>{disposed++;}}));
 const spawned=await f.service.spawn({actor:f.context.actor,requestSource:'agent',operationId:'actual-child-spawn',taskName:'child',message:'first actual work'});
 const childId=spawned.targetAgentId!;
 await vi.waitFor(()=>expect(f.store.getAgent(f.context.groupId,childId)).toMatchObject({status:'completed',executionActive:false}));
 const child=f.store.getAgent(f.context.groupId,childId)!;
 const followup={...f.groupInput,agentId:childId,expectedTurn:child.turn,operationId:'actual-child-followup',message:'second actual work'};
 expect(await f.invoke('followupAgent',followup)).toMatchObject({operationId:followup.operationId,state:'queued_next_admission',targetAgentId:childId,expectedTurn:child.turn+1});
 // User followup requires a new real admission epoch; the old root must settle
 // before the coordinator can grant that epoch. Do not mutate a lease/agent row.
 f.releaseRoot();
 await vi.waitFor(()=>expect(runs.map(row=>row.message)).toEqual(['first actual work','second actual work']));
 await vi.waitFor(()=>expect(f.store.getAgent(f.context.groupId,childId)).toMatchObject({status:'completed',executionActive:false,turn:child.turn+1}));
 const close={...f.groupInput,agentId:childId,expectedTurn:child.turn+1,operationId:'actual-child-close'};
 const receipt=await f.invoke('closeAgent',close);expect(receipt).toMatchObject({operationId:close.operationId,targetAgentId:childId});
 await vi.waitFor(()=>expect(f.store.getAgent(f.context.groupId,childId)).toMatchObject({status:'closed',resourcesReleased:true}));
 expect(disposed).toBe(1);
 const settledReceipt=await f.invoke('closeAgent',close);
 expect(settledReceipt).toMatchObject({operationId:close.operationId,targetAgentId:childId,state:'completed',resourcesReleased:true,cleanupPending:false});
 expect(f.store.getOperation(f.context.groupId,close.operationId)?.result).toEqual(settledReceipt);
 expect(disposed).toBe(1);
});

it('registered interrupt durably owns a real active child until its native session settles',async()=>{
 const entered=deferred<void>(),settled=deferred<string>();let disposed=0;
 const f=await liveFixture(async()=>({run:async(_message,signal)=>{entered.resolve();signal?.addEventListener('abort',()=>settled.resolve('physically settled after abort'),{once:true});return settled.promise;},suspend:async()=>{},dispose:async()=>{disposed++;}}));
 const spawned=await f.service.spawn({actor:f.context.actor,requestSource:'agent',operationId:'active-child-spawn',taskName:'active_child',message:'bounded real session work'});await entered.promise;
 const childId=spawned.targetAgentId!,child=f.store.getAgent(f.context.groupId,childId)!;
 const payload={...f.groupInput,agentId:childId,expectedTurn:child.turn,operationId:'actual-child-interrupt'};
 expect(await f.invoke('interruptAgent',payload)).toMatchObject({operationId:payload.operationId,state:'applied',targetAgentId:childId});
 await vi.waitFor(()=>expect(f.store.getAgent(f.context.groupId,childId)?.executionActive).toBe(false));
 const close={...payload,operationId:'close-after-physical-interrupt'};await f.invoke('closeAgent',close);
 await vi.waitFor(()=>expect(f.store.getAgent(f.context.groupId,childId)?.resourcesReleased).toBe(true));expect(disposed).toBe(1);
});
