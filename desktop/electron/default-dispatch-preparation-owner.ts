import {readOriginalPreparationNativeComposition,acquireOriginalPreparationNativeObservationLease,assertOriginalPreparationNativeObservationCurrent,assertOriginalPreparationNativeObservationLocal,releaseOriginalPreparationNativeObservationLease,type DefaultDispatchPreparationNativeSource,type OriginalPreparationNativeComposition} from './default-dispatch-preparation-native-source.js';
import {readKSwarmOwnedPreparationServiceScope,getKSwarmOwnedPreparationTransport,readOriginalPreparationAcceptedWorkBinding,type KSwarmService} from './kswarm-service.js';
import {readOriginalTaskSourcePopulationPreparationBinding,readOriginalTaskHostPreparationIO,type OriginalTaskSourcePopulationPreparationBinding} from '../../src/runtime/task-host/task-runtime-host.js';
import {takeOriginalDefaultDispatchObservationRequests,consumeOriginalDefaultDispatchObservationRequest,type OriginalDefaultDispatchObservationRequestData} from './default-dispatch-business-controller.js';
import {mapDefaultDispatchObservationInput} from './default-dispatch-observation-input.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {scanTaskStoreSdkChildren} from '../../src/runtime/task-host/source-sdk-children.js';
import {createIntrinsicSet,appendIntrinsic,settleIntrinsicOperations,aggregateIntrinsicErrors} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {types} from 'node:util';
import type {TaskDefaultDispatchPreparationSource} from '../../src/runtime/task-host/default-dispatch-preparation.js';
import type {KSwarmPreparationSource,KSwarmPreparationAdmission} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import type {IngressOwner} from './desktop-shutdown-coordinator.js';
const get=WeakMap.prototype.get,set=WeakMap.prototype.set,apply=Reflect.apply,create=Object.create,assign=Object.assign,freeze=Object.freeze;
const unavailable=()=>Error('DEFAULT_DISPATCH_PREPARATION_COMPOSITION_REQUIRED');
const noWork=()=>{throw Error('DEFAULT_DISPATCH_PREPARATION_WORK_AUTHORIZATION_UNAVAILABLE');};
const inert=<T extends object>(data:T):Readonly<T>=>freeze(assign(create(null),data));
const P=Promise,then=P.prototype.then,define=Object.defineProperty,Abort=AbortController;
const descriptors=Object.getOwnPropertyDescriptors,descriptor=Object.getOwnPropertyDescriptor,remove=Reflect.deleteProperty,own=Object.hasOwn;
const sameScope=(a:any,b:any)=>a?.profileId===b.profileId&&a?.workspaceId===b.workspaceId;
let observationSequence=0n;
const bigintString=BigInt.prototype.toString,pad=String.prototype.padStart;
// Non-secret correlation within an authenticated original client session.
// Actual authorization is the private request/proof, never these wire ids.
function correlation():string{observationSequence++;if(observationSequence>=1n<<256n)throw unavailable();return apply(pad,apply(bigintString,observationSequence,[16]),[64,'0']);}
function deferred<T>(){let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const promise=new P<T>((yes,no)=>{resolve=yes;reject=no;});define(promise,'constructor',{__proto__:null,value:P} as PropertyDescriptor);return{promise,resolve,reject};}
export interface DefaultDispatchPreparationObservation {readonly childKey:string;readonly status:'present'|'missing'|'unavailable';readonly reason?:string;readonly fact?:unknown}
export interface DefaultDispatchPreparationOwner {
 readonly transportSource:KSwarmPreparationSource;readonly transportAdmission:KSwarmPreparationAdmission;
 readonly hostSource:TaskDefaultDispatchPreparationSource;readonly ingress:IngressOwner;
 bindService(service:KSwarmService):void;bindOriginalHost(population:unknown,host:unknown):void;
 seal():void;drain():Promise<void>;
}
export interface DefaultDispatchPreparationComposition {
 readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly nativeIdentity:object;
 readonly populationIdentity:object;readonly hostIdentity:object;readonly storeIdentity:object;
 readonly transportSource:KSwarmPreparationSource;readonly transportAdmission:KSwarmPreparationAdmission;
 assertLocal():void;
}
export interface DefaultDispatchPreparationOwnerPorts {
 readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly hostSource:TaskDefaultDispatchPreparationSource;
 readonly transportSource:KSwarmPreparationSource;readonly transportAdmission:KSwarmPreparationAdmission;assertLocal():void;
}
interface Record {ports:Readonly<DefaultDispatchPreparationOwnerPorts>;native:Readonly<OriginalPreparationNativeComposition>;service?:KSwarmService;population?:unknown;host?:unknown;binding?:Readonly<OriginalTaskSourcePopulationPreparationBinding>;view?:Readonly<DefaultDispatchPreparationComposition>;assertLocal():void;observe(controller:unknown,invocation:unknown):Promise<readonly DefaultDispatchPreparationObservation[]>}
const owners=new WeakMap<object,Record>(),sourceOwners=new WeakMap<object,object>();
/** Original Main handoff only. Copied receipts and renderer DTOs cannot mint an
 * observation; each request is consumed before the old user invocation releases. */
export function observeOriginalDefaultDispatchPreparation(owner:unknown,controller:unknown,invocation:unknown):Promise<readonly DefaultDispatchPreparationObservation[]>{
 const row=owner&&typeof owner==='object'?apply(get,owners,[owner]) as Record|undefined:undefined;if(!row)throw unavailable();return row.observe(controller,invocation);
}
/** Narrow passive constructor ports, before Host creation. No Native lookup,
 * Work proof, Host IO or caller-supplied callback table is returned. */
export function readDefaultDispatchPreparationOwnerPorts(owner:unknown,service:unknown):Readonly<DefaultDispatchPreparationOwnerPorts>{
 const row=owner&&typeof owner==='object'?apply(get,owners,[owner]) as Record|undefined:undefined;
 if(!row||row.service!==service)throw unavailable();row.ports.assertLocal();return row.ports;
}
/** Original factory composition only. It is not a Native birth, Work lease,
 * checkpoint observation, B grant or permission to call any Host SDK. */
export function readDefaultDispatchPreparationComposition(owner:unknown,service:unknown):Readonly<DefaultDispatchPreparationComposition>{
 const row=owner&&typeof owner==='object'?apply(get,owners,[owner]) as Record|undefined:undefined;
 if(!row||row.service!==service||!row.view)throw unavailable();row.assertLocal();return row.view;
}
/** Passive composition with a read-only observation issuer. Only original
 * normal-capture requests may enter; prepare/send/ACK/execute remain denied. */
export function createDefaultDispatchPreparationOwner(source:DefaultDispatchPreparationNativeSource):DefaultDispatchPreparationOwner{
 const native=readOriginalPreparationNativeComposition(source);
 if(apply(get,sourceOwners,[source]))throw unavailable();
 const originalSeal=source.seal,originalDrain=source.drain,originalActivate=source.activate;
 type Binding=ReturnType<typeof readOriginalPreparationAcceptedWorkBinding>;
 interface Work {proof:object;hostProof:object;custody:object;workId:string;sourceIncarnation:string;request?:Readonly<OriginalDefaultDispatchObservationRequestData>;lease?:object;binding?:Binding;lower?:ReturnType<ReturnType<typeof getKSwarmOwnedPreparationTransport>['openWork']>;observer?:(cut:unknown)=>unknown;hostData?:unknown;hostEntered:boolean;finishing:boolean;unknown:boolean;failed:boolean;failure?:unknown;raw?:unknown;done:ReturnType<typeof deferred<void>>;result:ReturnType<typeof deferred<DefaultDispatchPreparationObservation>>;tails:ReturnType<typeof createIntrinsicSet<{raw:unknown;completion:Promise<void>}>>;seen:ReturnType<typeof createIntrinsicSet<object>>;signal:AbortSignal}
 const works=createIntrinsicSet<Work>(),proofs=new WeakMap<object,Work>(),hostProofs=new WeakMap<object,Work>(),custodies=new WeakMap<object,Work>(),failures:unknown[]=[];
 let sealed=false,closing:Promise<void>|undefined,frontier:Promise<void>|undefined;
 const find=(table:WeakMap<object,Work>,candidate:unknown)=>candidate&&typeof candidate==='object'?apply(get,table,[candidate]) as Work|undefined:undefined;
 function fail(work:Work,error:unknown){if(!work.failed){work.failed=true;work.failure=error;}}
 function children(work:Work,value:unknown){const found=scanTaskStoreSdkChildren(value);if(found.unknowns.length)work.unknown=true;for(let i=0;i<found.promises.length;i++)retain(work,found.promises[i]);}
 function retain(work:Work,raw:unknown,onValue?:(value:unknown)=>void,onError?:(error:unknown)=>void){
  if(!raw||typeof raw!=='object'&&typeof raw!=='function'){work.unknown=true;return;}
  if(work.seen.has(raw)){if(onValue||onError)work.unknown=true;return;}work.seen.add(raw);
  const done=deferred<void>(),tail={raw,completion:done.promise};work.tails.add(tail);
  // The fixed original client pins its internal Promise constructor to this
  // very intrinsic. It is metadata, not an SDK child. Inspect every other own
  // descriptor and keep all original child references without modifying raw.
  let inventoryRoot:unknown=raw,rootPromise=types.isPromise(raw);
  if(rootPromise&&!types.isProxy(raw)){const fields=descriptors(raw),ctor=descriptor(raw,'constructor');if(ctor&&own(ctor,'value')&&ctor.value===P){remove(fields,'constructor');inventoryRoot=create(null,fields);rootPromise=false;}}
  const inventory=scanTaskStoreSdkChildren(inventoryRoot,rootPromise);if(inventory.unknowns.length)work.unknown=true;for(let i=0;i<inventory.promises.length;i++)if(inventory.promises[i]!==raw)retain(work,inventory.promises[i]);
  try{assertStandardIpcPromise(raw,'DEFAULT_DISPATCH_OBSERVATION_SDK_UNKNOWN');apply(then,raw,[(value:unknown)=>{children(work,value);work.tails.delete(tail);done.resolve();onValue?.(value);},(error:unknown)=>{children(work,error);work.tails.delete(tail);done.resolve();onError?.(error);}]);}
  catch(error){work.unknown=true;fail(work,error);}
 }
 function invoke(work:Work,fn:Function,receiver:unknown,args:unknown[]):Promise<{value:unknown}>{
  const result=deferred<{value:unknown}>();let raw:unknown;
  try{raw=apply(fn,receiver,args);retain(work,raw,value=>result.resolve(inert({value})),error=>result.reject(error));}
  catch(error){children(work,error);result.reject(error);}return result.promise;
 }
 async function joinTails(work:Work){for(;;){await settleIntrinsicOperations(work.tails.snapshot(),tail=>tail.completion);if(!work.tails.size)return;}}
 function current(work:Work){if(!work.lease||work.unknown)throw unavailable();assertOriginalPreparationNativeObservationCurrent(source,work.lease);work.binding?.assertCurrent();assertOriginalPreparationNativeObservationLocal(source,work.lease);}
 function audience(work:Work,value:any,operation:string){
  const request=work.request;if(!request||work.finishing||value.serviceOwner!==row.service||value.operation!==operation||value.projectId!==request.projectId||!sameScope(value.scope,native.scope))return noWork();
  const input=captureDispatchBusinessData(value.input) as any;if(input.childKey!==request.childKey||input.payloadHash!==request.payloadHash||Reflect.ownKeys(input).length!==2)noWork();current(work);
 }
 const transportSource=inert<KSwarmPreparationSource>({
  resolveWork(proof,value){const work=find(proofs,proof);if(!work)noWork();audience(work!,value,'open_work');return inert({workId:work!.workId,sourceIncarnation:work!.sourceIncarnation,custody:work!.custody});},
  observeWork(custody,observer){const work=find(custodies,custody);if(!work||work.observer||typeof observer!=='function')noWork();work!.observer=observer;},
  sealWork(custody){const work=find(custodies,custody);if(!work)noWork();/* Original accepted observation owns its remaining read/cleanup. */},
 });
 const transportAdmission:KSwarmPreparationAdmission=(proof,value)=>{const work=find(proofs,proof);if(!work)noWork();if(value.operation!=='open_work'&&value.operation!=='read_preparation_basis')noWork();if(value.workId!==work!.workId||value.sourceIncarnation!==work!.sourceIncarnation)noWork();audience(work!,value,value.operation);};
 const hostSource=inert<TaskDefaultDispatchPreparationSource>({resolve(proof,purpose){const work=find(hostProofs,proof);if(!work||purpose!=='observe'||!work.hostData||!work.hostEntered||work.finishing)noWork();current(work!);return inert({data:work!.hostData,assertCurrent(){current(work!);}});}});
 const baseLocal=()=>{if(sealed)throw unavailable();native.assertLocal();};
 const serviceLocal=(service:KSwarmService)=>{const scope=readKSwarmOwnedPreparationServiceScope(service,transportSource,transportAdmission);if(scope.profileId!==native.scope.profileId||scope.workspaceId!==native.scope.workspaceId)throw unavailable();};
 const row:Record=assign(create(null),{ports:undefined,native,service:undefined,population:undefined,host:undefined,binding:undefined,view:undefined,observe:observe,assertLocal(){
  baseLocal();if(!row.service||!row.binding)throw unavailable();serviceLocal(row.service);
  const current=readOriginalTaskSourcePopulationPreparationBinding(row.population,row.host,hostSource);
  if(current.identity!==row.binding.identity||current.hostIdentity!==row.binding.hostIdentity||current.store!==row.binding.store||current.storeIdentity!==row.binding.storeIdentity)throw unavailable();baseLocal();
 }});
 row.ports=inert<DefaultDispatchPreparationOwnerPorts>({scope:native.scope,hostSource,transportSource,transportAdmission,assertLocal(){baseLocal();if(!row.service)throw unavailable();serviceLocal(row.service);baseLocal();}});
 function start(controller:unknown,request:object):Work{
  baseLocal();
  const work:Work=assign(create(null),{proof:inert({}),hostProof:inert({}),custody:inert({}),workId:correlation(),sourceIncarnation:correlation(),hostEntered:false,finishing:false,unknown:false,failed:false,done:deferred<void>(),result:deferred<DefaultDispatchPreparationObservation>(),tails:createIntrinsicSet(),seen:createIntrinsicSet(),signal:new Abort().signal});works.add(work);
  // The one original client has one short RPC slot. Existing accepted Work
  // roots form a dependency chain; no second transport/store queue is created.
  const previous=frontier;frontier=work.done.promise;
  try{
   work.request=consumeOriginalDefaultDispatchObservationRequest(controller,request,owner,row.service).data;
   apply(originalActivate,source,[]);work.lease=acquireOriginalPreparationNativeObservationLease(source);row.assertLocal();
   apply(set,proofs,[work.proof,work]);apply(set,hostProofs,[work.hostProof,work]);apply(set,custodies,[work.custody,work]);
   const facet=getKSwarmOwnedPreparationTransport(row.service!,transportSource,transportAdmission),lookup={childKey:work.request.childKey,payloadHash:work.request.payloadHash};
   try{work.lower=facet.openWork(work.request.projectId,lookup,{requestSource:'scheduler',preparationProof:work.proof,signal:work.signal});}
   finally{try{work.binding=readOriginalPreparationAcceptedWorkBinding(row.service,transportSource,transportAdmission,work.lower??work.proof);}catch(error){if(work.observer)work.unknown=true;fail(work,error);}}
  }catch(error){fail(work,error);}
  const run=(async()=>{
   let result:DefaultDispatchPreparationObservation={childKey:work.request?.childKey??'',status:'unavailable',reason:'observation_failed'};
   try{
    if(previous)await previous;
    if(work.failed)throw work.failure;
    const basis=(await invoke(work,work.lower!.readBasis,work.lower,[])).value;current(work);
    const mapped=mapDefaultDispatchObservationInput(work.request!,basis);
    if(mapped.kind==='unavailable')result={childKey:work.request!.childKey,status:'unavailable',reason:mapped.reason};
    else{
     work.hostData=mapped.data;const io=readOriginalTaskHostPreparationIO(row.host,hostSource);current(work);work.hostEntered=true;
     const fact=(await invoke(work,io.observe,io,[work.hostProof,'scheduler'])).value;current(work);
     result=fact===null?{childKey:work.request!.childKey,status:'missing'}:{childKey:work.request!.childKey,status:'present',fact:captureDispatchBusinessData(fact)};
    }
   }catch(error){fail(work,error);children(work,error);}
   work.finishing=true;
   try{
    await joinTails(work);if(work.binding)await invoke(work,work.binding.waitKnown,work.binding,[]);await joinTails(work);
    if(work.unknown)return;
    if(!work.failed)try{current(work);}catch(error){fail(work,error);result={childKey:work.request!.childKey,status:'unavailable',reason:'observation_withdrawn'};}
    if(work.binding){await invoke(work,work.binding.waitKnown,work.binding,[]);await joinTails(work);work.binding.assertKnown();}
    if(work.unknown)return;
    if(work.observer){const raw=apply(work.observer,undefined,[inert({disposition:'no_ack'})]);if(raw!==undefined){retain(work,raw);work.unknown=true;return;}}
    if(work.lease){try{assertOriginalPreparationNativeObservationLocal(source,work.lease);}catch{result={childKey:work.request!.childKey,status:'unavailable',reason:'observation_withdrawn'};}releaseOriginalPreparationNativeObservationLease(source,work.lease);}
    works.delete(work);if(frontier===work.done.promise)frontier=undefined;work.result.resolve(captureDispatchBusinessData(result) as unknown as DefaultDispatchPreparationObservation);work.done.resolve();
   }catch(error){fail(work,error);children(work,error);work.unknown=true;appendIntrinsic(failures,error);}
  })();work.raw=run;define(run,'constructor',{__proto__:null,value:P} as PropertyDescriptor);apply(then,run,[()=>{},error=>{work.unknown=true;fail(work,error);appendIntrinsic(failures,error);}]);return work;
 }
 function observe(controller:unknown,invocation:unknown):Promise<readonly DefaultDispatchPreparationObservation[]>{
  row.assertLocal();const requests=takeOriginalDefaultDispatchObservationRequests(controller,invocation,owner,row.service),accepted:Work[]=[];
  for(let i=0;i<requests.length;i++)appendIntrinsic(accepted,start(controller,requests[i]!));
  const result=deferred<readonly DefaultDispatchPreparationObservation[]>();const run=(async()=>{const values:DefaultDispatchPreparationObservation[]=[];for(let i=0;i<accepted.length;i++)appendIntrinsic(values,await accepted[i]!.result.promise);result.resolve(captureDispatchBusinessData(values) as unknown as readonly DefaultDispatchPreparationObservation[]);})();define(run,'constructor',{__proto__:null,value:P} as PropertyDescriptor);apply(then,run,[()=>{},result.reject]);return result.promise;
 }
 function seal(){sealed=true;apply(originalSeal,source,[]);}
 function drain():Promise<void>{
  if(closing)return closing;const result=deferred<void>();closing=result.promise;seal();
  const run=(async()=>{await settleIntrinsicOperations(works.snapshot(),work=>work.done.promise);await apply(originalDrain,source,[]);if(failures.length)throw aggregateIntrinsicErrors(failures,'DEFAULT_DISPATCH_OBSERVATION_DRAIN_UNCONFIRMED');})();define(run,'constructor',{__proto__:null,value:P} as PropertyDescriptor);apply(then,run,[()=>result.resolve(),result.reject]);return closing;
 }
 const ingress=inert<IngressOwner>({name:'default-dispatch-preparation-owner',stopAccepting:seal,abortAllActive:seal,drain(deadline){const result=deferred<boolean>(),timer=setTimeout(()=>result.resolve(false),Math.max(0,deadline));apply(then,drain(),[()=>{clearTimeout(timer);result.resolve(true);},()=>{clearTimeout(timer);result.resolve(false);}]);return result.promise;}});
 const owner=inert<DefaultDispatchPreparationOwner>({transportSource,transportAdmission,hostSource,ingress,
  bindService(service){baseLocal();if(row.service)throw unavailable();serviceLocal(service);baseLocal();row.service=service;},
  bindOriginalHost(population,host){
   baseLocal();if(!row.service||row.binding)throw unavailable();serviceLocal(row.service);
   const binding=readOriginalTaskSourcePopulationPreparationBinding(population,host,hostSource);baseLocal();
   row.population=population;row.host=host;row.binding=binding;
   row.view=inert<DefaultDispatchPreparationComposition>({scope:native.scope,nativeIdentity:native.identity,populationIdentity:binding.identity,hostIdentity:binding.hostIdentity,storeIdentity:binding.storeIdentity,transportSource,transportAdmission,assertLocal:row.assertLocal});
  },
  seal,drain,
 });
 apply(set,owners,[owner,row]);apply(set,sourceOwners,[source,owner]);return owner;
}
