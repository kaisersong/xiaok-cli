import {setTimeout as originalPollDelay} from 'node:timers/promises';
import {types} from 'node:util';
import {readOriginalKSwarmServiceIdentity} from './kswarm-service.js';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {createIntrinsicSet} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {createRoomTurnCustody} from './original-room-turn-custody.js';
import {readOriginalMainDshServicesBinding} from './desktop-services.js';
import {readOriginalMainMaterialSourceBinding} from './main-material-source.js';
import {createOriginalRoomTurnSource,closeOriginalRoomTurnRuntime,type OriginalRoomTurnSource} from './original-room-turn-source.js';
import {createOriginalMainRootAdmissionOwner,bindOriginalMainRoomDiscussionAdmission,bindOriginalMainDshPhysicalPort,bindOriginalMainModelProbeAdmission,bindOriginalMainMaterialAdmission,bindOriginalMainWorkflowAdmission,bindOriginalMainRoomProjectAdmission,bindOriginalMainDirectAdmission,type OriginalMainRootAdmissionOwner} from './main-room-root-admission.js';
import {readOriginalKSwarmHandoffRunnerBinding} from './kswarm-runtime-bridge.js';
import {createMainDshModelSource,type MainDshModelSource} from './main-dsh-model-source.js';
import {createMainDshAdmissionCoordinator,type MainDshAdmissionCoordinator} from './main-dsh-admission-coordinator.js';
import {createDshDesktopController,assertOriginalDshDesktopControllerAccepting,type DshDesktopController} from './dsh-desktop-controller.js';
import {createMainDshBrokerControlSource,readOriginalMainDshBrokerControlSource,type MainDshBrokerControlSource} from './main-dsh-broker-control-source.js';
import {assertOriginalBrokerAdmissionClient} from './collaboration-room-broker-client.js';
import {bindOriginalScopedRoomWakeDispatcher} from './collaboration-room-wake-dispatcher.js';
import {claimOriginalMainDshServiceRole} from './main-dsh-service-role.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';

const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,freeze=Object.freeze,create=Object.create;
const NativePromise=Promise,then=Promise.prototype.then,NativeError=Error;
const NativeAbort=AbortController,abort=AbortController.prototype.abort,signalGetter=Object.getOwnPropertyDescriptor(AbortController.prototype,'signal')!.get!,abortedGetter=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy,isError=types.isNativeError;
type Binding=ReturnType<typeof readOriginalMainDshServicesBinding>;
type Stock=ReturnType<typeof createRoomTurnCustody>;
interface Row {
 readonly services:object;readonly sources:object;readonly runtime:object;readonly dispatcher:object;readonly direct:object;readonly material:object;readonly brokerClient:object;
 readonly binding:Binding;readonly handle:object;readonly stock:Stock;readonly negatives:ReturnType<typeof createIntrinsicSet<Stock>>;
 readonly promise:Promise<object>;readonly birthDone:Promise<void>;
 stopping:boolean;complete:boolean;failure?:{raw:unknown};closing?:Promise<void>;startupRejected?:Promise<never>;
 pollStarted?:Promise<void>;pollReady?:boolean;pollLoop?:Promise<void>;pollAbort?:AbortController;pollSignal?:AbortSignal;pollReason?:object;readonly pollStocks:ReturnType<typeof createIntrinsicSet<Stock>>;
 room?:OriginalRoomTurnSource;owner?:OriginalMainRootAdmissionOwner;model?:MainDshModelSource;coordinator?:MainDshAdmissionCoordinator;controller?:DshDesktopController;view?:MainDshRuntimeBinding;
 broker?:MainDshBrokerControlSource;brokerStop?:Function;brokerClose?:Function;brokerConsumer?:Function;
}
export interface MainDshRuntimeBinding {readonly controller:DshDesktopController;readonly coordinator:MainDshAdmissionCoordinator;readonly owner:OriginalMainRootAdmissionOwner;readonly ingress:IngressOwner}
const rows=new WeakMap<object,Row>(),proofs=new WeakMap<object,Row>(),retired=new WeakMap<object,object>(),held=createIntrinsicSet<Row>();
const denied=()=>new NativeError('DSH_MAIN_RUNTIME_COMPOSITION_REQUIRED');
function rowFor(services:unknown,sources:unknown):Row|undefined {
 // An untrusted candidate never reaches properties, Native or an SDK.
 readOriginalMainDshServicesBinding(services,sources);
 const row=apply(get,rows,[services]) as Row|undefined;
 if(row&&row.sources!==sources)throw denied();return row;
}
function current(row:Row):void {if(row.stopping||row.failure)throw denied();}
function negativeVoid(row:Row,fn:Function,receiver:unknown,args:unknown[]=[]):void {
 const stock=createRoomTurnCustody();row.negatives.add(stock);stock.syncVoid(fn,receiver,args);
}
async function negative(row:Row,fn:Function,receiver:unknown):Promise<void> {
 const stock=createRoomTurnCustody();row.negatives.add(stock);await stock.sdk(fn,receiver,[]);
}
function stop(row:Row):void {
 if(row.stopping)return;row.stopping=true;
 const attempt=(fn:Function,receiver:unknown,args:unknown[]=[])=>{try{negativeVoid(row,fn,receiver,args);}catch(raw){row.failure??={raw};row.stock.inventory(raw);}};
 if(row.pollAbort)attempt(abort,row.pollAbort,[row.pollReason]);
 if(row.controller){attempt(row.controller.ingress.stopAccepting,row.controller.ingress);attempt(row.controller.ingress.abortAllActive,row.controller.ingress,['app_shutdown']);}
 if(row.coordinator)attempt(row.coordinator.stopAccepting,row.coordinator);
 if(row.model)attempt(row.model.stopAccepting,row.model);
 if(row.broker&&row.brokerStop)attempt(row.brokerStop,row.broker);
 if(row.room)attempt(row.room.seal,row.room);
}
function close(row:Row):Promise<void> {
 if(row.closing)return row.closing;
 let yes!:()=>void,no!:(raw:unknown)=>void;
 row.closing=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});stop(row);
 const operation=(async()=>{
  // This independent bookkeeping barrier is completed before resolving or
  // rejecting the public birth Promise. Never await a not-started recovery.
  await row.birthDone;
  let failure:{raw:unknown}|undefined;
  if(row.pollLoop)try{await row.pollLoop;}catch(raw){failure??={raw};}
  for(const stock of row.pollStocks.snapshot())try{await stock.waitPhysicalKnown();}catch(raw){failure??={raw};}
  const attempt=async(fn:Function,receiver:unknown)=>{try{await negative(row,fn,receiver);}catch(raw){failure??={raw};}};
  if(row.controller)await attempt(row.controller.close,row.controller);
  if(row.coordinator)await attempt(row.coordinator.close,row.coordinator);
  if(row.model)await attempt(row.model.close,row.model);
  if(row.room)await attempt(()=>closeOriginalRoomTurnRuntime(row.room!),undefined);
  if(row.room)await attempt(row.room.drain,row.room);
  if(row.owner)await attempt(row.owner.drain,row.owner);
  if(row.broker&&row.brokerConsumer)await attempt(()=>row.stock.consumeResource(row.brokerConsumer!,row.broker!,[]),undefined);
  try{await row.stock.waitPhysicalKnown();}catch(raw){failure??={raw};}
  const stocks=row.negatives.snapshot();
  for(let i=0;i<stocks.length;i++)try{await stocks[i]!.waitPhysicalKnown();}catch(raw){failure??={raw};}
  if(failure)throw failure.raw;
 })();
 apply(then,operation,[yes,no]);return row.closing;
}

/** Fixed original Main composition; no profile flag, scope DTO, factory,
 * runtime, permission callback or replacement service can enter this API.
 * Its receipt covers these bindings only, never production/all14 eligibility. */
export function composeOriginalMainDshRuntime(raw:unknown):Promise<object> {
 const value=captureGithubOpaqueRecord(raw,['services','sources','roomRuntime','roomDispatcher','directBridge','materialSource','brokerClient']);
 const services=value.services as object,sources=value.sources as object;
 const binding=readOriginalMainDshServicesBinding(services,sources);
 const prior=apply(get,rows,[services]) as Row|undefined;
 if(prior){
  if(prior.sources!==sources||prior.runtime!==value.roomRuntime||prior.dispatcher!==value.roomDispatcher||prior.direct!==value.directBridge||prior.material!==value.materialSource||prior.brokerClient!==value.brokerClient||prior.stopping||prior.failure)throw denied();
  return prior.promise;
 }
 if(apply(get,retired,[services]))throw denied();
 // Validate real producer/service and material birth before reserving a new
 // row. No public service table or claimed same-scope status is authority.
 readOriginalKSwarmHandoffRunnerBinding(value.directBridge,binding.kswarmService,binding.directRunner);
 assertOriginalBrokerAdmissionClient(value.brokerClient,binding.kswarmService);
 const material=readOriginalMainMaterialSourceBinding(value.materialSource,services);
 if(material.storageScope.profileId!==binding.lease.scope.profileId||material.storageScope.workspaceId!==binding.lease.scope.workspaceId)throw denied();
 claimOriginalMainDshServiceRole(services,sources,'runtime');
 let yes!:(proof:object)=>void,no!:(raw:unknown)=>void,birthComplete!:()=>void;
 const promise=new NativePromise<object>((resolve,reject)=>{yes=resolve;no=reject;});
 const birthDone=new NativePromise<void>(resolve=>{birthComplete=resolve;});
 const handle=freeze(create(null)) as object;
 const row:Row={services,sources,runtime:value.roomRuntime as object,dispatcher:value.roomDispatcher as object,direct:value.directBridge as object,material:value.materialSource as object,brokerClient:value.brokerClient as object,binding,handle,promise,birthDone,stock:createRoomTurnCustody(),negatives:createIntrinsicSet(),pollStocks:createIntrinsicSet(),stopping:false,complete:false};
 // The one original promise and all partial handles precede the first await
 // or SDK. Failure/unknown/close never deletes this row or opens a new pool.
 apply(set,rows,[services,row]);held.add(row);
 const operation=row.stock.root(async()=>{
  await binding.constructionReady;current(row);
  const lease=binding.lease;
  bindOriginalScopedRoomWakeDispatcher(row.dispatcher,binding.kswarmService);current(row);
  const consumeBroker=function(){if(!row.broker||!row.brokerClose)throw denied();return apply(row.brokerClose,row.broker,[]);};row.brokerConsumer=consumeBroker;
  await row.stock.sdk(createMainDshBrokerControlSource,undefined,[{services,sources,client:row.brokerClient}],{
   accept(value){
    const source=readOriginalMainDshBrokerControlSource(value,lease.realm,binding.store);
    const stop=descriptor(source,'stopAccepting'),close=descriptor(source,'close');
    if(!stop||!own(stop,'value')||typeof stop.value!=='function'||isProxy(stop.value)||!close||!own(close,'value')||typeof close.value!=='function'||isProxy(close.value))throw denied();
    row.broker=source;row.brokerStop=stop.value;row.brokerClose=close.value;return true;
   },consumer:consumeBroker,
  });current(row);
  row.room=createOriginalRoomTurnSource({dispatcher:row.dispatcher,runtime:row.runtime,services,scope:lease.scope});current(row);
  row.owner=createOriginalMainRootAdmissionOwner({roomSource:row.room,host:binding.host,store:binding.taskStore});current(row);
  await row.stock.sdk(bindOriginalMainRoomDiscussionAdmission,undefined,[row.owner,row.runtime,row.room]);current(row);
  await row.stock.sdk(bindOriginalMainDshPhysicalPort,undefined,[row.owner,lease.realm,binding.store,lease.runtime,lease.budgetSource]);current(row);
  row.stock.syncVoid(bindOriginalMainModelProbeAdmission,undefined,[row.owner,lease.userSource,services]);current(row);
  row.stock.syncVoid(bindOriginalMainMaterialAdmission,undefined,[row.owner,row.material,services]);current(row);
  await row.stock.sdk(bindOriginalMainWorkflowAdmission,undefined,[row.owner,binding.kswarmService]);current(row);
  await row.stock.sdk(bindOriginalMainRoomProjectAdmission,undefined,[row.owner,row.runtime,binding.kswarmService]);current(row);
  await row.stock.sdk(bindOriginalMainDirectAdmission,undefined,[row.owner,row.direct,binding.kswarmService]);current(row);
  row.model=createMainDshModelSource({realm:lease.realm,store:binding.store,runtime:lease.runtime,budgetSource:lease.budgetSource});current(row);
  row.coordinator=createMainDshAdmissionCoordinator({realm:lease.realm,store:binding.store,runtime:lease.runtime,budgetSource:lease.budgetSource,businessSource:lease.businessSource,modelSource:row.model,brokerSource:row.broker});current(row);
  row.controller=createDshDesktopController({scope:lease.scope,realm:lease.realm,store:binding.store,userSource:lease.userSource,runtime:lease.runtime,sourcePopulation:lease.sourcePopulation,budgetSource:lease.budgetSource,businessSource:lease.businessSource,admissionCoordinator:row.coordinator,brokerSource:row.broker});current(row);
  const ingress:IngressOwner=freeze({name:'main-dsh-runtime',stopAccepting:()=>stop(row),abortAllActive:()=>stop(row),drain(deadlineMs:number){
   const actual=close(row);
   return new NativePromise<boolean>(resolve=>{const timer=setTimeout(()=>resolve(false),Math.max(0,deadlineMs));apply(then,actual,[()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);}]);});
  }});
  row.view=freeze({controller:row.controller,coordinator:row.coordinator,owner:row.owner,ingress});row.complete=true;apply(set,proofs,[handle,row]);
 });
 apply(then,operation,[()=>{birthComplete();yes(handle);},(raw:unknown)=>{
  row.failure??={raw};row.stock.inventory(raw);birthComplete();
  // Try every original negative owner before delivering the original failure.
  // Cleanup failure is retained separately; it never overwrites a falsy cause.
  apply(then,close(row),[()=>no(raw),(cleanup:unknown)=>{row.stock.inventory(cleanup);no(raw);}]);
 }]);
 return promise;
}

/** Pure membership assertion. It grants neither SDK entry nor all14 status. */
export function readOriginalMainDshRuntimeCompletion(services:unknown,sources:unknown,proof:unknown):void {
 const row=rowFor(services,sources),member=apply(get,proofs,[proof]) as Row|undefined;
 if(!row||member!==row||row.handle!==proof||!row.complete||!row.view)throw denied();current(row);
}
/** Original Main resource tuple, never scanned as a wire/data SDK result. */
export function readOriginalMainDshRuntimeBinding(services:unknown,sources:unknown,proof:unknown):MainDshRuntimeBinding {
 readOriginalMainDshRuntimeCompletion(services,sources,proof);return (apply(get,rows,[services]) as Row).view!;
}
export function stopOriginalMainDshRuntimeComposition(services:unknown,sources:unknown):void {
 const row=rowFor(services,sources);
 if(row)stop(row);else apply(set,retired,[services,sources]);
}
export function closeOriginalMainDshRuntimeComposition(services:unknown,sources:unknown):Promise<void> {
 const row=rowFor(services,sources);
 if(row)return close(row);
 apply(set,retired,[services,sources]);return new NativePromise<void>(resolve=>resolve());
}

/** Negative-only original startup handoff. Ownership survives a failed or
 * stopped positive path; cleanup never replaces the first raw rejection. */
export function rejectOriginalMainDshRuntimeStartup(services:unknown,sources:unknown,proof:unknown,raw:unknown):Promise<never> {
 const row=apply(get,rows,[services]) as Row|undefined,member=apply(get,proofs,[proof]) as Row|undefined;
 if(!row||member!==row||row.services!==services||row.sources!==sources||row.handle!==proof||!row.complete)throw denied();
 row.failure??={raw};
 if(row.startupRejected){row.stock.inventory(raw);return row.startupRejected;}
 let no!:(raw:unknown)=>void;
 row.startupRejected=new NativePromise<never>((_yes,reject)=>{no=reject;});
 // Reserve before inspecting SDK error descriptors or entering any cleanup.
 row.stock.inventory(raw);stop(row);
 apply(then,close(row),[()=>no(row.failure!.raw),(cleanup:unknown)=>{row.stock.inventory(cleanup);no(row.failure!.raw);}]);
 return row.startupRejected;
}

function originalPollAbort(row:Row,raw:unknown):boolean {
 if(!row.stopping||!row.pollSignal||apply(abortedGetter,row.pollSignal,[])!==true||!raw||typeof raw!=='object'||isProxy(raw)||!isError(raw))return false;
 const cause=descriptor(raw,'cause'),code=descriptor(raw,'code');
 return !!cause&&own(cause,'value')&&cause.value===row.pollReason&&!!code&&own(code,'value')&&code.value==='ABORT_ERR';
}
/** One original Main loop. It delegates all source cadence, admission, retries
 * and durable state to the existing controller/Source; no second work queue. */
export function startOriginalMainDshRuntimePolling(services:unknown,sources:unknown,proof:unknown):Promise<void> {
 readOriginalMainDshRuntimeCompletion(services,sources,proof);
 const row=apply(get,rows,[services]) as Row;
 if(row.pollStarted)return row.pollStarted;
 let yes!:()=>void,no!:(raw:unknown)=>void;
 row.pollStarted=new NativePromise<void>((resolve,reject)=>{yes=resolve;no=reject;});
 row.pollAbort=new NativeAbort();row.pollSignal=apply(signalGetter,row.pollAbort,[]) as AbortSignal;row.pollReason=freeze(create(null)) as object;
 // Reserve the exact loop/start Promise before current checks or timer SDKs
 // can synchronously reenter stop/start. Late raw returns stay in their stock.
 const operation=row.stock.root(async()=>{
  await row.binding.ready;if(row.stopping)return;current(row);
  const identity=readOriginalKSwarmServiceIdentity(row.binding.kswarmService);
  row.stock.syncVoid(identity.assertCurrent,identity,[]);if(row.stopping)return;current(row);
  while(!row.stopping){
   current(row);assertOriginalDshDesktopControllerAccepting(row.controller);
   const delayStock=createRoomTurnCustody();row.pollStocks.add(delayStock);let ownedAbort=false;
   try{
    // The local cut is adjacent to the real, fixed Node delay. Abort is not
    // physical completion: its original Promise and every child must join.
    current(row);assertOriginalDshDesktopControllerAccepting(row.controller);
    const delay=delayStock.sdk(originalPollDelay,undefined,[1000,undefined,{ref:false,signal:row.pollSignal}]);
    if(!row.stopping){current(row);row.pollReady=true;yes();}
    await delay;
   }catch(raw){if(!originalPollAbort(row,raw))throw raw;ownedAbort=true;}
   await delayStock.waitPhysicalKnown();row.pollStocks.delete(delayStock);
   if(ownedAbort||row.stopping)break;
   current(row);const tickStock=createRoomTurnCustody();row.pollStocks.add(tickStock);
   try{await tickStock.sdk(row.controller!.tick,row.controller,[]);}
   catch{/* Original controller records known operational failures. Never
          bypass its state/backoff or repeat an SDK attempt here. */}
   // A known operational rejection may continue through the same controller;
   // malformed/unknown SDK fate stops the owner and remains held for close.
   await tickStock.waitPhysicalKnown();row.pollStocks.delete(tickStock);
   if(!row.stopping)assertOriginalDshDesktopControllerAccepting(row.controller);
  }
 });
 row.pollLoop=operation;
 apply(then,operation,[()=>{if(row.pollReady)yes();else no(denied());},(raw:unknown)=>{row.failure??={raw};row.stock.inventory(raw);stop(row);no(raw);}]);
 return row.pollStarted;
}
