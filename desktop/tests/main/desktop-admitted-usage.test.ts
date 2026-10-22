// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import type {ModelAdapter,StreamChunk} from '../../../src/types.js';
import {createSkillCatalog} from '../../../src/ai/skills/loader.js';
import {ModelStreamPhysicalOwner} from '../../../src/ai/runtime/model-stream-physical-owner.js';
import {InProcessTaskRuntimeHost} from '../../../src/runtime/task-host/task-runtime-host.js';
import {FileTaskSnapshotStore} from '../../../src/runtime/task-host/snapshot-store.js';
import {MaterialRegistry} from '../../../src/runtime/task-host/material-registry.js';
import {DesktopMultiAgentStore} from '../../electron/desktop-multi-agent-store.js';
import {DesktopMultiAgentService,type DesktopAgentExecutionContext} from '../../electron/desktop-multi-agent-service.js';
import {DesktopExecutionCoordinator} from '../../electron/desktop-execution-coordinator.js';
import {DesktopMultiAgentRuntime} from '../../electron/desktop-multi-agent-runtime.js';
import {DesktopCapabilityCatalog,type DesktopScopedRegistry} from '../../electron/desktop-multi-agent-capabilities.js';
import type {DesktopManagedAgentSession} from '../../electron/desktop-managed-agent-session.js';

function contains(value:unknown,original:unknown,seen=new Set<object>()):boolean{if(value===original)return true;if(!(value instanceof Error)||seen.has(value))return false;seen.add(value);return contains(value.cause,original,seen)||(value instanceof AggregateError&&value.errors.some(error=>contains(error,original,seen)));}
function deferred<T=void>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const tick=()=>new Promise<void>(yes=>setImmediate(yes));
function errorTree(value:unknown,seen=new Map<object,number>()):unknown{
 if(value===null||typeof value!=='object')return {primitive:typeof value,value:value===undefined?'undefined':String(value)};
 if(seen.has(value))return {ref:seen.get(value)};
 const id=seen.size+1;seen.set(value,id);
 const error=value as Error&{errors?:unknown[]};return {id,name:error.name,message:error.message,stack:error.stack,
  ...(Object.hasOwn(error,'cause')?{cause:errorTree(error.cause,seen)}:{}),...(Array.isArray(error.errors)?{errors:error.errors.map(child=>errorTree(child,seen))}:{})};
}

// No registered recipe, model call, fetch or substitute authority. The actual
// Runtime creates the ManagedSession using a genuine root tool's private seed.
it.for(['normal','cancelled'] as const)('original admitted managed usage settles after %s without granting a new actor',(mode,testContext)=>{const originalScenario=(async()=>{
 const evidence=resolve(__dirname,'../../../.xiaok/evals/pi-durable/remediation-20261022');
 const root=realpathSync(mkdtempSync(join(evidence,'admitted-usage-'))),stat=lstatSync(root),nonce=randomUUID();
 const identity={canonicalRoot:root,workerPID:process.pid,parentPID:process.ppid,uid:stat.uid,dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs,nonce,runNonce:process.env.XIAOK_ADMITTED_USAGE_RUN_NONCE??null};
 writeFileSync(join(root,'identity.json'),JSON.stringify(identity,null,2)+'\n');
 const read=deferred<IteratorResult<StreamChunk>>(),returned=deferred<IteratorResult<StreamChunk>>(),entered=deferred(),rootRelease=deferred();
 let childRun:Promise<string>|undefined,nativeSignal:AbortSignal|undefined;
 let reads=0,returns=0,sends=0,childId='',rootContext:DesktopAgentExecutionContext|undefined,session:DesktopManagedAgentSession|undefined;
 let coordinator:DesktopExecutionCoordinator|undefined;
 let service:DesktopMultiAgentService|undefined,store:DesktopMultiAgentStore|undefined,host:InProcessTaskRuntimeHost|undefined,scope:DesktopScopedRegistry|undefined;
 let disposal:Promise<void>|undefined,disposalOutcome:{ok:true}|{ok:false,error:unknown}|undefined,physical:Promise<void>|undefined,physicalOutcome:{ok:true}|{ok:false,error:unknown}|undefined,nativeDisposal:Promise<void>|undefined,nativeOutcome:{ok:true}|{ok:false,error:unknown}|undefined,bodyFailure:unknown,hasBodyFailure=false;
 const cleanupErrors:unknown[]=[],restores:Array<()=>void>=[],usagePromises:Promise<void>[]=[],physicalPromises:Promise<unknown>[]=[];
 const facts:Record<string,unknown>={mode};
 const onTimeout=()=>{read.resolve({done:true,value:undefined});returned.resolve({done:true,value:undefined});rootRelease.resolve();void service?.dispose().catch(()=>{});};testContext.signal.addEventListener('abort',onTimeout,{once:true});
 try{
  store=new DesktopMultiAgentStore(join(root,'groups.sqlite'));coordinator=new DesktopExecutionCoordinator();
  let runtime!:DesktopMultiAgentRuntime;
  service=new DesktopMultiAgentService({store,coordinator,closeGraceMs:10,createSession:async input=>{session=await runtime.createSession(input);nativeSignal=(session as unknown as {lifetime:{signal:AbortSignal}}).lifetime.signal;const original=session.run;const spy=vi.spyOn(session,'run').mockImplementation(function(this:DesktopManagedAgentSession,...args){const raw=original.apply(this,args);childRun=raw;return raw;});restores.push(()=>spy.mockRestore());return session;}});
  runtime=new DesktopMultiAgentRuntime({service});service.registerThread({threadId:'usage-thread',profileId:'usage-profile',workspaceId:'usage-workspace',cwd:root});
  const originalUsage=service.recordUsage;
  const usageSpy=vi.spyOn(service,'recordUsage').mockImplementation(function(this:DesktopMultiAgentService,...args){
   const raw=originalUsage.apply(this,args);usagePromises.push(raw);return raw;
  });restores.push(()=>usageSpy.mockRestore());
  // Observe the same originals, never replace the provider/usage Promise.
  const proto=ModelStreamPhysicalOwner.prototype as unknown as {track(raw:Promise<unknown>,yes:()=>void,no:(e:unknown)=>void):void};
  const originalTrack=proto.track;
  const trackSpy=vi.spyOn(proto,'track').mockImplementation(function(this:typeof proto,...args){physicalPromises.push(args[0]);return originalTrack.apply(this,args);});restores.push(()=>trackSpy.mockRestore());
  const adapter={stream(){sends++;return {next(){reads++;if(reads===1){entered.resolve();return read.promise;}if(reads===2)return Promise.resolve({done:false,value:{type:'text',delta:'original child reply'}});if(reads===3)return Promise.resolve({done:false,value:{type:'done'}});return Promise.resolve({done:true,value:undefined});},return(){returns++;return returned.promise;},[Symbol.asyncIterator](){return this;}};}} as unknown as Pick<ModelAdapter,'stream'>;
  const catalog=new DesktopCapabilityCatalog();
  host=new InProcessTaskRuntimeHost({snapshotStore:new FileTaskSnapshotStore(join(root,'tasks')),materialRegistry:new MaterialRegistry({workspaceRoot:join(root,'materials'),maxBytes:1048576}),
   runner:input=>service!.runRoot(input,async context=>{
    rootContext=context;
    scope=runtime.bindRoot(context,{adapter,systemPrompt:'Actual managed usage',catalog,policy:catalog.snapshotPolicy(),workspaceId:'usage-workspace',materialIds:[],registryOptions:{autoMode:true},materials:[],skillCatalog:createSkillCatalog(undefined,root),dataRoot:root,agents:[],emitRuntimeEvent:input.emitRuntimeEvent,maxIterations:1});
    const raw=await scope.registry.executeTool('spawn_agent',{task_name:'usage_child',message:'Reply once.',fork_context:false},{signal:input.signal,taskId:input.taskId,toolInvocationId:'owned-usage-spawn',messages:[]});
    expect(raw).not.toMatch(/^Error:/);childId=JSON.parse(raw).targetAgentId;
    context.signal.addEventListener('abort',()=>rootRelease.resolve(),{once:true});if(context.signal.aborted)rootRelease.resolve();
    await rootRelease.promise;
   }),authorizePreparation:(id,marker)=>service!.assertHostPreparation(id,marker),assertTaskAdmission:snapshot=>service!.assertHostAdmission(snapshot),decideCancellation:(snapshot,reason)=>service!.decideHostCancellation(snapshot,reason)});
  await service.initialize(host);
  const prepared=await service.prepareRoot(host,'usage-thread',{prompt:'Create the actual ordinary child.',materials:[]});await host.startTask(prepared.taskId);await vi.waitFor(()=>expect(reads,JSON.stringify(store!.allAgents(store!.getThread('usage-thread')!.activeGroupId!))).toBe(1),{timeout:3000});await entered.promise;
  await vi.waitFor(()=>expect(childId).not.toBe(''));
  const internals=service as unknown as {groups:Map<string,{core:{waitForDisposedResources():Promise<void>},children:Map<string,{context:DesktopAgentExecutionContext}>}>,actors:WeakMap<object,{active:boolean,preparing?:boolean,sealed:boolean,context:DesktopAgentExecutionContext}>};
  const context=internals.groups.get(rootContext!.groupId)!.children.get(childId)!.context;
  expect(sends).toBe(1);expect(reads).toBe(1);expect(returns).toBe(0);expect(session).toBeDefined();
  const promiseIds=new Map<object,number>();const pid=(p:object)=>{if(!promiseIds.has(p))promiseIds.set(p,promiseIds.size+1);return promiseIds.get(p);};
  const beginDisposal=()=>{disposal=service!.dispose();expect(service!.dispose()).toBe(disposal);void disposal.then(()=>{disposalOutcome={ok:true};},error=>{disposalOutcome={ok:false,error};});};
  if(mode==='cancelled'){
   beginDisposal();await vi.waitFor(()=>expect(context.signal.aborted).toBe(true));await tick();
   await disposal!.catch(()=>{});
   nativeDisposal=session!.dispose();expect(session!.dispose()).toBe(nativeDisposal);void nativeDisposal.then(()=>{nativeOutcome={ok:true};},error=>{nativeOutcome={ok:false,error};});
   physical=internals.groups.get(context.groupId)!.core.waitForDisposedResources();void physical.then(()=>{physicalOutcome={ok:true};},error=>{physicalOutcome={ok:false,error};});
   expect(physicalOutcome).toBeUndefined();expect(nativeOutcome).toBeUndefined();expect(store.getAgent(context.groupId,childId)?.resourcesReleased).toBe(false);
   const state=internals.actors.get(context.actor)!;facts.invalidated={active:state.active,preparing:!!state.preparing,sealed:state.sealed,signalAborted:context.signal.aborted,sameContext:state.context===context};
   await expect(service.recordUsage(context,{usageId:'new-unadmitted-operation',inputTokens:1,outputTokens:1})).rejects.toThrow('stale or invalid multi-agent authority');
   usagePromises.length=0;
  }
  read.resolve({done:false,value:{type:'usage',usage:{inputTokens:17,outputTokens:19}}});
  await vi.waitFor(()=>expect(returns).toBe(1));await tick();
  if(mode==='cancelled'){expect(physicalOutcome).toBeUndefined();expect(nativeOutcome).toBeUndefined();}
  expect(physicalPromises.includes(returned.promise)).toBe(true);
  facts.originalReturnObserved=true;facts.usagePromises=usagePromises.map(pid);facts.physicalPromises=physicalPromises.map(pid);facts.sameDisposePromise=true;
  returned.resolve({done:true,value:undefined});
  if(mode==='normal'){
   await vi.waitFor(()=>expect(store!.getAgent(context.groupId,childId)?.executionActive).toBe(false));beginDisposal();
  }
  await disposal!.catch(()=>{});
  if(!nativeDisposal){nativeDisposal=session!.dispose();void nativeDisposal.then(()=>{nativeOutcome={ok:true};},error=>{nativeOutcome={ok:false,error};});}
  physical??=internals.groups.get(context.groupId)!.core.waitForDisposedResources();
  await physical.then(()=>{physicalOutcome={ok:true};},error=>{physicalOutcome={ok:false,error};});await nativeDisposal.catch(()=>{});await tick();
  const events=store.readEvents(context.groupId,0,1000).filter(event=>event.kind==='usage'&&event.agentId===childId);
  facts.events=events.map(event=>({kind:event.kind,agentId:event.agentId,turnId:event.turnId,payload:event.payload}));facts.calls={sends,reads,returns};facts.disposal=disposalOutcome?.ok?'fulfilled':errorTree((disposalOutcome as {ok:false,error:unknown})?.error);
  const runOutcome=await childRun!.then(value=>({fulfilled:true,value}),error=>({fulfilled:false,error}));
  if(mode==='cancelled'){facts.originalCancellationPreserved=!runOutcome.fulfilled&&contains((runOutcome as {error:unknown}).error,nativeSignal!.reason);facts.originalContextCancellation=errorTree(context.signal.reason);facts.originalNativeCancellation=errorTree(nativeSignal!.reason);facts.originalChildRunFailure=errorTree((runOutcome as {error:unknown}).error);}
  facts.coordinator=coordinator.snapshot();facts.physical=physicalOutcome?.ok?'fulfilled':errorTree((physicalOutcome as {ok:false,error:unknown})?.error);facts.nativeDispose=nativeOutcome?.ok?'fulfilled':errorTree((nativeOutcome as {ok:false,error:unknown})?.error);
  console.log('ADMITTED_USAGE_ACTUAL_EVIDENCE',JSON.stringify(facts));
  if(physicalOutcome?.ok!==true||nativeOutcome?.ok!==true){const failures=[...(physicalOutcome?.ok===false?[physicalOutcome.error]:[]),...(nativeOutcome?.ok===false?[nativeOutcome.error]:[])];throw new AggregateError(failures,'original admitted usage must settle through its actual host owner',{cause:failures[0]});}
  if(mode==='cancelled'){expect(runOutcome.fulfilled).toBe(false);expect(facts.originalCancellationPreserved).toBe(true);}
  expect(events).toHaveLength(1);expect(events[0].turnId).toBe(context.turnId);const usageId=String(events[0].payload.usageId),operationId='usage:'+createHash('sha256').update(`${childId}:${context.turnId}:${usageId}`).digest('hex');expect(store.getOperation(context.groupId,operationId)).toMatchObject({command:'usage',applyState:'applied'});expect(store.getAgent(context.groupId,childId)).toMatchObject({resourcesReleased:true,cleanupPending:false});expect(store.getAgent(context.groupId,childId)?.usage).toEqual({inputTokens:17,outputTokens:19});
  expect(sends).toBe(1);expect(returns).toBe(1);expect(coordinator.snapshot().active).toBe(0);
 }catch(error){hasBodyFailure=true;bodyFailure=error;}
 finally{
  read.resolve({done:true,value:undefined});returned.resolve({done:true,value:undefined});rootRelease.resolve();
  if(service){try{disposal??=service.dispose();await disposal;if(!disposalOutcome)disposalOutcome={ok:true};}catch(error){if(!disposalOutcome)disposalOutcome={ok:false,error};if(!hasBodyFailure||!contains(bodyFailure,error))cleanupErrors.push(error);}}
  if(session&&!nativeDisposal)nativeDisposal=session.dispose();
  if(nativeDisposal){try{await nativeDisposal;}catch(error){if(!hasBodyFailure||!contains(bodyFailure,error))cleanupErrors.push(error);}}
  if(physical){try{await physical;}catch(error){if(!hasBodyFailure||!contains(bodyFailure,error))cleanupErrors.push(error);}}
  if(host){try{await host.drain();}catch(error){cleanupErrors.push(error);}}
  if(scope){try{scope.dispose();}catch(error){cleanupErrors.push(error);}}
  testContext.signal.removeEventListener('abort',onTimeout);
  for(const restore of restores.reverse()){try{restore();}catch(error){cleanupErrors.push(error);}}
  // Sticky unknown keeps its real journal open until worker exit. The parent
  // may remove only this exact nonce/stat root after its owned group is absent.
  let removed=false;
  try{if(disposalOutcome?.ok===true&&physicalOutcome?.ok===true&&nativeOutcome?.ok===true&&store&&coordinator?.snapshot().active===0&&service?.runtimeStatus.blocked===false){store.close();const db=(store as unknown as {db:object}).db;const getter=Object.getOwnPropertyDescriptor(db,'isOpen')?.get;if(!getter||getter.call(db)!==false)throw Error('admitted_usage_store_close_unconfirmed');rmSync(root,{recursive:true,force:true});removed=true;}}catch(error){cleanupErrors.push(error);}
  if(!removed)console.log('ADMITTED_USAGE_RETAINED_ROOT',JSON.stringify(identity));
 }
 if(cleanupErrors.length)throw new AggregateError([...(hasBodyFailure?[bodyFailure]:[]),...cleanupErrors],'admitted usage body and cleanup failures',{cause:hasBodyFailure?bodyFailure:cleanupErrors[0]});
 if(hasBodyFailure)throw bodyFailure;
})();testContext.onTestFinished(()=>originalScenario);return originalScenario;},10000);
