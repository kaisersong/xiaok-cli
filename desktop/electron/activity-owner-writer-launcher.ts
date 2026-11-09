import type {DesktopPreparationCompositionLaunch} from './default-dispatch-preparation-composition-bootstrap.js';
import {createOwnedCanonicalBusiness,prepareOwnedCanonicalBusinessHello,assertOwnedCanonicalBusinessHelloCurrent,readOwnedCanonicalBusinessRetirement,observeOwnedCanonicalBusinessClose,readOwnedCanonicalPreparationFacet,readOwnedCanonicalPreparationWorkBinding,type CanonicalPreparationFacet,type CanonicalPreparationSource,type CanonicalPreparationAdmission,type CanonicalBusinessAdmission} from '../../src/runtime/conversation-activity/owned-canonical-business.js';
import {dispatchBusinessProtocolTag} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import type {DesktopDispatchLaunch} from './default-dispatch-native-bootstrap.js';
import {spawn,type ChildProcess} from 'node:child_process';
import {createConnection} from 'node:net';
import {openSync,closeSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {randomBytes} from 'node:crypto';
import {readKSwarmOwnedControlServiceScope,readKSwarmOwnedBusinessServiceScope,type KSwarmOwnedBusinessTransport,type KSwarmService} from './kswarm-service.js';
import {readKSwarmWriterControlBootstrap,type KSwarmWriterControlSource} from './kswarm-writer-control-source.js';
import type {DesktopWriterControlLaunch} from './kswarm-writer-control-native-bootstrap.js';
import type {KSwarmOwnedControlContext,KSwarmOwnedControlOperation} from './kswarm-owned-control.js';
import type {ActivityOwnerConfig} from '../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerConfigDigest} from '../../src/runtime/conversation-activity/owner-runtime.js';
import {activityOwnerAddress,readActivityOwnerCredentials,ACTIVITY_OWNER_GENERATION} from '../../src/runtime/conversation-activity/owner-protocol.js';
import {ACTIVITY_STORAGE_NAMES,chmodPrivateActivityFile} from '../../src/runtime/conversation-activity/storage-permissions.js';
import {buildActivityOwnerEnv} from '../../src/runtime/conversation-activity/owner-launcher.js';
import {ConversationActivityOwnerClient} from '../../src/runtime/conversation-activity/owner-client.js';
import {captureOwnedConfigurationData} from '../../src/runtime/conversation-activity/owned-kswarm-control.js';
import {assertStandardIpcPromise} from './ipc-native-promise.js';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
const NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
const descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,own=Object.hasOwn,define=Object.defineProperty,freeze=Object.freeze,create=Object.create,setPrototype=Object.setPrototypeOf,assign=Object.assign,splice=Array.prototype.splice,ownDescriptor=Object.getOwnPropertyDescriptor;
const nativeQueue=queueMicrotask;
const preparationIsProxy=types.isProxy,preparationIsAsync=types.isAsyncFunction;
const protocol='activity_desktop_config_v1',prototypeOf=Object.getPrototypeOf,asyncPrototype=Object.getPrototypeOf(async()=>{});
type Scope=Readonly<{profileId:string;workspaceId:string}>;
type Operation='inspect_writer'|'prepare_initial_plan_writer';
interface Status {profileId:string;generation?:number;configDigest?:string;ready?:boolean;pid?:number;ownerEpoch?:string;nativeSourceProtocol?:number}
interface LaunchSdkTail {raw:Promise<unknown>;completed:boolean;listeners:Array<()=>void>}
interface PreparationLaunchState {owner:object;capsule:object;composition?:Readonly<DesktopPreparationCompositionLaunch>;port?:CanonicalPreparationFacet;failure?:{error:unknown}}
interface LaunchState {dispatchClient?:ReturnType<typeof createOwnedCanonicalBusiness>;preparation?:PreparationLaunchState;source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;scope:Scope;digest?:string;promise:Promise<ConversationActivityOwnerClient>;workRaw?:Promise<void>;observationUnknown?:boolean;spawnFailure?:unknown;retainedInitialization:ReturnType<typeof createIntrinsicSet<unknown>>;workDone:Promise<void>;workCompleted:boolean;initializationListeners:Array<()=>void>;complete():void;closed:boolean;failure?:unknown;relay?:Relay;child?:ChildProcess;configArtifact?:string;closing?:Promise<void>;sdkFailure?:unknown;sdkErrors:unknown[];sdkTails:ReturnType<typeof createIntrinsicSet<LaunchSdkTail>>;retirementSdkTail?:((tail:LaunchSdkTail)=>void);business?:{controller:object;capsule:object;launch?:DesktopDispatchLaunch;port?:KSwarmOwnedBusinessTransport;admission?:CanonicalBusinessAdmission;initialized:boolean}}
interface Relay {readonly installed:boolean;call(op:Operation,context:KSwarmOwnedControlContext):Promise<unknown>;seal():void;drain():Promise<void>;observeClose(done:(error?:unknown)=>void):void;retirement():Readonly<{revision:number;known:boolean}>}
const launches=new WeakMap<object,LaunchState>(),services=new WeakMap<object,LaunchState>();
const originalLaunchStates=new WeakSet<object>(),originalLaunchHas=WeakSet.prototype.has,originalLaunchAdd=WeakSet.prototype.add;
/** Internal original launch attempt/descriptor observation. A caller DTO,
 * health/PID, copied record or supplied ChildProcess is never an origin. */
export function readOriginalDesktopDispatchLaunchState(candidate:object):Readonly<{controller:object;service:KSwarmService;scope:Scope;child:ChildProcess|undefined;launch:object|undefined}>{
 if(!apply(originalLaunchHas,originalLaunchStates,[candidate]))throw Error('DISPATCH_NATIVE_ORIGINAL_LAUNCH_REQUIRED');const state=candidate as LaunchState;
 if(state.closed||!state.business||stateFor(state.service)!==state)throw Error('DISPATCH_NATIVE_ORIGINAL_LAUNCH_REQUIRED');
 return freeze(assign(create(null),{controller:state.business.controller,service:state.service,scope:state.scope,child:state.child,launch:state.business.launch}));
}
/** Original dormant-composition binding only, never a Native/Work grant. */
export function readOriginalDesktopPreparationLaunchState(candidate:object):Readonly<{owner:object;service:KSwarmService;scope:Scope;child:ChildProcess|undefined;composition:object|undefined}>{
 if(!apply(originalLaunchHas,originalLaunchStates,[candidate]))throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_LAUNCH_REQUIRED');const state=candidate as LaunchState;
 if(state.closed||!state.preparation||stateFor(state.service)!==state)throw Error('DEFAULT_DISPATCH_PREPARATION_ORIGINAL_LAUNCH_REQUIRED');
 return freeze(assign(create(null),{owner:state.preparation.owner,service:state.service,scope:state.scope,child:state.child,composition:state.preparation.composition}));
}
function stateFor(service:object){return apply(weakGet,services,[service]) as LaunchState|undefined;}
interface BusinessBootstrap {controller:object;capsule:object}
interface PreparationBootstrap {owner:object;capsule:object}
interface LaunchOptions {source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;businessBootstrap?:BusinessBootstrap;preparationBootstrap?:PreparationBootstrap}
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
function hex(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
function nonce(){const bytes=randomBytes(32);let result='';const digits='0123456789abcdef';for(let i=0;i<bytes.length;i++)result+=digits[bytes[i]!>>>4]!+digits[bytes[i]!&15]!;return result;}
function same(a:Scope,b:Scope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
function inert(raw:unknown):unknown{if(!raw||typeof raw!=='object')return raw;setPrototype(raw,null);const rows=descriptors(raw),keys=ownKeys(rows);for(let i=0;i<keys.length;i++){const key=keys[i]!;if(typeof key==='string'&&key!=='length'&&own(rows[key]!,'value'))inert(rows[key]!.value);}return raw;}
function data(raw:unknown){return inert(captureOwnedConfigurationData(raw)) as Record<string,unknown>;}
function exact(row:Record<string,unknown>,keys:readonly string[]){const names=ownKeys(row);if(names.length!==keys.length)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');for(let i=0;i<keys.length;i++)if(!own(row,keys[i]!))throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
function fixedPromise<T>(work:(yes:(value:T)=>void,no:(error:unknown)=>void)=>void){return new NativePromise<T>(work);}
const closePromiseConstructor=freeze(assign(create(null),{[Symbol.species]:NativePromise}));
function handledClosePromise(work:(yes:()=>void,no:(error:unknown)=>void)=>void):Promise<void>{
 const raw=fixedPromise<void>(work);define(raw,'constructor',{__proto__:null,value:closePromiseConstructor,configurable:true} as PropertyDescriptor);
 try{apply(then,raw,[()=>{},()=>{}]);}finally{define(raw,'constructor',{__proto__:null,value:NativePromise,configurable:false} as PropertyDescriptor);}return raw;
}
function observe(raw:Promise<void>,yes:()=>void,no:(error:unknown)=>void){assertStandardIpcPromise(raw,'WRITER_CONFIG_TAIL_UNKNOWN');void apply(then,raw,[yes,no]);}
/** Read-only transport-stage probe. Credential ENOENT is never socket absence. */
function probeSocket(socketPath:string):Promise<boolean>{
 return fixedPromise((yes,no)=>{let done=false;const socket=createConnection(socketPath),timer=setTimeout(()=>finish(Error('activity_owner_probe_unknown')),1500);
  function finish(error?:unknown,present=false){if(done)return;done=true;clearTimeout(timer);socket.destroy();if(error)no(error);else yes(present);}
  socket.once('connect',()=>finish(undefined,true));socket.once('error',(error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT'||error.code==='ECONNREFUSED')finish(undefined,false);else finish(error);});
 });
}
/** These fixed lookups do not accept an injected port or recover one from data. */
export function hasDesktopWriterRelay(service:KSwarmService):boolean{const state=stateFor(service);return !!state&&!state.closed&&state.relay?.installed===true;}
export function callDesktopWriterRelay(service:KSwarmService,op:KSwarmOwnedControlOperation,context:KSwarmOwnedControlContext):Promise<unknown>{const state=stateFor(service);if(!state?.relay||state.closed||!state.relay.installed||op!=='inspect_writer'&&op!=='prepare_initial_plan_writer')return fixedPromise((_,no)=>no(Error('WRITER_CONFIG_RELAY_UNAVAILABLE')));return state.relay.call(op,context);}
export function sealDesktopWriterRelay(source:KSwarmWriterControlSource,service:KSwarmService):void{const state=stateFor(service);if(!state||state.source!==source)return;state.closed=true;state.relay?.seal();}
export function getDesktopDispatchBusinessTransport(service:KSwarmService,admission:CanonicalBusinessAdmission):KSwarmOwnedBusinessTransport{
 const state=stateFor(service),business=state?.business;if(!state||state.closed||state.observationUnknown||state.spawnFailure||!business?.initialized||!business.port||business.admission!==admission)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');
 if(!same(readKSwarmOwnedBusinessServiceScope(service,admission),state.scope))throw Error('DISPATCH_BUSINESS_UNAVAILABLE');return business.port;
}
/** Pure preflight before the one shared constructor. A malformed optional
 * preparation pair cannot poison the existing user/config client. */
function assertPreparationConstructorPorts(value:Readonly<DesktopPreparationCompositionLaunch>):void{
 const sync=(fn:unknown)=>typeof fn==='function'&&!preparationIsProxy(fn)&&!preparationIsAsync(fn)&&prototypeOf(fn)!==asyncPrototype;
 const source=value.transportSource;
 if(!source||typeof source!=='object'||preparationIsProxy(source)||!sync(value.transportAdmission))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
 const rows=descriptors(source),names=['resolveWork','observeWork','sealWork'];
 for(let i=0;i<names.length;i++){const row=rows[names[i]!]!;if(!row||!own(row,'value')||!sync(row.value))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');}
}
/** Genuine same-client delegated facet. Composition identity is not Work permission. */
export function getDesktopPreparationTransport(service:KSwarmService,source:CanonicalPreparationSource,admission:CanonicalPreparationAdmission):CanonicalPreparationFacet{
 const state=stateFor(service),preparation=state?.preparation;
 if(!state||state.closed||state.observationUnknown||state.spawnFailure||state.sdkFailure||!state.child||!state.dispatchClient||!preparation?.composition||preparation.failure||!preparation.port||preparation.composition.transportSource!==source||preparation.composition.transportAdmission!==admission)throw Error('DISPATCH_PREPARATION_UNAVAILABLE');
 preparation.composition.assertLocal();return preparation.port;
}
/** Only an accepted Work of the retained original canonical client. Normal
 * retirement may seal entry while its actual child and original tails remain. */
export function readDesktopPreparationAcceptedWorkBinding(service:KSwarmService,source:CanonicalPreparationSource,admission:CanonicalPreparationAdmission,work:unknown):Readonly<{scope:Scope;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>{
 const state=stateFor(service),preparation=state?.preparation;
 if(!state?.dispatchClient||!preparation?.composition||preparation.composition.transportSource!==source||preparation.composition.transportAdmission!==admission)throw Error('DISPATCH_PREPARATION_ORIGINAL_WORK_REQUIRED');
 return readOwnedCanonicalPreparationWorkBinding(state.dispatchClient,source,admission,work);
}
export function drainDesktopWriterRelay(service:KSwarmService):Promise<void>{
 const found=stateFor(service);if(!found)return fixedPromise(yes=>yes());const state:LaunchState=found;if(state.closing)return state.closing;
 let resolve!:()=>void,reject!:(error:unknown)=>void;const output=fixedPromise<void>((yes,no)=>{resolve=yes;reject=no;});define(output,'constructor',{__proto__:null,value:NativePromise} as PropertyDescriptor);state.closing=output;state.closed=true;
 const errors:unknown[]=[];let started=false,remaining=0,scheduling=true,physicalStarted=false,settled=false;
 const remember=(error:unknown)=>appendIntrinsic(errors,error);
 const finish=()=>{if(scheduling||remaining||settled)return;settled=true;if(state.failure)remember(state.failure);for(let i=0;i<state.sdkErrors.length;i++)remember(state.sdkErrors[i]);if(state.observationUnknown)remember(Error('DESKTOP_OWNER_RETIREMENT_OBSERVER_UNKNOWN'));if(errors.length)reject(aggregateIntrinsicErrors(errors,'DESKTOP_OWNER_RETIREMENT_UNCONFIRMED'));else resolve();};
 function unexpected(raw:unknown,label:string){
  state.retainedInitialization.add(raw);remember(Error(label));
  // Unknown native Promise observation stays pending and strongly retained.
  // Every independently observable native raw joins this original owner.
  if(!types.isPromise(raw)||types.isProxy(raw))return;
  remaining++;try{assertStandardIpcPromise(raw,'DESKTOP_OWNER_RETIREMENT_TAIL_UNKNOWN');apply(then,raw,[()=>{state.retainedInitialization.delete(raw);remaining--;finish();},(error:unknown)=>{remember(error);state.retainedInitialization.delete(raw);remaining--;finish();}]);}catch(error){state.observationUnknown=true;remember(error);}
 }
 const callable=(raw:unknown):raw is Function=>typeof raw==='function'&&!types.isProxy(raw)&&!types.isAsyncFunction(raw)&&prototypeOf(raw)!==asyncPrototype;
 function retirePhysical(){
  if(physicalStarted)return;physicalStarted=true;if(errors.length||state.failure||state.sdkFailure||state.observationUnknown){scheduling=false;finish();return;}
  const child=state.child;if(!child){scheduling=false;finish();return;}
  const assertCut=()=>{if(state.observationUnknown||state.sdkFailure||state.child!==child||!state.relay?.retirement().known||state.business&&!state.dispatchClient||state.dispatchClient&&!readOwnedCanonicalBusinessRetirement(state.dispatchClient).known)throw Error('DESKTOP_OWNER_RETIREMENT_UNCONFIRMED');};
  // Every property is an SDK result, including a diagnostic/invalid return.
  // Reserve it before classification, and finish lookups before either cut.
  let disconnect:unknown,channel:unknown,unref:unknown,connected:unknown;
  try{disconnect=child.disconnect;if(!callable(disconnect))unexpected(disconnect,'DESKTOP_OWNER_DISCONNECT_UNKNOWN');}catch(error){remember(error);}
  try{channel=child.channel;if(channel!==undefined&&channel!==null){if(typeof channel!=='object'||asynchronousSdkValue(channel)){unexpected(channel,'DESKTOP_OWNER_CHANNEL_UNKNOWN');channel=undefined;}else{unref=(channel as {unref?:unknown}).unref;if(!callable(unref))unexpected(unref,'DESKTOP_OWNER_UNREF_UNKNOWN');}}}catch(error){remember(error);channel=undefined;}
  try{connected=child.connected;if(connected!==true&&connected!==false)unexpected(connected,'DESKTOP_OWNER_CONNECTED_UNKNOWN');}catch(error){remember(error);}
  const sdk=(fn:Function,receiver:object)=>{try{assertCut();const raw=apply(fn,receiver,[]);if(raw!==undefined)unexpected(raw,'DESKTOP_OWNER_RETIREMENT_RETURN_UNKNOWN');}catch(error){remember(error);}};
  // A failed lookup grants no new physical action. Already admitted SDK raws
  // remain joined; successful disconnect cannot skip the independent unref.
  if(!errors.length){if(connected===true&&callable(disconnect))sdk(disconnect,child);if(channel&&callable(unref))sdk(unref,channel as object);}
  scheduling=false;finish();
 }
 function afterLanes(error?:unknown){if(error!==undefined)remember(error);if(--remaining===0){if(physicalStarted)finish();else retirePhysical();}}
 function afterInitialization(){
  if(started)return;started=true;if(state.observationUnknown){remember(Error('WRITER_CONFIG_STARTUP_OBSERVER_UNKNOWN'));scheduling=false;finish();return;}
  // Both obligations exist before either callback may run synchronously.
  const sdkRows=state.sdkTails.snapshot();remaining=(state.relay?1:0)+(state.dispatchClient?1:0)+sdkRows.length;
  const joinSdk=(row:LaunchSdkTail,late=false)=>{if(late)remaining++;let notified=false;const done=()=>{if(notified)return;notified=true;afterLanes();};if(row.completed)done();else appendIntrinsic(row.listeners,done);};state.retirementSdkTail=row=>joinSdk(row,true);
  if(!remaining){retirePhysical();return;}for(let i=0;i<sdkRows.length;i++)joinSdk(sdkRows[i]!);
  const once=()=>{let notified=false;return(error?:unknown)=>{if(notified)return;notified=true;afterLanes(error);};};
  if(state.relay)try{state.relay.observeClose(once());}catch(error){remember(error);/* Missing original completion is never synthesized. */}
  if(state.dispatchClient)try{observeOwnedCanonicalBusinessClose(state.dispatchClient,once());}catch(error){remember(error);}
 }
 state.relay?.seal();state.dispatchClient?.seal();if(state.workCompleted)afterInitialization();else appendIntrinsic(state.initializationListeners,afterInitialization);return output;
}
/** Fixed Main-only launch. Generic ensure, CLI options and ordinary RPC cannot
 * obtain a configuration relay. Only the genuine Native capsule factory may
 * create a relay record, and only a new inherited descriptor may install it. */
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
// This private delivery table contains no operation setter or caller callback.
const deliveries=new WeakMap<LaunchState,(client:ConversationActivityOwnerClient)=>void>();
async function runMainLaunch(state:LaunchState,config:ActivityOwnerConfig):Promise<void>{
 if(!same(state.scope,readKSwarmOwnedControlServiceScope(state.service,state.source.admission)))throw Error('WRITER_CONTROL_NATIVE_BOOTSTRAP_REQUIRED');
 const address=activityOwnerAddress(config.dataRoot),normalized={...config,dataRoot:address.dataRoot},digest=activityOwnerConfigDigest(normalized);state.digest=digest;
 async function attach(){const client=new ConversationActivityOwnerClient(address.dataRoot,'producer');try{const status=await client.request<Status>('status');if(status.profileId!==config.profileId)throw Error('activity_owner_profile_mismatch');if(typeof status.generation==='number'&&status.generation>=ACTIVITY_OWNER_GENERATION&&status.configDigest!==digest)throw Error('activity_owner_config_mismatch');if(status.ready===false)throw Error('activity_owner_initializing');if(config.identity.kind==='desktop'&&status.nativeSourceProtocol===1)try{const connection=await client.authorizeNativeSource();client.assertNativeConnectionCurrent(connection);}catch(error){console.warn('[conversation-activity] Native source unavailable:',error);}return {client,status};}catch(error){client.dispose();throw error;}}
 // Malformed/private credential failures remain errors even if a socket is gone.
 try{readActivityOwnerCredentials(address);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 const present=await probeSocket(address.socketPath);if(state.observationUnknown)return;
 if(present){const attached=await attach();state.closed=true;(apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;}
 if(state.closed)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
 if(state.preparation){try{const binding=await import('./default-dispatch-preparation-composition-bootstrap.js');if(state.closed)throw Error('DEFAULT_DISPATCH_PREPARATION_LAUNCH_CLOSED');state.preparation.composition=binding.consumeDesktopPreparationCompositionCapsule(state.preparation.capsule,state);}catch(error){state.preparation.failure={error};}}
 const {consumeDesktopWriterControlLaunchCapsule}=await import('./kswarm-writer-control-native-bootstrap.js');if(state.observationUnknown)return;
 if(state.closed)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
 const launch=consumeDesktopWriterControlLaunchCapsule(state.capsule,{source:state.source,service:state.service,scope:state.scope});
 let businessBinding:typeof import('./default-dispatch-native-bootstrap.js')|undefined;if(state.business){businessBinding=await import('./default-dispatch-native-bootstrap.js');if(state.closed||state.observationUnknown)throw Error('DISPATCH_NATIVE_LAUNCH_CLOSED');state.business.launch=businessBinding.consumeDesktopDispatchLaunchCapsule(state.business.capsule,state);}
 const configFile=join(address.dataRoot,`activity-owner-launch-${launch.mainLaunchNonce}.json`);state.configArtifact=configFile;
 const configFd=openSync(configFile,'wx',0o600);try{writeFileSync(configFd,JSON.stringify(data(normalized)));}finally{closeSync(configFd);}chmodPrivateActivityFile(configFile);
 const logFile=join(address.dataRoot,ACTIVITY_STORAGE_NAMES.log),logFd=openSync(logFile,'a',0o600);let child:ChildProcess;
 try{
  chmodPrivateActivityFile(logFile);const executable=process.execPath,args=[fileURLToPath(new URL('../../src/runtime/conversation-activity/owner-entry.js',import.meta.url)),configFile],spawnOptions={detached:true,stdio:['ignore',logFd,logFd,'ipc'] as ['ignore',number,number,'ipc'],windowsHide:true,env:{...buildActivityOwnerEnv(process.env),ELECTRON_RUN_AS_NODE:'1'}};
  launch.assertCurrent();state.business?.launch!.assertCurrent();launch.assertLocal();state.business?.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure||stateFor(state.service)!==state)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');
  child=spawn(executable,args,spawnOptions);state.child=child;
 }finally{closeSync(logFd);}
 let relay:ReturnType<typeof createRelay>|undefined;try{relay=createRelay(state,child!,launch);state.relay=relay;}catch(error){state.failure=error;}
 const deadline=Date.now()+30000;let lastError:unknown;
 while(Date.now()<deadline){
  if(state.spawnFailure)throw state.spawnFailure;
  let attached:Awaited<ReturnType<typeof attach>>|undefined;
  try{attached=await attach();}catch(error){lastError=error;if(error instanceof Error&&['activity_owner_profile_mismatch','activity_owner_config_mismatch'].includes(error.message))throw error;}
  if(attached){
   if(attached.status.pid!==child!.pid){state.closed=true;relay?.seal();(apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;}
   // Configuration failure must never trigger ordinary service fallback/takeover.
   try{if(relay)await relay.install(attached.status.ownerEpoch);}catch(error){state.failure=error;relay?.seal();}
   if((state.business||state.preparation?.composition&&!state.preparation.failure)&&!state.closed&&!state.observationUnknown&&!state.spawnFailure){
    try{
     const business=state.business;
     let admission:CanonicalBusinessAdmission|undefined;
     if(business){businessBinding!.assertDesktopDispatchLaunchBinding(business.launch!,state);admission=(business.controller as import('./default-dispatch-business-controller.js').DefaultDispatchBusinessController).businessAdmission;}
     const physicalCurrent=()=>state.child===child&&!state.observationUnknown&&!state.spawnFailure&&!state.sdkFailure&&originalLaunchConnected(state,child!)&&!state.observationUnknown&&!state.spawnFailure&&!state.sdkFailure;
     const current=()=>{if(state.closed||!business?.initialized||!physicalCurrent())throw Error('DISPATCH_BUSINESS_UNAVAILABLE');business.launch!.assertCurrent();if(state.closed||!business.initialized||!physicalCurrent())throw Error('DISPATCH_BUSINESS_UNAVAILABLE');business.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');};
     let preparation:Readonly<DesktopPreparationCompositionLaunch>|undefined;
     if(state.preparation?.composition&&!state.preparation.failure){try{const binding=await import('./default-dispatch-preparation-composition-bootstrap.js');binding.assertDesktopPreparationCompositionBinding(state.preparation.composition,state);preparation=state.preparation.composition;}catch(error){state.preparation.failure={error};}}
     // The config nonce is correlation data for the same retained descriptor,
     // never a Work grant. User mode retains its independent original nonce.
     const mainLaunchNonce=business?business.launch!.mainLaunchNonce:launch.mainLaunchNonce,ownerEpoch=attached.status.ownerEpoch!;
     if(state.closed||state.observationUnknown||state.spawnFailure||state.sdkFailure||state.child!==child)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');
     if(business){businessBinding!.assertDesktopDispatchLaunchBinding(business.launch!,state);business.launch!.assertLocal();}
     if(preparation)try{preparation.assertLocal();assertPreparationConstructorPorts(preparation);}catch(error){state.preparation!.failure={error};preparation=undefined;}
     if(business||preparation){
      const client=createOwnedCanonicalBusiness({...(preparation?{preparationSource:preparation.transportSource,preparationAdmission:preparation.transportAdmission}:{}),...(business?{admit(proof:object,audience:Parameters<CanonicalBusinessAdmission>[1]){current();const result=apply(admission!,undefined,[proof,audience]);if(result!==undefined)return result;business.launch!.assertLocal();if(state.closed||state.observationUnknown||state.spawnFailure)throw Error('DISPATCH_BUSINESS_UNAVAILABLE');}}:{}),child:child!,scope:state.scope,serviceOwner:state.service,mainLaunchNonce,ownerEpoch,isCurrent:physicalCurrent});
      state.dispatchClient=client;
      if(business){business.admission=admission;business.port=freeze({prepareHello(){current();return prepareOwnedCanonicalBusinessHello(client);},assertHelloCurrent(value:object){current();assertOwnedCanonicalBusinessHelloCurrent(client,value);},readPlan(projectId:string,context:Parameters<typeof client.readPlan>[1]){current();return client.readPlan(projectId,context);},captureDefaultDispatch(projectId:string,input:unknown,context:Parameters<typeof client.readPlan>[1]){current();return client.captureDefaultDispatch(projectId,input,context);},readOperation(projectId:string,input:unknown,context:Parameters<typeof client.readPlan>[1]){current();return client.readOperation(projectId,input,context);}});business.initialized=true;}
      if(preparation&&state.preparation){try{state.preparation.port=readOwnedCanonicalPreparationFacet(client,preparation.transportSource,preparation.transportAdmission);}catch(error){state.preparation.failure={error};}}
     }
    }catch(error){if(state.business)state.failure??=error;else if(state.preparation)state.preparation.failure={error};state.dispatchClient?.seal();}
   }
   (apply(weakGet,deliveries,[state]) as (client:ConversationActivityOwnerClient)=>void)(attached.client);return;
  }
  if(child!.exitCode!==null||child!.signalCode!==null){if(Date.now()+500>=deadline)break;}
  await new NativePromise<void>(yes=>setTimeout(yes,50));
 }
 throw lastError??Error('activity_owner_start_timeout');
}
interface Wire {frame:Record<string,unknown>;types:readonly string[];sent:boolean;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;knownDone:boolean;knownCompletion:Promise<void>;completeKnown():void;closed:boolean;reply?:Record<string,unknown>;raw?:unknown;failure?:unknown;delivered:boolean;completion:Promise<void>;complete():void;resolve(value:Record<string,unknown>):void;reject(error:unknown):void;timer?:ReturnType<typeof setTimeout>}
function createRelay(state:LaunchState,child:ChildProcess,launch:DesktopWriterControlLaunch){
 const extraTails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>(),wires=createIntrinsicSet<Wire>(),unknownRaws=createIntrinsicSet<unknown>(),calls=createIntrinsicSet<{raw?:Promise<void>;completion:Promise<void>;complete():void}>(),causes:unknown[]=[];
 const closeListeners:Array<(error?:unknown)=>void>=[];let closeOutcome:{error?:unknown}|undefined,listenerCompleted=false,drainWorkCompleted=false;
 function notifyKnownClose(){if(!closeOutcome||!drainWorkCompleted||!listenerCompleted||extraTails.size||calls.size)return;const rows=wires.snapshot();for(let i=0;i<rows.length;i++)if(!rows[i]!.knownDone)return;const listeners=apply(splice,closeListeners,[0]) as Array<(error?:unknown)=>void>;for(let i=0;i<listeners.length;i++)try{listeners[i]!(closeOutcome.error);}catch(error){fail(error);}}
 let retirementRevision=0,retirementCut:number|undefined;const touch=()=>{retirementRevision++;retirementCut=undefined;};
 let hello:Record<string,unknown>|undefined,helloResolve!:(value:void)=>void,helloReject!:(error:unknown)=>void;
 const helloReady=fixedPromise<void>((yes,no)=>{helloResolve=yes;helloReject=no;});state.retainedInitialization.add(helloReady);let listenerComplete!:()=>void;const listenerReady=fixedPromise<void>(yes=>{listenerComplete=yes;});state.retainedInitialization.add(listenerReady);let helloObserved=false;
 const helloTimer=setTimeout(()=>fail(Error('WRITER_CONFIG_HELLO_TIMEOUT')),30000);
 let session:Record<string,unknown>|undefined,pending:Wire|undefined,sealPending:Wire|undefined,installed=false,sealed=false,terminal=false,unknown=false,peerClosed=false,offerId=0,lastInvokeId=0,closing:Promise<void>|undefined,busy=false;
 function connected(){const value=originalLaunchConnected(state,child);if(state.sdkFailure)fail(state.sdkFailure);return value;}
 function fail(error:unknown){touch();sealed=true;terminal=true;appendIntrinsic(causes,error);if(!helloObserved){helloObserved=true;clearTimeout(helloTimer);helloReject(error);}if(pending&&!pending.delivered){pending.delivered=true;pending.reject(error);}if(sealPending&&!sealPending.delivered){sealPending.delivered=true;sealPending.reject(error);}}
 // This rejection is owned immediately, even if the ordinary attach loses race.
 const helloObserver=fixedPromise<void>(yes=>{observe(helloReady,()=>yes(),()=>yes());});state.retainedInitialization.add(helloObserver);unknownRaws.add(helloObserver);observe(helloObserver,()=>unknownRaws.delete(helloObserver),()=>{});
 function finish(row:Wire){
  // This narrower barrier never certifies an unknown raw. It joins only the
  // actual callback/reply and every observable raw before reporting failure.
  if(!row.knownDone&&row.returned&&(row.rawDone||row.rawUnknown)&&(!row.sent||row.callback)&&(row.reply||row.closed)){row.knownDone=true;row.completeKnown();}
  if(!row.returned||!row.rawDone||row.sent&&!row.callback||!row.reply&&!row.closed)return;wires.delete(row);if(pending===row)pending=undefined;if(sealPending===row)sealPending=undefined;if(row.timer)clearTimeout(row.timer);row.complete();if(row.delivered)return;row.delivered=true;if(row.failure||!row.reply)row.reject(row.failure??Error('WRITER_CONFIG_CHANNEL_CLOSED'));else row.resolve(data(row.reply));}
 function wire(frame:Record<string,unknown>,expected:readonly string[],guard:()=>void,closingWire=false):Promise<Record<string,unknown>>{
  return fixedPromise((resolve,reject)=>{
   if((sealed&&!closingWire)||terminal||!connected()||(closingWire?!!sealPending:!!pending)){reject(Error('WRITER_CONFIG_CLOSED_OR_BUSY'));return;}
   let complete!:()=>void,completeKnown!:()=>void;const row:Wire={frame,types:expected,sent:false,returned:false,callback:false,rawDone:true,rawUnknown:false,knownDone:false,knownCompletion:fixedPromise(yes=>{completeKnown=yes;}),completeKnown(){completeKnown();notifyKnownClose();},closed:false,delivered:false,completion:fixedPromise(yes=>{complete=yes;}),complete(){complete();},resolve,reject};wires.add(row);if(closingWire)sealPending=row;else pending=row;
   row.timer=setTimeout(()=>fail(Error('WRITER_CONFIG_OUTCOME_UNKNOWN')),30000);
   try{
    const send=child.send;if(typeof send!=='function'||types.isProxy(send)||types.isAsyncFunction(send)||prototypeOf(send)===asyncPrototype)throw Error('WRITER_CONFIG_SYNCHRONOUS_SDK_REQUIRED');
    const outgoing=data(frame);if(!connected())throw Error('WRITER_CONFIG_CLOSED');guard();if(terminal||sealed&&!closingWire)throw Error('WRITER_CONFIG_CLOSED');
    row.sent=true;
    const raw=apply(send,child,[outgoing,(error:Error|null)=>{row.callback=true;if(error){row.failure=error;fail(error);}finish(row);}]);
    if(raw!==true&&raw!==false){row.raw=raw;row.failure=Error('WRITER_CONFIG_SEND_RETURN_UNKNOWN');fail(row.failure);if(raw&&typeof raw==='object'||typeof raw==='function'){row.rawDone=false;try{assertStandardIpcPromise(raw,'WRITER_CONFIG_SDK_TAIL_UNKNOWN');void apply(then,raw,[()=>{row.rawDone=true;finish(row);},(error:unknown)=>{row.failure=error;fail(error);row.rawDone=true;finish(row);}]);}catch(error){row.rawUnknown=true;unknown=true;unknownRaws.add(raw);appendIntrinsic(causes,error);}}}
    row.returned=true;finish(row);
   }catch(error){row.failure=error;row.returned=true;if(row.sent)unknown=true;else row.closed=true;fail(error);finish(row);}
  });
 }
 const base=['protocol','type','daemonBoot','ownerEpoch','mainLaunchNonce','scope','configConnectionIncarnation'];
 function sameSession(row:Record<string,unknown>){if(!session)throw Error('WRITER_CONFIG_NOT_INSTALLED');const keys=['protocol','daemonBoot','ownerEpoch','mainLaunchNonce','configConnectionIncarnation'];for(let i=0;i<keys.length;i++){const key=keys[i]!;if(row[key]!==session[key])throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}const scope=row.scope as Scope;if(!scope||!same(scope,state.scope)||ownKeys(scope).length!==2)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
 function onMessage(raw:unknown,handle:unknown){try{
  if(handle!==undefined&&handle!==null){unknown=true;unknownRaws.add(handle);throw Error('WRITER_CONFIG_UNEXPECTED_HANDLE');}if(dispatchBusinessProtocolTag(raw)==='activity_dispatch_business_v1'&&state.dispatchClient)return;touch();const row=data(raw);
  if(!hello){exact(row,['protocol','type','daemonBoot','ownerEpoch','installChallenge']);if(row.protocol!==protocol||row.type!=='daemon_hello'||!hex(row.daemonBoot)||!hex(row.installChallenge)||typeof row.ownerEpoch!=='string'||!row.ownerEpoch.length||row.ownerEpoch.length>256)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');hello=row;helloObserved=true;clearTimeout(helloTimer);helloResolve();return;}
  if(row.type==='fault'){exact(row,['protocol','type','code']);throw Error('WRITER_CONFIG_REMOTE_PROTOCOL_FAILURE',{cause:row});}
  const record=row.type==='prefix_drained'?sealPending:pending;if(!record||!record.sent||record.reply)throw Error('WRITER_CONFIG_NOT_INVOKED_OR_DUPLICATE_REPLY');
  let expectedType=false;for(let i=0;i<record.types.length;i++)if(record.types[i]===row.type)expectedType=true;if(!expectedType)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');
  if(record.frame.type==='install'){
   const keys=['protocol','type','daemonBoot','ownerEpoch','installChallenge','mainLaunchNonce','scope',row.type==='installed'?'configConnectionIncarnation':'reason'];exact(row,keys);
   const keysToEcho=['protocol','daemonBoot','ownerEpoch','installChallenge','mainLaunchNonce'];for(let i=0;i<keysToEcho.length;i++){const key=keysToEcho[i]!;if(row[key]!==record.frame[key])throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
   const scope=row.scope as Scope;if(!scope||!same(scope,state.scope)||ownKeys(scope).length!==2||row.type==='installed'&&!hex(row.configConnectionIncarnation)||row.type!=='installed'&&row.reason!=='target_not_owned')throw Error('WRITER_CONFIG_PROTOCOL_INVALID');
  }else if(record.frame.type==='offer'){
   sameSession(row);if(row.offerId!==record.frame.offerId||row.op!==record.frame.op)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');
   if(row.type==='command_challenge'){exact(row,[...base,'offerId','op','targetGeneration','childBoot','commandNonce']);if(!Number.isSafeInteger(row.targetGeneration)||Number(row.targetGeneration)<1||!hex(row.childBoot)||!hex(row.commandNonce))throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
   else{exact(row,[...base,'offerId','op','reason']);if(row.reason!==(row.type==='offer_cancelled'?'configuration_closing':'target_not_owned'))throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
  }else if(record.frame.type==='invoke'){
   sameSession(row);const resultKey=own(row,'error')?'error':'result';exact(row,[...base,'offerId','op','targetGeneration','childBoot','commandNonce',resultKey]);const keysToEcho=['offerId','op','targetGeneration','childBoot','commandNonce'];for(let i=0;i<keysToEcho.length;i++){const key=keysToEcho[i]!;if(row[key]!==record.frame[key])throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
  }else{sameSession(row);exact(row,[...base,'throughInvokeId','sealNonce']);if(row.throughInvokeId!==record.frame.throughInvokeId||row.sealNonce!==record.frame.sealNonce)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
  record.reply=row;finish(record);
 }catch(error){fail(error);}}
 const onDisconnect=()=>fail(Error('WRITER_CONFIG_OUTCOME_UNKNOWN'));
 const onError=(error:Error)=>fail(error);
 const onClose=()=>{peerClosed=true;onDisconnect();const rows=wires.snapshot();for(let i=0;i<rows.length;i++){rows[i]!.closed=true;finish(rows[i]!);}};
 const onSpawnError=(error:Error)=>{state.spawnFailure=error;fail(error);};
 function extra(raw:unknown,error:unknown){
  fail(error);
  if(!raw||typeof raw!=='object'&&typeof raw!=='function')return;
  unknownRaws.add(raw);let complete!:()=>void;const row={raw:raw as Promise<unknown>,completion:fixedPromise<void>(yes=>{complete=yes;})};extraTails.add(row);
  try{assertStandardIpcPromise(raw,'WRITER_CONFIG_LISTENER_TAIL_UNKNOWN');void apply(then,raw,[()=>{extraTails.delete(row);unknownRaws.delete(raw);complete();notifyKnownClose();},(reason:unknown)=>{fail(reason);extraTails.delete(row);unknownRaws.delete(raw);complete();notifyKnownClose();}]);}catch(reason){unknown=true;appendIntrinsic(causes,reason);extraTails.delete(row);}
 }
 function emitterCall(method:'on'|'once'|'off',event:string,listener:(...args:any[])=>void){
  touch();
  const fn=child[method];if(typeof fn!=='function'||types.isProxy(fn)||types.isAsyncFunction(fn)||prototypeOf(fn)===asyncPrototype)throw Error('WRITER_CONFIG_SYNCHRONOUS_LISTENER_REQUIRED');
  const raw=apply(fn,child,[event,listener]);if(raw!==child)extra(raw,Error('WRITER_CONFIG_LISTENER_RETURN_UNKNOWN'));
 }
 // The original listener future exists before this factory returns. The
 // caller owns the relay before any SDK/newListener hook can reenter it.
 nativeQueue(()=>{try{const registrations:[string,(...args:any[])=>void,'on'|'once'][]=[['message',onMessage,'on'],['disconnect',onDisconnect,'once'],['error',onError,'once'],['close',onClose,'once'],['error',onSpawnError,'once']];for(let i=0;i<registrations.length;i++){const row=registrations[i]!;try{emitterCall(row[2],row[0],row[1]);}catch(error){fail(error);}}
  // Refcount setup belongs to this configuration attempt too. A local SDK
  // diagnostic failure must not turn a healthy ordinary owner into fallback.
  const refcounts=[()=>{const fn=child.unref;if(types.isProxy(fn)||types.isAsyncFunction(fn)||prototypeOf(fn)===asyncPrototype)throw Error('WRITER_CONFIG_SYNCHRONOUS_REFCOUNT_REQUIRED');const raw=apply(fn,child,[]);if(raw!==undefined)extra(raw,Error('WRITER_CONFIG_REFCOUNT_RETURN_UNKNOWN'));},()=>{const channel=child.channel;if(channel===null||channel===undefined)return;if(typeof channel!=='object'||asynchronousSdkValue(channel)){extra(channel,Error('WRITER_CONFIG_REFCOUNT_CHANNEL_UNKNOWN'));return;}const fn=channel.unref;if(types.isProxy(fn)||types.isAsyncFunction(fn)||prototypeOf(fn)===asyncPrototype)throw Error('WRITER_CONFIG_SYNCHRONOUS_REFCOUNT_REQUIRED');const raw=apply(fn,channel,[]);if(raw!==undefined)extra(raw,Error('WRITER_CONFIG_REFCOUNT_RETURN_UNKNOWN'));}];for(let i=0;i<refcounts.length;i++)try{refcounts[i]!();}catch(error){fail(error);}
 }finally{listenerCompleted=true;listenerComplete();notifyKnownClose();}});
 function bootstrapCurrent(){launch.assertCurrent();if(state.closed)throw Error('WRITER_CONFIG_LAUNCH_CLOSED');}
 function commandCurrent(op:Operation,context:KSwarmOwnedControlContext){if(context.requestSource!=='user'||context.signal.aborted)throw Error('WRITER_CONTROL_AUTHORITY_REQUIRED');bootstrapCurrent();state.source.admission(context.admission,{operation:op,scope:state.scope,serviceOwner:state.service});if(context.signal.aborted)throw Error('WRITER_CONTROL_AUTHORITY_REQUIRED');}
 function sessionFrame(type:string,extra:Record<string,unknown>={}){if(!session)throw Error('WRITER_CONFIG_NOT_INSTALLED');return {...session,type,...extra};}
 async function install(epoch:unknown){await listenerReady;await helloReady;bootstrapCurrent();if(hello!.ownerEpoch!==epoch)throw Error('WRITER_CONFIG_WRONG_DAEMON_EPOCH');const row=await wire({...hello,type:'install',mainLaunchNonce:launch.mainLaunchNonce,scope:state.scope},['installed','install_unavailable'],bootstrapCurrent);if(row.type!=='installed')throw Error('WRITER_CONFIG_TARGET_NOT_OWNED');session=data({protocol,daemonBoot:hello!.daemonBoot,ownerEpoch:epoch,mainLaunchNonce:launch.mainLaunchNonce,scope:state.scope,configConnectionIncarnation:row.configConnectionIncarnation});installed=true;}
 function call(op:Operation,context:KSwarmOwnedControlContext):Promise<unknown>{
  return fixedPromise((resolve,reject)=>{
   try{if(!installed||sealed||busy)throw Error('WRITER_CONFIG_CLOSED_OR_BUSY');commandCurrent(op,context);}catch(error){reject(error);return;}
   busy=true;let complete!:()=>void,delivered=false;const callRoot={completion:fixedPromise<void>(yes=>{complete=yes;}),complete(){calls.delete(callRoot);complete();notifyKnownClose();},raw:undefined as Promise<void>|undefined};calls.add(callRoot);
   const abort=()=>{if(!delivered){delivered=true;reject(context.signal.reason??Error('WRITER_CONTROL_AUTHORITY_REQUIRED'));}seal();};context.signal.addEventListener('abort',abort,{once:true});
   const work=async()=>{
    const id=++offerId,challenge=await wire(sessionFrame('offer',{offerId:id,op}),['command_challenge','offer_unavailable','offer_cancelled'],()=>commandCurrent(op,context));
    if(sealed||context.signal.aborted)throw context.signal.reason??Error('WRITER_CONFIG_CLOSED');if(challenge.type!=='command_challenge')throw Error('WRITER_CONFIG_TARGET_NOT_OWNED');
    const invoked={...challenge,type:'invoke'};const result=await wire(invoked,['command_result'],()=>{commandCurrent(op,context);lastInvokeId=id;});
    if(own(result,'error')){const error=Error('WRITER_CONFIG_REMOTE_EXECUTION_FAILED',{cause:result.error});fail(error);throw error;}
    if(!delivered){delivered=true;resolve(inert(result.result));}
   };
   const raw=work();callRoot.raw=raw;
   try{observe(raw,()=>{busy=false;context.signal.removeEventListener('abort',abort);callRoot.complete();},error=>{busy=false;context.signal.removeEventListener('abort',abort);if(!delivered){delivered=true;reject(error);}if(!sealed)fail(error);callRoot.complete();});}catch(error){unknown=true;unknownRaws.add(raw);fail(error);reject(error);}
  });
 }
 function seal(){sealed=true;const raw=drain();try{observe(raw,()=>{},error=>{state.failure??=error;});}catch(error){state.failure??=error;unknown=true;unknownRaws.add(raw);}}
 async function joinOwned<T>(rows:readonly T[],completion:(row:T)=>Promise<void>):Promise<void>{
  const outcomes=await settleIntrinsicOperations(rows,completion);let failed=false;
  for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i]!;if(outcome.status==='rejected'){failed=true;unknown=true;appendIntrinsic(causes,outcome.reason);}}
  if(failed)throw aggregateIntrinsicErrors(causes,'WRITER_CONFIG_JOIN_UNCONFIRMED');
 }
 function drain():Promise<void>{
  if(closing)return closing;sealed=true;let resolve!:()=>void,reject!:(error:unknown)=>void;closing=handledClosePromise((yes,no)=>{resolve=()=>{closeOutcome??={};notifyKnownClose();yes();};reject=error=>{closeOutcome??={error};notifyKnownClose();no(error);};});
  const run=async()=>{try{
   let bodyFailure:unknown,knownJoined=false;
   const joinKnown=async()=>{knownJoined=false;await joinOwned(wires.snapshot(),row=>row.knownCompletion);knownJoined=true;};
   try{
   await state.workDone;await listenerReady;await joinOwned(extraTails.snapshot(),row=>row.completion);
   if(unknown){await joinKnown();throw Error('WRITER_CONFIG_TAIL_UNKNOWN');}
   await joinOwned(calls.snapshot(),row=>row.completion);
   if(unknown){await joinKnown();throw Error('WRITER_CONFIG_TAIL_UNKNOWN');}
   await joinOwned(wires.snapshot(),row=>row.completion);knownJoined=true;
   if(unknown||terminal)throw aggregateIntrinsicErrors(causes,'WRITER_CONFIG_PREFIX_UNCONFIRMED');
   if(!installed)throw Error('WRITER_CONFIG_UNINSTALLED_PREFIX_UNCONFIRMED');
   // A new wire expands the frontier. A prior successful cut cannot authorize
   // receiver teardown if observing this new SDK tail becomes unconfirmed.
   knownJoined=false;
   if(installed){try{await wire(sessionFrame('seal_prefix',{throughInvokeId:lastInvokeId,sealNonce:nonce()}),['prefix_drained'],()=>{if(peerClosed||!connected())throw Error('WRITER_CONFIG_CHANNEL_CLOSED');},true);}catch(error){await joinKnown();throw error;}}
   knownJoined=true;
   if(unknown||terminal)throw aggregateIntrinsicErrors(causes,'WRITER_CONFIG_PREFIX_UNCONFIRMED');
   }catch(error){bodyFailure=error;appendIntrinsic(causes,error);}
   // Do not tear down the receiver to manufacture a missing callback/reply.
   // Every independently known cleanup is attempted after that local cut.
   if(knownJoined){
    const removals:[string,(...args:any[])=>void][]=[['message',onMessage],['disconnect',onDisconnect],['error',onError],['close',onClose],['error',onSpawnError]];
    for(let i=0;i<removals.length;i++){const row=removals[i]!;try{emitterCall('off',row[0],row[1]);}catch(error){appendIntrinsic(causes,error);}}
    try{await joinOwned(extraTails.snapshot(),row=>row.completion);}catch(error){appendIntrinsic(causes,error);}

   }
   if(bodyFailure||unknown||terminal||causes.length){reject(aggregateIntrinsicErrors(causes,'WRITER_CONFIG_PREFIX_UNCONFIRMED'));}else{retirementCut=retirementRevision;resolve();}
  }finally{drainWorkCompleted=true;notifyKnownClose();}};
  const raw=run();unknownRaws.add(raw);try{observe(raw,()=>{unknownRaws.delete(raw);resolve();},error=>{unknownRaws.delete(raw);reject(error);});}catch(error){unknown=true;unknownRaws.add(raw);reject(error);}return closing;
 }
 const relay={get installed(){return installed&&!sealed&&!terminal;},install,call,seal,drain,observeClose(done:(error?:unknown)=>void){appendIntrinsic(closeListeners,done);const raw=drain();try{observe(raw,()=>{},()=>{});}catch(error){unknown=true;unknownRaws.add(raw);fail(error);}notifyKnownClose();},retirement:()=>freeze({revision:retirementRevision,known:retirementCut===retirementRevision&&!unknown&&!extraTails.size&&!wires.size})};return freeze(relay);
}
