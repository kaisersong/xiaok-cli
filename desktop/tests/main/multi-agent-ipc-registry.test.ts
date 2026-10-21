// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { DesktopMultiAgentApprovalTransport } from '../../electron/desktop-multi-agent-approval-transport.js';
import { DesktopMultiAgentWorktrees } from '../../electron/desktop-multi-agent-worktrees.js';
import { encodeMultiAgentRow } from '../../../src/runtime/multi-agent/row-codec.js';
import { DesktopMultiAgentStore } from '../../electron/desktop-multi-agent-store.js';
import { DesktopMultiAgentService } from '../../electron/desktop-multi-agent-service.js';
import { DesktopExecutionCoordinator } from '../../electron/desktop-execution-coordinator.js';
import { registerDesktopMultiAgentIpc } from '../../electron/desktop-multi-agent-ipc.js';
import { IPC_SCHEMA_REGISTRY, registerIpcHandler, resetIpcSchemaRegistryForTests } from '../../electron/ipc-runtime.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain } from '../../electron/shutdown-aware-ipc-main.js';
import { createMultiAgentPreload } from '../../electron/desktop-multi-agent-preload.js';
import { InProcessTaskRuntimeHost } from '../../../src/runtime/task-host/task-runtime-host.js';
import { FileTaskSnapshotStore } from '../../../src/runtime/task-host/snapshot-store.js';
import { MaterialRegistry } from '../../../src/runtime/task-host/material-registry.js';
const keys = ['getMultiAgentSnapshot','getMultiAgentApproval','decideMultiAgentApproval','listMultiAgentGroups','listMultiAgents','getMultiAgentEvents','getAgentContent','getMultiAgentOperation','getMultiAgentResources','resolveMultiAgentResource','resetMultiAgentGroup','getMultiAgentThreadDeletion','deleteMultiAgentThread','sendAgentMessage','followupAgent','interruptAgent','closeAgent','subscribeMultiAgents','getLocalExecutionAuthorization','getLocalExecutionWorkspace','getLocalExecutionAuthorizationOperation','setLocalExecutionAuthorization','subscribeLocalExecutionAuthorization','unsubscribeLocalExecutionAuthorization','unsubscribeMultiAgents'] as const;
const workspace = new Set(['getLocalExecutionAuthorization','getLocalExecutionWorkspace','getLocalExecutionAuthorizationOperation','setLocalExecutionAuthorization','subscribeLocalExecutionAuthorization']);
const unsubscribe = new Set(['unsubscribeLocalExecutionAuthorization','unsubscribeMultiAgents']);
const extras: Record<string,string[]> = { decideMultiAgentApproval:['capability-token'],resolveMultiAgentResource:['fs-delete','external-process'],resetMultiAgentGroup:['fs-delete','exec','external-process'],deleteMultiAgentThread:['fs-delete','exec','external-process'],sendAgentMessage:['internal-mutation'],followupAgent:['exec','external-process','network'],interruptAgent:['exec','external-process'],closeAgent:['exec','external-process','fs-delete'],subscribeMultiAgents:['long-subscription'] };
const workspaceRisk: Record<string,string[]> = {getLocalExecutionWorkspace:['fs-read'],getLocalExecutionAuthorization:['fs-read'],getLocalExecutionAuthorizationOperation:['fs-read'],setLocalExecutionAuthorization:['fs-read','fs-write-userData','exec','external-process','capability-token'],subscribeLocalExecutionAuthorization:['fs-read','long-subscription']};
function payload(key: string, groupId = 'group'): Record<string,unknown> {
  const scope = { threadId:'thread', groupId };
  const control = { ...scope, agentId:'agent', operationId:'operation', expectedTurn:1 };
  if (unsubscribe.has(key)) return { subscriptionId:key === 'unsubscribeMultiAgents' ? 'subscribeMultiAgents' : 'subscribeLocalExecutionAuthorization' };
  if (key === 'subscribeLocalExecutionAuthorization') return { subscriptionId:key };
  if (key === 'getLocalExecutionWorkspace' || key === 'getLocalExecutionAuthorization') return {};
  if (key === 'getLocalExecutionAuthorizationOperation') return {operationId:'operation'};
  if (key === 'setLocalExecutionAuthorization') return {operationId:'operation',expectedPermissionRevision:0,executionAllowed:false,confirm:true};
  if (key === 'getMultiAgentApproval') return {...scope,approvalId:'approval',inputOffset:0};
  if (key === 'decideMultiAgentApproval') return {...scope,approvalId:'approval',operationId:'operation',decision:'deny'};
  if (key === 'listMultiAgentGroups' || key === 'getMultiAgentThreadDeletion') return {threadId:'thread'};
  if (key === 'getMultiAgentEvents') return {...scope,afterSeq:0,limit:100};
  if (key === 'getAgentContent') return {...scope,contentId:'content',offset:0};
  if (key === 'getMultiAgentOperation') return {...scope,operationId:'operation'};
  if (key === 'resolveMultiAgentResource') return {...scope,resourceId:'resource',action:'keep',operationId:'operation'};
  if (key === 'resetMultiAgentGroup') return {threadId:'thread',expectedGroupId:groupId,operationId:'operation',confirmTerminate:true};
  if (key === 'deleteMultiAgentThread') return {threadId:'thread',expectedThreadRevision:0,operationId:'operation',confirmTerminate:true};
  if (key === 'sendAgentMessage' || key === 'followupAgent') return {...control,message:'message'};
  if (key === 'interruptAgent' || key === 'closeAgent') return control;
  if (key === 'subscribeMultiAgents') return {...scope,subscriptionId:key,afterSeq:0};
  return scope;
}
const controlResult = {operationId:'operation',state:'completed',phase:'completed',actorId:'user',cancellationError:'legacy',resourceId:'resource',action:'keep'};
const cleanup: Array<() => void|Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for(const fn of cleanup.splice(0).reverse()) await fn(); resetIpcSchemaRegistryForTests(); });
async function fixture(ready: Promise<void> = Promise.resolve(), live = false) {
  const root=mkdtempSync(join(tmpdir(),'xiaok-multi-registry-')); cleanup.push(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));
  const store=new DesktopMultiAgentStore(join(root,'state.sqlite')); cleanup.push(()=>store.close());
  const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:vi.fn(),worktrees:new DesktopMultiAgentWorktrees({store}),executionDomain:{profileId:'profile',workspaceId:'workspace',actorId:'user',cwd:root}}); cleanup.push(()=>service.dispose());
  let entered!:(context:any)=>void,release!:()=>void;const contextPromise=new Promise<any>(resolve=>{entered=resolve;}),settled=new Promise<void>(resolve=>{release=resolve;});
  const host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1024}),...(live?{authorizePreparation:(taskId:string,marker:any)=>service.assertHostPreparation(taskId,marker),assertTaskAdmission:(snapshot:any)=>service.assertHostAdmission(snapshot),decideCancellation:(snapshot:any,reason:string)=>service.decideHostCancellation(snapshot,reason)}:{}),runner:live?input=>service.runRoot(input,async context=>{entered(context);context.signal.addEventListener('abort',release,{once:true});await settled;}):vi.fn()});
  await service.initialize(host); service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root}); const group=store.createGroup('thread');
  const mainFrame={url:'file:///fixture/index.html'}; let authorized=true;
  const transport=new EventEmitter(),sent:unknown[]=[];
  const sender=Object.assign(new EventEmitter(),{id:1,mainFrame,isDestroyed:()=>false,send:(channel:string,data:unknown)=>{sent.push(data);transport.emit(channel,{},data);}});
  const event={sender,senderFrame:mainFrame}; const handlers=new Map<string,Function>(); const gate=new DesktopShutdownGate();
  const authorize=vi.fn((candidate:any)=>authorized&&candidate.sender===sender&&candidate.senderFrame===mainFrame?{actorId:'user'}:null);
  const dispose=registerDesktopMultiAgentIpc(new ShutdownAwareIpcMain({handle:(channel,fn)=>handlers.set(channel,fn)},gate) as never,{service,ready,profileId:'profile',workspaceId:'workspace',cwd:root},{authorize}); cleanup.push(dispose);if(live)cleanup.push(release);
  const invoke=(key:string,input:unknown=payload(key,group.groupId),candidate:any=event)=>Promise.resolve().then(()=>handlers.get(`desktop:${key}`)!(candidate,input));
  return {root,store,service,group,host,contextPromise,sender,event,handlers,gate,authorize,dispose,invoke,sent,transport,revoke:()=>{authorized=false;}};
}
function mockActions(f: Awaited<ReturnType<typeof fixture>>) {
  const access=f.service.createUserAccess({requestSource:'user',actorId:'user',threadId:'thread',profileId:'profile',workspaceId:'workspace'});
  const snapshot=f.service.getSnapshot({access,groupId:f.group.groupId});
  const agent=snapshot.root!;
  const view={approvalId:'approval',threadId:'thread',groupId:f.group.groupId,bootId:f.store.bootId,agentId:'agent',turn:1,turnId:'turn',toolName:'tool',cwd:f.root,issuedAt:0,minDeadlineAt:1,inputSha256:'hash',inputByteLength:0,status:'pending',persistenceState:'confirmed',canDecide:true};
  const actions: Record<string,unknown> = {getApproval:view,decideApproval:controlResult,listGroups:{items:[f.group],nextCursor:null},readAgents:{items:[{...agent,executionHealth:'waiting',preparedReservation:true}],nextCursor:null},readEvents:{items:[],nextAfterSeq:0,headSeq:0,hasMore:false},readContent:{contentId:'content',base64:'',nextOffset:0,byteLength:0,sha256:'hash',truncated:false},readOperation:{groupId:f.group.groupId,operationId:'operation',requestHash:'hash',command:'tool_finished',applyState:'applied',result:{state:'completed',nested:[null,.5,{optional:undefined}]}},readResources:{items:[],nextCursor:null},resolveResource:controlResult,resetGroup:controlResult,readThreadDeletion:{threadId:'thread',threadRevision:0,deleteState:'none',operation:controlResult},deleteThread:controlResult,userSend:controlResult,userFollowup:controlResult,userInterrupt:controlResult,userClose:controlResult,getExecutionAuthorizationOperation:{kind:'not_found',authorization:f.service.getExecutionAuthorization()},setExecutionAuthorization:{operationId:'operation',state:'applied',permissionRevision:0,executionAllowed:false,persistenceState:'confirmed'}};
  for(const [method,value] of Object.entries(actions)) vi.spyOn(f.service as any,method).mockImplementation(()=>value);
  return snapshot;
}

describe('complete25 authorized MultiAgent registry',()=>{
  it('registers every original channel once with exact stage/source/risk metadata',async()=>{
    const f=await fixture(); const entries=[...IPC_SCHEMA_REGISTRY.values()].filter(x=>Number(x.rolloutRound)===5);
    expect(entries.map(x=>x.channel).sort()).toEqual(keys.map(x=>`desktop:${x}`).sort());
    for(const key of keys) expect(IPC_SCHEMA_REGISTRY.get(`desktop:${key}`)).toMatchObject({sourceFile:'desktop/electron/desktop-multi-agent-ipc.ts',payloadMode:'single',inputStage:unsubscribe.has(key)?'beforeHandler':'afterHostAuthorization',riskTags:unsubscribe.has(key)?['internal-mutation']:workspace.has(key)?workspaceRisk[key]:['fs-read','fs-write-userData',...(extras[key]??[])]});
    expect(f.handlers.size).toBe(25);
  });
  it.each(keys)('%s denies foreign sender before touching malformed/getter input',async key=>{
    const f=await fixture(); let reads=0; const input=new Proxy({},{ownKeys(){reads++;throw Error('input touched');}});
    await expect(f.invoke(key,input,{...f.event,senderFrame:{}})).rejects.toThrow('multi_agent_unauthorized_sender'); expect(reads).toBe(0);
  });
  it('preserves unsupported boundary priority over operation scalar/confirmation errors',async()=>{
    const handlers=new Map<string,Function>(); const frame={}; const sender={mainFrame:frame,isDestroyed:()=>false};
    registerDesktopMultiAgentIpc({handle:(key,fn)=>handlers.set(key,fn)},null,{authorize:()=>({actorId:'user'})});
    await expect(Promise.resolve().then(()=>handlers.get('desktop:resetMultiAgentGroup')!({sender,senderFrame:frame},{threadId:'thread',expectedGroupId:4,operationId:null,confirmTerminate:false}))).rejects.toThrow('multi_agent_unsupported_runner');
  });
  it('keeps shape and64KiB rejection before readiness and ownership',async()=>{
    const f=await fixture(); const owner=vi.spyOn(f.service,'registerThreadWithOwnership');
    await expect(f.invoke('getMultiAgentSnapshot',{threadId:'thread',actorId:'forged'})).rejects.toThrow('invalid multi-agent argument');
    await expect(f.invoke('getMultiAgentSnapshot',{threadId:'x'.repeat(65536)})).rejects.toThrow('multi_agent_wire_limit_exceeded'); expect(owner).not.toHaveBeenCalled();
  });
  it('does not create thread ownership after a revoked deferred ready barrier',async()=>{
    let release!:()=>void; const ready=new Promise<void>(resolve=>{release=resolve;}); const f=await fixture(ready);const owner=vi.spyOn(f.service,'registerThreadWithOwnership');
    const pending=f.invoke('getMultiAgentSnapshot');await Promise.resolve();f.revoke();release();await expect(pending).rejects.toThrow('multi_agent_unauthorized_sender');expect(owner).not.toHaveBeenCalled();
  });
  it('keeps foreign ownership rejection ahead of malformed operation confirmation',async()=>{
    const f=await fixture(); f.store.registerThread({threadId:'foreign',profileId:'other',workspaceId:'other',cwd:f.root});
    await expect(f.invoke('resetMultiAgentGroup',{threadId:'foreign',expectedGroupId:4,operationId:null,confirmTerminate:false})).rejects.toThrow(/ownership|domain/);
  });
  it.each(keys)('%s validates registry wiring with controlled service DTOs and preserves auth count',async key=>{
    const f=await fixture();mockActions(f);f.authorize.mockClear();const result=await f.invoke(key);expect(f.authorize).toHaveBeenCalledTimes(unsubscribe.has(key)?1:workspace.has(key)?3:4); const entry=IPC_SCHEMA_REGISTRY.get(`desktop:${key}`);expect(entry).toBeDefined();expect(entry!.output.safeParse(result).success).toBe(true);expect(entry!.output.safeParse({forged:true}).success).toBe(false);expect(f.gate.outstanding).toBe(0);
  });
  for(const mode of ['development','production']) it('rejects malformed DTO and clears only its owned subscription in '+mode,async()=>{
    vi.stubEnv('NODE_ENV',mode);const f=await fixture();await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'existing'});
    vi.spyOn(f.service,'getSnapshot').mockReturnValue({forged:true} as any);
    await expect(f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'bad'})).rejects.toThrow();
    f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'existing survives'}});
    expect(f.sent).toEqual([expect.objectContaining({subscriptionId:'existing'})]);
    await f.invoke('unsubscribeMultiAgents',{subscriptionId:'existing'});
  });
  it.each(keys)('%s accepts its actual service/store/approval producer DTO',async key=>{
    const f=await fixture(Promise.resolve(),true);const prepared=await f.service.prepareRoot(f.host,'thread',{prompt:'Bounded producer contract root.',materials:[]});await f.host.startTask(prepared.taskId);await f.contextPromise;
    const group=f.store.getThread('thread')!.activeGroupId!;const input=payload(key,group);const rootId=`root_${group}`;
    if(['sendAgentMessage','followupAgent','interruptAgent','closeAgent'].includes(key)){input.agentId='missing-target';input.expectedTurn=0;}
    if(key==='getAgentContent'){const content=f.store.putContent(group,rootId,'Actual native content');input.contentId=content.contentId;}
    if(key==='getMultiAgentApproval'||key==='decideMultiAgentApproval'){
      const transport=new DesktopMultiAgentApprovalTransport({store:f.store,service:f.service});cleanup.push(()=>transport.dispose());
      const approval={approvalId:'approval',bootId:f.store.bootId,profileId:'profile',workspaceId:'workspace',threadId:'thread',groupId:group,agentId:rootId,turn:0,turnId:'producer-turn',canonicalName:'write',toolName:'write',cwd:f.root,ownerId:'owner',slotId:'slot',capabilityId:'capability',revision:1,permissionRevision:0,invocationNonce:'nonce',inputSha256:createHash('sha256').update('{}').digest('hex'),inputByteLength:2,issuedAt:1,minDeadlineAt:600001,status:'invalidated',persistenceState:'confirmed',reason:'restart'};
      f.store.putOperation({groupId:group,operationId:'approval-request:approval',command:'approval_request',requestHash:'fixture-request',applyState:'applied',result:{approval}},true);
      if(key==='decideMultiAgentApproval')f.store.putOperation({groupId:group,operationId:'operation',command:'approval_decision',requestHash:createHash('sha256').update(encodeMultiAgentRow({actorId:'user',approvalId:'approval',decision:'deny'})).digest('hex'),applyState:'applied',result:{operationId:'operation',state:'applied',groupId:group,targetAgentId:rootId,expectedTurn:0}},true);
    }
    if(key==='resolveMultiAgentResource'){
      const root=f.store.getAgent(group,rootId)!;f.store.putAgent(group,{...root,executionActive:false},true);
      f.store.putResource({resourceId:'resource',groupId:group,agentId:rootId,ownerBootId:f.store.bootId,kind:'worktree',canonicalPath:join(f.root,'kept-resource'),allocationToken:'fixture-token',cleanupPolicy:'keep',cleanupEligibility:'manual',state:'retained_by_policy'},true);
    }
    if(key==='setLocalExecutionAuthorization')input.operationId=`exec-auth:${f.store.bootId}:0:producer`;
    if(key==='getLocalExecutionAuthorizationOperation')input.operationId=`exec-auth:${f.store.bootId}:0:producer`;
    if(key==='deleteMultiAgentThread'){input.expectedThreadRevision=f.store.getThread('thread')!.threadRevision!;input.operationId=`delete:${input.expectedThreadRevision}:producer`;}
    f.authorize.mockClear();const result=await f.invoke(key,input);expect(IPC_SCHEMA_REGISTRY.get(`desktop:${key}`)!.output.safeParse(result).success).toBe(true);expect(f.authorize).toHaveBeenCalledTimes(unsubscribe.has(key)?1:workspace.has(key)?3:4);
    if(key==='getMultiAgentEvents'){
      const sourceEvents=f.store.readEvents(group,0,100);
      expect(sourceEvents.some(event=>event.kind==='activity_run')).toBe(true);
      const page=result as {items:typeof sourceEvents};
      expect(page.items).toEqual(sourceEvents);
      expect(page.items.map(event=>({eventId:event.eventId,seq:event.seq,kind:event.kind,payload:event.payload}))).toEqual(sourceEvents.map(event=>({eventId:event.eventId,seq:event.seq,kind:event.kind,payload:event.payload})));
      const output=IPC_SCHEMA_REGISTRY.get('desktop:getMultiAgentEvents')!.output;
      expect(output.safeParse({...page,items:[{...sourceEvents[0]!,kind:'unknown_durable_kind'}]}).success).toBe(false);
    }
  });
  for(const [subscribeKey,unsubscribeKey,method] of [
    ['subscribeMultiAgents','unsubscribeMultiAgents','subscribe'],
    ['subscribeLocalExecutionAuthorization','unsubscribeLocalExecutionAuthorization','subscribeExecutionAuthorization'],
  ] as const) it(`${unsubscribeKey} releases its exact subscription and final viewer hooks when unsubscribe throws`,async()=>{
    const f=await fixture();const original=Error('unsubscribe failure');const real=(f.service[method] as any).bind(f.service);const stop=vi.fn();
    vi.spyOn(f.service,method).mockImplementation(((...args:any[])=>{const release=real(...args);return ()=>{release();stop();throw original;};}) as any);
    const input=subscribeKey==='subscribeMultiAgents'?{threadId:'thread',subscriptionId:'throwing'}:{subscriptionId:'throwing'};
    await f.invoke(subscribeKey,input);await expect(f.invoke(unsubscribeKey,{subscriptionId:'throwing'})).rejects.toBe(original);
    expect(stop).toHaveBeenCalledTimes(1);expect(f.sender.listenerCount('did-start-navigation')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);
    await expect(f.invoke(unsubscribeKey,{subscriptionId:'throwing'})).resolves.toEqual({unsubscribed:true});expect(stop).toHaveBeenCalledTimes(1);
  });
  it.each(['navigation','destroyed','dispose'])('cleans every owned subscription after unsubscribe failure during %s',async trigger=>{
    const f=await fixture();const original=Error('first cleanup');const real=f.service.subscribe.bind(f.service);const stop=vi.fn();let installed=0;
    vi.spyOn(f.service,'subscribe').mockImplementation((...args)=>{const release=real(...args);const n=installed++;return ()=>{release();stop(n);if(n===0)throw original;};});
    await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'first'});await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'second'});
    expect(()=>trigger==='dispose'?f.dispose():trigger==='destroyed'?f.sender.emit('destroyed'):f.sender.emit('did-start-navigation',{},'',false,true)).toThrow(original);
    expect(stop.mock.calls).toEqual([[0],[1]]);expect(f.sender.listenerCount('did-start-navigation')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);
    if(trigger!=='dispose')await expect(f.invoke('unsubscribeMultiAgents',{subscriptionId:'second'})).resolves.toEqual({unsubscribed:true});
  });
  it.each(['finalAuthorization','wireBudget'])('rolls back only the installed subscription on %s failure',async branch=>{
    const f=await fixture();await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'existing'});
    const real=f.service.subscribe.bind(f.service);const stop=vi.fn();vi.spyOn(f.service,'subscribe').mockImplementation((...args)=>{const release=real(...args);return ()=>{stop();release();};});
    const read=f.service.getSnapshot.bind(f.service);vi.spyOn(f.service,'getSnapshot').mockImplementation(input=>{
      const snapshot=read(input);if(branch==='finalAuthorization')f.revoke();else snapshot.runtimeError='x'.repeat(65536);return snapshot;
    });
    await expect(f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'bad'})).rejects.toThrow(branch==='finalAuthorization'?'multi_agent_unauthorized_sender':'multi_agent_wire_limit_exceeded');
    expect(stop).toHaveBeenCalledTimes(1);expect(f.sender.listenerCount('did-start-navigation')).toBe(1);expect(f.sender.listenerCount('destroyed')).toBe(1);
    if(branch==='wireBudget')await expect(f.invoke('unsubscribeMultiAgents',{subscriptionId:'bad'})).resolves.toEqual({unsubscribed:true});
    f.dispose();expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  for(const variant of ['typed','cjs']) it(`${variant} delivers real durable and authorization pushes then removes its preload listeners`,async()=>{
    const f=await fixture();const ipc={invoke:(channel:string,...args:unknown[])=>Promise.resolve().then(()=>f.handlers.get(channel)!(f.event,...args)),on:(channel:string,fn:any)=>f.transport.on(channel,fn),off:(channel:string,fn:any)=>f.transport.off(channel,fn)};
    let api:any=createMultiAgentPreload(ipc);
    if(variant==='cjs')runInNewContext(readFileSync(join(import.meta.dirname,'../../electron/preload.cjs'),'utf8'),{require:(name:string)=>name==='os'?{userInfo:()=>({username:'fixture'})}:{contextBridge:{exposeInMainWorld:(_name:unknown,value:any)=>{api=value;}},ipcRenderer:{...ipc,removeListener:ipc.off}}});
    const events=vi.fn(),authorizations=vi.fn();await api.subscribeMultiAgents({threadId:'thread',groupId:f.group.groupId,subscriptionId:'push'},events);await api.subscribeLocalExecutionAuthorization({subscriptionId:'authorization'},authorizations);
    f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'native push'}});
    expect(events).toHaveBeenCalledWith(expect.objectContaining({subscriptionId:'push',envelope:expect.objectContaining({channel:'durable',payload:{text:'native push'}})}));
    await api.setLocalExecutionAuthorization({operationId:`exec-auth:${f.store.bootId}:0:push`,expectedPermissionRevision:0,executionAllowed:false,confirm:true});
    expect(authorizations).toHaveBeenCalledWith(expect.objectContaining({subscriptionId:'authorization',authorization:expect.objectContaining({executionAllowed:false})}));
    await api.unsubscribeMultiAgents({subscriptionId:'push'});await api.unsubscribeLocalExecutionAuthorization({subscriptionId:'authorization'});
    expect(f.transport.listenerCount('desktop:multiAgentEvent')).toBe(0);expect(f.transport.listenerCount('desktop:localExecutionAuthorizationChanged')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);
    const count=events.mock.calls.length;f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'no listener'}});expect(events).toHaveBeenCalledTimes(count);
  });
  it('keeps a concurrent same-key replacement when the old snapshot fails after navigation',async()=>{
    const f=await fixture();const realSubscribe=f.service.subscribe.bind(f.service),read=f.service.getSnapshot.bind(f.service);const stops:ReturnType<typeof vi.fn>[]=[];
    vi.spyOn(f.service,'subscribe').mockImplementation((...args)=>{const release=realSubscribe(...args),stop=vi.fn(release);stops.push(stop);return stop;});
    let snapshots=0;vi.spyOn(f.service,'getSnapshot').mockImplementation(input=>{
      if(snapshots++===0){f.sender.emit('did-start-navigation',{},'file:///replacement',false,true);return {forged:true} as any;}return read(input);
    });
    const input={threadId:'thread',groupId:f.group.groupId,subscriptionId:'same'};const [old,replacement]=await Promise.allSettled([f.invoke('subscribeMultiAgents',input),f.invoke('subscribeMultiAgents',input)]);
    expect(old.status).toBe('rejected');expect(replacement.status).toBe('fulfilled');expect(stops).toHaveLength(2);expect(stops[0]).toHaveBeenCalledTimes(1);expect(stops[1]).not.toHaveBeenCalled();expect(f.sender.listenerCount('destroyed')).toBe(1);
    f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'replacement survives'}});expect(f.sent).toEqual([expect.objectContaining({subscriptionId:'same'})]);
    await f.invoke('unsubscribeMultiAgents',{subscriptionId:'same'});expect(stops[1]).toHaveBeenCalledTimes(1);expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  it('preserves the snapshot rejection and diagnoses exactly one failing owned cleanup',async()=>{
    const f=await fixture();const original=Error('snapshot rejection'),secondary=Error('cleanup rejection');const diagnostic=vi.spyOn(console,'error').mockImplementation(()=>{}),real=f.service.subscribe.bind(f.service),stop=vi.fn();
    vi.spyOn(f.service,'subscribe').mockImplementation((...args)=>{const release=real(...args);return ()=>{release();stop();throw secondary;};});vi.spyOn(f.service,'getSnapshot').mockImplementation(()=>{throw original;});
    await expect(f.invoke('subscribeMultiAgents')).rejects.toBe(original);expect(stop).toHaveBeenCalledTimes(1);expect(diagnostic).toHaveBeenCalledWith('[ipc] owned cleanup failed',expect.objectContaining({originalError:original,cleanupError:secondary}));expect(diagnostic).toHaveBeenCalledTimes(1);expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  it('releases the shared viewer lease when its previous subscription disappears during a failing new snapshot',async()=>{
    const f=await fixture();await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'existing'});const original=Error('new snapshot failure');
    vi.spyOn(f.service,'getSnapshot').mockImplementation(()=>{void f.handlers.get('desktop:unsubscribeMultiAgents')!(f.event,{subscriptionId:'existing'});throw original;});
    await expect(f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'new'})).rejects.toBe(original);expect(f.sender.listenerCount('did-start-navigation')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  it('continues viewer cleanup and reports later failures without replacing the first error',async()=>{
    const f=await fixture();const first=Error('first unsubscribe'),second=Error('second unsubscribe'),diagnostic=vi.spyOn(console,'error').mockImplementation(()=>{});let n=0;const real=f.service.subscribe.bind(f.service);
    vi.spyOn(f.service,'subscribe').mockImplementation((...args)=>{const release=real(...args),error=n++===0?first:second;return ()=>{release();throw error;};});
    await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'one'});await f.invoke('subscribeMultiAgents',{threadId:'thread',subscriptionId:'two'});
    expect(()=>f.sender.emit('destroyed')).toThrow(first);expect(diagnostic).toHaveBeenCalledWith('[multi-agent-ipc] viewer cleanup failed',second);expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  for(const variant of ['typed','cjs']) it(`${variant} cancels a real pending main subscription without a late push or listener leak`,async()=>{
    let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});const f=await fixture(ready);
    const ipc={invoke:(channel:string,...args:unknown[])=>Promise.resolve().then(()=>f.handlers.get(channel)!(f.event,...args.map(value=>structuredClone(value)))),on:(channel:string,fn:any)=>f.transport.on(channel,fn),off:(channel:string,fn:any)=>f.transport.off(channel,fn)};let api:any=createMultiAgentPreload(ipc);
    if(variant==='cjs')runInNewContext(readFileSync(join(import.meta.dirname,'../../electron/preload.cjs'),'utf8'),{require:(name:string)=>name==='os'?{userInfo:()=>({username:'fixture'})}:{contextBridge:{exposeInMainWorld:(_name:unknown,value:any)=>{api=value;}},ipcRenderer:{...ipc,removeListener:ipc.off}}});
    const events=vi.fn(),input={threadId:'thread',groupId:f.group.groupId,subscriptionId:'pending'};const subscription=api.subscribeMultiAgents(input,events);const rejected=expect(subscription).rejects.toThrow('multi-agent subscription cancelled');
    await Promise.resolve();await api.unsubscribeMultiAgents({subscriptionId:'pending'});release();await rejected;
    expect(f.transport.listenerCount('desktop:multiAgentEvent')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'late cancelled'}});expect(events).not.toHaveBeenCalled();
    await api.subscribeMultiAgents(input,events);f.store.appendEvent(f.group.groupId,{agentId:`root_${f.group.groupId}`,kind:'output',payload:{text:'fresh replacement'}});expect(events).toHaveBeenCalledTimes(1);await api.unsubscribeMultiAgents({subscriptionId:'pending'});expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  it('accepts the real cancelled reset replay phase without accepting arbitrary stage text',async()=>{
    const f=await fixture();vi.spyOn(f.service,'resetGroup').mockResolvedValue({...controlResult,phase:'cancelled',outcome:'cancelled',error:'permission_revoked'} as any);
    await expect(f.invoke('resetMultiAgentGroup')).resolves.toMatchObject({phase:'cancelled',outcome:'cancelled'});
    expect(IPC_SCHEMA_REGISTRY.get('desktop:resetMultiAgentGroup')!.output.safeParse({...controlResult,phase:'invented'}).success).toBe(false);
  });
  it('releases a newly created viewer lease when service subscription construction throws',async()=>{
    const f=await fixture();vi.spyOn(f.service,'subscribe').mockImplementation(()=>{throw Error('construction failed');});
    await expect(f.invoke('subscribeMultiAgents')).rejects.toThrow('construction failed');expect(f.sender.listenerCount('did-start-navigation')).toBe(0);expect(f.sender.listenerCount('destroyed')).toBe(0);
  });
  it('never executes DTO/input getters or proxies after authorization and never re-reads raw input',async()=>{
    const f=await fixture(); let inputReads=0;const input={};Object.defineProperty(input,'threadId',{enumerable:true,get(){inputReads++;return 'thread';}});
    await expect(f.invoke('getMultiAgentSnapshot',input)).rejects.toThrow();expect(inputReads).toBe(0);
    let outputReads=0;const output={};Object.defineProperty(output,'threadId',{enumerable:true,get(){outputReads++;return 'thread';}});vi.spyOn(f.service,'getSnapshot').mockReturnValue(output as any);
    await expect(f.invoke('getMultiAgentSnapshot')).rejects.toThrow();expect(outputReads).toBe(0);
  });
  it('keeps final authorization ahead of invalid output after deferred action',async()=>{
    const f=await fixture();let release!:(value:any)=>void;vi.spyOn(f.service,'getSnapshot').mockImplementation(()=>new Promise(resolve=>{release=resolve;}) as any);
    const pending=f.invoke('getMultiAgentSnapshot');while(!release)await Promise.resolve();f.revoke();release({forged:true});await expect(pending).rejects.toThrow('multi_agent_unauthorized_sender');
  });
  it('connects native snapshot and all25 typed/CJS consumer keys to actual registered listeners',async()=>{
    const f=await fixture();mockActions(f);const ipc={invoke:(channel:string,...args:unknown[])=>Promise.resolve().then(()=>f.handlers.get(channel)!(f.event,...args)),on:(channel:string,fn:any)=>f.transport.on(channel,fn),off:(channel:string,fn:any)=>f.transport.off(channel,fn)};
    const typed=createMultiAgentPreload(ipc); let cjs:any;
    runInNewContext(readFileSync(join(import.meta.dirname,'../../electron/preload.cjs'),'utf8'),{require:(name:string)=>name==='os'?{userInfo:()=>({username:'fixture'})}:{contextBridge:{exposeInMainWorld:(_name:unknown,api:any)=>{cjs=api;}},ipcRenderer:{...ipc,removeListener:ipc.off}}});
    for(const api of [typed,cjs])for(const key of keys){const input=payload(key,f.group.groupId);const result=await api[key](input,()=>{});if(unsubscribe.has(key))expect(result).toBeUndefined();else expect(IPC_SCHEMA_REGISTRY.get(`desktop:${key}`)!.output.safeParse(result).success).toBe(true);}
  });
});

describe('real registrar host stages and once owned failure diagnostics',()=>{
  it('keeps beforeInput ahead of parse, and default input adapters cannot swallow auth',async()=>{
    const original=Error('auth');const parse=vi.fn();let listener:any;
    registerIpcHandler({registrar:{handle:(_key:string,fn:any)=>{listener=fn;}},channel:'fixture:admission',input:z.preprocess(raw=>{parse();return raw;},z.string()),output:z.string(),sourceFile:'test',rolloutRound:3,beforeInput:()=>{throw original;},inputError:()=> 'masked',handler:async()=> 'done'} as any);
    await expect(listener({},null)).rejects.toBe(original);expect(parse).not.toHaveBeenCalled();
  });
  it.each(['handler','beforeOutput','captureOutput','outputCheck','schema'])('runs failure once for%s and preserves original plus cleanup diagnostic identities',async branch=>{
    let listener:any;const original=Error('original'),secondary=Error('cleanup');const rollback=vi.fn(()=>{throw secondary;}),reporter=vi.fn();
    registerIpcHandler({registrar:{handle:(_key:string,fn:any)=>{listener=fn;}},channel:`fixture:failure:${branch}`,input:z.object({n:z.number()}),wireInput:z.object({n:z.number()}),inputStage:'afterHostAuthorization',output:z.string(),sourceFile:'test',rolloutRound:3,cleanupFailureReporter:reporter,
      beforeOutput:()=>{if(branch==='beforeOutput')throw original;},captureOutput:(raw:unknown)=>{if(branch==='captureOutput')throw original;return raw;},outputCheck:()=>{if(branch==='outputCheck')throw original;},
      handler:async(raw:any,_event:any,helpers:any)=>{helpers.parseInput(raw);helpers.onFailure(rollback);if(branch==='handler')helpers.fail(original);return branch==='schema'?7:'done';},
    } as any);
    const failure=await listener({}, {n:1}).catch((error:unknown)=>error);expect(rollback).toHaveBeenCalledTimes(1);if(branch!=='schema')expect(failure).toBe(original);expect(reporter).toHaveBeenCalledWith({channel:`fixture:failure:${branch}`,originalError:failure,cleanupError:secondary});
  });
});
