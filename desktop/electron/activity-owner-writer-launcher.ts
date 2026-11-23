import { hex, nonce, same, inert, data, exact } from './activity-owner-writer-data.js';
import type { Scope, LaunchSdkTail, LaunchState, BusinessBootstrap, PreparationBootstrap, LaunchOptions } from './activity-owner-writer-launcher-types.js';
export type * from './activity-owner-writer-launcher-types.js';
import { createRelay as writerRelayImplementation } from './activity-owner-writer-relay.js';
import { runMainLaunch as writerLaunchImplementation } from './activity-owner-writer-launch.js';
import { drainDesktopWriterRelay as writerDrainImplementation } from './activity-owner-writer-drain.js';
import type { DesktopPreparationCompositionLaunch } from './default-dispatch-preparation-composition-bootstrap.js';
import { readOwnedCanonicalPreparationWorkBinding, type CanonicalPreparationFacet, type CanonicalPreparationSource, type CanonicalPreparationAdmission, type CanonicalBusinessAdmission } from '../../src/runtime/conversation-activity/owned-canonical-business.js';


import { type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { renameSync } from 'node:fs';
import { join } from 'node:path';

import { types } from 'node:util';
import { randomBytes } from 'node:crypto';
import { readKSwarmOwnedControlServiceScope, readKSwarmOwnedBusinessServiceScope, type KSwarmOwnedBusinessTransport, type KSwarmService } from './kswarm-service.js';
import { readKSwarmWriterControlBootstrap, type KSwarmWriterControlSource } from './kswarm-writer-control-source.js';
import type { DesktopWriterControlLaunch } from './kswarm-writer-control-native-bootstrap.js';
import type { KSwarmOwnedControlContext, KSwarmOwnedControlOperation } from './kswarm-owned-control.js';
import type { ActivityOwnerConfig } from '../../src/runtime/conversation-activity/owner-runtime.js';


import { ACTIVITY_STORAGE_NAMES, writePrivateActivityFile } from '../../src/runtime/conversation-activity/storage-permissions.js';

import { ConversationActivityOwnerClient } from '../../src/runtime/conversation-activity/owner-client.js';

import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { createIntrinsicSet, appendIntrinsic } from '../../src/runtime/verification/intrinsic-async-collection.js';
const NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
const descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,own=Object.hasOwn,define=Object.defineProperty,freeze=Object.freeze,create=Object.create,setPrototype=Object.setPrototypeOf,assign=Object.assign,splice=Array.prototype.splice,ownDescriptor=Object.getOwnPropertyDescriptor;
const nativeQueue=queueMicrotask;
const preparationIsProxy=types.isProxy,preparationIsAsync=types.isAsyncFunction;
const protocol='activity_desktop_config_v1',prototypeOf=Object.getPrototypeOf,asyncPrototype=Object.getPrototypeOf(async()=>{});







const launches=new WeakMap<object,LaunchState>(),services=new WeakMap<object,LaunchState>();
const originalLaunchStates=new WeakSet<object>(),originalLaunchHas=WeakSet.prototype.has,originalLaunchAdd=WeakSet.prototype.add;

export function readOriginalDesktopDispatchLaunchState(candidate:object):Readonly<{controller:object;service:KSwarmService;scope:Scope;child:ChildProcess|undefined;launch:object|undefined}>{
 if(!apply(originalLaunchHas,originalLaunchStates,[candidate]))throw Error('DISPATCH_NATIVE_ORIGINAL_LAUNCH_REQUIRED');const state=candidate as LaunchState;
 if(state.closed||!state.business||stateFor(state.service)!==state)throw Error('DISPATCH_NATIVE_ORIGINAL_LAUNCH_REQUIRED');
 return freeze(assign(create(null),{controller:state.business.controller,service:state.service,scope:state.scope,child:state.child,launch:state.business.launch}));
}

export function readOriginalDesktopPreparationLaunchState(candidate:object):Readonly<{owner:object;service:KSwarmService;scope:Scope;child:ChildProcess|undefined;composition:object|undefined}>{
 if(!apply(originalLaunchHas,originalLaunchStates,[candidate]))throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_LAUNCH_REQUIRED');const state=candidate as LaunchState;
 if(state.closed||!state.preparation||stateFor(state.service)!==state)throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_LAUNCH_REQUIRED');
 return freeze(assign(create(null),{owner:state.preparation.owner,service:state.service,scope:state.scope,child:state.child,composition:state.preparation.composition}));
}
function stateFor(service:object){return apply(weakGet,services,[service]) as LaunchState|undefined;}



function closedOptions(raw:unknown):LaunchOptions{
 if(!raw||typeof raw!=='object'||types.isProxy(raw))throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
 const rows=descriptors(raw),keys=ownKeys(rows),hasBusiness=own(rows,'businessBootstrap'),hasPreparation=own(rows,'preparationBootstrap');if(keys.length!==3+Number(hasBusiness)+Number(hasPreparation))throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
 const required=['source','service','capsule'];if(hasBusiness)required.push('businessBootstrap');if(hasPreparation)required.push('preparationBootstrap');for(let i=0;i<required.length;i++){const name=required[i]!;if(!own(rows,name)||!own(rows[name]!,'value')||!rows[name]!.enumerable)throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');}
 let businessBootstrap:BusinessBootstrap|undefined;
 if(hasBusiness){const value=rows.businessBootstrap!.value;if(!value||typeof value!=='object'||types.isProxy(value))throw Error('DISPATCH_NATIVE_ORIGINAL_BOOTSTRAP_REQUIRED');const fields=descriptors(value);if(ownKeys(fields).length!==2)throw Error('DISPATCH_NATIVE_ORIGINAL_BOOTSTRAP_REQUIRED');for(const name of ['controller','capsule'])if(!own(fields,name)||!own(fields[name]!,'value')||!fields[name]!.enumerable)throw Error('DISPATCH_NATIVE_ORIGINAL_BOOTSTRAP_REQUIRED');businessBootstrap=assign(create(null),{controller:fields.controller!.value,capsule:fields.capsule!.value});}
 let preparationBootstrap:PreparationBootstrap|undefined;
 if(hasPreparation){const value=rows.preparationBootstrap!.value;if(!value||typeof value!=='object'||types.isProxy(value))throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_COMPOSITION_REQUIRED');const fields=descriptors(value);if(ownKeys(fields).length!==2)throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_COMPOSITION_REQUIRED');for(const name of ['owner','capsule'])if(!own(fields,name)||!own(fields[name]!,'value')||!fields[name]!.enumerable)throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_COMPOSITION_REQUIRED');preparationBootstrap=assign(create(null),{owner:fields.owner!.value,capsule:fields.capsule!.value});}
 return {source:rows.source!.value,service:rows.service!.value,capsule:rows.capsule!.value,...(hasBusiness?{businessBootstrap}: {}),...(hasPreparation?{preparationBootstrap}: {})};
}
function asynchronousSdkValue(raw:unknown):boolean{
 if(!raw||typeof raw!=='object'&&typeof raw!=='function')return false;
 if(types.isPromise(raw))return true;let cursor:object|null=raw;
 for(let depth=0;cursor&&depth<16;depth++){if(types.isProxy(cursor)||ownDescriptor(cursor,'then'))return true;cursor=prototypeOf(cursor);}return cursor!==null;
}
function retainOriginalLaunchSdkRaw(state:LaunchState,raw:unknown,error:unknown):void{
 state.sdkFailure??=error;appendIntrinsic(state.sdkErrors,error);state.retainedInitialization.add(raw);
 if(!types.isPromise(raw)||types.isProxy(raw))return;
 const row:LaunchSdkTail=assign(create(null),{raw,completed:false,listeners:[]});state.sdkTails.add(row);state.retirementSdkTail?.(row);
 const complete=()=>{if(row.completed)return;row.completed=true;state.sdkTails.delete(row);state.retainedInitialization.delete(raw);const listeners=row.listeners;row.listeners=[];for(let i=0;i<listeners.length;i++)listeners[i]!();};
 try{if(ownDescriptor(raw as object,'then'))throw Error('DESKTOP_OWNER_SDK_RAW_UNKNOWN');assertStandardIpcPromise(raw,'DESKTOP_OWNER_SDK_RAW_UNKNOWN');apply(then,raw,[complete,(cause:unknown)=>{appendIntrinsic(state.sdkErrors,cause);complete();}]);}
 catch(cause){appendIntrinsic(state.sdkErrors,cause);/* Unobservable Native raw remains owned and pending. */}
}
function originalLaunchConnected(state:LaunchState,child:ChildProcess):boolean{
 if(state.sdkFailure)return false;const raw=child.connected;if(raw!==true&&raw!==false){retainOriginalLaunchSdkRaw(state,raw,Error('DESKTOP_OWNER_CONNECTED_UNKNOWN'));return false;}return raw;
}
function fixedPromise<T>(work:(yes:(value:T)=>void,no:(error:unknown)=>void)=>void){return new NativePromise<T>(work);}
const closePromiseConstructor=freeze(assign(create(null),{[Symbol.species]:NativePromise}));
function handledClosePromise(work:(yes:()=>void,no:(error:unknown)=>void)=>void):Promise<void>{
 const raw=fixedPromise<void>(work);define(raw,'constructor',{__proto__:null,value:closePromiseConstructor,configurable:true} as PropertyDescriptor);
 try{apply(then,raw,[()=>{},()=>{}]);}finally{define(raw,'constructor',{__proto__:null,value:NativePromise,configurable:false} as PropertyDescriptor);}return raw;
}
function observe(raw:Promise<void>,yes:()=>void,no:(error:unknown)=>void){assertStandardIpcPromise(raw,'WRITER_CONFIG_TAIL_UNKNOWN');void apply(then,raw,[yes,no]);}

function probeSocket(socketPath:string):Promise<boolean>{
 return fixedPromise((yes,no)=>{let done=false;const socket=createConnection(socketPath),timer=setTimeout(()=>finish(Error('activity_owner_probe_unknown')),1500);
  function finish(error?:unknown,present=false){if(done)return;done=true;clearTimeout(timer);socket.destroy();if(error)no(error);else yes(present);}
  socket.once('connect',()=>finish(undefined,true));socket.once('error',(error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error.code==='ECONNREFUSED')finish(undefined,false);else finish(error);});
 });
}

export function hasDesktopWriterRelay(service:KSwarmService):boolean{const state=stateFor(service);return !!state&&!state.closed&&state.relay?.installed===true;}
export function callDesktopWriterRelay(service:KSwarmService,op:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext):Promise<unknown>{const state=stateFor(service);if(!state?.relay||state.closed||!state.relay.installed||op!=='inspect_writer'&&op!=='prepare_initial_plan_writer')return fixedPromise((_,no)=>no(Error('WRITER_CONFIG_RELAY_UNAVAILABLE')));return state.relay.call(op,context);}
export function sealDesktopWriterRelay(source:KSwarmWriterControlSource,service:KSwarmService):void{const state=stateFor(service);if(!state||state.source!==source)return;state.closed=true;state.relay?.seal();}
export function getDesktopDispatchBusinessTransport(service:KSwarmService,admission:CanonicalBusinessAdmission):KSwarmOwnedBusinessTransport{
 const state=stateFor(service),business=state?.business;if(!state||state.closed||state.observationUnknown||state.spawnFailure||!business?.initialized||!business.port||business.admission!==admission)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');
 if(!same(readKSwarmOwnedBusinessServiceScope(service,admission),state.scope))throw Error('DISPATCH_BUSINESS_UNAVAILABLE');return business.port;
}

function assertPreparationConstructorPorts(value:Readonly<DesktopPreparationCompositionLaunch>):void{
 const sync=(fn:unknown)=>typeof fn==='function'&&!preparationIsProxy(fn)&&!preparationIsAsync(fn)&&prototypeOf(fn)!==asyncPrototype;
 const source=value.transportSource;
 if(!source||typeof source!=='object'||preparationIsProxy(source)||!sync(value.transportAdmission))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
 const rows=descriptors(source),names=['resolveWork','observeWork','sealWork'];
 for(let i=0;i<names.length;i++){const row=rows[names[i]!]!;if(!row||!own(row,'value')||!sync(row.value))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');}
}

export function getDesktopPreparationTransport(service:KSwarmService,source:CanonicalPreparationSource,admission:CanonicalPreparationAdmission):CanonicalPreparationFacet{
 const state=stateFor(service),preparation=state?.preparation;
 if(!state||state.closed||state.observationUnknown||state.spawnFailure||state.sdkFailure||!state.child||!state.dispatchClient||!preparation?.composition||preparation.failure||!preparation.port||preparation.composition.transportSource!==source||preparation.composition.transportAdmission!==admission)throw Error('DISPATCH_PREPARATION_UNAVAILABLE');
 preparation.composition.assertLocal();return preparation.port;
}

export function readDesktopPreparationAcceptedWorkBinding(service:KSwarmService,source:CanonicalPreparationSource,admission:CanonicalPreparationAdmission,work:unknown):Readonly<{scope:Scope;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>{
 const state=stateFor(service),preparation=state?.preparation;
 if(!state?.dispatchClient||!preparation?.composition||preparation.composition.transportSource!==source||preparation.composition.transportAdmission!==admission)throw Error('DISPATCH_PREPARATION_ORIGINAL_WORK_REQUIRED');
 return readOwnedCanonicalPreparationWorkBinding(state.dispatchClient,source,admission,work);
}
export function drainDesktopWriterRelay(service:KSwarmService):Promise<void>{return writerDrainImplementation(service,writerDrainContextValue); }
export function ensureDesktopConversationActivityOwner(config:ActivityOwnerConfig,raw:LaunchOptions):Promise<ConversationActivityOwnerClient>{
 try{
  const {source,service,capsule,businessBootstrap,preparationBootstrap}=closedOptions(raw);
  // Original WeakMap membership is tested before any supplied getter or I/O.
  const binding=readKSwarmWriterControlBootstrap(source,service);
  if(!same(binding.scope,readKSwarmOwnedControlServiceScope(service,source.admission)))throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
  const occupied=stateFor(service);if(occupied&&occupied.source!==source)throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
  const previous=apply(weakGet,launches,[source]) as LaunchState|undefined;
  if(previous){if(previous.service!==service||previous.capsule!==capsule||previous.business?.controller!==businessBootstrap?.controller||previous.business?.capsule!==businessBootstrap?.capsule||previous.preparation?.owner!==preparationBootstrap?.owner||previous.preparation?.capsule!==preparationBootstrap?.capsule)throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');return previous.promise;}
  let resolve!:(client:ConversationActivityOwnerClient)=>void,reject!:(error:unknown)=>void,complete!:()=>void;
  const state:LaunchState=assign(create(null),{source,service,capsule,scope:binding.scope,promise:fixedPromise<ConversationActivityOwnerClient>((yes,no)=>{resolve=yes;reject=no;}),workDone:fixedPromise<void>(yes=>{complete=yes;}),workCompleted:false,initializationListeners:[],complete(){state.workCompleted=true;complete();const listeners=state.initializationListeners;state.initializationListeners=[];for(let i=0;i<listeners.length;i++)listeners[i]!();},closed:false,retainedInitialization:createIntrinsicSet<unknown>(),digest:undefined,workRaw:undefined,observationUnknown:undefined,spawnFailure:undefined,failure:undefined,relay:undefined,child:undefined,configArtifact:undefined,closing:undefined,sdkFailure:undefined,sdkErrors:[],sdkTails:createIntrinsicSet<LaunchSdkTail>(),retirementSdkTail:undefined,preparation:preparationBootstrap?assign(create(null),{owner:preparationBootstrap.owner,capsule:preparationBootstrap.capsule,composition:undefined,port:undefined,failure:undefined}):undefined,business:businessBootstrap?assign(create(null),{controller:businessBootstrap.controller,capsule:businessBootstrap.capsule,launch:undefined,port:undefined,admission:undefined,initialized:false}):undefined});
  apply(originalLaunchAdd,originalLaunchStates,[state]);
  apply(weakSet,launches,[source,state]);apply(weakSet,services,[service,state]);
  function deliver(client:ConversationActivityOwnerClient){define(client,'then',{__proto__:null,value:undefined} as PropertyDescriptor);resolve(client);}
  apply(weakSet,deliveries,[state,deliver]);
  try{
   // Validate the intrinsic observer before starting any asynchronous producer.
   assertStandardIpcPromise(fixedPromise<void>(yes=>yes()),'WRITER_CONFIG_STARTUP_OBSERVER_UNKNOWN');
   const work=runMainLaunch(state,config);state.workRaw=work;
   observe(work,()=>state.complete(),error=>{state.failure=error;state.complete();reject(error);});
  }catch(error){
   state.closed=true;state.failure=error;
   // A started, unobserved raw stays strongly owned and unconfirmed. Every
   // pre-spawn continuation tests this flag; no later descriptor may be born.
   if(state.workRaw)state.observationUnknown=true;else state.complete();
   reject(error);
  }
  return state.promise;
 }catch(error){return fixedPromise((_,no)=>no(error));}
}

export function writeOwnerLaunchConfig(dataRoot:string,nonce:string,payload:unknown):string{
 const configFile=join(dataRoot,`activity-owner-launch-${nonce}.json`),bytes=JSON.stringify(payload);
 writePrivateActivityFile(configFile,bytes,true);
 const canonical=join(dataRoot,ACTIVITY_STORAGE_NAMES.config),temporary=`${canonical}.${randomBytes(8).toString('hex')}.tmp`;
 writePrivateActivityFile(temporary,bytes,true);renameSync(temporary,canonical);
 return configFile;
}
// This private delivery table contains no operation setter or caller callback.
const deliveries=new WeakMap<LaunchState,(client:ConversationActivityOwnerClient)=>void>();
async function runMainLaunch(state:LaunchState,config:ActivityOwnerConfig):Promise<void>{return writerLaunchImplementation(state,config,writerLaunchContextValue); }
function createRelay(state:LaunchState,child:ChildProcess,launch:DesktopWriterControlLaunch){return writerRelayImplementation(state,child,launch,writerRelayContextValue); }

const writerRelayContextValue={then,apply,ownKeys,own,freeze,splice,nativeQueue,protocol,prototypeOf,asyncPrototype,asynchronousSdkValue,originalLaunchConnected,hex,nonce,same,inert,data,exact,fixedPromise,handledClosePromise,observe};
export type writerRelayContext=typeof writerRelayContextValue;
const writerLaunchContextValue={NativePromise,apply,weakGet,freeze,stateFor,originalLaunchConnected,nonce,same,data,probeSocket,assertPreparationConstructorPorts,writeOwnerLaunchConfig,deliveries,createRelay};
export type writerLaunchContext=typeof writerLaunchContextValue;
const writerDrainContextValue={NativePromise,then,apply,define,create,prototypeOf,asyncPrototype,stateFor,asynchronousSdkValue,fixedPromise};
export type writerDrainContext=typeof writerDrainContextValue;


export function assertOriginalWriterImplementationContext(value:unknown,kind:'relay'|'launch'|'drain'):void {
 const expected=kind==='relay'?writerRelayContextValue:kind==='launch'?writerLaunchContextValue:kind==='drain'?writerDrainContextValue:undefined;
 if(!expected||value!==expected)throw Error('WRITER_CONFIG_ORIGINAL_IMPLEMENTATION_REQUIRED');
}
