import {assertOriginalWriterImplementationContext} from './activity-owner-writer-launcher.js';
import { dispatchBusinessProtocolTag } from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import { type ChildProcess } from 'node:child_process';
import { types } from 'node:util';
import type { DesktopWriterControlLaunch } from './kswarm-writer-control-native-bootstrap.js';
import type { KSwarmOwnedControlContext } from './kswarm-owned-control.js';
import { assertStandardIpcPromise } from './ipc-native-promise.js';
import { createIntrinsicSet, appendIntrinsic, aggregateIntrinsicErrors, settleIntrinsicOperations } from '../../src/runtime/verification/intrinsic-async-collection.js';
import type { writerRelayContext, Scope, Operation, LaunchState } from './activity-owner-writer-launcher.js';
interface Wire {frame:Record<string,unknown>;types:readonly string[];sent:boolean;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;knownDone:boolean;knownCompletion:Promise<void>;completeKnown():void;closed:boolean;reply?:Record<string,unknown>;raw?:unknown;failure?:unknown;delivered:boolean;completion:Promise<void>;complete():void;resolve(value:Record<string,unknown>):void;reject(error:unknown):void;timer?:ReturnType<typeof setTimeout>}
export function createRelay(state:LaunchState,child:ChildProcess,launch:DesktopWriterControlLaunch, context:writerRelayContext){
 assertOriginalWriterImplementationContext(context,'relay');
 const {then,apply,ownKeys,own,freeze,splice,nativeQueue,protocol,prototypeOf,asyncPrototype,asynchronousSdkValue,originalLaunchConnected,hex,nonce,same,inert,data,exact,fixedPromise,handledClosePromise,observe}=context;
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
 const helloObserver=fixedPromise<void>(yes=>{observe(helloReady,()=>yes(),()=>yes());});state.retainedInitialization.add(helloObserver);unknownRaws.add(helloObserver);observe(helloObserver,()=>unknownRaws.delete(helloObserver),()=>{});
 function finish(row:Wire){
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
 nativeQueue(()=>{try{const registrations:[string,(...args:any[])=>void,'on'|'once'][]=[['message',onMessage,'on'],['disconnect',onDisconnect,'once'],['error',onError,'once'],['close',onClose,'once'],['error',onSpawnError,'once']];for(let i=0;i<registrations.length;i++){const row=registrations[i]!;try{emitterCall(row[2],row[0],row[1]);}catch(error){fail(error);}}
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
   knownJoined=false;
   if(installed){try{await wire(sessionFrame('seal_prefix',{throughInvokeId:lastInvokeId,sealNonce:nonce()}),['prefix_drained'],()=>{if(peerClosed||!connected())throw Error('WRITER_CONFIG_CHANNEL_CLOSED');},true);}catch(error){await joinKnown();throw error;}}
   knownJoined=true;
   if(unknown||terminal)throw aggregateIntrinsicErrors(causes,'WRITER_CONFIG_PREFIX_UNCONFIRMED');
   }catch(error){bodyFailure=error;appendIntrinsic(causes,error);}
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
