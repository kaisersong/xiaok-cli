import {createIntrinsicSet,settleIntrinsicOperations,appendIntrinsic,aggregateIntrinsicErrors} from '../verification/intrinsic-async-collection.js';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import {randomBytes} from 'node:crypto';
import {types} from 'node:util';
import type {ChildProcess} from 'node:child_process';
import {hasOwnedKSwarmBusinessSibling} from './owned-kswarm-business.js';
import {dispatchBusinessProtocolTag} from './dispatch-business-data.js';
const NativePromise=Promise,NativeSet=Set,NativeMap=Map,nativeThen=NativePromise.prototype.then,apply=Reflect.apply;
const objectPrototype=Object.prototype,arrayPrototype=Array.prototype,asyncPrototype=Object.getPrototypeOf(async()=>{});
const descriptor=Object.getOwnPropertyDescriptor,descriptors=Object.getOwnPropertyDescriptors,prototypeOf=Object.getPrototypeOf;
const ownKeys=Reflect.ownKeys,objectKeys=Object.keys,hasOwn=Object.hasOwn,define=Object.defineProperty,create=Object.create,freeze=Object.freeze;
const isArray=Array.isArray,isFiniteNumber=Number.isFinite,isProxy=types.isProxy,isPromise=types.isPromise,isAsync=types.isAsyncFunction;
const stringify=JSON.stringify,parse=JSON.parse,byteLength=Buffer.byteLength,NativeArray=Array,nativeString=String,nativeNumber=Number,isInteger=Number.isInteger;
const mapHasNative=Map.prototype.has,mapGetNative=Map.prototype.get,mapSetNative=Map.prototype.set;
const setHasNative=Set.prototype.has,setAddNative=Set.prototype.add,setDeleteNative=Set.prototype.delete;
const mapHas=(map:Map<string,unknown>,key:string):boolean=>apply(mapHasNative,map,[key]);
const mapGet=(map:Map<string,unknown>,key:string):unknown=>apply(mapGetNative,map,[key]);
const mapSet=(map:Map<string,unknown>,key:string,value:unknown):void=>{apply(mapSetNative,map,[key,value]);};
const setHas=(set:Set<unknown>,value:unknown):boolean=>apply(setHasNative,set,[value]);
const setAdd=(set:Set<unknown>,value:unknown):void=>{apply(setAddNative,set,[value]);};
const setDelete=(set:Set<unknown>,value:unknown):void=>{apply(setDeleteNative,set,[value]);};
const charCode=String.prototype.charCodeAt,setPrototype=Object.setPrototypeOf;
const nullPrototype=(value:object)=>setPrototype(value,null);
const V1='kswarm_owned_desktop_control_v1',V2='kswarm_owned_desktop_control_v2';
function mintPrefixNonce(){const bytes=randomBytes(32),alphabet='0123456789abcdef';let nonce='';for(let i=0;i<bytes.length;i++){const value=bytes[i]!;nonce+=alphabet[value>>>4]!+alphabet[value&15]!;}return nonce;}
export type KSwarmOwnedControlOperation='prepare_initial_plan_writer'|'inspect_writer'|'migrate_default_dispatch_writer';
export interface KSwarmOwnedControlContext {requestSource:'user'|'agent'|'scheduler';admission:object;signal:AbortSignal}
export interface KSwarmOwnedControlAudience {readonly operation:KSwarmOwnedControlOperation;readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly serviceOwner:object}
export type KSwarmOwnedControlAdmission=(proof:object,audience:KSwarmOwnedControlAudience)=>unknown;
const hex=(value:unknown):value is string=>{if(typeof value!=='string'||value.length!==64)return false;for(let i=0;i<64;i++){const n=apply(charCode,value,[i]);if(!(n>=48&&n<=57||n>=97&&n<=102))return false;}return true;};
const keys=(value:unknown,expected:string[]):value is Record<string,unknown>=>{if(!value||typeof value!=='object'||isArray(value)||objectKeys(value).length!==expected.length)return false;for(let i=0;i<expected.length;i++)if(!hasOwn(value,expected[i]!))return false;return true;};
function bad():never{throw Error('OWNED_CONTROL_PROTOCOL_INVALID');}
/** Fixed Node-only wire capture. Sparse array holes retain the old JSON null
 * normalization. No user serializer, accessor, proxy or container hook runs. */
function data(value:unknown):Record<string,unknown>{
 if(descriptor(objectPrototype,'toJSON')||descriptor(arrayPrototype,'toJSON'))bad();
 let count=0;const ancestors=new NativeSet<unknown>();
 const visit=(raw:unknown,depth:number):unknown=>{
  if(++count>10000||depth>32)bad();if(raw===null||raw===undefined||typeof raw==='boolean')return raw;
  if(typeof raw==='string'){if(raw.length>65536)bad();return raw;}if(typeof raw==='number'){if(!isFiniteNumber(raw))bad();return raw;}
  if(typeof raw!=='object'||isProxy(raw)||setHas(ancestors,raw))bad();
  const array=isArray(raw),proto=prototypeOf(raw);if(array?proto!==arrayPrototype:proto!==objectPrototype&&proto!==null)bad();
  const fields=descriptors(raw),names=ownKeys(fields);let length=0;
  if(array){length=fields.length?.value;if(typeof length!=='number'||length>10000)bad();}
  const result=array?new NativeArray(length):create(null);setAdd(ancestors,raw);
  for(let n=0;n<names.length;n++){
   const key=names[n];if(typeof key!=='string')bad();const row=fields[key]!;
   if(!hasOwn(row,'value'))bad();if(array&&key==='length')continue;if(!row.enumerable)bad();
   if(array){const index=nativeNumber(key);if(!isInteger(index)||index<0||index>=length||nativeString(index)!==key)bad();}
   define(result,key,{__proto__:null,value:visit(row.value,depth+1),writable:true,configurable:true,enumerable:true} as PropertyDescriptor);
  }
  setDelete(ancestors,raw);return result;
 };
 const copied=visit(value,0),encoded=stringify(copied);
 if(!encoded||byteLength(encoded,'utf8')>65536)bad();return parse(encoded) as Record<string,unknown>;
}
/** Pure bounded wire data, not a Source, peer or execution grant. */
export function captureOwnedConfigurationData(raw:unknown):Record<string,unknown>{return data(raw);}
interface Pending {
 frame:Record<string,unknown>;guard:()=>void;resolve:(result:unknown)=>void;reject:(error:unknown)=>void;
 timer:ReturnType<typeof setTimeout>;onAbort:()=>void;signal:AbortSignal;
 closing:boolean;sent:boolean;sendSettled:boolean;sendReturned:boolean;sendTailDone:boolean;notInvoked:boolean;peerClosed:boolean;
 reply?:Record<string,unknown>;remoteError?:Error;delivered:boolean;physicalDone:boolean;
 completion:Promise<void>;complete():void;
}
/** Private child of the original configuration owner. No automatic start/retry
 * and no renderer/agent endpoint. An ACK never grants business execution. */
export interface KSwarmPrefixHelloAudience {readonly scope:Readonly<{profileId:string;workspaceId:string}>;readonly boot:string}
interface PrefixHelloReader {prepare():Promise<KSwarmPrefixHelloAudience>;assertCurrent(audience:object):void}
const helloReaders=new WeakMap<object,PrefixHelloReader>(),weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set;
function originalHelloReader(client:object):PrefixHelloReader {
 const reader=apply(weakGet,helloReaders,[client]) as PrefixHelloReader|undefined;
 if(!reader)throw Error('OWNED_CONTROL_HELLO_CLIENT_REQUIRED');return reader;
}
/** Non-business handshake observation for a genuine original transport only.
 * Its data projection is not Native authority or a replacement for the binder. */
export function prepareOwnedKSwarmPrefixV2Hello(client:object):Promise<KSwarmPrefixHelloAudience>{return originalHelloReader(client).prepare();}
export function assertOwnedKSwarmPrefixV2HelloCurrent(client:object,audience:object):void{originalHelloReader(client).assertCurrent(audience);}
interface ControlOptions {child:ChildProcess;scope:{profileId:string;workspaceId:string};serviceOwner:object;isCurrent:()=>boolean;admit?:KSwarmOwnedControlAdmission}
export function createKSwarmOwnedControl(options:ControlOptions){
 const {call,seal,drainGuardTails,sealAndDrainTransport}=createOwnedControl(options,V1);
 return freeze({call,seal,drainGuardTails,sealAndDrainTransport});
}
/** Fixed transport facade for the original supervisor's actual child. This is
 * not Native user authority: the endpoint binder must authorize before calling.
 * Caller options cannot replace its protocol, guard, owner or operation set. */
export function createOwnedKSwarmPrefixV2Client({child,scope}:Pick<ControlOptions,'child'|'scope'>){
 const owner=freeze({}),proof=freeze({}),signal=new AbortController().signal;
 const control=createOwnedControl({child,scope,serviceOwner:owner,isCurrent:()=>child.connected===true,
  admit(candidate,audience){if(candidate!==proof||audience.serviceOwner!==owner||audience.operation!=='inspect_writer'&&audience.operation!=='prepare_initial_plan_writer')throw Error('OWNED_CONTROL_AUTHORITY_REQUIRED');}},V2);
 const context={requestSource:'user' as const,admission:proof,signal};
 const facade=freeze({inspectWriter:()=>control.call('inspect_writer',context),prepareInitialPlanWriter:()=>control.call('prepare_initial_plan_writer',context),sealAndDrainPrefix:control.sealAndDrainPrefix});
 apply(weakSet,helloReaders,[facade,freeze({prepare:control.prepareHelloAudience,assertCurrent:control.assertHelloAudience})]);return facade;
}
function createOwnedControl(options:ControlOptions,protocol:typeof V1|typeof V2){
 const child=options.child,scope=freeze({...options.scope}),serviceOwner=options.serviceOwner,isCurrent=options.isCurrent,admit=options.admit,nonce=protocol===V2?mintPrefixNonce():randomBytes(32).toString('hex');
 const causes=new NativeMap<string,unknown>(),guardTails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>(),sendTails=createIntrinsicSet<{raw:Promise<unknown>;completion:Promise<void>}>();
 const wires=createIntrinsicSet<Pending>(),unknownGuardObjects=createIntrinsicSet<unknown>(),unknownSendObjects=createIntrinsicSet<unknown>();
 let guardActive=false,guardFault:Error|undefined,guardUnknown=false,sendUnknown=false;
 let sealed=false,uncertain=false,peerClosed=false,instance:string|undefined,sequence=0,pending:Pending|undefined,sealPending:Pending|undefined;
 const prefixWork=createIntrinsicSet<Promise<void>>(),helloTails=createIntrinsicSet<{raw?:Promise<KSwarmPrefixHelloAudience>;completion:Promise<void>}>();
 let helloAudience:KSwarmPrefixHelloAudience|undefined,helloUnknown=false;
 let prefixDrain:Promise<void>|undefined;
 const remember=(kind:string,error:unknown)=>{if(!mapHas(causes,kind))mapSet(causes,kind,error);};
 const current=(closing=false)=>{if(peerClosed||child.connected!==true||!closing&&(sealed||!isCurrent()))throw Error('OWNED_CONTROL_CLOSED');};
 function rejectCaller(record:Pending,error:unknown){if(record.delivered)return;record.delivered=true;clearTimeout(record.timer);record.signal.removeEventListener('abort',record.onAbort);record.reject(error);}
 function unknown(error:unknown){uncertain=true;remember('outcome_unknown',error);if(pending)rejectCaller(pending,error);if(sealPending)rejectCaller(sealPending,error);}
 function seal(error:unknown=Error('OWNED_CONTROL_CLOSED')){sealed=true;remember('sealed',error);if(pending)rejectCaller(pending,error);if(sealPending)rejectCaller(sealPending,error);}
 function finish(record:Pending){
  if(record.physicalDone||!record.sendReturned||!record.sendTailDone||!record.notInvoked&&(!record.sendSettled||!record.reply&&!record.peerClosed))return;
  record.physicalDone=true;wires.delete(record);if(pending===record)pending=undefined;if(sealPending===record)sealPending=undefined;
  clearTimeout(record.timer);record.signal.removeEventListener('abort',record.onAbort);record.complete();
  if(record.reply?.type==='hello_ack')instance=record.reply.instance as string;
  if(record.delivered)return;
  if(record.notInvoked||!record.reply){rejectCaller(record,Error('OWNED_CONTROL_CLOSED'));return;}
  try{
   record.guard();current(record.closing);const frame=record.reply;
   if(record.remoteError)throw record.remoteError;
   if(frame.type==='response')nullPrototype(frame.result as object);
   record.delivered=true;record.resolve(frame.type==='hello_ack'?undefined:frame.result);
  }catch(error){if(record.sent)uncertain=true;rejectCaller(record,error);}
 }
 function validateError(value:unknown,depth=0):void{
  if(depth>4||!keys(value,value&&typeof value==='object'&&hasOwn(value,'cause')?['name','message','code','durableCommitted','cause']:['name','message','code','durableCommitted']))bad();
  const names=['name','message','code'];for(let i=0;i<names.length;i++){const field=value[names[i]!];if(typeof field!=='string'||field.length>2048)bad();}if(typeof value.durableCommitted!=='boolean')bad();
  if(hasOwn(value,'cause'))validateError(value.cause,depth+1);
 }
 function onMessage(raw:unknown,handle:unknown){
  // A closed lane may finish only its original physical record. It cannot
  // create a new caller or restore a withdrawn frame.
  try{
   if(handle!==undefined&&handle!==null){unknownSendObjects.add(handle);sendUnknown=true;remember('unexpected_handle',handle);bad();}
   // The factory-private original-child association permits routing only.
   // JSON protocol data cannot grant either lane a business operation.
   if(dispatchBusinessProtocolTag(raw)==='kswarm_dispatch_business_v1'&&hasOwnedKSwarmBusinessSibling(child,scope))return;
   if(sealed&&!pending&&!sealPending)return;
   const frame=data(raw),record=frame.type==='prefix_drained'?sealPending:pending;if(!record||!record.sent||record.reply)bad();
   if(frame.protocol!==protocol||frame.nonce!==nonce||!keys(frame.scope,['profileId','workspaceId'])||frame.scope.profileId!==scope.profileId||frame.scope.workspaceId!==scope.workspaceId)bad();
   if(record.frame.type==='hello'){
    if(!keys(frame,protocol===V2?['protocol','type','nonce','scope','instance','capabilities']:['protocol','type','nonce','scope','instance'])||frame.type!=='hello_ack'||!hex(frame.instance))bad();
    if(protocol===V2&&(!isArray(frame.capabilities)||frame.capabilities.length!==1||frame.capabilities[0]!=='prefix_seal_v1'))bad();
   }else if(record.frame.type==='seal_prefix'){
    if(protocol!==V2||!keys(frame,['protocol','type','nonce','scope','instance','throughId','sealNonce'])||frame.type!=='prefix_drained'||frame.instance!==instance||frame.throughId!==record.frame.throughId||frame.sealNonce!==record.frame.sealNonce)bad();
   }else{
    const field=hasOwn(frame,'result')?'result':'error';
    if(!keys(frame,['protocol','type','nonce','scope','instance','id','op',field])||frame.type!=='response'||frame.instance!==instance||frame.id!==record.frame.id||frame.op!==record.frame.op)bad();
    if(field==='result'){
     const result=frame.result;if(!result||typeof result!=='object'||typeof (result as Record<string,unknown>).ok!=='boolean')bad();
     const row=result as Record<string,unknown>;if(row.ok===false){if(!keys(row,['ok','error'])||typeof row.error!=='string'||row.error.length>2048)bad();}
     else if(record.frame.op==='prepare_initial_plan_writer'||record.frame.op==='inspect_writer'){if(!keys(row,['ok','profile'])||!row.profile||typeof row.profile!=='object')bad();}
     else if(!keys(row,hasOwn(row,'reused')?['ok','transition','reused']:['ok','transition'])||!row.transition||typeof row.transition!=='object'||hasOwn(row,'reused')&&row.reused!==true)bad();
    }else{
     validateError(frame.error);
     const error=new Error('OWNED_CONTROL_REMOTE_ERROR',{cause:frame.error});define(error,'remoteError',{__proto__:null,value:frame.error,writable:true,enumerable:true,configurable:true} as PropertyDescriptor);
     record.remoteError=error;remember('remote',error);
    }
   }
   record.reply=frame;finish(record);
  }catch(error){remember('protocol',error);unknown(error);seal(error);}
 }
 const onDisconnect=()=>{unknown(Error('OWNED_CONTROL_OUTCOME_UNKNOWN'));seal();};
 const onExit=()=>onDisconnect();
 const onClose=()=>{peerClosed=true;onDisconnect();const records=wires.snapshot();for(let i=0;i<records.length;i++){records[i]!.peerClosed=true;finish(records[i]!);}child.off('message',onMessage);};
 const onError=(error:Error)=>{unknown(error);seal(error);};
 child.on('message',onMessage);child.once('disconnect',onDisconnect);child.once('exit',onExit);child.once('close',onClose);child.on('error',onError);
 function retainSend(record:Pending,raw:unknown){
  if(!raw||typeof raw!=='object'&&typeof raw!=='function')return;
  record.sendTailDone=false;
  if(!isPromise(raw)){sendUnknown=true;unknownSendObjects.add(raw);return;}
  let complete!:()=>void;const row={raw,completion:new NativePromise<void>(resolve=>{complete=resolve;})};sendTails.add(row);
  try{
   assertStandardIpcPromise(raw,'OWNED_CONTROL_TRANSPORT_TAIL_UNKNOWN');
   void apply(nativeThen,raw,[()=>{sendTails.delete(row);record.sendTailDone=true;complete();finish(record);},(error:unknown)=>{remember('send_tail',error);sendTails.delete(row);record.sendTailDone=true;complete();finish(record);}]);
  }catch(error){sendUnknown=true;unknownSendObjects.add(raw);remember('send_observation',error);}
 }
 function wire(frame:Record<string,unknown>,guard:()=>void,signal:AbortSignal,closing=false):Promise<unknown>{
  return new NativePromise((resolve,reject)=>{
   try{guard();current(closing);if(frame.type==='seal_prefix'?sealPending:pending)throw Error('OWNED_CONTROL_BUSY');}catch(error){reject(error);return;}
   let complete!:()=>void;const completion=new NativePromise<void>(done=>{complete=done;});
   const record:Pending={frame,guard,resolve,reject,signal,closing,sent:false,sendSettled:false,sendReturned:false,sendTailDone:true,notInvoked:true,peerClosed,delivered:false,physicalDone:false,completion,complete,timer:undefined!,onAbort:()=>{if(record.sent)unknown(signal.reason??Error('OWNED_CONTROL_OUTCOME_UNKNOWN'));else rejectCaller(record,signal.reason);}};
   if(frame.type==='seal_prefix')sealPending=record;else pending=record;wires.add(record);
   record.timer=setTimeout(()=>unknown(Error('OWNED_CONTROL_OUTCOME_UNKNOWN')),30_000);
   signal.addEventListener('abort',record.onAbort,{once:true});
   try{
    // These fixed outgoing frames contain only a top-level object and scope.
    // Remove inherited serializers before the last external guard can run.
    nullPrototype(frame);nullPrototype(frame.scope as object);
    const send=child.send;if(typeof send!=='function')throw Error('OWNED_CONTROL_UNAVAILABLE');
    if(isProxy(send)||isAsync(send)||prototypeOf(send)===asyncPrototype)throw Error('OWNED_CONTROL_SYNCHRONOUS_SEND_REQUIRED');
    guard();current(closing);if((frame.type==='seal_prefix'?sealPending:pending)!==record||record.delivered)throw Error('OWNED_CONTROL_CLOSED');
    if(frame.type==='request')sequence=frame.id as number;
    record.sent=true;record.notInvoked=false;
    const result=apply(send,child,[frame,(error:Error|null)=>{record.sendSettled=true;if(error)unknown(error);finish(record);}]);
    // The callback and even an ACK may run synchronously inside a wrapper.
    // Neither can deliver before the SDK's original return is classified.
    if(result!==true&&result!==false){unknown(Error('OWNED_CONTROL_SEND_RETURN_UNKNOWN'));retainSend(record,result);}
    record.sendReturned=true;finish(record);
   }catch(error){
    record.sendReturned=true;
    if(record.sent){unknown(error);finish(record);}
    else{record.notInvoked=true;rejectCaller(record,error);finish(record);}
   }
  });
 }
 async function call(operation:KSwarmOwnedControlOperation,raw:KSwarmOwnedControlContext){
  if(protocol===V2&&operation!=='inspect_writer'&&operation!=='prepare_initial_plan_writer')throw Error('OWNED_CONTROL_OPERATION_FORBIDDEN');
  if(guardActive){uncertain=true;guardFault??=Error('OWNED_CONTROL_AUTHORITY_REENTRY');throw guardFault;}
  if(guardFault)throw guardFault;
  if(!raw||typeof raw!=='object'||isProxy(raw))throw Error('OWNED_CONTROL_AUTHORITY_REQUIRED');
  const fields=descriptors(raw),names=ownKeys(fields);for(let i=0;i<names.length;i++){const key=names[i]!;if(typeof key!=='string'||!hasOwn(fields[key]!,'value'))throw Error('OWNED_CONTROL_AUTHORITY_REQUIRED');}if(fields.requestSource?.value!=='user'||!admit||!fields.admission?.value||typeof fields.admission.value!=='object')throw Error('OWNED_CONTROL_AUTHORITY_REQUIRED');
  if(typeof admit!=='function'||isProxy(admit)||isAsync(admit)||prototypeOf(admit)===asyncPrototype){uncertain=true;guardFault??=Error('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');throw guardFault;}
  const proof=fields.admission.value as object,signal=fields.signal?.value as AbortSignal;
  if(!(signal instanceof AbortSignal))throw Error('OWNED_CONTROL_AUTHORITY_REQUIRED');
  const audience=freeze({operation,scope,serviceOwner});
  const guard=()=>{
   current();signal.throwIfAborted();if(guardActive){uncertain=true;throw Error('OWNED_CONTROL_AUTHORITY_REENTRY');}let result:unknown;guardActive=true;try{result=admit(proof,audience);}finally{guardActive=false;}
   if(result!==undefined){
    uncertain=true;guardFault??=Error('OWNED_CONTROL_SYNCHRONOUS_AUTHORITY_REQUIRED');
    if(isPromise(result)){
     let complete!:()=>void;const row={raw:result,completion:new NativePromise<void>(resolve=>{complete=resolve;})};guardTails.add(row);
     try{assertStandardIpcPromise(result,'OWNED_CONTROL_GUARD_TAIL_UNKNOWN');void apply(nativeThen,result,[()=>{guardTails.delete(row);complete();},(error:unknown)=>{remember('guard_tail',error);guardTails.delete(row);complete();}]);}
     catch(error){guardUnknown=true;unknownGuardObjects.add(result);remember('guard_observation',error);}
    }else{guardUnknown=true;unknownGuardObjects.add(result);}
    throw guardFault;
   }
   current();signal.throwIfAborted();if(guardFault)throw guardFault;if(uncertain&&operation!=='inspect_writer')throw Error('OWNED_CONTROL_OUTCOME_UNKNOWN');
  };
  guard();if(uncertain&&operation!=='inspect_writer')throw Error('OWNED_CONTROL_OUTCOME_UNKNOWN');if(pending)throw Error('OWNED_CONTROL_BUSY');
  if(!instance){await wire(data({protocol,type:'hello',nonce,scope}),guard,signal);guard();}
  if(uncertain&&operation!=='inspect_writer')throw Error('OWNED_CONTROL_OUTCOME_UNKNOWN');
  const frame=data({protocol,type:'request',nonce,scope,instance,id:sequence+1,op:operation});guard();return wire(frame,guard,signal);
 }
 async function join(records:readonly {completion:Promise<void>}[]):Promise<void>{
  const outcomes=await settleIntrinsicOperations(records,row=>row.completion),errors:unknown[]=[];
  for(let i=0;i<outcomes.length;i++){const outcome=outcomes[i]!;if(outcome.status==='rejected')appendIntrinsic(errors,outcome.reason);}
  if(errors.length)throw aggregateIntrinsicErrors(errors,'OWNED_CONTROL_TRANSPORT_DRAIN_UNCONFIRMED');
 }
 async function drainGuardTails(){if(guardUnknown)throw guardFault??Error('OWNED_CONTROL_GUARD_TAIL_UNKNOWN');await join(guardTails.snapshot());if(mapHas(causes,'guard_tail'))throw mapGet(causes,'guard_tail');}
 async function sealAndDrainTransport(){
  seal();if(sendUnknown)throw Error('OWNED_CONTROL_TRANSPORT_TAIL_UNKNOWN');
  if(guardUnknown)throw guardFault??Error('OWNED_CONTROL_GUARD_TAIL_UNKNOWN');
  await join(wires.snapshot());await join(sendTails.snapshot());await drainGuardTails();
  if(sendUnknown)throw Error('OWNED_CONTROL_TRANSPORT_TAIL_UNKNOWN');if(mapHas(causes,'send_tail'))throw mapGet(causes,'send_tail');
 }
 function assertHelloReady():void {
  current();if(protocol!==V2)throw Error('OWNED_CONTROL_HELLO_CLIENT_REQUIRED');
  if(uncertain||sendUnknown||guardUnknown||guardFault||helloUnknown)throw Error('OWNED_CONTROL_OUTCOME_UNKNOWN');
 }
 function assertHelloAudience(audience:object):void {
  if(!helloAudience||audience!==helloAudience)throw Error('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');
  assertHelloReady();if(helloAudience.boot!==instance)throw Error('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');
 }
 async function readHelloAudience():Promise<KSwarmPrefixHelloAudience>{
  assertHelloReady();const hello=pending?.frame.type==='hello'?pending:undefined;
  if(hello)await join([hello]);
  else if(!instance){const guard=()=>assertHelloReady();await wire(data({protocol,type:'hello',nonce,scope}),guard,new AbortController().signal);}
  // Instance alone is not qualification. A closing-only handshake or a prior
  // SDK/observer fault can never mint an ordinary audience after this await.
  assertHelloReady();if(!instance)throw Error('OWNED_CONTROL_HELLO_AUDIENCE_REQUIRED');
  if(!helloAudience){
   const audience=create(null);define(audience,'scope',{__proto__:null,value:scope,enumerable:true} as PropertyDescriptor);define(audience,'boot',{__proto__:null,value:instance,enumerable:true} as PropertyDescriptor);helloAudience=freeze(audience) as KSwarmPrefixHelloAudience;
  }
  return helloAudience;
 }
 function prepareHelloAudience():Promise<KSwarmPrefixHelloAudience>{
  let resolve!:(audience:KSwarmPrefixHelloAudience)=>void,reject!:(error:unknown)=>void,complete!:()=>void;
  const result=new NativePromise<KSwarmPrefixHelloAudience>((yes,no)=>{resolve=yes;reject=no;});
  const row:{raw?:Promise<KSwarmPrefixHelloAudience>;completion:Promise<void>}={completion:new NativePromise<void>(yes=>{complete=yes;})};helloTails.add(row);
  try{
   const raw=readHelloAudience();row.raw=raw;assertStandardIpcPromise(raw,'OWNED_CONTROL_HELLO_TAIL_UNKNOWN');
   void apply(nativeThen,raw,[(audience:KSwarmPrefixHelloAudience)=>{try{assertHelloAudience(audience);helloTails.delete(row);complete();resolve(audience);}catch(error){helloTails.delete(row);complete();reject(error);}},(error:unknown)=>{helloTails.delete(row);complete();reject(error);}]);
  }catch(error){helloUnknown=true;remember('hello_observation',error);reject(error);}
  return result;
 }
 function sealAndDrainPrefix():Promise<void>{
  if(prefixDrain)return prefixDrain;
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const result=new NativePromise<void>((yes,no)=>{resolve=yes;reject=no;});
  // Publish the same reservation before seal can withdraw a caller or any SDK
  // getter/callback can reenter. There is only one cut and one original promise.
  prefixDrain=result;seal();
  const run=async()=>{
   if(protocol!==V2)throw Error('OWNED_CONTROL_PREFIX_UNAVAILABLE');
   const hello=pending?.frame.type==='hello'?pending:undefined;
   if(hello)await join([hello]);
   const guard=()=>current(true),signal=new AbortController().signal;
   if(!instance)await wire(data({protocol,type:'hello',nonce,scope}),guard,signal,true);
   guard();if(!instance)throw Error('OWNED_CONTROL_PREFIX_UNCONFIRMED');
   const frame=data({protocol,type:'seal_prefix',nonce,scope,instance,throughId:sequence,sealNonce:mintPrefixNonce()});
   await wire(frame,guard,signal,true);
   // A remote witness cannot replace any original business reply or local SDK
   // callback/raw. The terminal KS notification itself remains KS-owned.
   if(helloUnknown)throw Error('OWNED_CONTROL_HELLO_TAIL_UNKNOWN');
   await join(wires.snapshot());await join(sendTails.snapshot());await join(helloTails.snapshot());await drainGuardTails();
   if(helloUnknown)throw Error('OWNED_CONTROL_HELLO_TAIL_UNKNOWN');
   if(sendUnknown)throw Error('OWNED_CONTROL_TRANSPORT_TAIL_UNKNOWN');
   if(mapHas(causes,'send_tail'))throw mapGet(causes,'send_tail');
   if(uncertain)throw mapGet(causes,'outcome_unknown')??Error('OWNED_CONTROL_PREFIX_UNCONFIRMED');
  };
  try{const work=run();prefixWork.add(work);assertStandardIpcPromise(work,'OWNED_CONTROL_PREFIX_TAIL_UNKNOWN');void apply(nativeThen,work,[()=>{prefixWork.delete(work);resolve();},(error:unknown)=>{prefixWork.delete(work);reject(error);}]);}
  catch(error){remember('prefix_observation',error);reject(error);}
  return result;
 }
 return freeze({call,seal,drainGuardTails,sealAndDrainTransport,sealAndDrainPrefix,prepareHelloAudience,assertHelloAudience});
}
