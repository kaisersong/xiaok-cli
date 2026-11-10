import type {ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {types} from 'node:util';
import {createIntrinsicSet,appendIntrinsic,aggregateIntrinsicErrors} from '../verification/intrinsic-async-collection.js';
import {scanTaskStoreSdkChildren} from '../task-host/source-sdk-children.js';
import {assertStandardIpcPromise} from '../verification/native-ipc-promise.js';
import {captureDispatchBusinessData,dispatchBusinessProtocolTag} from './dispatch-business-data.js';
const protocol='kswarm_dispatch_business_v1',cfg1='kswarm_owned_desktop_control_v1',cfg2='kswarm_owned_desktop_control_v2';
const NativePromise=Promise,then=Promise.prototype.then,apply=Reflect.apply,freeze=Object.freeze,create=Object.create;
const objectPrototype=Object.prototype,ownKeys=Reflect.ownKeys,isFrozen=Object.isFrozen;
const descriptor=Object.getOwnPropertyDescriptor,descriptors=Object.getOwnPropertyDescriptors,prototype=Object.getPrototypeOf,own=Object.hasOwn,keys=Object.keys,assign=Object.assign,define=Object.defineProperty;
const isProxy=types.isProxy,isAsync=types.isAsyncFunction,isPromise=types.isPromise,asyncPrototype=prototype(async()=>{}),integer=Number.isSafeInteger;
const weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,charCode=String.prototype.charCodeAt;
const setPrototype=Object.setPrototypeOf,promisePrototype=NativePromise.prototype,species=Symbol.species,originalSpecies=descriptor(NativePromise,species);
const ownedPromises=new WeakSet<object>(),weakAdd=WeakSet.prototype.add,weakHas=WeakSet.prototype.has;
const inert=<T extends object>(value:T):T=>setPrototype(value,null);
function ownPromise<T>(raw:Promise<T>):Promise<T>{define(raw,'constructor',{__proto__:null,value:NativePromise,configurable:false} as PropertyDescriptor);apply(weakAdd,ownedPromises,[raw]);return raw;}
function promise<T>(executor:(resolve:(value:T|PromiseLike<T>)=>void,reject:(error:unknown)=>void)=>void):Promise<T>{
 let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(error:unknown)=>void;const result=ownPromise(new NativePromise<T>((yes,no)=>{resolve=yes;reject=no;}));
 try{executor(resolve,reject);}catch(error){reject(error);}return result;
}
const signalAborted=descriptor(AbortSignal.prototype,'aborted')!.get!,signalReason=descriptor(AbortSignal.prototype,'reason')!.get!;
const addSignal=EventTarget.prototype.addEventListener,removeSignal=EventTarget.prototype.removeEventListener;
interface ClientBirth {readPreparationProof(proof:unknown):AcceptedPreparationBinding|undefined;assertPreparationCurrent(value:object):void;prepare():Promise<KSwarmBusinessHello>;assertCurrent(value:object):void;preparationSource?:object;preparationAdmission?:KSwarmPreparationAdmission;preparationFacet?:KSwarmPreparationFacet;dshAdmission?:KSwarmDshAdmission;dshFacet?:KSwarmDshFacet}
const clients=new WeakMap<object,ClientBirth>();
export interface KSwarmDshReplyView {readonly kind:'kswarm_dsh_reply_v1';readonly scope:BusinessScope;readonly operation:KSwarmDshOperation;readonly input:unknown;readonly output:unknown;readonly instance:string;assertCurrent():void;assertKnown():void;waitKnown():Promise<void>}
const dshReplies=new WeakMap<object,{client:object;admission:KSwarmDshAdmission;view:KSwarmDshReplyView}>();
/** Actual same-client response membership and SDK fate, not a B validity or
 * Native grant. Copies and user/preparation replies have no membership. */
export function readOwnedKSwarmDshReply(client:unknown,admission:unknown,reply:unknown):KSwarmDshReplyView {
 const birth=reader(client as object),row=apply(weakGet,dshReplies,[reply]) as {client:object;admission:KSwarmDshAdmission;view:KSwarmDshReplyView}|undefined;
 if(!row||row.client!==client||row.admission!==admission||birth.dshAdmission!==admission)throw Error('DSH_BUSINESS_ORIGINAL_REPLY_REQUIRED');return row.view;
}
interface AcceptedPreparationBinding {client:object;source:object;admission:Function;scope:BusinessScope;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}
const acceptedPreparationWorks=new WeakMap<object,AcceptedPreparationBinding>();

/** Same original client/Work identity; no Source callback and no new Work. */
export function readOwnedKSwarmPreparationWorkBinding(client:object,source:object,admission:KSwarmPreparationAdmission,work:unknown):Readonly<{scope:BusinessScope;assertCurrent():void;waitKnown():Promise<void>;assertKnown():void}>{
 const birth=reader(client),row=work&&typeof work==='object'?(apply(weakGet,acceptedPreparationWorks,[work])??birth.readPreparationProof(work)) as AcceptedPreparationBinding|undefined:undefined;
 if(!row||row.client!==client||row.source!==source||row.admission!==admission)throw Error('DISPATCH_PREPARATION_ORIGINAL_WORK_REQUIRED');return freeze(inert({scope:row.scope,assertCurrent:row.assertCurrent,waitKnown:row.waitKnown,assertKnown:row.assertKnown}));
}

const remoteFailures=new WeakMap<object,Readonly<Record<string,unknown>>>();
/** Data projection only: a copied Error or caller SDK hint cannot assert the
 * original remote endpoint's durable outcome. No local Native brand is minted. */
export function readOwnedKSwarmBusinessRemoteError(error:unknown):Readonly<Record<string,unknown>>|undefined{
 if(!error||typeof error!=='object')return;return apply(weakGet,remoteFailures,[error]) as Readonly<Record<string,unknown>>|undefined;
}
const children=new WeakMap<object,ReturnType<typeof createIntrinsicSet<{scope:BusinessScope;client:object}>>>();
export interface BusinessScope {readonly profileId:string;readonly workspaceId:string}
export type KSwarmDshOperation='prepare_dsh_owner'|'read_dsh_domain'|'apply_dsh_control'|'apply_dsh_command'|'prepare_dsh_slot'|'read_dsh_basis'|'read_dsh_work'|'read_dsh_slot'|'stage_dsh_draft'|'commit_dsh_draft'|'read_dsh_draft';
export interface KSwarmDshContext {readonly requestSource:'scheduler';readonly admission:object;readonly signal:AbortSignal}
export interface KSwarmDshAudience {readonly operation:KSwarmDshOperation;readonly scope:BusinessScope;readonly serviceOwner:object;readonly projectId:'@dsh-domain';readonly input:unknown;readonly sessionNonce:string;readonly instance:string|null}
export type KSwarmDshAdmission=(proof:object,audience:KSwarmDshAudience)=>unknown;
export interface KSwarmDshFacet {
 prepareOwner(context:KSwarmDshContext):Promise<unknown>;
 readDomain(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 applyControl(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 applyCommand(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 prepareSlot(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 readBasis(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 readWork(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 readSlot(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 stageDraft(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 commitDraft(input:unknown,context:KSwarmDshContext):Promise<unknown>;
 readDraft(input:unknown,context:KSwarmDshContext):Promise<unknown>;
}
export type KSwarmBusinessOperation='read_plan'|'capture_default_dispatch'|'read_operation';
export interface KSwarmBusinessContext {requestSource:'user'|'agent'|'scheduler';admission:object;signal:AbortSignal}
export interface KSwarmBusinessAudience {
 readonly operation:KSwarmBusinessOperation;readonly scope:BusinessScope;readonly projectId:string;readonly serviceOwner:object;
 /** Immutable outgoing data. Final binders must bind capture to their private
  * original A command, never grant arbitrary facts with a project user proof. */
 readonly input:unknown;
}
export type KSwarmBusinessAdmission=(proof:object,audience:KSwarmBusinessAudience)=>unknown;
export interface KSwarmBusinessHello {readonly scope:BusinessScope;readonly boot:string}
export interface KSwarmPreparationContext {readonly requestSource:'scheduler';readonly preparationProof:object;readonly signal:AbortSignal}
export interface KSwarmPreparationAudience {readonly operation:string;readonly scope:BusinessScope;readonly serviceOwner:object;readonly projectId:string;readonly input:unknown;readonly workId?:string;readonly sourceIncarnation?:string}
export interface KSwarmPreparationSource {resolveWork(proof:object,audience:KSwarmPreparationAudience):{readonly workId:string;readonly sourceIncarnation:string;readonly custody:object};observeWork(custody:object,observer:(cut:unknown)=>void):void;sealWork(custody:object):void}
export type KSwarmPreparationAdmission=(proof:object,audience:KSwarmPreparationAudience)=>unknown;
/** Fixed original custody reader. Data is never an effect or Native grant. */
export interface KSwarmHostSettlementSource {resolveRegistration(custody:object,audience:KSwarmPreparationAudience):unknown;resolveNoEffectSettlement(custody:object,audience:KSwarmPreparationAudience):unknown}
export interface KSwarmPreparationWork {readBasis():Promise<unknown>;prepareIntent(input:unknown):Promise<unknown>;admitSend(input:unknown):Promise<unknown>;readCall(input:unknown):Promise<unknown>;acknowledge(input:unknown):Promise<unknown>;registerHost():Promise<unknown>;finishHostNoEffect():Promise<unknown>}
export interface KSwarmPreparationFacet {openWork(projectId:string,lookup:{childKey:string;payloadHash:string},context:KSwarmPreparationContext):KSwarmPreparationWork}
interface Options {child:ChildProcess;scope:BusinessScope;serviceOwner:object;isCurrent:()=>boolean;admit?:KSwarmBusinessAdmission;preparationSource?:KSwarmPreparationSource;preparationAdmission?:KSwarmPreparationAdmission;hostSettlementSource?:KSwarmHostSettlementSource;dshAdmission?:KSwarmDshAdmission}
interface Root {raw?:unknown;completion:Promise<void>;unknown:boolean;finishedRoot:boolean;listeners:Array<()=>void>;complete():void}
interface Tail extends Root {raw:unknown}
interface Wire extends Root {
 frame:Record<string,any>;sent:boolean;returned:boolean;callback:boolean;rawDone:boolean;done:boolean;
 reply?:Record<string,any>;failure?:unknown;delivered:boolean;resolve(value:unknown):void;reject(error:unknown):void;
 guard():void;timer?:ReturnType<typeof setTimeout>;
}
function sync(fn:unknown):fn is (...args:any[])=>unknown{return typeof fn==='function'&&!isProxy(fn)&&!isAsync(fn)&&prototype(fn)!==asyncPrototype;}
function method(object:object,name:string):unknown{let cursor:object|null=object;for(let n=0;cursor&&n<16;n++){if(isProxy(cursor))return;const row=descriptor(cursor,name);if(row)return own(row,'value')?row.value:undefined;cursor=prototype(cursor);}return;}
function hex(value:unknown):value is string{if(typeof value!=='string'||value.length!==64)return false;for(let i=0;i<64;i++){const c=apply(charCode,value,[i]);if(!(c>=48&&c<=57||c>=97&&c<=102))return false;}return true;}
function nonce(){const value=randomBytes(32),alphabet='0123456789abcdef';let out='';for(let i=0;i<value.length;i++)out+=alphabet[value[i]!>>>4]!+alphabet[value[i]!&15]!;return out;}
function exact(value:any,names:readonly string[]){if(!value||typeof value!=='object'||Array.isArray(value)||keys(value).length!==names.length)return false;for(let i=0;i<names.length;i++)if(!own(value,names[i]!))return false;return true;}
function invalid():never{throw Error('DISPATCH_BUSINESS_PROTOCOL_INVALID');}
function reader(client:object){const row=apply(weakGet,clients,[client]) as ClientBirth|undefined;if(!row)throw Error('DISPATCH_BUSINESS_ORIGINAL_CLIENT_REQUIRED');return row;}
export function readOwnedKSwarmPreparationFacet(client:object,source:object,admission:KSwarmPreparationAdmission):KSwarmPreparationFacet{
 const row=reader(client);if(!row.preparationFacet||source!==row.preparationSource||admission!==row.preparationAdmission)throw Error('DISPATCH_PREPARATION_ORIGINAL_SOURCE_REQUIRED');return row.preparationFacet;
}
/** Exact constructor admission identity only, never a user/preparation grant. */
export function readOwnedKSwarmDshFacet(client:object,admission:KSwarmDshAdmission):KSwarmDshFacet {
 const row=reader(client);if(row.dshAdmission!==admission||!row.dshFacet)throw Error('DSH_BUSINESS_ORIGINAL_SOURCE_REQUIRED');return row.dshFacet;
}
/** Fixed normal-seal current read; this cannot mint a work or bypass its Source. */
export function assertOwnedKSwarmPreparationHelloCurrent(client:object,source:object,admission:KSwarmPreparationAdmission,hello:object):void{
 const row=reader(client);if(!row.preparationFacet||source!==row.preparationSource||admission!==row.preparationAdmission)throw Error('DISPATCH_PREPARATION_ORIGINAL_SOURCE_REQUIRED');row.assertPreparationCurrent(hello);
}
export function prepareOwnedKSwarmBusinessHello(client:object):Promise<KSwarmBusinessHello>{return reader(client).prepare();}
export function assertOwnedKSwarmBusinessHelloCurrent(client:object,value:object):void{reader(client).assertCurrent(value);}
/** Private factory birth association, used only to route the fixed sibling
 * tag. No supplied property is read and it grants no business admission. */
export function hasOwnedKSwarmBusinessSibling(child:object,scope:BusinessScope):boolean{
 const rows=apply(weakGet,children,[child]) as ReturnType<typeof createIntrinsicSet<{scope:BusinessScope;client:object}>>|undefined;
 if(!rows)return false;const values=rows.snapshot();for(let i=0;i<values.length;i++)if(values[i]!.scope.profileId===scope.profileId&&values[i]!.scope.workspaceId===scope.workspaceId)return true;return false;
}
/** No SDK calls at construction. The original service stores this facade
 * before any prepare/call starts its owned setup future. No HTTP fallback. */
export function createOwnedKSwarmBusiness(options:Options){
 const child=options.child,scope=captureDispatchBusinessData(options.scope) as BusinessScope,owner=options.serviceOwner,admit=options.admit,isCurrent=options.isCurrent;
 const preparationSource=options.preparationSource,preparationAdmission=options.preparationAdmission;
 const dshOption=descriptor(options,'dshAdmission');if(dshOption&&!own(dshOption,'value'))throw Error('DSH_BUSINESS_FIXED_ADMISSION_REQUIRED');
 const dshAdmission=dshOption?.value as KSwarmDshAdmission|undefined;if(dshAdmission!==undefined&&!sync(dshAdmission))throw Error('DSH_BUSINESS_FIXED_ADMISSION_REQUIRED');
 const hostSource=options.hostSettlementSource;
 let resolveRegistration:Function|undefined,resolveNoEffect:Function|undefined;
 if(hostSource!==undefined){
  if(!hostSource||isProxy(hostSource))throw Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');
  const rows=descriptors(hostSource);
  for(const name of ['resolveRegistration','resolveNoEffectSettlement'])if(!rows[name]||!own(rows[name]!,'value')||!sync(rows[name]!.value))throw Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED');
  resolveRegistration=rows.resolveRegistration!.value;resolveNoEffect=rows.resolveNoEffectSettlement!.value;
 }

 let resolveWork:((...args:any[])=>unknown)|undefined,observeWork:((...args:any[])=>unknown)|undefined,sealWork:((...args:any[])=>unknown)|undefined;
 if(preparationSource!==undefined||preparationAdmission!==undefined){
  if(!preparationSource||isProxy(preparationSource)||!sync(preparationAdmission))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  const rows=descriptors(preparationSource);for(const name of ['resolveWork','observeWork','sealWork'])if(!rows[name]||!own(rows[name]!,'value')||!sync(rows[name]!.value))throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  resolveWork=rows.resolveWork!.value;observeWork=rows.observeWork!.value;sealWork=rows.sealWork!.value;
 }
 if(apply(weakGet,children,[child]))throw Error('DISPATCH_BUSINESS_CHILD_ALREADY_BOUND');
 if(!exact(scope,['profileId','workspaceId'])||!hex(scope.profileId)||!hex(scope.workspaceId))throw Error('DISPATCH_BUSINESS_SCOPE_INVALID');
 const roots=createIntrinsicSet<Root>(),wires=createIntrinsicSet<Wire>(),tails=createIntrinsicSet<Tail>(),unknowns=createIntrinsicSet<unknown>();
 const helloPhysical=createIntrinsicSet<Root>();
 const cleanups:Array<()=>void>=[],errors:unknown[]=[];const sessionNonce=nonce();
 let sealed=false,terminal=false,disconnected=false,closeStarted=false,guardActive=false,setupStarted=false,setupDone=false,disposed=false;
 let instance:string|undefined,sequence=0,pending:Wire|undefined,prefix:Wire|undefined,helloPromise:Promise<KSwarmBusinessHello>|undefined,helloValue:KSwarmBusinessHello|undefined,closing:Promise<void>|undefined;
 let send:(...args:any[])=>unknown,on:(...args:any[])=>unknown,off:(...args:any[])=>unknown;
 function notify(row:Root){const callbacks=row.listeners;row.listeners=[];for(let i=0;i<callbacks.length;i++)callbacks[i]!();}
 function markUnknown(row:Root){row.unknown=true;notify(row);}
 function fail(error:unknown){terminal=true;appendIntrinsic(errors,error);const all=wires.snapshot();for(let i=0;i<all.length;i++){const row=all[i]!;if(row.timer)clearTimeout(row.timer);if(!row.reply){markUnknown(row);unknowns.add(row);}reject(row,row.failure??error);}}
 function standard(raw:unknown):raw is Promise<unknown>{try{
  if(!raw||typeof raw!=='object'||isProxy(raw)||descriptor(raw,'then'))return false;
  if(apply(weakHas,ownedPromises,[raw])){
   const currentSpecies=descriptor(NativePromise,species),ctor=descriptor(raw,'constructor');
   return isPromise(raw)&&!isProxy(raw)&&prototype(raw)===promisePrototype&&!!ctor&&own(ctor,'value')&&ctor.value===NativePromise&&!!currentSpecies&&!!originalSpecies&&!own(currentSpecies,'value')&&currentSpecies.get===originalSpecies.get&&currentSpecies.set===originalSpecies.set;
  }
  assertStandardIpcPromise(raw,'DISPATCH_BUSINESS_TAIL_UNKNOWN');return true;
 }catch{return false;}}
 function checked<T>(raw:Promise<T>):Promise<T>{if(!standard(raw)){retain(raw);throw Error('DISPATCH_BUSINESS_INTERNAL_TAIL_UNKNOWN');}return raw;}
 function reservation():Root{let complete!:()=>void;const row:Root=inert({raw:undefined,completion:promise<void>(yes=>{complete=yes;}),unknown:false,finishedRoot:false,listeners:[],complete(){if(row.finishedRoot)return;row.finishedRoot=true;complete();notify(row);}});return row;}
 function tail(raw:unknown):Tail{const row=reservation() as Tail;row.raw=raw;const complete=row.complete;row.complete=()=>{tails.delete(row);complete();};tails.add(row);return row;}
 function retain(raw:unknown,settled?:()=>void){
  // Retain the original before constructor/species/observer classification.
  const row=tail(raw);
  if(!standard(raw)){markUnknown(row);unknowns.add(raw);return row;}
  try{apply(then,raw,[()=>{row.complete();settled?.();},(error:unknown)=>{fail(error);row.complete();settled?.();}]);}
  catch(error){markUnknown(row);unknowns.add(raw);fail(error);}
  return row;
 }
 function root():Root{const row=reservation(),complete=row.complete;row.complete=()=>{roots.delete(row);complete();};roots.add(row);return row;}
 function observe(row:Root,work:()=>Promise<void>){try{const raw=work();row.raw=raw;
  // Only this lexical async function's return is an owned internal promise;
  // SDK/caller returns always go through retain's strict external classifier.
  if(!isPromise(raw)||isProxy(raw)||prototype(raw)!==promisePrototype)throw Error('DISPATCH_BUSINESS_ROOT_UNKNOWN');ownPromise(raw);
  if(!standard(raw)){markUnknown(row);unknowns.add(raw);fail(Error('DISPATCH_BUSINESS_ROOT_UNKNOWN'));return;}apply(then,raw,[()=>row.complete(),(error:unknown)=>{fail(error);row.complete();}]);
 }catch(error){markUnknown(row);unknowns.add(row.raw);fail(error);}}
 function local(closingOnly=false){if(terminal||disconnected||!closingOnly&&sealed)throw Error('DISPATCH_BUSINESS_CLOSED');}
 function active(closingOnly=false,physical?:ReturnType<typeof createIntrinsicSet<Root>>){
  local(closingOnly);if(!sync(isCurrent))throw Error('DISPATCH_BUSINESS_SYNCHRONOUS_CURRENT_REQUIRED');
  const current=apply(isCurrent,undefined,[]);if(current!==true){if(current!==false){const tail=retain(current);physical?.add(tail);fail(Error('DISPATCH_BUSINESS_CURRENT_UNKNOWN'));}throw Error('DISPATCH_BUSINESS_CLOSED');}local(closingOnly);
 }
 const data=(value:unknown,physical?:ReturnType<typeof createIntrinsicSet<Root>>)=>captureDispatchBusinessData(value,raw=>{const tail=retain(raw);physical?.add(tail);fail(Error('DISPATCH_BUSINESS_DATA_UNCONFIRMED'));});
 function setup(){
  if(setupDone)return;if(setupStarted)throw Error('DISPATCH_BUSINESS_SETUP_REENTRY');setupStarted=true;
  // The caller invoke/hello Root already owns every setup SDK and future off.
  try{
   const sendMethod=method(child,'send'),onMethod=method(child,'on'),offMethod=method(child,'off');
   if(!sync(sendMethod)||!sync(onMethod)||!sync(offMethod))throw Error('DISPATCH_BUSINESS_SYNCHRONOUS_SDK_REQUIRED');send=sendMethod;on=onMethod;off=offMethod;
   const rows=[['message',onMessage],['disconnect',onDisconnect],['exit',onDisconnect],['close',onClose],['error',onError]] as const;
   for(let i=0;i<rows.length;i++){
    const [name,handler]=rows[i]!;appendIntrinsic(cleanups,()=>{const raw=apply(off,child,[name,handler]);if(raw!==child){retain(raw);fail(Error('DISPATCH_BUSINESS_OFF_UNKNOWN'));}});
    const raw=apply(on,child,[name,handler]);if(raw!==child){helloPhysical.add(retain(raw));throw Error('DISPATCH_BUSINESS_ON_UNKNOWN');}local(closeStarted);
   }
   setupDone=true;
  }catch(error){fail(error);throw error;}
 }
 function reject(row:Wire,error:unknown){if(row.delivered)return;row.delivered=true;row.reject(error);}
 function finish(row:Wire){
  if(row.done||!row.returned||!row.rawDone||row.sent&&(!row.callback||!row.reply&&!disconnected))return;
  row.done=true;if(row.timer)clearTimeout(row.timer);wires.delete(row);row.complete();if(pending===row)pending=undefined;if(prefix===row)prefix=undefined;
  if(row.delivered)return;
  try{if(row.failure)throw row.failure;if(!row.reply)throw Error('DISPATCH_BUSINESS_CLOSED');row.guard();
   if(row.reply.type==='hello_ack'){instance=row.reply.instance;row.delivered=true;row.resolve(undefined);}
   else if(own(row.reply,'error'))throw row.failure;
   else{row.delivered=true;row.resolve(row.reply.result);}
  }catch(error){reject(row,error);}
 }
 function wire(frame:Record<string,any>,guard:()=>void,closingOnly=false,registered?:(row:Wire)=>void):Promise<unknown>{
  let resolve!:(value:unknown)=>void,rejectValue!:(error:unknown)=>void;const value=promise<unknown>((yes,no)=>{resolve=yes;rejectValue=no;});
  const reservation=root(),row:Wire=assign(reservation,{frame,sent:false,returned:false,callback:false,rawDone:true,done:false,delivered:false,resolve,reject:rejectValue,guard});wires.add(row);
  if(frame.type==='seal_prefix')prefix=row;else if(pending){row.returned=true;row.failure=Error('DISPATCH_BUSINESS_BUSY');finish(row);return value;}else pending=row;
  try{
   row.frame=data(frame) as Record<string,any>;
   // Timer/refcount SDK work can revoke the original admission synchronously.
   // Complete it before the last command proof and pure signal/local fence.
   row.timer=setTimeout(()=>{fail(Error('DISPATCH_BUSINESS_OUTCOME_UNCONFIRMED'));},30_000);row.timer.unref?.();
   guard();local(closingOnly);
   if(row.delivered)throw Error('DISPATCH_BUSINESS_CLOSED');
   registered?.(row);
   if(frame.type==='request')sequence=frame.id;
   row.sent=true;
   const callbackTail=tail(row);
   let raw:unknown;try{raw=apply(send,child,[row.frame,(error:Error|null)=>{row.callback=true;callbackTail.complete();if(error){row.failure??=error;fail(error);}finish(row);}]);}
   catch(error){throw error;}
   if(raw!==true&&raw!==false){row.raw=raw;row.rawDone=false;if(!standard(raw))markUnknown(row);fail(Error('DISPATCH_BUSINESS_SEND_RETURN_UNCONFIRMED'));retain(raw,()=>{row.rawDone=true;finish(row);});}
   row.returned=true;finish(row);
  }catch(error){row.failure??=error;row.returned=true;if(row.sent){markUnknown(row);fail(error);unknowns.add(row);}reject(row,row.failure);finish(row);}
  return value;
 }
 function errorShape(error:any,depth=0):boolean{
  if(depth>4||!exact(error,own(error??{},'cause')?['name','message','code','durableCommitted','cause']:['name','message','code','durableCommitted']))return false;
  return typeof error.name==='string'&&typeof error.message==='string'&&typeof error.code==='string'&&error.name.length<=2048&&error.message.length<=2048&&error.code.length<=2048&&typeof error.durableCommitted==='boolean'&&(!own(error,'cause')||errorShape(error.cause,depth+1));
 }
 function remoteError(value:Record<string,unknown>):Error{const error=new Error('DISPATCH_BUSINESS_REMOTE_ERROR',{cause:value});define(error,'remoteError',{__proto__:null,value,enumerable:true} as PropertyDescriptor);apply(weakSet,remoteFailures,[error,value]);return error;}
 function onMessage(raw:unknown,handle:unknown){
  if(handle!==null&&handle!==undefined){retain(handle);fail(Error('DISPATCH_BUSINESS_TRANSFER_HANDLE_UNCONFIRMED'));return;}
  const tag=dispatchBusinessProtocolTag(raw);if(tag===cfg1||tag===cfg2)return;
  try{
   const frame=data(raw) as Record<string,any>;if(disposed)throw Error('DISPATCH_BUSINESS_CLOSING');
   if(frame.protocol===protocol&&frame.type==='fault'){if(!exact(frame,['protocol','type','error'])||!errorShape(frame.error))invalid();throw remoteError(frame.error);}
   if(closeStarted&&!pending&&!prefix)throw Error('DISPATCH_BUSINESS_CLOSING');
   const row=frame.type==='prefix_drained'?prefix:pending;if(!row||!row.sent||row.reply)invalid();
   if(frame.protocol!==protocol||frame.nonce!==sessionNonce||!exact(frame.scope,['profileId','workspaceId'])||frame.scope.profileId!==scope.profileId||frame.scope.workspaceId!==scope.workspaceId)invalid();
   if(row.frame.type==='hello'){
    if(!exact(frame,['protocol','type','scope','nonce','instance'])||frame.type!=='hello_ack'||!hex(frame.instance))invalid();
   }else if(row.frame.type==='seal_prefix'){
    if(!exact(frame,['protocol','type','scope','nonce','instance','throughId','sealNonce'])||frame.type!=='prefix_drained'||frame.instance!==instance||frame.throughId!==row.frame.throughId||frame.sealNonce!==row.frame.sealNonce)invalid();
   }else{
    const field=own(frame,'result')?'result':'error';
    const fields=['protocol','type','scope','nonce','instance','id','op','projectId',field];
    if(row.frame.family==='preparation'){fields.push('family','workId','sourceIncarnation');if(frame.family!=='preparation'||frame.workId!==row.frame.workId||frame.sourceIncarnation!==row.frame.sourceIncarnation)invalid();}
    if(row.frame.family==='dsh'){fields.push('family');if(frame.family!=='dsh')invalid();}
    if(!exact(frame,fields)||frame.type!=='response'||frame.instance!==instance||frame.id!==row.frame.id||frame.op!==row.frame.op||frame.projectId!==row.frame.projectId)invalid();
    if(field==='error'){
     if(!errorShape(frame.error))invalid();
     const error=remoteError(frame.error);row.failure=error;appendIntrinsic(errors,error);
    }else if(!frame.result||typeof frame.result!=='object'||typeof frame.result.ok!=='boolean')invalid();
   }
   row.reply=frame;finish(row);
  }catch(error){fail(error);}
 }
 function onDisconnect(){disconnected=true;fail(Error('DISPATCH_BUSINESS_DISCONNECTED'));const all=wires.snapshot();for(let i=0;i<all.length;i++)finish(all[i]!);}
 function onClose(){onDisconnect();}
 function onError(error:unknown){fail(error);}
 function preparationHelloCurrent(value:object){if(value!==helloValue||!helloValue||helloValue.boot!==instance)throw Error('DISPATCH_BUSINESS_ORIGINAL_HELLO_REQUIRED');if(terminal&&errors.length)throw errors[0];if(disposed)throw Error('DISPATCH_BUSINESS_CLOSED');try{active(true);}catch(error){if(terminal&&errors.length)throw errors[0];throw error;}}
 function currentHello(value:object){if(value!==helloValue||!helloValue||helloValue.boot!==instance)throw Error('DISPATCH_BUSINESS_ORIGINAL_HELLO_REQUIRED');active();}
 function prepareHello(closingOnly=false):Promise<KSwarmBusinessHello>{
  if(helloPromise)return helloPromise;
  let resolve!:(value:KSwarmBusinessHello)=>void,rejectValue!:(error:unknown)=>void;
  const result=promise<KSwarmBusinessHello>((yes,no)=>{resolve=yes;rejectValue=no;});helloPromise=result;
  const row=root();helloPhysical.add(row);observe(row,async()=>{
   try{active(closingOnly,helloPhysical);setup();active(closingOnly,helloPhysical);const guard=()=>active(closingOnly,helloPhysical);
    const response=wire({protocol,type:'hello',scope,nonce:sessionNonce},guard,closingOnly,row=>helloPhysical.add(row));await checked(response);active(closingOnly,helloPhysical);
    if(!instance)throw Error('DISPATCH_BUSINESS_HELLO_UNKNOWN');helloValue=data({scope,boot:instance}) as KSwarmBusinessHello;resolve(helloValue);
   }catch(error){rejectValue(error);throw error;}
  });return result;
 }
 function contextGuard(operation:KSwarmBusinessOperation,projectId:string,input:unknown,raw:KSwarmBusinessContext){
  if(!raw||typeof raw!=='object'||isProxy(raw)||!sync(admit))throw Error('DISPATCH_BUSINESS_USER_AUTHORITY_REQUIRED');
  const rows=descriptors(raw);if(!exact(rows,['requestSource','admission','signal']))throw Error('DISPATCH_BUSINESS_USER_AUTHORITY_REQUIRED');
  const fields=['requestSource','admission','signal'];for(let i=0;i<fields.length;i++)if(!own(rows[fields[i]!]!,'value'))throw Error('DISPATCH_BUSINESS_USER_AUTHORITY_REQUIRED');
  const proof=rows.admission!.value,signal=rows.signal!.value as AbortSignal;
  if(rows.requestSource!.value!=='user'||!proof||typeof proof!=='object'||isProxy(signal))throw Error('DISPATCH_BUSINESS_USER_AUTHORITY_REQUIRED');
  // Apply captured native brand getter; caller instance methods are never read.
  apply(signalAborted,signal,[]);
  const audience=freeze({operation,scope,serviceOwner:owner,projectId,input});
  const checkSignal=()=>{if(apply(signalAborted,signal,[]))throw apply(signalReason,signal,[]);};
  const guard=()=>{
   active();checkSignal();if(guardActive)throw Error('DISPATCH_BUSINESS_ADMISSION_REENTRY');guardActive=true;
   let returned:unknown;try{returned=apply(admit,undefined,[proof,audience]);}finally{guardActive=false;}
   if(returned!==undefined){retain(returned);fail(Error('DISPATCH_BUSINESS_ADMISSION_UNCONFIRMED'));throw Error('DISPATCH_BUSINESS_ADMISSION_UNCONFIRMED');}
   checkSignal();local();
  };
  guard();return{guard,signal};
 }
 function call(operation:KSwarmBusinessOperation,projectId:string,input:unknown,context:KSwarmBusinessContext):Promise<unknown>{
  let resolve!:(value:unknown)=>void,rejectValue!:(error:unknown)=>void;
  const result=promise<unknown>((yes,no)=>{resolve=yes;rejectValue=no;});const row=root();
  observe(row,async()=>{
   let signal:AbortSignal|undefined,abort:(()=>void)|undefined;
   try{
    // A refused new entry owns no producer future. In particular it cannot
    // add a new input tail after close has selected its admitted frontier.
    local();if(guardActive)throw Error('DISPATCH_BUSINESS_ADMISSION_REENTRY');
    if(typeof projectId!=='string'||!projectId||projectId.length>256||projectId.trim()!==projectId||projectId.includes('\0'))throw Error('DISPATCH_BUSINESS_PROJECT_INVALID');
    const closed=data(input),contextData=contextGuard(operation,projectId,closed,context);signal=contextData.signal;
    abort=()=>rejectValue(apply(signalReason,signal,[]));apply(addSignal,signal,['abort',abort,{once:true}]);contextData.guard();
    const hello=prepareHello();await checked(hello);contextData.guard();
    const outgoing={protocol,type:'request',scope,nonce:sessionNonce,instance,id:sequence+1,op:operation,projectId,input:closed};
    const response=wire(outgoing,contextData.guard);const value=await checked(response);contextData.guard();resolve(value);
   }catch(error){rejectValue(error);}
   finally{if(signal&&abort)try{const returned=apply(removeSignal,signal,['abort',abort]);if(returned!==undefined){retain(returned);fail(Error('DISPATCH_BUSINESS_SIGNAL_OFF_UNKNOWN'));}}catch(error){fail(error);}}
  });return result;
 }
 // These records own future ACK publishers, independently of each short RPC.
 function dshCall(operation:KSwarmDshOperation,input:unknown,context:KSwarmDshContext):Promise<unknown>{
  let resolve!:(value:unknown)=>void,rejectValue!:(error:unknown)=>void;const result=promise<unknown>((yes,no)=>{resolve=yes;rejectValue=no;}),row=root(),physical=createIntrinsicSet<Root>();physical.add(row);
  observe(row,async()=>{let signal:AbortSignal|undefined,abort:(()=>void)|undefined;
   try{local();if(guardActive)throw Error('DSH_BUSINESS_ADMISSION_REENTRY');if(!sync(dshAdmission)||!context||typeof context!=='object'||isProxy(context))throw Error('DSH_BUSINESS_SOURCE_REQUIRED');
    const rows=descriptors(context);if(!exact(rows,['requestSource','admission','signal']))throw Error('DSH_BUSINESS_SOURCE_REQUIRED');for(const name of ['requestSource','admission','signal'])if(!own(rows[name]!,'value'))throw Error('DSH_BUSINESS_SOURCE_REQUIRED');
    const proof=rows.admission!.value;signal=rows.signal!.value;if(rows.requestSource!.value!=='scheduler'||!proof||typeof proof!=='object'||isProxy(proof)||isProxy(signal))throw Error('DSH_BUSINESS_SOURCE_REQUIRED');apply(signalAborted,signal,[]);
    const closed=data(input,physical);if(operation==='prepare_dsh_owner'){if(closed!==null)throw Error('DSH_BUSINESS_INPUT_INVALID');}else{if(!closed||typeof closed!=='object'||!exact(closed,['data','budget']))throw Error('DSH_BUSINESS_INPUT_INVALID');const budget=(closed as Record<string,unknown>).budget;if(operation!=='apply_dsh_command'&&operation!=='prepare_dsh_slot'&&operation!=='stage_dsh_draft'&&operation!=='commit_dsh_draft'&&budget!==null)throw Error('DSH_BUSINESS_INPUT_INVALID');}
    const checkSignal=()=>{if(apply(signalAborted,signal,[]))throw apply(signalReason,signal,[]);};
    const guard=()=>{active(false,physical);checkSignal();if(guardActive)throw Error('DSH_BUSINESS_ADMISSION_REENTRY');guardActive=true;let returned:unknown;try{returned=apply(dshAdmission,undefined,[proof,freeze({operation,scope,serviceOwner:owner,projectId:'@dsh-domain',input:closed,sessionNonce,instance:instance??null})]);}finally{guardActive=false;}if(returned!==undefined){physical.add(retain(returned));fail(Error('DSH_BUSINESS_ADMISSION_UNCONFIRMED'));throw Error('DSH_BUSINESS_ADMISSION_UNCONFIRMED');}checkSignal();local();};
    abort=()=>rejectValue(apply(signalReason,signal,[]));apply(addSignal,signal,['abort',abort,{once:true}]);guard();await checked(prepareHello());guard();
    const value=await checked(wire({protocol,type:'request',scope,nonce:sessionNonce,instance,id:sequence+1,op:operation,projectId:'@dsh-domain',input:closed,family:'dsh'},guard,false,wire=>physical.add(wire)));guard();
    if(!value||typeof value!=='object')throw Error('DSH_BUSINESS_REPLY_INVALID');
    const relevant=()=>{const rows=physical.snapshot(),hello=helloPhysical.snapshot();for(let i=0;i<hello.length;i++)appendIntrinsic(rows,hello[i]!);return rows;};
    const assertKnown=()=>{const rows=relevant();for(let i=0;i<rows.length;i++)if(!rows[i]!.finishedRoot||rows[i]!.unknown)throw Error('DSH_BUSINESS_REPLY_UNCONFIRMED');};
    const view:KSwarmDshReplyView=freeze<KSwarmDshReplyView>(inert<KSwarmDshReplyView>({kind:'kswarm_dsh_reply_v1' as const,scope,operation,input:closed,output:value,instance:instance!,assertCurrent(){const checking=root();try{guard();}finally{checking.complete();}},assertKnown,waitKnown(){return promise<void>((yes,no)=>{afterKnown([row],()=>afterKnown(relevant(),()=>{try{assertKnown();yes();}catch(error){no(error);}}));});}}));
    apply(weakSet,dshReplies,[value,{client,admission:dshAdmission,view}]);resolve(value);
   }catch(error){rejectValue(error);}finally{if(signal&&abort)try{const returned=apply(removeSignal,signal,['abort',abort]);if(returned!==undefined){physical.add(retain(returned));fail(Error('DSH_BUSINESS_SIGNAL_OFF_UNKNOWN'));}}catch(error){markUnknown(row);fail(error);}}
  });return result;
 }
 const dshFacet:KSwarmDshFacet|undefined=dshAdmission?freeze({prepareOwner:(context:KSwarmDshContext)=>dshCall('prepare_dsh_owner',null,context),readDomain:(input:unknown,context:KSwarmDshContext)=>dshCall('read_dsh_domain',input,context),applyControl:(input:unknown,context:KSwarmDshContext)=>dshCall('apply_dsh_control',input,context),applyCommand:(input:unknown,context:KSwarmDshContext)=>dshCall('apply_dsh_command',input,context),prepareSlot:(input:unknown,context:KSwarmDshContext)=>dshCall('prepare_dsh_slot',input,context),readBasis:(input:unknown,context:KSwarmDshContext)=>dshCall('read_dsh_basis',input,context),readWork:(input:unknown,context:KSwarmDshContext)=>dshCall('read_dsh_work',input,context),readSlot:(input:unknown,context:KSwarmDshContext)=>dshCall('read_dsh_slot',input,context),stageDraft:(input:unknown,context:KSwarmDshContext)=>dshCall('stage_dsh_draft',input,context),commitDraft:(input:unknown,context:KSwarmDshContext)=>dshCall('commit_dsh_draft',input,context),readDraft:(input:unknown,context:KSwarmDshContext)=>dshCall('read_dsh_draft',input,context)}):undefined;
 // Only the fixed constructor Source can close that producer frontier.
 interface PreparationRecord {physical:ReturnType<typeof createIntrinsicSet<Root>>;producer:Root;projectId:string;lookup:unknown;proof:object;signal:AbortSignal;workId:string;sourceIncarnation:string;custody:object;closed:boolean;sealed:boolean;unknown:boolean;sourceDepth:number;observed:boolean;sealInvoked:boolean;cuts:unknown[];ackWire?:Wire;ackReservation?:object;hostObserved?:ReturnType<typeof createIntrinsicSet<object>>;hostRef?:object;hostRegistration?:Record<string,any>;hostFinished?:boolean;hostFinishReservation?:object;hostFinishWire?:Wire;hostEffectStopped?:boolean;cut?:'no_ack'|'ack_registered'|'host_no_effect_registered'}
 const workProofs=new WeakMap<object,PreparationRecord>(),preparationWorks=createIntrinsicSet<PreparationRecord>();
 const acceptedPreparationProofs=new WeakMap<object,AcceptedPreparationBinding>();
 let preparationGuardActive=false;
 function preparationUnknown(work:PreparationRecord,raw:unknown){work.unknown=true;unknowns.add(raw);fail(raw);}
 function producerCut(work:PreparationRecord,raw:unknown){
  if(work.sourceDepth){appendIntrinsic(work.cuts,raw);return;}
  try{const cut=data(raw) as Record<string,unknown>;
   if(!exact(cut,cut?.disposition==='unconfirmed'?['disposition','error']:['disposition']))throw Error('DISPATCH_PREPARATION_CUT_INVALID');
   if(cut.disposition==='unconfirmed'){preparationUnknown(work,cut.error);return;}
   if(cut.disposition==='no_ack'&&work.hostRef)throw Error('DISPATCH_PREPARATION_HOST_UNSETTLED');
   if(cut.disposition==='host_no_effect_registered'&&!work.hostFinishWire?.sent)throw Error('DISPATCH_PREPARATION_HOST_FINISH_NOT_REGISTERED');
   if(cut.disposition!=='host_no_effect_registered'&&cut.disposition!=='no_ack'&&(cut.disposition!=='ack_registered'||!work.ackWire?.sent))throw Error('DISPATCH_PREPARATION_ACK_NOT_REGISTERED');
   if(work.closed){if(work.cut!==cut.disposition)preparationUnknown(work,Error('DISPATCH_PREPARATION_CUT_CONFLICT'));return;}
   if(work.unknown)return;work.cut=cut.disposition as 'no_ack'|'ack_registered'|'host_no_effect_registered';work.closed=true;work.producer.complete();
  }catch(error){preparationUnknown(work,error);}
 }
 function sourceVoid(work:PreparationRecord,fn:(...args:any[])=>unknown,args:unknown[]){
  work.sourceDepth++;let returned:unknown,valid=false;
  try{returned=apply(fn,preparationSource,args);if(returned!==undefined){trackPreparationPhysical(work,retain(returned));throw Error('DISPATCH_PREPARATION_SOURCE_RETURN_UNCONFIRMED');}valid=true;}
  catch(error){preparationUnknown(work,error);throw error;}
  finally{work.sourceDepth--;if(valid&&!work.sourceDepth){const cuts=work.cuts;work.cuts=[];for(let i=0;i<cuts.length;i++)producerCut(work,cuts[i]);}}
 }
 function preparationSignal(work:PreparationRecord){if(apply(signalAborted,work.signal,[]))throw apply(signalReason,work.signal,[]);}
 function preparationGuard(work:PreparationRecord,operation:string,input:unknown,continuation:boolean,sent:()=>boolean){
  const check=()=>{local(continuation);if(work.hostEffectStopped&&!sent()&&operation!=='read_prepare_call'&&operation!=='ack_prepared')throw Error('DISPATCH_PREPARATION_HOST_EFFECT_STOPPED');if(work.unknown||work.closed&&!sent())throw Error('DISPATCH_PREPARATION_WORK_CLOSED');preparationSignal(work);};
  return()=>{
   check();active(continuation,work.physical);if(preparationGuardActive||!sync(preparationAdmission))throw Error('DISPATCH_PREPARATION_ADMISSION_REENTRY');
   preparationGuardActive=true;let returned:unknown;
   try{returned=apply(preparationAdmission,undefined,[work.proof,freeze({operation,scope,serviceOwner:owner,projectId:work.projectId,input,workId:work.workId,sourceIncarnation:work.sourceIncarnation})]);}finally{preparationGuardActive=false;}
   if(returned!==undefined){trackPreparationPhysical(work,retain(returned));preparationUnknown(work,returned);throw Error('DISPATCH_PREPARATION_ADMISSION_UNCONFIRMED');}check();
  };
 }
 function preparationCall(work:PreparationRecord,operation:string,input:unknown):Promise<unknown>{
  let resolve!:(value:unknown)=>void,rejectValue!:(error:unknown)=>void;
  const result=promise<unknown>((yes,no)=>{resolve=yes;rejectValue=no;}),row=root();
  trackPreparationPhysical(work,row);observe(row,async()=>{let abort:(()=>void)|undefined;try{
   const continuation=operation==='read_prepare_call'||operation==='ack_prepared';
   local(continuation);if(work.closed||work.unknown)throw Error('DISPATCH_PREPARATION_WORK_CLOSED');
   let ackReservation:object|undefined;if(operation==='ack_prepared'){if(work.hostRef)throw Error('DISPATCH_PREPARATION_HOST_EFFECT_PERMISSION_UNAVAILABLE');if(work.ackReservation||work.hostFinishReservation)throw Error('DISPATCH_PREPARATION_ACK_ALREADY_REGISTERED');ackReservation=inert({});work.ackReservation=ackReservation;}
   const closed=data(input,work.physical);let sent=false;const guard=preparationGuard(work,operation,closed,continuation,()=>sent);guard();
   abort=()=>rejectValue(apply(signalReason,work.signal,[]));apply(addSignal,work.signal,['abort',abort,{once:true}]);guard();
   await checked(prepareHello(continuation));guard();
   const value=await checked(wire({protocol,type:'request',scope,nonce:sessionNonce,instance,id:sequence+1,op:operation,projectId:work.projectId,input:closed,family:'preparation',workId:work.workId,sourceIncarnation:work.sourceIncarnation},guard,continuation,wire=>{trackPreparationPhysical(work,wire);if(operation==='ack_prepared'){if(work.ackReservation!==ackReservation||work.ackWire)throw Error('DISPATCH_PREPARATION_ACK_ALREADY_REGISTERED');work.ackWire=wire;}sent=true;}));
   guard();resolve(value);
  }catch(error){rejectValue(error);}finally{if(abort)try{const returned=apply(removeSignal,work.signal,['abort',abort]);if(returned!==undefined){trackPreparationPhysical(work,retain(returned));preparationUnknown(work,returned);}}catch(error){preparationUnknown(work,error);}}});return result;
 }
 function hostChildren(work:PreparationRecord,raw:unknown){
  const seen=createIntrinsicSet<object>(),pending:unknown[]=[raw];
  if(!work.hostObserved)work.hostObserved=createIntrinsicSet<object>();
  for(let at=0;at<pending.length;at++){
   const value=pending[at];if(!value||typeof value!=='object'&&typeof value!=='function'||seen.has(value))continue;seen.add(value);
   if(seen.size>65536){unknowns.add(value);work.unknown=true;return;}
   const inventory=scanTaskStoreSdkChildren(value,isPromise(value));
   if(isPromise(value)&&!isProxy(value)&&!work.hostObserved.has(value)){
    work.hostObserved.add(value);const row=tail(value);trackPreparationPhysical(work,row);
    if(!standard(value)){markUnknown(row);unknowns.add(value);work.unknown=true;}
    else try{apply(then,value,[(settled:unknown)=>{try{hostChildren(work,value);hostChildren(work,settled);row.complete();}catch(error){markUnknown(row);preparationUnknown(work,error);}},(error:unknown)=>{try{hostChildren(work,value);hostChildren(work,error);row.complete();preparationUnknown(work,error);}catch(cause){markUnknown(row);preparationUnknown(work,cause);}}]);}
    catch(error){markUnknown(row);preparationUnknown(work,error);}
   }
   for(let i=0;i<inventory.promises.length;i++)appendIntrinsic(pending,inventory.promises[i]);
   for(let i=0;i<inventory.unknowns.length;i++){unknowns.add(inventory.unknowns[i]);work.unknown=true;}
  }
 }
 function hostSourceCall(work:PreparationRecord,fn:Function,receiver:unknown,args:unknown[]):unknown{
  work.sourceDepth++;let valid=false;
  try{const raw=apply(fn,receiver,args);valid=true;return raw;}
  catch(error){hostChildren(work,error);throw error;}
  finally{work.sourceDepth--;if(valid&&!work.sourceDepth){const cuts=work.cuts;work.cuts=[];for(let i=0;i<cuts.length;i++)producerCut(work,cuts[i]);}}
 }
 function hostCall(work:PreparationRecord,settling:boolean):Promise<unknown>{
  let yes!:(value:unknown)=>void,no!:(error:unknown)=>void;
  const result=promise<unknown>((resolve,reject)=>{yes=resolve;no=reject;});
  // Reserve once before a Source can reenter. Missing Source owns no HostRef.
  if(!resolveRegistration||!resolveNoEffect){no(Error('DISPATCH_PREPARATION_HOST_SOURCE_REQUIRED'));return result;}
  try{
   local(settling);if(work.unknown||work.closed)throw Error('DISPATCH_PREPARATION_WORK_CLOSED');
   if(settling){if(work.hostFinishReservation||work.ackReservation)throw Error('DISPATCH_PREPARATION_HOST_FINISH_ALREADY_REGISTERED');if(!work.hostRef)throw Error('DISPATCH_PREPARATION_HOST_REQUIRED');work.hostFinishReservation=inert({});work.hostEffectStopped=true;}
   else{if(work.hostRef||work.hostEffectStopped)throw Error('DISPATCH_PREPARATION_HOST_ALREADY_REGISTERED');preparationSignal(work);work.hostRef=inert({});}
  }catch(error){no(error);return result;}
  const prior=work.physical.snapshot(),hello=helloPhysical.snapshot();for(let i=0;i<hello.length;i++)appendIntrinsic(prior,hello[i]!);
  const row=root();trackPreparationPhysical(work,row);
  observe(row,async()=>{let entered=false;try{
   if(settling){await checked(join(prior));for(let i=0;i<prior.length;i++)if(prior[i]!.unknown||!prior[i]!.finishedRoot)throw Error('DISPATCH_PREPARATION_HOST_PRIOR_UNCONFIRMED');}
   const operation=settling?'finish_host_no_effect':'register_host';
   const localHost=()=>{local(settling);if(work.unknown||work.closed&&!work.hostFinishWire?.sent||!work.hostRef&&!work.hostFinished)throw Error('DISPATCH_PREPARATION_HOST_UNCONFIRMED');if(!settling){if(!entered&&work.hostEffectStopped)throw Error('DISPATCH_PREPARATION_HOST_EFFECT_STOPPED');preparationSignal(work);}};
   localHost();
   const audience=freeze({operation,scope,serviceOwner:owner,projectId:work.projectId,input:null,workId:work.workId,sourceIncarnation:work.sourceIncarnation});
   const sourceFn=settling?resolveNoEffect!:resolveRegistration!;
   const raw=hostSourceCall(work,sourceFn,hostSource,[work.custody,audience]);
   // Scan raw siblings before checking the closed envelope. Never invoke a getter.
   if(!raw||typeof raw!=='object'||isProxy(raw)||isPromise(raw)||prototype(raw)!==null&&prototype(raw)!==objectPrototype){hostChildren(work,raw);trackPreparationPhysical(work,retain(raw));throw Error('DISPATCH_PREPARATION_HOST_SOURCE_UNCONFIRMED');}
   const fields=descriptors(raw),names=ownKeys(fields);
   for(let i=0;i<names.length;i++){const field=fields[names[i] as string]!;if(!own(field,'value')){trackPreparationPhysical(work,retain(raw));continue;}if(!(names[i]==='assertCurrent'&&sync(field.value)))try{data(field.value,work.physical);}catch{}}
   if(!exact(fields,['data','assertCurrent'])||!own(fields.data!,'value')||!own(fields.assertCurrent!,'value')||!sync(fields.assertCurrent!.value))throw Error('DISPATCH_PREPARATION_HOST_SOURCE_UNCONFIRMED');
   const input=data(fields.data!.value,work.physical) as Record<string,any>;
   const expected=settling?['scope','projectId','registrationDigest','hostLeaseKey','sourceIncarnation','reason']:['scope','projectId','childKey','payloadHash','admissionId','preparationIntentDigest','sourceIncarnation','hostLeaseKey'];
   if(!exact(input,expected)||!exact(input.scope,['profileId','workspaceId'])||input.scope.profileId!==scope.profileId||input.scope.workspaceId!==scope.workspaceId||input.projectId!==work.projectId||input.sourceIncarnation!==work.sourceIncarnation||!hex(input.hostLeaseKey))throw Error('DISPATCH_PREPARATION_HOST_DATA_INVALID');
   const lookup=work.lookup as Record<string,unknown>;
   if(settling){if(input.hostLeaseKey!==work.hostRegistration?.hostLeaseKey||!hex(input.registrationDigest)||input.reason!=='cancelled'&&input.reason!=='revoked'&&input.reason!=='final_gate_denied')throw Error('DISPATCH_PREPARATION_HOST_DATA_INVALID');}
   else if(input.childKey!==lookup.childKey||input.payloadHash!==lookup.payloadHash||typeof input.admissionId!=='string'||!input.admissionId||!hex(input.preparationIntentDigest))throw Error('DISPATCH_PREPARATION_HOST_DATA_INVALID');
   const guard=()=>{
    localHost();active(settling,work.physical);
    if(!settling)preparationGuard(work,operation,input,false,()=>entered)();
    const returned=hostSourceCall(work,fields.assertCurrent!.value,raw,[]);
    if(returned!==undefined){hostChildren(work,returned);trackPreparationPhysical(work,retain(returned));throw Error('DISPATCH_PREPARATION_HOST_SOURCE_UNCONFIRMED');}localHost();
   };
   guard();await checked(prepareHello(settling));guard();
   const value=await checked(wire({protocol,type:'request',scope,nonce:sessionNonce,instance,id:sequence+1,op:operation,projectId:work.projectId,input,family:'preparation',workId:work.workId,sourceIncarnation:work.sourceIncarnation},guard,settling,wire=>{trackPreparationPhysical(work,wire);if(settling)work.hostFinishWire=wire;entered=true;}));
   guard();if(!value||typeof value!=='object'||(value as Record<string,unknown>).ok!==true)throw Error('DISPATCH_PREPARATION_HOST_RESULT_UNCONFIRMED');
   if(settling){work.hostFinished=true;work.hostRef=undefined;}else work.hostRegistration=input;
   yes(value);
  }catch(error){preparationUnknown(work,error);no(error);}});return result;
 }
 function trackPreparationPhysical(work:PreparationRecord,row:Root){
  work.physical.add(row);const done=()=>{if(row.finishedRoot&&!row.unknown)work.physical.delete(row);};appendIntrinsic(row.listeners,done);done();
 }
 function assertPreparationKnown(work:PreparationRecord){
  if(work.unknown)throw Error('DISPATCH_PREPARATION_PHYSICAL_UNCONFIRMED');
  const check=(rows:readonly Root[])=>{for(let i=0;i<rows.length;i++)if(rows[i]!.unknown||!rows[i]!.finishedRoot)throw Error('DISPATCH_PREPARATION_PHYSICAL_PENDING');};
  check(work.physical.snapshot());check(helloPhysical.snapshot());
 }
 /** Current actual frontier only. The fixed Source must stop producing new
  * operations before using this cut; the future producer itself is excluded. */
 function waitPreparationKnown(work:PreparationRecord):Promise<void>{
  return promise<void>(resolve=>{
   const watched=createIntrinsicSet<Root>();
   const check=()=>{
    const rows=work.physical.snapshot(),hello=helloPhysical.snapshot();for(let i=0;i<hello.length;i++)appendIntrinsic(rows,hello[i]!);
    let known=!work.unknown;
    for(let i=0;i<rows.length;i++){const row=rows[i]!;if(row.unknown||!row.finishedRoot)known=false;if(!row.finishedRoot&&!row.unknown&&!watched.has(row)){watched.add(row);appendIntrinsic(row.listeners,check);}}
    if(known)resolve();
   };check();
  });
 }
 function openPreparationWork(projectId:string,lookup:{childKey:string;payloadHash:string},context:KSwarmPreparationContext):KSwarmPreparationWork{
  local();if(!resolveWork||!observeWork||!sealWork||preparationGuardActive)throw Error('DISPATCH_PREPARATION_FIXED_SOURCE_REQUIRED');
  if(!context||typeof context!=='object'||isProxy(context))throw Error('DISPATCH_PREPARATION_SCHEDULER_REQUIRED');
  const rows=descriptors(context);if(!exact(rows,['requestSource','preparationProof','signal']))throw Error('DISPATCH_PREPARATION_SCHEDULER_REQUIRED');
  for(const name of ['requestSource','preparationProof','signal'])if(!own(rows[name]!,'value'))throw Error('DISPATCH_PREPARATION_SCHEDULER_REQUIRED');
  const proof=rows.preparationProof!.value,signal=rows.signal!.value as AbortSignal;
  if(rows.requestSource!.value!=='scheduler'||!proof||typeof proof!=='object'||isProxy(proof)||isProxy(signal))throw Error('DISPATCH_PREPARATION_SCHEDULER_REQUIRED');
  apply(signalAborted,signal,[]);if(apply(weakGet,workProofs,[proof]))throw Error('DISPATCH_PREPARATION_WORK_ALREADY_OPEN');
  if(typeof projectId!=='string'||!projectId||projectId.length>256||projectId.trim()!==projectId||projectId.includes('\0'))throw Error('DISPATCH_BUSINESS_PROJECT_INVALID');
  const closed=data(lookup) as Record<string,unknown>;
  if(!exact(closed,['childKey','payloadHash'])||typeof closed.childKey!=='string'||closed.childKey.length!==87||closed.childKey.slice(0,23)!=='default-dispatch-child:'||!hex(closed.childKey.slice(23))||!hex(closed.payloadHash))throw Error('DISPATCH_PREPARATION_LOOKUP_INVALID');
  const work:PreparationRecord=inert({physical:createIntrinsicSet<Root>(),producer:root(),projectId,lookup:closed,proof,signal,workId:'',sourceIncarnation:'',custody:inert({}),closed:false,sealed:false,unknown:false,sourceDepth:0,observed:false,sealInvoked:false,cuts:[]});
  apply(weakSet,workProofs,[proof,work]);preparationWorks.add(work);
  apply(weakSet,acceptedPreparationProofs,[proof,freeze({client,source:preparationSource!,admission:preparationAdmission!,scope,assertKnown(){assertPreparationKnown(work);},waitKnown(){return waitPreparationKnown(work);},assertCurrent(){if(terminal&&errors.length)throw errors[0];if(disposed||work.unknown||work.closed)throw Error('DISPATCH_PREPARATION_WORK_CLOSED');preparationSignal(work);try{active(true,work.physical);}catch(error){if(terminal&&errors.length)throw errors[0];throw error;}preparationSignal(work);if(disposed||work.unknown||work.closed)throw Error('DISPATCH_PREPARATION_WORK_CLOSED');}})]);
  let observing=false;
  try{
   active(false,work.physical);preparationSignal(work);
   const raw=apply(resolveWork,preparationSource,[proof,freeze({operation:'open_work',scope,serviceOwner:owner,projectId,input:closed})]);
   work.producer.raw=raw;
   if(!raw||typeof raw!=='object'||isProxy(raw)||isPromise(raw)||prototype(raw)!==null&&prototype(raw)!==objectPrototype||ownKeys(raw).length!==3){retain(raw);preparationUnknown(work,raw);throw Error('DISPATCH_PREPARATION_WORK_UNKNOWN');}
   const fields=descriptors(raw);
   if(!exact(fields,['workId','sourceIncarnation','custody'])||!own(fields.workId!,'value')||!own(fields.sourceIncarnation!,'value')||!own(fields.custody!,'value')||!hex(fields.workId!.value)||!hex(fields.sourceIncarnation!.value)||!fields.custody!.value||typeof fields.custody!.value!=='object'||isProxy(fields.custody!.value)){
    retain(raw);preparationUnknown(work,raw);throw Error('DISPATCH_PREPARATION_WORK_UNKNOWN');
   }
   const custody=fields.custody!.value as object;
   if(isPromise(custody)||prototype(custody)!==null||ownKeys(custody).length!==0||!isFrozen(custody)){retain(custody);preparationUnknown(work,custody);throw Error('DISPATCH_PREPARATION_CUSTODY_UNKNOWN');}
   work.workId=fields.workId!.value;work.sourceIncarnation=fields.sourceIncarnation!.value;work.custody=custody;
   observing=true;sourceVoid(work,observeWork,[work.custody,(cut:unknown)=>producerCut(work,cut)]);work.observed=true;
   if(work.sealed&&!work.sealInvoked){work.sealInvoked=true;sourceVoid(work,sealWork,[work.custody]);}
   preparationGuard(work,'open_work',closed,false,()=>false)();local();preparationSignal(work);
   const facade=freeze({registerHost:()=>hostCall(work,false),finishHostNoEffect:()=>hostCall(work,true),readBasis:()=>preparationCall(work,'read_preparation_basis',closed),prepareIntent:(input:unknown)=>preparationCall(work,'prepare_intent',input),admitSend:(input:unknown)=>preparationCall(work,'admit_send',input),readCall:(input:unknown)=>preparationCall(work,'read_prepare_call',input),acknowledge:(input:unknown)=>preparationCall(work,'ack_prepared',input)});
   apply(weakSet,acceptedPreparationWorks,[facade,apply(weakGet,acceptedPreparationProofs,[proof])]);return facade;
  }catch(error){if(!observing&&!work.unknown){work.closed=true;work.producer.complete();}throw error;}
 }
 const preparationFacet=preparationSource?freeze({openWork:openPreparationWork}):undefined;
 function seal(){
  if(sealed)return;sealed=true;const works=preparationWorks.snapshot();for(let i=0;i<works.length;i++){const work=works[i]!;if(work.sealed)continue;work.sealed=true;if(!work.observed)continue;work.sealInvoked=true;try{sourceVoid(work,sealWork!,[work.custody]);}catch{/* The producer remains strongly pending on an unconfirmed Source. */}}
 }
 function afterKnown(rows:readonly Root[],done:()=>void):void{
  let remaining=rows.length;if(!remaining){done();return;}
  for(let i=0;i<rows.length;i++){const row=rows[i]!;let counted=false;const check=()=>{if(!counted&&(row.finishedRoot||row.unknown)){counted=true;if(--remaining===0)done();}};
   if(!row.finishedRoot&&!row.unknown)appendIntrinsic(row.listeners,check);check();
  }
 }
 function join(rows:readonly Root[]):Promise<void>{
  // Private callback bookkeeping joins known native callbacks even if a SDK
  // poisoned ambient Promise constructors. No external then or accessor runs.
  return promise<void>(resolve=>{let remaining=rows.length;if(!remaining){resolve();return;}
   for(let i=0;i<rows.length;i++){const row=rows[i]!;let counted=false;const check=()=>{if(!counted&&(row.finishedRoot||row.unknown)){counted=true;if(--remaining===0)resolve();}};
    if(!row.finishedRoot&&!row.unknown)appendIntrinsic(row.listeners,check);check();
   }
  });
 }
 function cleanup(){if(disposed)return;disposed=true;for(let i=0;i<cleanups.length;i++)try{cleanups[i]!();}catch(error){fail(error);}}
 function sealAndDrainPrefix():Promise<void>{
  if(closing)return closing;let resolve!:()=>void,rejectValue!:(error:unknown)=>void;
  const result=promise<void>((yes,no)=>{resolve=yes;rejectValue=no;});closing=result;closeStarted=true;seal();const initial=roots.snapshot(),drainRoot=root();
  observe(drainRoot,async()=>{
   try{
    // Every pre-seal call includes its hello-to-request continuation. They
    // cannot issue fresh requests after seal; their existing sends stay owned.
    await checked(join(initial));
    // A producer can register a genuine continuation while close is waiting.
    // Its cut closes new publishers; join those actual late RPC roots too.
    await checked(join(roots.snapshot().filter(row=>row!==drainRoot)));
    if(!terminal){const hello=prepareHello(true);await checked(hello);active(true);
     const response=wire({protocol,type:'seal_prefix',scope,nonce:sessionNonce,instance,throughId:sequence,sealNonce:nonce()},()=>active(true),true);
     await checked(response);
    }
    await checked(join(wires.snapshot()));await checked(join(tails.snapshot()));cleanup();await checked(join(tails.snapshot()));
    if(unknowns.size)throw Error('DISPATCH_BUSINESS_CLOSE_UNCONFIRMED',{cause:errors[0]});if(errors.length)throw aggregateIntrinsicErrors(errors,'DISPATCH_BUSINESS_CLOSE_FAILED');resolve();
   }catch(error){
    // An invalid Promise observer is not a completed callback frontier. This
    // fallback uses only private notifications and owns its future off SDKs.
    const fallback=root();afterKnown(initial,()=>afterKnown(wires.snapshot(),()=>afterKnown(tails.snapshot(),()=>{
     cleanup();afterKnown(tails.snapshot(),()=>{rejectValue(error);fallback.complete();});
    })));
   }
  });return result;
 }
 const client=freeze({readPlan:(projectId:string,context:KSwarmBusinessContext)=>call('read_plan',projectId,null,context),
  captureDefaultDispatch:(projectId:string,input:unknown,context:KSwarmBusinessContext)=>call('capture_default_dispatch',projectId,input,context),
  readOperation:(projectId:string,input:unknown,context:KSwarmBusinessContext)=>call('read_operation',projectId,input,context),seal,sealAndDrainPrefix});
 function deliverHello():Promise<KSwarmBusinessHello>{
  let resolve!:(value:KSwarmBusinessHello)=>void,rejectValue!:(error:unknown)=>void;const result=promise<KSwarmBusinessHello>((yes,no)=>{resolve=yes;rejectValue=no;}),row=root();
  observe(row,async()=>{try{active();const hello=await checked(prepareHello());currentHello(hello);resolve(hello);}catch(error){rejectValue(error);}});return result;
 }
 apply(weakSet,clients,[client,freeze({readPreparationProof(proof:unknown){return proof&&typeof proof==='object'?apply(weakGet,acceptedPreparationProofs,[proof]) as AcceptedPreparationBinding|undefined:undefined;},prepare:deliverHello,assertCurrent:currentHello,assertPreparationCurrent:preparationHelloCurrent,preparationSource,preparationAdmission,preparationFacet,dshAdmission,dshFacet})]);
 let childClients=apply(weakGet,children,[child]) as ReturnType<typeof createIntrinsicSet<{scope:BusinessScope;client:object}>>|undefined;
 if(!childClients){childClients=createIntrinsicSet();apply(weakSet,children,[child,childClients]);}childClients.add({scope,client});return client;
}
