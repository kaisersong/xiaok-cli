import {assertOriginalWriterImplementationContext} from './activity-owner-writer-launcher.js';
import { readOwnedCanonicalBusinessRetirement, observeOwnedCanonicalBusinessClose } from '../../src/runtime/conversation-activity/owned-canonical-business.js';
import { types } from 'node:util';
import { type KSwarmService } from './kswarm-service.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { appendIntrinsic, aggregateIntrinsicErrors } from '../../src/runtime/verification/intrinsic-async-collection.js';
import type { writerDrainContext, LaunchSdkTail, LaunchState } from './activity-owner-writer-launcher.js';
export function drainDesktopWriterRelay(service:KSwarmService, context:writerDrainContext):Promise<void>{
 assertOriginalWriterImplementationContext(context,'drain');
 const {NativePromise,then,apply,define,create,prototypeOf,asyncPrototype,stateFor,asynchronousSdkValue,fixedPromise}=context;
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
