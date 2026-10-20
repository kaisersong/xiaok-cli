import {DesktopMultiAgentRuntime} from '../../electron/desktop-multi-agent-runtime.js';
import {DesktopMultiAgentService} from '../../electron/desktop-multi-agent-service.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {DesktopOwnedToolRegistry,DesktopToolCatalogBridge} from '../../electron/desktop-multi-agent-catalog-bridge.js';
import {captureInvocationDrain} from '../../electron/desktop-model-invocation.js';
// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDesktopModelRunnerWithRegistry} from '../../electron/desktop-services.js';
import {ToolRegistry} from '../../../src/ai/tools/index.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
const cfg=vi.hoisted(()=>({schemaVersion:2,defaultProvider:'local',defaultModelId:'model',providers:{local:{type:'custom',protocol:'openai_legacy',baseUrl:'http://127.0.0.1:1/v1'}},models:{model:{provider:'local',model:'model',label:'Fixture',capabilities:['tools']}}}));
vi.mock('../../../src/utils/config.js',async original=>({...await original<object>(),loadConfig:async()=>cfg}));
vi.mock('../../../src/ai/models.js',async original=>({...await original<object>(),createAdapterFromBinding:()=>({getModelName:()=> 'unleased SDK',async *stream(){yield {type:'text',delta:'SDK fallback must not be used'};yield {type:'done'};}})}));
const cleanup:Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const action of cleanup.splice(0).reverse())await action();});
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
function setup(openInvocation:any){
 const root=mkdtempSync(join(tmpdir(),'desktop-invocation-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));
 const registry=new ToolRegistry({autoMode:true},[]),materials=new MaterialRegistry({workspaceRoot:join(root,'materials')});cleanup.push(()=>registry.dispose());
 const runner=createDesktopModelRunnerWithRegistry(registry,[],root,{request:async()=>new Response('{}')} as never,materials,{}, {restrictedArtifactGeneration:true,openInvocation} as any);
 const settled=vi.fn(),host=new InProcessTaskRuntimeHost({runner,materialRegistry:materials,snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),onExecutionSettled:settled});cleanup.push(()=>host.drain());
 return {host,settled,registry};
}
it('the original root runner retains its invocation through receipt emission until its original close fulfils',async()=>{
 const closing=gate(),stream=vi.fn(async function*(){yield {type:'text' as const,delta:'LEASED_ROOT'};yield {type:'done' as const};}),close=vi.fn(()=>closing.promise),open=vi.fn(async()=>({adapter:{stream,getModelName:()=> 'leased'},closeAndDrain:close}));const f=setup(open);
 try{const task=await f.host.createTask({prompt:'run',materials:[]});await vi.waitFor(()=>expect(close).toHaveBeenCalledOnce());expect(open.mock.calls[0][0].taskId).toBe(task.taskId);expect(stream).toHaveBeenCalledOnce();expect(f.settled).not.toHaveBeenCalled();}finally{closing.release();await f.host.drain();}
 expect(close).toHaveBeenCalledOnce();expect(f.settled).toHaveBeenCalledOnce();
});
it.each(['before-stream','stream'] as const)('root %s failure still drains the acquired invocation exactly once',async phase=>{
 const close=vi.fn(async()=>{}),stream=vi.fn(async function*(){throw new Error('actual_stream_failure');yield {type:'done' as const};}),open=vi.fn(async()=>({adapter:{stream,getModelName:()=> 'leased'},closeAndDrain:close}));const f=setup(open);
 if(phase==='before-stream')vi.spyOn(f.registry,'getToolDefinitions').mockImplementation(()=>{throw new Error('actual_registry_failure');});
 await f.host.createTask({prompt:'run',materials:[]});await f.host.drain();expect(open).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(stream).toHaveBeenCalledTimes(phase==='stream'?1:0);expect(f.settled).toHaveBeenCalledOnce();
});
it('cancelling while the actual root factory awaits cannot start the late engine, but still drains its lease',async()=>{
 let originalSignal:AbortSignal|undefined;const ready=gate(),allocated=gate(),close=vi.fn(async()=>{}),stream=vi.fn(async function*(){yield {type:'text' as const,delta:'FORBIDDEN_LATE_WORK'};});const f=setup(async(input:any)=>{originalSignal=input.signal;ready.release();await allocated.promise;return {adapter:{stream,getModelName:()=> 'leased'},closeAndDrain:close};});
 try{const task=await f.host.createTask({prompt:'run',materials:[]});await ready.promise;const cancel=f.host.cancelTask(task.taskId,'user_cancelled');await vi.waitFor(()=>expect(originalSignal?.aborted).toBe(true));allocated.release();await cancel;await f.host.drain();expect(stream).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();}finally{allocated.release();}
});

it('the original captured drain installs one completion before an owner callback can reenter',async()=>{
 let drain!:()=>Promise<void>,inside:Promise<void>|undefined;let calls=0;const invocation={adapter:{getModelName:()=> 'test',async *stream(){}},closeAndDrain(){if(++calls===1)inside=drain();return Promise.resolve();}};drain=captureInvocationDrain(invocation);const outside=drain();await outside;expect(inside).toBe(outside);expect(calls).toBe(1);
});

it('a checkpoint failure after actual root registry binding disposes that original scope and drains the lease',async()=>{
 const root=mkdtempSync(join(tmpdir(),'root-scope-invocation-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanup.push(()=>store.close());const coordinator=new DesktopExecutionCoordinator();let runtime!:DesktopMultiAgentRuntime;const service=new DesktopMultiAgentService({store,coordinator,createSession:input=>runtime.createSession(input)});cleanup.push(()=>service.dispose());runtime=new DesktopMultiAgentRuntime({service});service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});
 const registry=new DesktopOwnedToolRegistry({autoMode:true},[]),catalog=new DesktopToolCatalogBridge({registry,workspaceId:'workspace'});cleanup.push(()=>{catalog.dispose();registry.dispose();});const materials=new MaterialRegistry({workspaceRoot:join(root,'materials')}),close=vi.fn(async()=>{});let dispose:ReturnType<typeof vi.fn>|undefined;const bind=runtime.bindRoot.bind(runtime);vi.spyOn(runtime,'bindRoot').mockImplementation((...args)=>{const scope=bind(...args);dispose=vi.spyOn(scope,'dispose');return scope;});
 const runner=createDesktopModelRunnerWithRegistry(registry,[],root,{request:async()=>new Response('{}')} as never,materials,{}, {restrictedArtifactGeneration:true,multiAgent:{runtime,service,catalog,workspaceId:'workspace',cwd:root},openInvocation:async()=>({adapter:{getModelName:()=> 'test',async *stream(){throw new Error('must not sample');}},closeAndDrain:close,prepareCheckpoint:()=>{throw new Error('checkpoint_failed');}})});
 const host=new InProcessTaskRuntimeHost({materialRegistry:materials,snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),runner:input=>service.runRoot(input,context=>runner(input,context))});
 await service.initialize(host);const task=await service.prepareRoot(host,'thread',{prompt:'run',materials:[]});await host.startTask(task.taskId);await host.drain();expect(dispose).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
});

it('the original sealed actor may return its result while strict new invocation remains closed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'sealed-result-owner-'));cleanup.push(()=>rmSync(root,{recursive:true,force:true,maxRetries:3}));const store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));cleanup.push(()=>store.close());const service=new DesktopMultiAgentService({store,coordinator:new DesktopExecutionCoordinator(),createSession:async()=>{throw new Error('unused');}});cleanup.push(()=>service.dispose());service.registerThread({threadId:'thread',profileId:'profile',workspaceId:'workspace',cwd:root});let original:any;const errors:unknown[]=[];
 const host=new InProcessTaskRuntimeHost({materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials')}),snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),authorizePreparation:(id,marker)=>service.assertHostPreparation(id,marker),assertTaskAdmission:snapshot=>service.assertHostAdmission(snapshot),runner:input=>service.runRoot(input,async context=>{original=context;try{service.assertInvocation(context.actor,context);await context.mailbox.trySealTurn({outcome:'completed',limitReached:true});expect(()=>service.assertInvocation(context.actor,context)).toThrow();expect(()=>(service as any).assertResultCurrent(context)).not.toThrow();expect(()=>(service as any).assertResultCurrent({...context})).toThrow();await expect(service.spawn({requestSource:'agent',actor:context.actor,operationId:'sealed-spawn',taskName:'forbidden',message:'no'})).rejects.toThrow();}catch(error){errors.push(error);throw error;}})});
 await service.initialize(host);const task=await service.prepareRoot(host,'thread',{prompt:'run',materials:[]});await host.startTask(task.taskId);await host.drain();expect(errors).toEqual([]);expect(()=>(service as any).assertResultCurrent(original)).toThrow();
});
