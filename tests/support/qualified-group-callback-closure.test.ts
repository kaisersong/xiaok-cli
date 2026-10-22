import {it,expect} from 'vitest';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createMultiAgentCoordinator} from '../../src/ai/agents/multi-agent-coordinator.js';
import {captureQualifiedCoreCallbacks,sealQualifiedCoreCallbacks,beginQualifiedCoreCallbacks,finishQualifiedCoreCallbacks,captureQualifiedServiceCallbacks,beginQualifiedGroupCallbackStop,finishQualifiedServiceCallbacks,restoreQualifiedServiceCallbackObservers,isQualifiedExpectedCallbackFailure,type QualifiedCallbackCall,type QualifiedPreparedCallbackCall} from '../../desktop/tests/fixtures/qualified-group-callback-closure.js';

// Original directly-imported helper guard block: root-qualified-core-callback-guards.test.ts
{

function gate<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
async function actualCore(failure:unknown) {
  const entered=gate<void>(),execution=gate<string>();
  const core=createMultiAgentCoordinator({closeSettlementTimeoutMs:1,idGenerator:()=> 'owned-child'});
  await core.spawn({requestSource:'agent',callerId:'main',taskName:'child',message:'run',createSession:async()=>({
    run:async()=>{entered.resolve();return execution.promise;},
    dispose:async()=>{throw failure;},
  })});
  await entered.promise;
  const records=(core as unknown as {records:Map<string,any>}).records;
  return {core,records,record:records.get('owned-child'),execution};
}
function retained() {
  const refs:unknown[]=[];
  return {refs,keep:<T,>(_label:string,value:T):T=>{refs.push(value);return value;}};
}

it('requires original callback completion after the real Core ACK, retaining F without native success',async()=>{
  const F=Error('original F'),r=await actualCore(F),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep);
  const originalStop=beginQualifiedCoreCallbacks(binding);
  expect(beginQualifiedCoreCallbacks(binding)).toBe(originalStop);
  const cleanup=r.record.cleanup;
  let terminal=false;
  const completion=finishQualifiedCoreCallbacks(binding,F);
  void completion.then(()=>{terminal=true;},()=>{terminal=true;});
  try {
    await originalStop;
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(terminal).toBe(false);
    expect(r.record.cleanupSettled).not.toBe(true);
    r.execution.resolve('finished');
    const receipt=await completion;
    expect(receipt.callbacksTerminal).toBe(true);
    expect(receipt.nativeHealthy).toBe(false);
    expect(r.record.cleanup).toBe(cleanup);
    expect(r.records.get('owned-child')).toBe(r.record);
    expect(r.record.cleanupFailures).toEqual([F]);
    expect(r.record.resourcesReleased).toBe(false);
    await expect(r.core.waitForDisposedResources()).rejects.toMatchObject({errors:[F],cause:F});
  } finally {
    r.execution.resolve('release owned execution');
    await originalStop;
    await cleanup;
  }
});

it.each([undefined,null])('rejects actual session shutdown with F plus extra original %s',async U=>{
  const F=Error('original F'),both=new AggregateError([F,U],'actual extra shutdown failure',{cause:F});
  const r=await actualCore(both),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  const completion=finishQualifiedCoreCallbacks(binding,F);const rejection=expect(completion).rejects.toBeDefined();
  try {
    r.execution.resolve('finished');
    await rejection;
    expect(r.record.cleanupFailures).toEqual([both]);
    expect(both.errors[0]).toBe(F);expect(both.errors[1]).toBe(U);
    expect(r.record.resourcesReleased).toBe(false);
  } finally {r.execution.resolve('release owned execution');await stop;await r.record.cleanup;}
});

it('refuses a changed original Core record population after close publication',async()=>{
  const F=Error('original F'),r=await actualCore(F),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  const originalCleanup=r.record.cleanup;
  r.records.delete('owned-child');
  const completion=finishQualifiedCoreCallbacks(binding,F);const rejection=expect(completion).rejects.toBeDefined();
  try {r.execution.resolve('finished');await rejection;expect(r.record.resourcesReleased).toBe(false);}
  finally {r.execution.resolve('release owned execution');await stop;await originalCleanup;r.records.set('owned-child',r.record);}
});

it('refuses replacement of the published cleanup Promise with a fulfilled lookalike',async()=>{
  const F=Error('original F'),r=await actualCore(F),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  const originalCleanup=r.record.cleanup;
  r.record.cleanup=Promise.resolve();
  const completion=finishQualifiedCoreCallbacks(binding,F);const rejection=expect(completion).rejects.toBeDefined();
  try {r.execution.resolve('finished');await rejection;expect(r.record.resourcesReleased).toBe(false);}
  finally {r.execution.resolve('release owned execution');await stop;await originalCleanup;r.record.cleanup=originalCleanup;}
});

it('accepts the real Core descendant failure wrapper only after both original callbacks finish',async()=>{
  const F=Error('original descendant F'),parentEntered=gate<void>(),childEntered=gate<void>();
  const parentRun=gate<string>(),childRun=gate<string>();let ordinal=0;
  const core=createMultiAgentCoordinator({maxResidentAgents:4,closeSettlementTimeoutMs:1,idGenerator:()=> 'tree_'+(++ordinal)});
  await core.spawn({requestSource:'agent',callerId:'main',taskName:'parent',message:'run',createSession:async()=>({
    run:async()=>{parentEntered.resolve();return parentRun.promise;},dispose:async()=>{},
  })});
  await parentEntered.promise;
  await core.spawn({requestSource:'agent',callerId:'tree_1',taskName:'child',message:'run',createSession:async()=>({
    run:async()=>{childEntered.resolve();return childRun.promise;},dispose:async()=>{throw F;},
  })});
  await childEntered.promise;
  const held=retained(),binding=captureQualifiedCoreCallbacks(core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  const records=(core as unknown as {records:Map<string,any>}).records;
  const parent=records.get('tree_1'),child=records.get('tree_2'),parentCleanup=parent.cleanup,childCleanup=child.cleanup;
  const completion=finishQualifiedCoreCallbacks(binding,F);
  try {
    parentRun.resolve('parent done');childRun.resolve('child done');
    const receipt=await completion;
    expect(receipt.callbacksTerminal).toBe(true);expect(receipt.nativeHealthy).toBe(false);
    expect(child.cleanupFailures[0]).toBe(F);
    expect(parent.cleanupFailures[0]).toBeInstanceOf(AggregateError);
    expect(parent.cleanupFailures[0].message).toBe('multi_agent_descendant_cleanup_unconfirmed');
    expect(parent.cleanupFailures[0].errors).toEqual([F]);
    expect(parent.cleanup).toBe(parentCleanup);expect(child.cleanup).toBe(childCleanup);
    expect(parent.resourcesReleased).toBe(false);expect(child.resourcesReleased).toBe(false);
  } finally {
    parentRun.resolve('release parent');childRun.resolve('release child');
    await stop;await parentCleanup;await childCleanup;
  }
});

it.each([undefined,null])('does not erase an additional own cause %s attached to the expected F',async U=>{
  const F=Error('original F'),r=await actualCore(F),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  Object.defineProperty(F,'cause',{value:U,configurable:true,writable:true});
  const completion=Promise.resolve().then(()=>finishQualifiedCoreCallbacks(binding,F));const rejection=expect(completion).rejects.toBeDefined();
  try {r.execution.resolve('finished');await rejection;expect(Object.getOwnPropertyDescriptor(F,'cause')?.value).toBe(U);}
  finally {r.execution.resolve('release owned execution');await stop;await r.record.cleanup;}
});

it('rejects a prototype lookalike returned by actual Core session cleanup',async()=>{
  const F=Error('original F');
  const forged=Object.create(AggregateError.prototype,{
    message:{value:'multi_agent_descendant_cleanup_unconfirmed',configurable:true,writable:true},
    errors:{value:[F],configurable:true,writable:true},stack:{value:'not a native aggregate',configurable:true,writable:true},
  });
  const r=await actualCore(forged),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep),stop=beginQualifiedCoreCallbacks(binding);
  const completion=finishQualifiedCoreCallbacks(binding,F);const rejection=expect(completion).rejects.toBeDefined();
  try {r.execution.resolve('finished');await rejection;expect(r.record.cleanupFailures[0]).toBe(forged);}
  finally {r.execution.resolve('release owned execution');await stop;await r.record.cleanup;}
});

it('uses the sealed public population after an earlier genuine Core stop closed the root',async()=>{
  const F=Error('original early-stop F'),r=await actualCore(F),held=retained();
  const binding=captureQualifiedCoreCallbacks(r.core,held.keep);
  sealQualifiedCoreCallbacks(binding);
  const firstRealStop=r.core.dispose(),cleanup=r.record.cleanup;
  try {
    await firstRealStop;
    expect(()=>r.core.listAgents({requestSource:'user',callerId:'main'})).toThrow('caller agent is closed');
    const helperRealStop=beginQualifiedCoreCallbacks(binding);
    expect(helperRealStop).not.toBe(firstRealStop);
    const completed=finishQualifiedCoreCallbacks(binding,F);
    r.execution.resolve('finished');
    const receipt=await completed;
    expect(receipt.originalCoreStop).toBe(helperRealStop);
    expect(receipt.callbacksTerminal).toBe(true);expect(receipt.nativeHealthy).toBe(false);
    expect(r.record.cleanup).toBe(cleanup);expect(r.record.cleanupFailures).toEqual([F]);
  } finally {r.execution.resolve('release owned execution');await firstRealStop;await cleanup;}
});

}

// Original directly-imported helper guard block: root-qualified-service-callback-guards-v11-extra-occurrence.test.ts
{

function gate<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
async function fixedService(F:Error){
 const entered=gate<void>(),execution=gate<string>(),physicalGate=gate<void>();
 const core=createMultiAgentCoordinator({executionMode:'externally_activated',closeSettlementTimeoutMs:1,idGenerator:()=> 'owned-child'});
 const context={groupId:'owned-group'},child={id:'owned-child',context};
 class Commands{run(fn:()=>unknown){return Promise.resolve().then(fn);}}
 const group={id:'owned-group',core,commands:new Commands(),children:new Map<string,object>()};
 class Store{getRootBinding(){return {groupId:'owned-group'};}}
 const originalDisposeRaw:Promise<void>[]=[],originalPreparedDispose=()=>{const raw=Promise.reject(F);originalDisposeRaw.push(raw);return raw;};
 const preparedSession={run:async()=>{entered.resolve();return execution.promise;},dispose:originalPreparedDispose};
 class Service{
  groups=new Map([['owned-group',group]]);groupObservationPreparationDrains=new WeakMap();physicalSessionClosures=new Map();managedFinalPublications=new Map();managedReleaseOwners=new Map();
  options={prepareObservationSession:(_input:unknown):Promise<unknown>=>this.result('prepareObservationSession',{session:preparedSession})};
  nextFailure:{method:string;error:unknown}|undefined;originalServicePromise?:Promise<void>;originalPhysicalPromise?:Promise<void>;physicalCalls=0;
  prepareRoot(){return this.result('prepareRoot',{taskId:'owned-task'});}
  result(method:string,value?:unknown){return this.nextFailure?.method===method?Promise.reject(this.nextFailure.error):Promise.resolve(value);}
  dispose(){const original=(async()=>{const stop=core.dispose();await physicalGate.promise;await stop;await core.waitForDisposedResources();})();this.originalServicePromise=original;return original;}
  closeManagedSession(_group:unknown,_child:unknown,close:()=>void|Promise<void>){this.physicalCalls++;const original=Promise.resolve().then(close);this.originalPhysicalPromise=original;return original;}
  bindManagedObservationAdmission(){return this.result('bindManagedObservationAdmission');}
  registerManagedFinalPublication(){return this.result('registerManagedFinalPublication');}
 }
 const service=new Service(),record={},coreSlot={receiver:core,called:false},ownerSlot={receiver:service,called:false};
 const als=new AsyncLocalStorage<{callbackCall?:QualifiedCallbackCall;slot?:object}>(),refs:unknown[]=[],observerErrors:unknown[]=[],prepared=new Map<object,QualifiedPreparedCallbackCall[]>();let closing=false;
 const cap=captureQualifiedServiceCallbacks(service,new Store(),{
  retain:<T,>(_label:string,value:T)=>{refs.push(value);return value;},isClosing:()=>closing,
  invokeOriginal:(call,invoke)=>{const origin=als.getStore();call.originRecord=record;call.originSlot=origin?.slot;call.preClosing=!closing;call.parentCall=origin?.callbackCall;return als.run({callbackCall:call,slot:origin?.slot},invoke);},
  allowedCloseOrigin:(receiver,call)=>{
   if(call.originRecord!==record)return false;
   if(call.name==='dispose')return receiver===service&&call.receiver===service&&((call.preClosing&&!call.originSlot)||(call.originSlot===ownerSlot&&ownerSlot.called));
   if(call.name!=='closeManagedSession')return false;
   if(receiver===service)return Boolean(call.parentCall&&cap.methods.some(method=>method.key==='dispose'&&method.calls.includes(call.parentCall!)&&call.parentCall!.originRecord===record));
   return receiver===core&&call.originSlot===coreSlot&&coreSlot.called;
  },
  onGroup(){},preparedCalls:factory=>prepared.get(factory)??[],onPreparedFactory:factory=>{prepared.set(factory,[]);},
  onPreparedSession:(factory,session,groupId,agentId)=>{
   expect(session).toBe(preparedSession);const original=preparedSession.dispose;
   preparedSession.dispose=function(this:object){const call:QualifiedPreparedCallbackCall={name:'dispose',factoryCall:factory,session,groupId,agentId,receiver:this,rawWritten:false,parentCall:als.getStore()?.callbackCall};prepared.get(factory)!.push(call);refs.push(call);
    try{const raw=Reflect.apply(original,this,[]);call.raw=raw;call.rawWritten=true;call.reaction=Promise.prototype.then.call(raw,(value:unknown)=>{call.outcome={ok:true,value};},(error:unknown)=>{call.outcome={ok:false,error};}) as Promise<void>;return raw;}
    catch(error){call.outcome={ok:false,error};throw error;}
   };
  },onError:error=>{observerErrors.push(error);},
 });
 await service.prepareRoot();await Promise.resolve();expect(cap.bindings).toHaveLength(1);
 const handle=core.prepareSpawn({requestSource:'agent',callerId:'main',taskName:'owned',message:'run',createSession:async()=>({run:()=>preparedSession.run(),dispose:()=>service.closeManagedSession(group,child,()=>preparedSession.dispose())})});
 expect(handle.agentId).toBe('owned-child');group.children.set(handle.agentId,child);
 await service.options.prepareObservationSession({context,identity:{id:handle.agentId}});
 core.activatePreparedTurn(handle);await entered.promise;
 async function close(){
  const raw=service.dispose(),serviceOutcome=raw.then(()=>({ok:true as const}),error=>({ok:false as const,error}));
  expect(raw).toBe(service.originalServicePromise);closing=true;coreSlot.called=true;
  const stop=als.run({slot:coreSlot},()=>beginQualifiedGroupCallbackStop(cap.bindings[0]));
  execution.resolve('owned finished');physicalGate.resolve();await stop;
  const outcome=await serviceOutcome;expect(outcome.ok).toBe(false);if(outcome.ok)throw Error('expected original failure');
  expect(outcome.error).toBeInstanceOf(AggregateError);if(!(outcome.error instanceof AggregateError))throw Error('expected_original_callback_aggregate');expect(outcome.error.errors[0]).toBe(F);expect(outcome.error.cause).toBe(F);
  return {raw,error:outcome.error,finish:()=>finishQualifiedServiceCallbacks(cap,F,outcome.error)};
 }
 return {service,cap,refs,observerErrors,core,context,child,close,originalDisposeRaw,preparedSession,prepared};
}
it('keeps an early body dispose source through the real Core and same observed physical session call',async()=>{
 const F=Error('same original F'),f=await fixedService(F);
 try{const stopped=await f.close(),receipt=await stopped.finish();expect(receipt.callbacksTerminal).toBe(true);expect(receipt.nativeHealthy).toBe(false);expect(receipt.originalServiceError).toBe(stopped.error);expect(f.observerErrors).toEqual([]);expect(f.service.physicalCalls).toBe(1);expect(f.cap.physicalCalls[0].raw).toBe(f.service.originalPhysicalPromise);expect(f.cap.physicalCalls[0].outcome).toMatchObject({ok:false,error:F});expect(f.cap.methods.find(m=>m.key==='dispose')!.calls[0].raw).toBe(stopped.raw);expect((f.core as any).records.get('owned-child').resourcesReleased).toBe(false);const calls=[...f.prepared.values()].flat();expect(calls).toHaveLength(1);expect(calls[0].raw).toBe(f.originalDisposeRaw[0]);expect(calls[0].parentCall).toBe(f.cap.physicalCalls[0]);expect(calls[0].outcome).toMatchObject({ok:false,error:F});}
 finally{restoreQualifiedServiceCallbackObservers(f.cap);}
});
for(const method of ['prepareRoot','bindManagedObservationAdmission','registerManagedFinalPublication','prepareObservationSession'] as const){
 for(const fault of ['undefined','null','same-F'] as const)it(`refuses an additional ${fault} from actual ${method}, retaining its original occurrence`,async()=>{
  const F=Error('original cleanup F'),U=fault==='undefined'?undefined:fault==='null'?null:F,f=await fixedService(F);
  try{
   f.service.nextFailure={method,error:U};const raw=method==='prepareObservationSession'?f.service.options.prepareObservationSession({context:f.context,identity:{id:'owned-child'}}):f.service[method]();
   const captured=await raw.then(()=>({ok:true as const}),error=>({ok:false as const,error}));expect(captured.ok).toBe(false);if(captured.ok)throw Error('expected original rejection');expect(captured.error).toBe(U);
   const stopped=await f.close();let rejection:{error:unknown}|undefined;try{await stopped.finish();}catch(error){rejection={error};}
   expect(rejection).toBeDefined();expect(f.cap.terminal).toBe(false);
   const error=rejection!.error;expect(error instanceof AggregateError?error.errors.some((item:unknown)=>item===U):error===U).toBe(true);
  }finally{restoreQualifiedServiceCallbackObservers(f.cap);}
 });
}

it('refuses an extra same-F cleanup occurrence without another original session call',async()=>{
 const F=Error('one actual dispose F'),f=await fixedService(F);
 try{const stopped=await f.close(),row=(f.core as any).records.get('owned-child');expect(row.cleanupFailures).toEqual([F]);row.cleanupFailures.push(F);
  let failure:{error:unknown}|undefined;try{await stopped.finish();}catch(error){failure={error};}
  expect(failure).toBeDefined();expect(f.cap.terminal).toBe(false);expect([...f.prepared.values()].flat()).toHaveLength(1);expect(row.cleanupFailures[0]).toBe(F);expect(row.cleanupFailures[1]).toBe(F);
 }finally{restoreQualifiedServiceCallbackObservers(f.cap);}
});

}

// Original directly-imported helper guard block: root-qualified-failure-shape-guards.test.ts
{

it.each([undefined,null])('refuses an extra own cause %s on a descendant wrapper',U=>{
 const F=Error('original F'),wrapper=new AggregateError([F],'multi_agent_descendant_cleanup_unconfirmed',{cause:U});
 expect(isQualifiedExpectedCallbackFailure(wrapper,F)).toBe(false);
 expect(Object.getOwnPropertyDescriptor(wrapper,'cause')?.value).toBe(U);
});
it('refuses a cause accessor without invoking it',()=>{
 const F=Error('original F'),wrapper=new AggregateError([F],'multi_agent_descendant_cleanup_unconfirmed');let calls=0;
 Object.defineProperty(wrapper,'cause',{get(){calls++;throw Error('accessor must not execute');},configurable:true});
 expect(isQualifiedExpectedCallbackFailure(wrapper,F)).toBe(false);expect(calls).toBe(0);
});
it('keeps the real cleanup wrapper cause tied to its first original error',()=>{
 const F=Error('original F'),wrapper=new AggregateError([F],'multi_agent_cleanup_unconfirmed',{cause:F});
 expect(isQualifiedExpectedCallbackFailure(wrapper,F)).toBe(true);
 const U=Error('other cause');Object.defineProperty(wrapper,'cause',{value:U});
 expect(isQualifiedExpectedCallbackFailure(wrapper,F)).toBe(false);expect(wrapper.cause).toBe(U);
});
for(const flags of [{writable:false,enumerable:false,configurable:true},{writable:true,enumerable:true,configurable:true},{writable:true,enumerable:false,configurable:false}]){
 it(`refuses an unexpected stack data descriptor ${JSON.stringify(flags)}`,()=>{
  const F=Error('original F');Object.defineProperty(F,'stack',{value:'replacement stack',...flags});
  expect(isQualifiedExpectedCallbackFailure(F,F)).toBe(false);
 });
}
it('refuses an extra symbol on the original expected Error',()=>{
 const F=Error('original F'),unknown=Symbol('unknown');Object.defineProperty(F,unknown,{value:undefined});
 expect(isQualifiedExpectedCallbackFailure(F,F)).toBe(false);expect(Object.hasOwn(F,unknown)).toBe(true);
});

}
